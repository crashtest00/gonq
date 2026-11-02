package com.gonq.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.util.Base64
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.FileNotFoundException

// The Gonq local-folder backend (M-30): a Storage Access Framework tree the user picked, addressed as (tree URI, relative
// path of names). Registered by the gonq-mobile crate's `gonq-saf` plugin (src/saf.rs forwards the local_* commands here);
// packages/editor/src/platform/local.ts is the only caller. Every call is confined to a tree Android still holds a
// persisted grant for; names are resolved segment by segment, so a document id (provider-private) is never stored.
// M-31 adds a single-document grant (local_create_document, Save as outside an opened folder): the "tree" is then a document
// URI (not a tree URI) and rel is '' or the one file name; every other command treats that document as the whole root.
// Rejections carry a code that saf.rs passes on as the error kind: not-found, permission, outside, conflict, exists, io.

@InvokeArg
class NodeArgs {
  var tree: String = ""
  var rel: String = ""
}

@InvokeArg
class CreateDocArgs {
  var name: String = ""
}

@InvokeArg
class Expected {
  var size: Long = -1
  var modified: Long? = null
}

@InvokeArg
class WriteArgs {
  var tree: String = ""
  var rel: String = ""
  var text: String = ""
  var expected: Expected? = null
}

@InvokeArg
class BytesArgs {
  var tree: String = ""
  var rel: String = ""
  var bytes: String = ""
}

/** A failure with the code the frontend maps to a ListDirectoryError kind or the conflict error. */
class SafFailure(val code: String, message: String) : Exception(message)

@TauriPlugin
class SafPlugin(private val activity: Activity) : Plugin(activity) {
  private val cr get() = activity.contentResolver
  private val projection = arrayOf(
    Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE,
    Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED,
  )

  /** One row of a document query. `modified` is null when the provider gives none (or 0). */
  private class Node(val id: String, val name: String, val isDir: Boolean, val size: Long, val modified: Long?)

  private fun node(c: android.database.Cursor) = Node(
    id = c.getString(0),
    name = c.getString(1) ?: "",
    isDir = c.getString(2) == Document.MIME_TYPE_DIR,
    size = if (c.isNull(3)) -1 else c.getLong(3),
    modified = if (c.isNull(4) || c.getLong(4) == 0L) null else c.getLong(4),
  )

