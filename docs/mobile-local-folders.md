# Android local folders (M-14 spike)

Status: the decision below rests on reading the pinned plugin sources (tauri-plugin-dialog 2.8.1, tauri-plugin-fs 2.6.0, in
`~/.cargo/registry`) and on a Kotlin prototype that is on a throwaway branch and is never merged. Every claim marked
**SOURCE** is read from code and is certain. Every claim marked **DEVICE** needs the emulator run (DevOps subtask) and is
UNVERIFIED until the evidence links in "Device evidence" are filled in. Nothing here is production code.

## Decision in one paragraph

Neither plugin can do local folders on Android. `tauri-plugin-dialog` cannot pick a folder (it returns an error on mobile) and
`tauri-plugin-fs` can only open a `content://` URI that points at one file; it cannot list a tree and holds no persisted
permission. So M-30 needs a small Kotlin Tauri plugin around the Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`,
`DocumentsContract`), and the folder is identified by an opaque handle (the tree URI), not by a path. The prototype for that
plugin is `SafPlugin.kt` on the spike branch (below). The "app documents folder only" fallback is viable but is a different
product (see question 6); the owner should choose.

## The prototype

Throwaway branch `chore/5226d53e-m14-spike-saf` (never merged; delete after M-30 starts). It adds:

- `apps/mobile/src-tauri/gen/android/app/src/main/java/com/gonq/app/SafPlugin.kt`, a Tauri plugin class with `pick`,
  `persisted`, `list`, `stat`, `read`, `write` (mode `wt` or `w`), `create`, `rename`, `delete`.
- `apps/mobile/src-tauri/src/saf_spike.rs`, an inline Tauri plugin `safspike` with one command that forwards to the Kotlin class
  (`register_android_plugin("com.gonq.app", "SafPlugin")`).
- `apps/mobile/src/safSpike.ts`, a debug panel (buttons Pick, Persisted, List, Selftest) that logs each step with its time to the
  page and to logcat (tag `GonqSaf`). The Selftest creates a file, writes, reads, stats, truncates, renames, and lists.

APK: build-mobile.yml run 41133727842, sha 1c54ad1, green (it compiles; it has not been run on a device by this author).

## 1. Can tauri-plugin-dialog pick a folder on Android?

**No. SOURCE.**

- `tauri-plugin-dialog-2.8.1/src/commands.rs`: in the `open` command, `options.directory` on `#[cfg(mobile)]` is
  `return Err(crate::Error::FolderPickerNotImplemented)`. JS `open({ directory: true })`, which `platform/folders.ts` `pickFolder` calls,
  therefore rejects on Android. The call never reaches Kotlin.
- `pick_folder`, `pick_folders` and `blocking_pick_folder` are all `#[cfg(desktop)]` in `src/lib.rs`.
- Even the file picker is `Intent.ACTION_GET_CONTENT` with `CATEGORY_OPENABLE` (`DialogPlugin.kt`, with a `TODO: ACTION_OPEN_DOCUMENT ??`).
  That grants a one-off read of the picked file and cannot be made persistent. It also means "Open file" on Android cannot be
  reopened from recents after a restart through the dialog plugin either.

Smallest plugin that can: `SafPlugin.pick` starts `ACTION_OPEN_DOCUMENT_TREE` with `FLAG_GRANT_READ_URI_PERMISSION |
FLAG_GRANT_WRITE_URI_PERMISSION | FLAG_GRANT_PERSISTABLE_URI_PERMISSION | FLAG_GRANT_PREFIX_URI_PERMISSION`, calls
`takePersistableUriPermission(uri, READ|WRITE)` in the result callback, and resolves `{ tree, root }` (the tree URI and
`DocumentsContract.getTreeDocumentId`). Cancel resolves `{ cancelled: true }`. About 25 lines.
**DEVICE**: picker UI on the emulator, returned URI shape (expected `content://com.android.externalstorage.documents/tree/primary%3A<dir>`).

