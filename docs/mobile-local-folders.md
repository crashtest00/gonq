# Android local folders (M-14 spike)

Status: the decision below rests on reading the pinned plugin sources (tauri-plugin-dialog 2.8.1, tauri-plugin-fs 2.6.0, in
`~/.cargo/registry`) and on a Kotlin prototype that is on a throwaway branch and is never merged, now run on an Android emulator.
Claims marked **SOURCE** are read from code. Claims marked **DEVICE** were observed in the emulator run named under "Device
evidence" (row ids `E1`..`E20` point at the table there). Nothing here is production code.

**Caveats that stand** (the evidence is an emulator, not a phone): (1) the picker was not browsed by touch: DocumentsUI ignored
the injected touch input, so the run drove it with keyboard focus (focus on "Use this folder", then "Allow") on a folder
pre-created at `Documents/GonqSpike`; the 39 s `pick` time is the harness, not a user. (2) Only one provider was exercised
(ExternalStorage); there was no Drive, Dropbox or SD-card provider, so null sizes or timestamps from other providers are still
unverified. (3) `ACTION_CREATE_DOCUMENT` (Save as outside a folder) was not run. (4) All timings are Android 11 (API 30) x86_64
`google_apis` image on a CI runner, so absolute numbers are an upper-bound feel, not phone numbers. (5) Revocation was simulated
with `pm clear` (which drops every persisted grant), not through the system settings screen. (6) The spike read returns text, so
the PNG read in E10 is mangled by UTF-8 decoding; binary read is not yet shown working.

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

