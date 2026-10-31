package com.gonq.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// M-14 SPIKE, throwaway: the smallest SAF plugin (tree pick with persistable grant, list, read, write, create, rename, delete, stat).
@InvokeArg class TreeArgs { var tree: String = ""; var doc: String? = null; var name: String? = null; var mime: String? = null; var text: String? = null; var mode: String? = null }

@TauriPlugin
class SafPlugin(private val activity: Activity) : Plugin(activity) {
  private val tag = "GonqSaf"
  private val cr get() = activity.contentResolver

  @Command
  fun pick(invoke: Invoke) {
    val i = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
      Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
    // Harness only: open the picker inside the seeded folder (touch input is ignored by the emulator's DocumentsUI, so it cannot browse).
    if (android.os.Build.VERSION.SDK_INT >= 26) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
      DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Documents/GonqSpike"))
    startActivityForResult(invoke, i, "pickResult")
  }

  @ActivityCallback
  fun pickResult(invoke: Invoke, r: ActivityResult) {
    val uri = r.data?.data
    if (r.resultCode != Activity.RESULT_OK || uri == null) { invoke.resolve(JSObject().put("cancelled", true)); return }
    cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    Log.i(tag, "picked $uri")
    invoke.resolve(JSObject().put("tree", uri.toString()).put("root", DocumentsContract.getTreeDocumentId(uri)))
  }

  /** Tree URIs still persisted after a restart (the answer to "does the grant survive"). */
  @Command
  fun persisted(invoke: Invoke) {
    val a = JSArray()
    for (p in cr.persistedUriPermissions) a.put(JSObject().put("uri", p.uri.toString()).put("read", p.isReadPermission).put("write", p.isWritePermission))
    Log.i(tag, "persisted=$a")
    invoke.resolve(JSObject().put("grants", a))
  }

  private fun docUri(a: TreeArgs): Uri {
    val tree = Uri.parse(a.tree)
    return DocumentsContract.buildDocumentUriUsingTree(tree, a.doc ?: DocumentsContract.getTreeDocumentId(tree))
  }

  @Command
  fun list(invoke: Invoke) = guard(invoke) { a ->
    val tree = Uri.parse(a.tree)
    val id = a.doc ?: DocumentsContract.getTreeDocumentId(tree)
    val kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id)
    val out = JSArray()
    val t0 = System.nanoTime()
    cr.query(kids, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use { c ->
      while (c.moveToNext()) out.put(JSObject().put("id", c.getString(0)).put("name", c.getString(1)).put("mime", c.getString(2))
        .put("dir", c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR).put("size", if (c.isNull(3)) -1 else c.getLong(3))
        .put("modified", if (c.isNull(4)) -1 else c.getLong(4)).put("flags", c.getInt(5)))
    }
    Log.i(tag, "list ${out.length()} entries in ${(System.nanoTime() - t0) / 1_000_000} ms")
    JSObject().put("entries", out)
  }

  @Command
  fun stat(invoke: Invoke) = guard(invoke) { a ->
    cr.query(docUri(a), arrayOf(DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
      DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use { c ->
      if (c.moveToFirst()) return@guard JSObject().put("size", if (c.isNull(0)) -1 else c.getLong(0))
        .put("modified", if (c.isNull(1)) -1 else c.getLong(1)).put("flags", c.getInt(2))
    }
    throw IllegalStateException("not found")
  }

  @Command
  fun read(invoke: Invoke) = guard(invoke) { a ->
    val text = cr.openInputStream(docUri(a))!!.use { it.readBytes().toString(Charsets.UTF_8) }
    JSObject().put("text", text)
  }

  /** mode "wt" truncates in place (not atomic); "w" is provider-defined. */
  @Command
  fun write(invoke: Invoke) = guard(invoke) { a ->
    cr.openOutputStream(docUri(a), a.mode ?: "wt")!!.use { it.write((a.text ?: "").toByteArray()) }
    JSObject().put("ok", true)
  }

  @Command
  fun create(invoke: Invoke) = guard(invoke) { a ->
    val parent = docUri(a)
    val u = DocumentsContract.createDocument(cr, parent, a.mime ?: "text/markdown", a.name!!)
    Log.i(tag, "created $u (asked ${a.name})")
    JSObject().put("uri", u.toString()).put("id", DocumentsContract.getDocumentId(u))
  }

  @Command
  fun rename(invoke: Invoke) = guard(invoke) { a ->
    val u = DocumentsContract.renameDocument(cr, docUri(a), a.name!!)
    JSObject().put("uri", u?.toString())
  }

  @Command
  fun delete(invoke: Invoke) = guard(invoke) { a -> JSObject().put("ok", DocumentsContract.deleteDocument(cr, docUri(a))) }

  private fun guard(invoke: Invoke, f: (TreeArgs) -> JSObject) {
    try { invoke.resolve(f(invoke.parseArgs(TreeArgs::class.java))) }
    catch (e: Exception) { Log.e(tag, "failed", e); invoke.reject("${e.javaClass.simpleName}: ${e.message}") }
  }
}