## 2. Can tauri-plugin-fs list, read and write a tree URI? Does the grant survive a restart?

**List: no. SOURCE.** `tauri-plugin-fs-2.6.0/src/android.rs` has one Android feature: `Fs::open` with a `FilePath::Url` calls the
Kotlin `getFileDescriptor`, which does `contentResolver.openAssetFileDescriptor(uri, mode)` and hands the raw fd to Rust. That
opens a single *document* URI. `read_dir`, `stat`, `rename`, `remove`, `mkdir` in `commands.rs` use `std::fs` paths and the fs
scope; none consults `ContentResolver` or `DocumentsContract`. A tree URI cannot be listed, and the scope (`allow_directory`) is a
path glob, which a `content://` URI never matches. There is no call that creates a document in a tree.

**Read/write by document URI: partly. SOURCE.** Only the Rust `Fs::open` with a `FilePath::Url` reaches `getFileDescriptor`; whether the JS
`readFile`/`writeTextFile` forward a `content://` string there was not traced, and does not matter: there is no listing, no create and no
persisted grant, so it cannot carry the folder function. (UNVERIFIED on device.)

**Persisted grants: neither plugin calls `takePersistableUriPermission`. SOURCE** (`grep -rn takePersistable` over both: no hits). Without it a
tree grant dies with the process. With it, the grant is kept until the user revokes it or the app is uninstalled; Android caps persisted
URIs per app (documented as 128, 512 from Android 11), plenty for ten recents.

So the minimum is the Kotlin plugin: `list` (`DocumentsContract.buildChildDocumentsUriUsingTree` plus a `query` for id, name, mime,
size, last-modified, flags), `read` (`openInputStream`), `write` (`openOutputStream(uri, "wt")`), `create`
(`DocumentsContract.createDocument`), `rename` (`renameDocument`), `delete` (`deleteDocument`), `stat` (`query` on the document URI).
**DEVICE**: all of the above on a real provider, and Selftest, Persisted and List after `adb shell am force-stop com.gonq.app` and relaunch.