APK first compiled by build-mobile.yml run 41133727842, sha 1c54ad1. The device run used build-mobile run 41148750205 from branch
`aigang/saf-spike-apk` (the same spike plus two changes; the inline `safspike` plugin needed an ACL permission entry before the
webview could call it, which M-30 gets for free from the real plugin's permission file). Device run: emulator workflow
`saf-spike-emulator`, https://github.com/crashtest00/gonq/actions/runs/41150845678 (job succeeded), artifact
`saf-evidence-7b1cc33cbf1f8b2816ee421bfda027d16086eb94` (`results.json`, `spike.logcat.txt` tag `GonqSaf`, 20 screenshots and
picker UI dumps). Image `system-images;android-30;google_apis;x86_64`, model `sdk_gphone_x86_64`, APK sha in `results.json` `info`.

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
**DEVICE, confirmed (E2, E3)**: the JS call `open({ directory: true })` rejected with "Folder picker is not implemented on mobile"
(screenshot `01-js-dialog-open-directory.png`). The system picker opened (`02-pick-picker-start.png`), showed the grant dialog
(`02-pick-picker-grant-dialog.png`), and `pick` resolved
`{"root":"primary:Documents/GonqSpike","tree":"content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FGonqSpike"}`;
logcat `GonqSaf : picked content://…/tree/primary%3ADocuments%2FGonqSpike`. The URI shape is as expected. Browsing the picker by
touch is untested (caveat 1).

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
**DEVICE, confirmed (E4..E9)**: on ExternalStorage `create`, `write` (`wt`), `read`, `stat`, `rename`, `list` and nested `list`/`read`
all work (Selftest, `04-selftest.png`; 12..45 ms per call). `persisted()` listed the tree with `read:true, write:true` right after the
pick (19 ms) and again after `am force-stop` and relaunch (129 ms), and `list` and `read` worked after the relaunch with no new pick
(E11, E12; `08-persisted.png`, `08-list.png`). So `takePersistableUriPermission` is enough; no re-prompt.

New facts the source reading did not give:
- **The tree is a hard fence (E13).** `read` of `../GonqSecond/d.md` and `create` in `Download/GonqSecond` (outside the granted tree)
  both fail with `SecurityException: Document … is not a descendant of primary:Documents/GonqSpike`. So a relative image or link that
  climbs out of the opened folder cannot be read, and Gonq cannot be talked into reading a sibling folder. The `local://` resolver
  must report this as "outside the opened folder", not as a crash.
- **A missing folder does not look like an error (E15).** With the folder moved away, `list` returned `{"entries":[]}` (an empty
  folder), while `read` of a file in it failed with `IllegalArgumentException … Missing file for primary:Documents/GonqSpike`.
  M-30 must `stat` the tree root (or treat the child query's null/empty cursor with a root check) so a vanished folder is
  "no longer available", not "No Markdown files.".
- **A revoked or cleared grant is a clean `SecurityException` (E14).** After `pm clear`, `persisted()` returned `[]`, and `list`, `read`
  and `write` with the old tree URI all failed with `SecurityException: Permission Denial … requires that you obtain access using
  ACTION_OPEN_DOCUMENT` (`09-persisted.png`, `09-list-revoked.png`). `persisted()` is therefore a reliable cheap check on reopen.
- **Flags:** every file reports 326 (`SUPPORTS_WRITE|DELETE|RENAME|MOVE`) and every folder 16716 (`DIR_SUPPORTS_CREATE|DELETE|RENAME|MOVE|METADATA`),
  so rename and delete are supported on ExternalStorage; other providers must be checked per document.

Two things to expect, to be confirmed on device: (a) listing is one `query` per folder, so a large folder is slow on the
ExternalStorage provider. **Measured (E18)**: 3000 files take 2.07, 2.43 and 2.48 s natively (logcat `list 3000 entries in … ms`) and 3.2, 3.5 and 3.5 s
as seen from JS, against 5 entries in 43 ms cold and 13..17 ms warm. Roughly 0.7 to 0.8 ms per entry: fine for a notes folder of a few hundred files, a visible
wait at several thousand. M-30 should list per folder on expand, never recursively, and should show "Loading…" (the desktop rule) rather than block; (b) providers other than
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
  "no longer available" error rather than a crash. **DEVICE, confirmed (E11, E14)** after force-stop (grant still listed, list works) and after `pm clear` (grant gone, calls fail with
`SecurityException`). Revoking through the system settings screen was not exercised (caveat 5), but it ends in the same state: the URI is no longer in
`persisted()`.

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
  measured on device (**E10, E19**): reading a 5 MB file as text took 2.47..2.51 s over the plugin channel, three runs. That is slow (JSON string, UTF-8 decode)
and the text read also destroys binary data (the PNG read in E10 comes back mangled), so `local_read` for images must return base64 or use the
fd path, not text. A 25 MB limit would be ~12 s on this emulator; M-30 should lower the image limit for `local://`, or stream through a custom protocol, if the
phone is no faster.

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
**DEVICE (E5, E16, E17)**: `stat` on ExternalStorage returns both: `{"modified":1793406931000,"size":69,"flags":326}` for `a.md`
(millisecond epoch, whole-second resolution). After a file was changed from outside the app (adb), `stat` returned a different
`modified` (1793406998000) and `size` (46), and `read` returned the new body: the conflict check detects an external edit
on this provider. Whole-second timestamps mean two edits in the same second with the same size are missed. Overwrite semantics
were measured (E6): `wt` truncates (writing "x" over a longer file read back "x"). Mode `w` read back "yy" after a 2-byte write over a 1-byte file, which
does not show whether `w` truncates (the test never wrote a shorter text after a longer one in mode `w`), so the rule stays `wt` because Android documents `w` as
possibly not truncating. Temp-then-rename: `create` of `spike-test.md.tmp` and `rename` to `spike-renamed.md` worked
(E7) but the provider created the `.tmp` as `application/octet-stream` with size 0 and a second `list` shows both names during
the sequence, confirming the non-atomic window. A second provider was not available; null sizes or timestamps remain a **risk**, not an observation.

## 6. Is "app documents folder only" a viable first-Beta fallback?

**Viable, with a clear loss. SOURCE.**

- The app's own files directory (`app_data_dir`/`documents`, resolved by `DataPaths`) is a real path. Everything that exists today works
  unchanged: `std::fs`, `folder::list_directory`, `recents.rs` with plain paths, the fs scope, relative images, `images.ts`, and atomic
  temp-then-rename saves (as `recents.rs` does for its own file). No Kotlin, no new scheme, and M-30 shrinks to scoping and a first-run folder.
- What the user loses: the folder is private to Gonq (no other app, no file manager and no Google Drive client sees it without
  "Share" or an export), it is deleted on uninstall or "Clear data", and there is no way to open an existing notes folder (Obsidian vault, Syncthing
  folder). The user could still pull files in with `ACTION_GET_CONTENT` (the dialog plugin's file picker; not run on the device, SOURCE only), which copies, so edits do not go back to the
  original. That is the opposite of what the owner asked for: "the first release includes local folders".
- It is a stepping stone, not a replacement: handle (`local://`) and path recents coexist, so shipping the app-folder first and SAF second costs
  no rework in `recents.rs`.

Recommendation to the owner: build the SAF plugin (a Kotlin class of the size of the prototype plus the M-30 routing) and ship a real folder pick. Use the app-documents
folder only if the device evidence shows the SAF listing is unusable (very slow, or the grant does not survive a restart on the
emulator image).

**The device evidence does not trigger that exception**: the grant survived a force-stop (E11), listing works without a new pick (E12), and the slowest
measurement (3000 entries, 2 to 3.5 s on an x86 emulator, E18) is acceptable if listing is per folder and shows "Loading…". The recommendation therefore stays:
build the SAF plugin for the first release. What the evidence adds is the list of things the plugin must do that the plain app folder never needs: root-existence check
(E15), binary-safe read (E10), `SecurityException` mapping (E13, E14). It remains an **owner decision** whether to ship the app-documents folder first as an
earlier milestone; it costs no rework in `recents.rs` either way. The open risk that could still flip it is a second provider (Drive, SD card) behaving worse than
ExternalStorage, which this run could not test.

## Proposed M-30 contract

No `invoke` outside `packages/editor/src/platform/`. New file `platform/local.ts` owns the `local://` format (like `github.ts`
owns `github://`), and `files.ts`, `folders.ts`, `images.ts`, `recents.ts` route by prefix.

Kotlin plugin `gonq-saf` registered by the `gonq-mobile` crate only (never desktop; nothing hidden by platform in UI: desktop shows
its native dialog, web and desktop raise a clear error from `local.ts`, as they do for `ssh://` today).

| Command (plugin `gonq-saf`)           | Arguments                  | Result                                                      |
| ------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| `local_pick_folder`                   | none                       | `{ tree: string, name: string } \| null` (cancel is `null`) |
| `local_granted`                       | none                       | `string[]` (trees still persisted)                          |
| `local_list`                          | `tree`, `rel`              | `FolderEntry[]` (same fields as today, sorted as `listFolderPage`); errors `not-found` when the tree root is gone (a provider returns an empty list, E15) |
| `local_stat`                          | `tree`, `rel`              | `{ size, modified \| null }` or error `not-found`           |
| `local_read`                          | `tree`, `rel`              | `bytes` (base64 over the channel; a text read corrupts images, E10) |
| `local_write`                         | `tree`, `rel`, `text`, `expected?: { size, modified }` | `{ size, modified }`; error `conflict` when `expected` no longer matches |
| `local_create`                        | `tree`, `rel`, `text`      | same as write; error `exists` (no silent rename: provider-added `(1)` suffixes are detected and deleted) |
| `local_exists`                        | `tree`, `rel`              | `boolean`                                                   |

- Types: `LocalHandle = { tree: string; rel: string }` (TypeScript) with `localPath(handle): string` and `parseLocalPath(path)` as in
  `github.ts`. `FolderEntry` is reused; `path` is the full `local://` string, so `FolderSidebar` needs no change.
- The Kotlin class cannot be in `gonq-core` (no JNI there). The Rust side is a thin `#[cfg(target_os = "android")]` shim; bindings for
  these commands are hand-declared in `platform/local.ts` because tauri-specta cannot generate a mobile plugin's commands (the `bindings.ts`
  drift check stays as it is). A mock for Vitest goes in `testing/mockBindings.ts`.
- Errors map to the existing `ListDirectoryError` kinds (`not-found`, `permission`, `unsupported`) and the SSH conflict error type.
  Device-observed sources: `SecurityException` "Permission Denial" (grant revoked, E14) becomes `permission` and removes the recent;
  `SecurityException` "not a descendant" (path climbs out of the tree, E13) becomes a distinct "outside the opened folder" message;
  `IllegalArgumentException` "Missing file for <root>" (E15) becomes `not-found`.
- `local_write` writes with mode `wt` only, and `expected` is compared against `stat` (`modified` has whole-second resolution, E16;
  size is compared too).
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
   dialog. Tested shape (E14, E15): a revoked grant fails with a `SecurityException`, a moved or deleted folder lists as empty until the root is checked, so the
   check on reopen is `local_granted` containing the tree **and** `local_stat` of the root succeeding.
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

Run: https://github.com/crashtest00/gonq/actions/runs/41150845678 (workflow `saf-spike-emulator`, branch `aigang/saf-spike-emulator`),
APK from build-mobile run 41148750205 (branch `aigang/saf-spike-apk`), Android 11 (API 30) x86_64 `google_apis` emulator.
Artifact `saf-evidence-7b1cc33cbf1f8b2816ee421bfda027d16086eb94`; "results" means `results.json` there (`k` names the row), "log" means
`spike.logcat.txt` (tag `GonqSaf`; `Tauri/Console` lines carry the JS-side result and ms), PNGs are in the same artifact.

| Id | Check | Expected from source | Result | Evidence |
| -- | ----- | -------------------- | ------ | -------- |
| E1 | Spike APK build | green | **Confirmed** | build-mobile run 41133727842 (sha 1c54ad1) and run 41148750205 (device APK); apksigner verify passed |
| E2 | `open({directory:true})` from JS | rejects with `FolderPickerNotImplemented` | **Confirmed**: rejected "Folder picker is not implemented on mobile" | results `js open({directory:true})`; `01-js-dialog-open-directory.png` |
| E3 | `pick` returns a tree URI | `content://…/tree/…` | **Confirmed**: `content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FGonqSpike`, root `primary:Documents/GonqSpike`; picker driven by keyboard focus, 39 s is harness time | results `pick output`, `picked tree URI`; log `picked content://…`; `02-pick-picker-start.png`, `02-pick-picker-grant-dialog.png`, `02-pick-after.png` |
| E4 | `persisted()` right after pick | tree listed read+write | **Confirmed**: `read:true, write:true`, 19 ms | results `Persisted button`; log `persisted=[…]`; `03-persisted.png` |
| E5 | `list`, `stat`, nested `list`/`read` | succeed | **Confirmed**: 5 entries in 43 ms (cold), `stat` gives `modified` (ms epoch) and `size`, nested `sub/c.md` read 12 ms | results `List button`, `stat a.md`, `list sub`, `read sub/c.md (nested)`; `03-list.png` |
| E6 | Selftest create/write/read/stat/truncate | succeed | **Confirmed**: `wt` truncates ("x" after shorter write); `w` result "yy" | results `selftest output` (`write shorter wt`, `read after shorter`, `write w`); `04-selftest.png` |
| E7 | Temp sibling + rename | works, not atomic | **Confirmed works**; `.tmp` created as `application/octet-stream`, size 0, visible in `list after` during the sequence | results `selftest output` (`create tmp sibling`, `rename`, `list after`) |
| E8 | Selftest timings | n/a | create 39 ms, write 31, read 37, stat 33, rename 45, list 14..32 ms | same row; log `Tauri/Console … GonqSaf …(N ms)` lines |
| E9 | Relative-image target found by tree path | readable | **Confirmed**: `img/pic.png` opens in 15 ms | results `read img/pic.png (relative image target, as text)` |
| E10 | Same, binary safety | bytes preserved | **Fails as written**: the spike returns text, the PNG bytes come back mangled; a base64 or fd read is needed | same row |
| E11 | `persisted()` after force-stop and relaunch | tree still listed, read+write | **Confirmed**, 129 ms, new pid 7377 | results `Persisted after force-stop`; log `persisted=[…]` pid 7377; `08-persisted.png`, `08-relaunch.png` |
| E12 | `list`/`read` after relaunch, no new pick | works | **Confirmed**: 8 entries in 13 ms; `a.md` read 15 ms | results `List after force-stop (no new pick)`, `read a.md after relaunch (direct tree)`; `08-list.png` |
| E13 | Read/create outside the granted tree | refused | **Confirmed**: `SecurityException: Document primary:Download/GonqSecond/d.md is not a descendant of primary:Documents/GonqSpike`; create likewise | results `read ../GonqSecond/d.md (outside granted tree)`, `create outside tree (Download/GonqSecond)`; log SecurityException stacks at 00:36:35.887 and .907 |
| E14 | Grant gone (`pm clear`) | calls fail, `persisted()` empty | **Confirmed**: `persisted()` `[]`; `list`, `read`, `write` fail `SecurityException: Permission Denial … requires … ACTION_OPEN_DOCUMENT`; revocation via system settings not exercised | results `Persisted after revoke`, `list/read/write … with the revoked tree URI`, `dumpsys uri_grants after pm clear`; `09-persisted.png`, `09-list-revoked.png`, `09-after-revoke.png` |
| E15 | Folder moved away while granted | error | **Surprise**: `list` returns `[]` (17 ms), `read` fails `Missing file for primary:Documents/GonqSpike` | results `list while folder moved away`, `read a.md while moved away`; log 00:37:18.950 and .965 |
| E16 | External edit visible to `stat` | `modified`/`size` change | **Confirmed**: `modified` 1793406931000 to 1793406998000, `size` 69 to 46; `read` returns new text | results `stat before external write`, `stat after external write`, `modified/size changed`, `read after external write` |
| E17 | `stat` fields present on ExternalStorage | yes | **Confirmed**, whole-second `modified`; second provider not tested | results `stat a.md` |
| E18 | List of 3000 files | seconds, not ms | **2.07, 2.43, 2.48 s native; 3.2, 3.5, 3.5 s from JS** | log `list 3000 entries in … ms`; results `list 3000 files run 1..3`; `07-perf.png` |
| E19 | Read of a 5 MB file as text | slow | **2.47..2.51 s**, 5 242 880 chars, three runs | results `read 5 MB (as text) run 1..3`; `07-perf.png` |
| E20 | Not run | n/a | `ACTION_CREATE_DOCUMENT` save-as; second provider (Drive, SD); touch browsing of the picker; revoke through system settings | caveats 1, 2, 3, 5 |

## As built (M-30)

The contract above is implemented as follows; where it differs, this section is what the code does.

- **Kotlin** `apps/mobile/src-tauri/gen/android/app/src/main/java/com/gonq/app/SafPlugin.kt`; **Rust shim** `apps/mobile/src-tauri/src/saf.rs` (plugin
  `gonq-saf`, registered by `gonq-mobile` only; permissions generated in build.rs, `gonq-saf:default` in capabilities/mobile.json; off Android every
  command fails with kind `unsupported`). **TypeScript** `packages/editor/src/platform/local.ts` is the only caller; fake plugin: `fakeSafPlugin()` in
  `testing/mockBindings.ts`.
- **Wire shapes.** Android plugins resolve objects, never a bare `null` or array, so Kotlin answers `{picked, tree?, name?}`, `{trees}`, `{entries:[{name,isDir}]}`,
  `{exists}` and `{size, modified|null, isDir}` (+ `bytes` base64 for a read); local.ts turns them into the contract's shapes (and accepts the bare shapes too).
  Filtering (folders and `.md`/`.markdown` only, no dotfiles) and the sort (folders first, A-Z ignoring case) are done in local.ts, so they are tested without a device.
- **Errors.** The Kotlin reject code is the kind: `not-found`, `permission`, `outside`, `conflict`, `exists`, `io`. folders.ts maps them to `not_found`,
  `permission_denied`, `not_allowed`, `unsupported`, `io`. `conflict` becomes `RemoteConflictError` (the SSH type), so the existing Cancel/Overwrite flow applies.
  A tree that is not in `persistedUriPermissions` is refused with `permission` before any provider call.
- **Reopening a recent** (`files.openPath`): `local_granted` must contain the tree and `local_stat` of the root must succeed; if not, the recent is removed and
  the platform text is thrown. A missing file in a healthy tree keeps the recent. `allowRecentDocument` is not called for `local://`.
- **Recents.** `recents.rs` is unchanged and stores `local://` strings. `listRecents` hides them everywhere except the Gonq Android app (desktop never writes
  them; the browser fallback filters them like `ssh://`).
- **Images.** In a `local://` document `..` above the root, an absolute path, or a `file:` path to elsewhere is refused with "That is outside the opened folder."
  (the ticket's "refuse" wording wins over the clamp suggested in section 4). Pictures over 8 MB (`MAX_LOCAL_IMAGE_BYTES`) are refused before reading, because
  base64 over the channel is slow (E19). Insert > Image into a `local://` document is not available yet (M-31).
- **Conflict check gap.** `expected` is compared on size always and on `modified` when both sides have one; whole-second timestamps mean an edit in the same
  second that keeps the size is missed, and a provider reporting no `modified` (null or 0) is checked on size alone. The check and the write are two calls, so a
  few milliseconds of race remain. A provider that gives neither size nor time is written unchecked. Not yet device-verified on a second provider (M-34).
- **Not built here:** screens (M-31), rename/delete, device evidence (M-34). The Kotlin and Rust Android code is compiled by the
  rust-checks `android` job and build-mobile.yml, not on the Jenkins box.

## As built (M-31, Save as outside an opened folder)

- **Command** `local_create_document` (`name`: the suggested file name) in the `gonq-saf` plugin: Kotlin `SafPlugin.local_create_document` launches
  `ACTION_CREATE_DOCUMENT` (openable, `text/markdown`, `EXTRA_TITLE` = the suggestion) with a persistable read+write grant, takes it, and resolves
  `{picked: true, tree, name}` (`tree` = the new document's URI, `name` = the name the user confirmed, which the provider may have changed) or
  `{picked: false}` on cancel (no error). Rust shim `saf.rs` forwards it; the permission is generated by build.rs and covered by `gonq-saf:default`.
  Reject codes are the usual ones (`permission`, `io`, ...).
- **Wrapper** `createLocalDocument(suggestedName)` in local.ts returns `{handle, name}` or `null` (cancel). The document is created empty: the caller
  writes it with `writeLocal(handle, text)` (no `expected`; it is new). Off Android it throws `unsupported` like the other commands.
- **A single-document grant as a local:// path.** The handle is `{tree: <document URI>, rel: <file name>}`, so `localPath` gives
  `local://<encoded document URI>/<name>`. It round-trips through `parseLocalPath`, is stored in recents as that string (`recents.rs` unchanged), is routed by
  `files.ts` like any local:// path, and `localFileName` yields the name for the tab title. The "tree" is not a folder tree: the Kotlin plugin recognises a
  non-tree URI (`!DocumentsContract.isTreeUri`) and treats the document as the whole root, accepting `rel` of `''` or one name (any one name addresses the
  document, so a rename outside the app does not break the path; more than one segment is `not-found`). The persisted-grant check, `local_granted`, `checkLocalRoot`
  (grant + root stat) and `local_stat/read/write` therefore work unchanged; `local_list` and `local_create` on it fail `not-found` (it is not a folder).
  Opening it as a project folder is not meant: the frontend uses it only as a document path.
- **Fake** `fakeSafPlugin().nextDocument = {uri, name}` queues what the next `local_create_document` resolves (null = cancel).
- Not compiled or run locally: the Kotlin and Rust parts are checked by the rust-checks `android` job and build-mobile.yml; device check is M-34.