  @Command
  fun local_pick_folder(invoke: Invoke) {
    val i = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    i.addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
    )
    startActivityForResult(invoke, i, "pickResult")
  }

  @ActivityCallback
  fun pickResult(invoke: Invoke, r: ActivityResult) {
    val uri = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("picked", false))
      return
    }
    try {
      cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      // The folder's own name for the title; the tree id ("primary:Notes") is the fallback.
      val treeId = DocumentsContract.getTreeDocumentId(uri)
      val rootName = cr.query(DocumentsContract.buildDocumentUriUsingTree(uri, treeId), arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null }
      invoke.resolve(JSObject().put("picked", true).put("tree", uri.toString()).put("name", rootName ?: treeId.substringAfterLast('/').substringAfterLast(':')))
    } catch (e: Exception) {
      fail(invoke, e)
    }
  }

  /** Save as: the system create-document picker with a suggested name; the new document's grant is persisted. */
  @Command
  fun local_create_document(invoke: Invoke) {
    val a = invoke.parseArgs(CreateDocArgs::class.java)
    val i = Intent(Intent.ACTION_CREATE_DOCUMENT)
    i.addCategory(Intent.CATEGORY_OPENABLE)
    i.type = "text/markdown"
    i.putExtra(Intent.EXTRA_TITLE, a.name)
    i.addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )
    startActivityForResult(invoke, i, "createDocumentResult")
  }

  @ActivityCallback
  fun createDocumentResult(invoke: Invoke, r: ActivityResult) {
    val uri = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("picked", false))
      return
    }
    try {
      cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      // The name the user confirmed (the provider may have changed the suggestion); the last path piece is the fallback.
      val name = cr.query(uri, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)
        ?.use { if (it.moveToFirst()) it.getString(0) else null }
      invoke.resolve(JSObject().put("picked", true).put("tree", uri.toString()).put("name", name ?: uri.lastPathSegment ?: "Untitled.md"))
    } catch (e: Exception) {
      fail(invoke, e)
    }
  }

  /** The trees Android still holds a read+write grant for. */
  @Command
  fun local_granted(invoke: Invoke) {
    val a = JSArray()
    for (p in cr.persistedUriPermissions) if (p.isReadPermission && p.isWritePermission) a.put(p.uri.toString())
    invoke.resolve(JSObject().put("trees", a))
  }

  @Command
  fun local_list(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(NodeArgs::class.java)
    val tree = treeUri(a.tree)
    val dir = resolve(tree, a.rel)
    if (!dir.isDir) throw SafFailure("not-found", "${dir.name} is not a folder.")
    val out = JSArray()
    for (n in children(tree, dir.id)) out.put(JSObject().put("name", n.name).put("isDir", n.isDir))
    // A provider lists a vanished folder as empty (E15): an empty answer is only believed when the root still exists.
    if (out.length() == 0) rootNode(tree)
    JSObject().put("entries", out)
  }

  @Command
  fun local_stat(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(NodeArgs::class.java)
    val tree = treeUri(a.tree)
    val n = resolve(tree, a.rel)
    statJson(n)
  }

  @Command
  fun local_exists(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(NodeArgs::class.java)
    val tree = treeUri(a.tree)
    rootNode(tree)
    val found = try {
      resolve(tree, a.rel)
      true
    } catch (e: SafFailure) {
      if (e.code != "not-found") throw e
      false
    }
    JSObject().put("exists", found)
  }

  /** The bytes as base64: a text read would corrupt images (E10). */
  @Command
  fun local_read(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(NodeArgs::class.java)
    val tree = treeUri(a.tree)
    val n = resolve(tree, a.rel)
    if (n.isDir) throw SafFailure("not-found", "${n.name} is a folder, not a file.")
    val bytes = cr.openInputStream(docUri(tree, n.id))?.use { it.readBytes() } ?: throw SafFailure("io", "${n.name} could not be opened.")
    // The stat the text was read at, so a later save can detect an outside edit.
    val after = resolve(tree, a.rel)
    statJson(after).put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP))
  }

  /** Writes in place with mode "wt" (truncate), after comparing `expected` with the file's current size and modified time. */
  @Command
  fun local_write(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(WriteArgs::class.java)
    val tree = treeUri(a.tree)
    val n = resolve(tree, a.rel)
    if (n.isDir) throw SafFailure("not-found", "${n.name} is a folder, not a file.")
    val exp = a.expected
    if (exp != null && changed(exp, n)) throw SafFailure("conflict", "${n.name} changed since you opened it.")
    cr.openOutputStream(docUri(tree, n.id), "wt")?.use { it.write(a.text.toByteArray(Charsets.UTF_8)) }
      ?: throw SafFailure("io", "${n.name} could not be opened for writing.")
    statJson(resolve(tree, a.rel))
  }

  /** Creates a new file; fails with "exists" instead of letting the provider rename it to "name (1).md". */
  @Command
  fun local_create(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(WriteArgs::class.java)
    createNew(treeUri(a.tree), a.rel, a.text.toByteArray(Charsets.UTF_8), "application/octet-stream")
  }

  /** Like local_create for binary content (a picture): `bytes` is base64, the MIME type comes from the file name's extension. */
  @Command
  fun local_create_bytes(invoke: Invoke) = guard(invoke) {
    val a = invoke.parseArgs(BytesArgs::class.java)
    val data = try {
      Base64.decode(a.bytes, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
      throw SafFailure("io", "The picture data is not valid.")
    }
    val ext = a.rel.substringAfterLast('.', "").lowercase()
    val mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    createNew(treeUri(a.tree), a.rel, data, mime)
  }

  private fun createNew(tree: Uri, rel: String, data: ByteArray, mime: String): JSObject {
    val parts = segments(rel)
    if (parts.isEmpty()) throw SafFailure("exists", "That is the opened folder itself.")
    val name = parts.last()
    val parent = resolve(tree, parts.dropLast(1).joinToString("/"))
    if (!parent.isDir) throw SafFailure("not-found", "${parent.name} is not a folder.")
    if (children(tree, parent.id).any { it.name == name }) throw SafFailure("exists", "$name already exists.")
    val created = DocumentsContract.createDocument(cr, docUri(tree, parent.id), mime, name)
      ?: throw SafFailure("io", "$name could not be created.")
    val createdId = DocumentsContract.getDocumentId(created)
    // Some providers add a suffix on a name clash that raced the check above: the file is not ours, remove it.
    val actual = children(tree, parent.id).firstOrNull { it.id == createdId }
    if (actual != null && actual.name != name) {
      DocumentsContract.deleteDocument(cr, created)
      throw SafFailure("exists", "$name already exists.")
    }
    try {
      cr.openOutputStream(created, "wt")?.use { it.write(data) }
        ?: throw SafFailure("io", "$name could not be opened for writing.")
    } catch (e: Exception) {
      runCatching { DocumentsContract.deleteDocument(cr, created) }
      throw e
    }
    return statJson(resolve(tree, rel))
  }

  // ---- helpers ----

  private fun treeUri(tree: String): Uri {
    val uri = Uri.parse(tree)
    // Only a tree the user picked and Android still holds a persisted grant for is reachable.
    if (cr.persistedUriPermissions.none { it.uri == uri }) {
      throw SafFailure("permission", "Access to this folder was removed. Open it again to continue.")
    }
    return uri
  }

  /** A grant on one document (from local_create_document) rather than a folder tree. */
  private fun isSingleDoc(tree: Uri) = !DocumentsContract.isTreeUri(tree)

  private fun docUri(tree: Uri, id: String): Uri = if (isSingleDoc(tree)) tree else DocumentsContract.buildDocumentUriUsingTree(tree, id)

  /** Path segments; "..", "." and empty names are refused so a name can never climb out of the tree. */
  private fun segments(rel: String): List<String> {
    val parts = rel.split('/').filter { it.isNotEmpty() }
    if (parts.any { it == ".." || it == "." }) throw SafFailure("outside", "That is outside the opened folder.")
    return parts
  }

  private fun rootNode(tree: Uri): Node {
    val id = if (isSingleDoc(tree)) DocumentsContract.getDocumentId(tree) else DocumentsContract.getTreeDocumentId(tree)
    val root = cr.query(docUri(tree, id), projection, null, null, null)?.use { if (it.moveToFirst()) node(it) else null }
    return root ?: throw SafFailure("not-found", "The opened folder is no longer available.")
  }

  private fun children(tree: Uri, id: String): List<Node> {
    val out = ArrayList<Node>()
    cr.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), projection, null, null, null)?.use { c ->
      while (c.moveToNext()) out.add(node(c))
    }
    return out
  }

  /** Walks the names from the tree root. The first sibling with a name wins. */
  private fun resolve(tree: Uri, rel: String): Node {
    val parts = segments(rel)
    // A single document is the root itself, addressed with rel '' or its one file name.
    if (isSingleDoc(tree)) {
      if (parts.size > 1) throw SafFailure("not-found", "${parts.last()} was not found.")
      return rootNode(tree)
    }
    var cur = rootNode(tree)
    for (name in parts) {
      if (!cur.isDir) throw SafFailure("not-found", "${cur.name} is not a folder.")
      cur = children(tree, cur.id).firstOrNull { it.name == name } ?: throw SafFailure("not-found", "$name was not found.")
    }
    return cur
  }

  private fun statJson(n: Node): JSObject {
    val o = JSObject().put("size", n.size.coerceAtLeast(0)).put("isDir", n.isDir)
    if (n.modified != null) o.put("modified", n.modified) else o.put("modified", org.json.JSONObject.NULL)
    return o
  }

  /**
   * Whether the file differs from what the caller read. `modified` has whole-second resolution (E16), so size is compared
   * too; a provider that gives no modified time (either side) is compared on size alone.
   */
  private fun changed(exp: Expected, n: Node): Boolean {
    if (n.size >= 0 && exp.size >= 0 && n.size != exp.size) return true
    val m = n.modified
    val e = exp.modified
    return m != null && e != null && m != e
  }

  private fun guard(invoke: Invoke, f: () -> JSObject) {
    try {
      invoke.resolve(f())
    } catch (e: Exception) {
      fail(invoke, e)
    }
  }

  /** Maps a failure to the reject codes of the contract (docs/mobile-local-folders.md, "Proposed M-30 contract"). */
  private fun fail(invoke: Invoke, e: Exception) {
    val msg = e.message ?: ""
    when {
      e is SafFailure -> invoke.reject(e.message, e.code)
      e is SecurityException && msg.contains("not a descendant") ->
        invoke.reject("That is outside the opened folder.", "outside")
      e is SecurityException ->
        invoke.reject("Access to this folder was removed. Open it again to continue.", "permission")
      e is IllegalArgumentException && msg.contains("Missing file for") ->
        invoke.reject("The opened folder is no longer available.", "not-found")
      e is FileNotFoundException -> invoke.reject("That file was not found.", "not-found")
      else -> invoke.reject("${e.javaClass.simpleName}: $msg", "io")
    }
  }
}