Two things to expect, to be confirmed on device: (a) listing is one `query` per folder, so a large folder is slow on the
ExternalStorage provider (the panel prints ms per list; compare with desktop's 3000-entry test in `folder.rs`); (b) providers other than
ExternalStorage (Drive, Dropbox) may return `null` sizes, no `COLUMN_LAST_MODIFIED`, or stream on demand.

## 3. What goes in recent.json

An **opaque handle**. A path is wrong on Android, and the recent entry must carry both which granted tree it lives in and where in it.

Proposal: keep `Recent { path: String, opened_at: u64 }` unchanged (so `recents.rs`, the specta bindings, the localStorage
fallback and the ten-entry cap all stay as they are) and put the handle in `path` as a new scheme next to `github://`:

```
local://<tree>/<rel>       tree = percent-encoded tree URI, rel = "/"-separated path under the tree root, e.g.
local://content%3A%2F%2Fcom.android.externalstorage.documents%2Ftree%2Fprimary%253ANotes/drafts/a.md
```

- `github://` and `ssh://` recents are untouched; they are routed by prefix the same way (`isGithubPath`, `isSshPath`). `local://` is
  routed by a new `isLocalHandle` in `platform/`. Desktop never writes `local://`.
- `rel` is names, not document IDs: a document ID is provider-private (`primary:Notes/a.md` for ExternalStorage, opaque numbers for
  Drive) and may not be stable between provider updates. Resolving names costs one list per path segment on open; the plugin
  walks the segments (`list` each level, match `display_name`). The handle therefore stays valid across restarts and can be
  shown or edited like a path. If two siblings share a name (providers allow it) the first is used and the open fails loudly if
  the result is a folder.
- Validity check on reopen: `persisted()` must still list `tree`; if not, the recent is removed (`recent_documents_remove`) with the usual
  "no longer available" error rather than a crash. **DEVICE**: confirm after force-stop and after revoking the grant in system settings.

## 4. Do relative images resolve?

`resolveImagePath(src, docPath)` is a pure string function. It splits `docPath` on `/` or `\`, drops the file name, applies `..`
and `.`, and joins with `/`. **SOURCE**, run against `local://…/drafts/a.md` it does the following:

- `ssh://host` is the only scheme prefix it preserves. For `local://<tree>/drafts/a.md` it would treat `local:` and the encoded
  tree as path segments and could pop the tree with enough `..`, so a `local://` branch must be added next to the `ssh` one: keep
  `local://<tree>` as the prefix, resolve `rel` only, and clamp at the root (a `..` above the root is dropped, as it is for
  `/` on desktop).
- `read()` in `images.ts` then calls `readFile(path)` from tauri-plugin-fs, which cannot read it (question 2). It needs a
  third branch like the existing `isSshPath(docPath)` one: `local.read(handle, rel)` returning bytes, and the `MIME` map and the `blob:` URL stay.
- Absolute image paths (`/x.png`, `C:\x.png`) have no meaning in a tree: they must fail with the same clear error as
  "Save the document to show images next to it." does today, or better "That image is outside the opened folder."
- Images are read whole (`MAX_IMAGE_BYTES` 25 MB applies). Binary read over the plugin channel is base64 in JSON; fine up to a few MB, and
  worth measuring on device (**DEVICE**: Selftest time for a 5 MB image).

Result: relative images work under the handle model once `images.ts` and `resolveImagePath` get a `local://` branch. They do not work
with a raw `content://` document URI as the document path, because the neighbouring file is not addressable from a document URI alone
(only from the tree, via `buildDocumentUriUsingTree`).

## 5. Can a save be atomic or conflict-checked?

Desktop reference: SSH carries a server version in the document and refuses to overwrite a changed file (`RemoteConflictError`,
`platform/files.ts`); GitHub sends the blob sha. Local desktop files have no check at all (the plan notes this: "desktop has no
external-change detection for local files").

**Atomic: not generally.** SAF has no `O_EXCL`, no `rename` over an existing name, and no fsync contract.
- `openOutputStream(uri, "wt")` truncates then writes; a crash or kill between them leaves an empty or short file. Mode `"w"` may
  not truncate on some providers (the Selftest writes a shorter text with `wt` then `w` to show which) so `wt` is the right mode.
- Write-to-temp-then-rename works by `createDocument(name + ".tmp")`, write, then `deleteDocument(original)` and `renameDocument(tmp, original)`.
  That is not atomic (there is a window with no file) and not supported on every provider (`FLAG_SUPPORTS_RENAME`, `FLAG_SUPPORTS_DELETE`;
  `renameDocument` can also return a new URI or `null`), and it changes the document ID, which would break other apps' grants and the
  provider's own file references. Not recommended.
- Recommendation: write in place with `wt`, after the conflict check below. It matches what desktop does for local files (`fs.writeTextFile`).

**Conflict-checked: yes, best effort.** Read `COLUMN_LAST_MODIFIED` and `COLUMN_SIZE` at open (`stat`), keep them on the document like the SSH
`version`, and `stat` again just before writing; if either differs, throw the same conflict error as SSH so the existing Overwrite/Cancel
dialog applies. Gaps: the check and the write are two calls (a race window of milliseconds); providers may report
`null`/0 for `last_modified` (then only size is compared, and an in-place edit that keeps the size is missed); some providers round
timestamps. When both are missing the save proceeds unchecked and the plan must say so. This is **stricter than desktop local files**, and the owner rule
"desktop wins" means this is optional: the plan should decide whether to ship the check, since desktop local saves overwrite silently.
**DEVICE**: report what `stat` returns for ExternalStorage and, if available on the emulator image, one second provider.

## 6. Is "app documents folder only" a viable first-Beta fallback?

**Viable, with a clear loss. SOURCE.**

- The app's own files directory (`app_data_dir`/`documents`, resolved by `DataPaths`) is a real path. Everything that exists today works
  unchanged: `std::fs`, `folder::list_directory`, `recents.rs` with plain paths, the fs scope, relative images, `images.ts`, and atomic
  temp-then-rename saves (as `recents.rs` does for its own file). No Kotlin, no new scheme, and M-30 shrinks to scoping and a first-run folder.
- What the user loses: the folder is private to Gonq (no other app, no file manager and no Google Drive client sees it without
  "Share" or an export), it is deleted on uninstall or "Clear data", and there is no way to open an existing notes folder (Obsidian vault, Syncthing
  folder). The user could still pull files in with `ACTION_GET_CONTENT` (the dialog plugin's file picker, **DEVICE**), which copies, so edits do not go back to the
  original. That is the opposite of what the owner asked for: "the first release includes local folders".
- It is a stepping stone, not a replacement: handle (`local://`) and path recents coexist, so shipping the app-folder first and SAF second costs
  no rework in `recents.rs`.

Recommendation to the owner: build the SAF plugin (a Kotlin class of the size of the prototype plus the M-30 routing) and ship a real folder pick. Use the app-documents
folder only if the device evidence shows the SAF listing is unusable (very slow, or the grant does not survive a restart on the
emulator image). **Decision for the owner**, see the evidence section.

## Proposed M-30 contract

No `invoke` outside `packages/editor/src/platform/`. New file `platform/local.ts` owns the `local://` format (like `github.ts`
owns `github://`), and `files.ts`, `folders.ts`, `images.ts`, `recents.ts` route by prefix.

Kotlin plugin `gonq-saf` registered by the `gonq-mobile` crate only (never desktop; nothing hidden by platform in UI: desktop shows
its native dialog, web and desktop raise a clear error from `local.ts`, as they do for `ssh://` today).

| Command (plugin `gonq-saf`)           | Arguments                  | Result                                                      |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `local_pick_folder`                   | none                       | `{ tree: string, name: string } \| null` (cancel is `null`) |
| `local_granted`                       | none                       | `string[]` (trees still persisted)                          |
| `local_list`                          | `tree`, `rel`              | `FolderEntry[]` (same fields as today, sorted as `listFolderPage`) |
| `local_stat`                          | `tree`, `rel`              | `{ size, modified \| null }` or error `not-found`           |
| `local_read`                          | `tree`, `rel`              | `bytes`                                                     |
| `local_write`                         | `tree`, `rel`, `text`, `expected?: { size, modified }` | `{ size, modified }`; error `conflict` when `expected` no longer matches |
| `local_create`                        | `tree`, `rel`, `text`      | same as write; error `exists` (no silent rename: provider-added `(1)` suffixes are detected and deleted) |
| `local_exists`                        | `tree`, `rel`              | `boolean`                                                   |

- Types: `LocalHandle = { tree: string; rel: string }` (TypeScript) with `localPath(handle): string` and `parseLocalPath(path)` as in
  `github.ts`. `FolderEntry` is reused; `path` is the full `local://` string, so `FolderSidebar` needs no change.
- The Kotlin class cannot be in `gonq-core` (no JNI there). The Rust side is a thin `#[cfg(target_os = "android")]` shim; bindings for
  these commands are hand-declared in `platform/local.ts` because tauri-specta cannot generate a mobile plugin's commands (the `bindings.ts`
  drift check stays as it is). A mock for Vitest goes in `testing/mockBindings.ts`.
- Errors map to the existing `ListDirectoryError` kinds (`not-found`, `permission`, `unsupported`) and the SSH conflict error type.
- `allow_document_folder` / `allow_recent_document` / the fs scope stay desktop-only: the only reachable locations are trees the user picked and
  Android still holds a persisted grant for (same principle: "Refuses any path the user has not chosen").
- `recents.rs` is unchanged; `local://` entries are filtered out on desktop and browser reads like `ssh://` is in the browser.
- Tests: Vitest with a fake plugin for `local.ts`, routing, `resolveImagePath` with `local://` (including `..` at the root), the conflict path, recents
  with `local://` and `github://` side by side. Device: M-34.

## Proposed M-31 screens

Desktop strings and roles verbatim (`FolderSidebar.tsx`, `RepoNavigator.tsx`, `ConflictDialog.tsx`); the folder navigator is a mobile-only
top-bar button (D5, outside the registry).

1. **Documents home → Open Folder…**: always present. It runs `local_pick_folder`; the system picker is Android's, not ours. Cancel returns with no message.
2. **Folder navigator** (bottom sheet): section "Project folder", title is the folder's base name only; with nothing open "No folder open", a
   disabled Refresh and "Open Folder…". Rows: folders and Markdown files only (no dotfiles, folders first, A-Z ignoring case), current file `aria-current`,
   "Loading…", "No Markdown files." for an empty folder, "Empty." for an empty subfolder. Refresh is always rendered, disabled with nothing open
   or while listing, and keeps expanded folders (no timers or watchers; Android has no change notification worth using).
3. **Revoked or missing grant** on reopen from recents or on Refresh: the error banner with the platform's error text; the recent is removed. No new
   dialog.
4. **Save / Save as…**: Save writes in place. Save as… uses `ACTION_CREATE_DOCUMENT` (a file picker for a new file, also persisted) only for a file *outside* an
   opened folder; inside an opened folder it creates in the current folder with the desktop name prompt. The conflict path is the existing Cancel/Overwrite
   dialog (D8 says GitHub only, so adopting it for local files is an owner call; see "cannot be matched").

## Desktop behaviours that cannot be matched on Android

- **Absolute paths.** A document has no filesystem path. The tab title, tooltip and "Recent" entries show the folder name and relative path, never `/storage/emulated/0/...`.
  Markdown links and images that use absolute paths do not resolve.
- **Open any file by path.** Opening a file with `ACTION_GET_CONTENT` is a copy, not an edit in place; only files inside a picked tree save back.
- **Launch with a path** (`take_launch_paths`, file association, "Open with"): needs intent handling and a persistable grant for a single document
  (`ACTION_OPEN_DOCUMENT`). Out of scope for v1 (see section 7 of the plan).
- **Atomic saves** (desktop `recents.rs` and local writes rename a temp file). See question 5.
- **Scope-based "only chosen folders".** Replaced by Android's persisted grant list; the user can revoke it in system settings and Gonq cannot prevent that.
- **Fast listing and watch.** `std::fs::read_dir` of a 3000-entry folder is instant; SAF is a content-provider query per folder with per-provider cost.
- **Symlinks, hidden files** and file modes: providers expose neither; "no dotfiles" is filtered by name only.
- **Case and name rules.** Providers may reject names (`:` `/`), rename on conflict (`a (1).md`), or be case-insensitive; desktop's Save as validation does not know.
- **Provider-dependent timestamps/size.** Conflict check may degrade to size-only or none.
- **SSH.** Out of mobile v1 (the M-05 excluded list).

## Device evidence

To be filled in from the DevOps subtask; this doc must not claim a DEVICE result until it links one.

| Check | Expected from source | Evidence |
| ----- | -------------------- | -------- |
| Spike APK build | green | Compiled: build-mobile run 41133727842 on sha 1c54ad1 succeeded (Kotlin plugin and Rust shim compile, apksigner verify passed), artifact `gonq-android-debug-signed-1c54ad1936b655088b9db9617eb5379733106218.apk` |
| `open({directory:true})` from JS | rejects with `FolderPickerNotImplemented` | (pending) |
| `pick` returns a tree URI | `content://…/tree/…` | (pending) |
| Selftest create/write/read/stat/truncate/rename/list | all succeed on ExternalStorage | (pending) |
| `persisted()` after force-stop and relaunch | tree still listed, read+write | (pending) |
| `list` after force-stop and relaunch | works without a new pick | (pending) |
| `stat` last-modified/size present | yes on ExternalStorage | (pending) |
| List of ~3000 files, ms | seconds, not ms | (pending) |
