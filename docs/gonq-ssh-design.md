# Gonq: Open Markdown over SSH — Design

Approved by the user 2026-10-10. Written by Claude, relaying the user's decisions.

## Summary

Gonq's desktop app will open, edit and save Markdown files on SSH servers, and will show remote folders in the folder navigator. It speaks SFTP from Rust using the pure-Rust `russh` and `russh-sftp` crates, behind the same file and folder interfaces the app already uses for local files.

**Decisions**

| Decision | Choice | Why |
| --- | --- | --- |
| SSH implementation | `russh` + `russh-sftp`, in-process | Builds for Windows, macOS and Linux without OpenSSL or a system `ssh` binary |
| v1 scope | Open, edit, save, remote folder tree | The core workflow first; images follow in v2 |
| Deferred to v2 | Relative images in remote documents | They need a remote fetch and a cache; text editing does not depend on them |
| Login model | Same as VS Code Remote-SSH | A saved key is used silently; otherwise the user logs in with a password |
| Folder choice | User picks a remote folder after connecting | The navigator never loads the whole home directory |
| Decrypted keys | Never kept | Dropped once connected; each new connection asks for the passphrase again |
| Host aliases | Each alias is its own host | Gonq stays hands-off with the system's aliases |
| ProxyJump | Out of scope entirely | Not needed |

**Goals**

- Open `.md` / `.markdown` files on any host reachable over SSH, with the user's existing keys and agent.
- Save back safely: no half-written file on a dropped connection, no silent overwrite of a change made on the server.
- Browse a user-chosen remote folder in the navigator exactly like a local one.
- Remote documents behave like local ones in tabs, recent files and unsaved-changes prompts.

**Non-goals for v1**

- Images and other linked files in remote documents (v2).
- Creating, renaming or deleting remote files and folders from the navigator.
- Watching remote files for live changes; changes are detected only at save time.
- SSH in the web beta: a browser cannot open SSH connections, so the feature is hidden there.
- SSH certificates, keyboard-interactive / two-factor prompts, `Match` blocks in `~/.ssh/config`. ProxyJump and bastion hosts are out of scope entirely.

## Current architecture

All native file access already sits behind two TypeScript modules and a few Rust commands, so SSH is a second backend behind the same seams.

| Piece | Where | What it does today | What changes |
| --- | --- | --- | --- |
| `FileAccess` interface | `src/platform/files.ts` | `pickDocument`, `openPath`, `saveDocument`, `saveDocumentAs`, `loadImage`. Desktop reads and writes through `@tauri-apps/plugin-fs`. | `openPath` / `saveDocument` route `ssh://` paths to new Rust commands. `loadImage` returns null for remote documents in v1. |
| Folder listing | `src-tauri/src/folder.rs` | `list_directory` returns `{name, path, is_dir}`: folders and Markdown only, no dotfiles, folders first. | Same filter and sort applied to an SFTP `readdir`. |
| Navigator calls | `src/platform/folders.ts` | `pickFolder`, `listDirectory`, `pathExists`. Errors arrive as typed `ListError` kinds. | `listDirectory` and `pathExists` accept `ssh://` paths. New error kinds. |
| Access scope | `lib.rs`, `allow_document_folder`, `list_directory` | Only folders in Tauri's fs scope can be listed or read. | Tauri's fs scope only knows local paths, so remote roots get their own allow-list in Rust (see Security). |
| Recent files | `src-tauri/src/recents.rs` | Keeps 10 paths as plain strings. | Unchanged: an `ssh://` URI is just another string. `allow_recent_document` gets a remote branch. |
| Capabilities | `capabilities/default.json` | `fs:allow-read-file`, `fs:allow-write-text-file`, dialogs. | No new plugin permissions; SSH is custom commands. |

Two existing behaviours must stay true for remote files: text is written exactly as held (no newline or BOM normalisation), and the "already open in another tab" check (`PathTaken`) compares path strings.

## Document identity

A remote document's `path` is a canonical URI string, `ssh://user@host[:port]/absolute/path.md`. The rest of the app keeps treating `path` as an opaque string.

Rust parses and builds it in one place (`RemotePath`), so two spellings of the same file never become two tabs.

- `user` is always present: when the user leaves it blank, it is filled from `~/.ssh/config`, or else the local user name.
- `host` is the name the user typed, lower-cased. A `~/.ssh/config` alias stays the alias; its settings are applied when connecting. Two aliases for one server are two hosts, deliberately.
- `:port` is omitted when it is 22.
- The path is always absolute and `/`-separated. `~` is resolved once with SFTP `realpath`.
- The path is stored unescaped; only `%` is escaped (as `%25`). Everything after the authority is the path.

Tabs (`PathTaken`), recent files and `basename()` in `files.ts` work unchanged on these strings.

## Rust backend

A new `ssh` module in `src-tauri` owns all connections and exposes async Tauri commands. The TypeScript layer picks local or remote by the `ssh://` prefix, so no component outside `src/platform/` changes for routing.

**Modules**

| File | Responsibility |
| --- | --- |
| `ssh/uri.rs` | `RemotePath`: parse and build the canonical URI; `ConnKey = (user, host, port)` |
| `ssh/config.rs` | Read `~/.ssh/config` (`ssh2-config` crate) for `Host` names, `HostName`, `User`, `Port`, `IdentityFile` |
| `ssh/known_hosts.rs` | Check and append `~/.ssh/known_hosts` |
| `ssh/auth.rs` | Try agent, then key files, then password, in that order |
| `ssh/pool.rs` | One live session plus one SFTP channel per `ConnKey`, held in Tauri state |
| `ssh/fs.rs` | List, stat, read and write over SFTP; reuses `folder.rs`'s filter and sort |

**Commands**

| Command | Returns | Notes |
| --- | --- | --- |
| `ssh_list_hosts()` | `Host` names from `~/.ssh/config` | Wildcard patterns left out. Feeds the Connect dialog's list. |
| `ssh_connect(target, answers)` | `Connected { home }` or a `Needs…` prompt | See Authentication. Opens the session but grants no folder yet. |
| `remote_list_folders(uri)` | Folder names under `uri` | For the folder picker only. Works anywhere on a connected host, but never returns files or file contents. |
| `remote_open_root(uri)` | `()` | The picked folder joins the remote allow-list and becomes the navigator root. |
| `remote_list_directory(uri)` | `Vec<FolderEntry>` or `ListError` | Same shape and errors as `list_directory`; inside an allowed root only |
| `remote_read(uri)` | raw bytes + `RemoteStat { mtime, size }` | Bytes go back as a raw IPC response. TypeScript runs the existing `decodeUtf8`. |
| `remote_write(uri, text, expected, force)` | new `RemoteStat` or `Conflict` | See Open and save |
| `remote_exists(uri)` | `bool` | Backs `pathExists` for remote recents; `false` when unreachable |
| `ssh_disconnect(host)` | `()` | Drops the session |

**Connection pool**

- Sessions open on demand and are shared by every tab and tree node on that host.
- A keepalive goes out every 30 s, so a dead link is noticed before the user saves.
- A session idle for 15 minutes is closed. It reopens on next use without prompting if the agent or an unencrypted key still works.
- A lost session is reopened once per command before an error is returned.
- russh is async on Tokio, which Tauri already runs, so commands are `async fn` and never block the UI thread.

**TypeScript routing.** `files.ts` and `folders.ts` gain `isSshPath(path)`. `openPath`, `saveDocument`, `listDirectory` and `pathExists` branch on it. `pickDocument` and `pickFolder` stay local-only; remote ones come from the Connect dialog.

## Authentication and host keys

Same model as VS Code Remote-SSH: if a saved key works, the user is never asked anything; if no key works, they log in with a password.

| Behaviour | VS Code Remote-SSH | Gonq v1 |
| --- | --- | --- |
| Host list | `Host` entries from `~/.ssh/config`, plus hosts added by hand | Same, plus the last 5 folders opened |
| Saved key in the agent | Used silently | Used silently |
| Key file (`IdentityFile`, `id_ed25519`, …) | Used silently; asks for its passphrase if encrypted | Same |
| No key accepted | Password prompt | Password prompt, 3 attempts |
| Unknown host | Asks to confirm the fingerprint | Same |
| Password or passphrase saved | Never | Never |
| After connecting | "Open Folder" browses the remote side, starting at home | Same: a remote folder picker |
| Two-factor / keyboard-interactive | Works, via system `ssh` | Not in v1 |

**One command, retried with answers.** `ssh_connect(target, answers)` either connects or returns the one thing it needs. The UI asks the user, then calls again with the answer added.

| Result | When | UI response |
| --- | --- | --- |
| `Connected { home }` | Authenticated and SFTP is open | Show the folder picker, starting at home |
| `NeedsHostKey { key_type, fingerprint }` | Host not in `known_hosts` | "Trust this host?" with the SHA256 fingerprint. Yes retries with `trust_fingerprint`. |
| `HostKeyChanged { fingerprint, known_line }` | Key differs from `known_hosts` | Hard stop. Explain the risk and name the `known_hosts` line to remove. No override. |
| `NeedsPassphrase { key_path }` | An encrypted key is the next one to try | Passphrase field; retries with `passphrase` |
| `NeedsPassword { attempts_left }` | Agent and keys failed, server allows password | Password field, up to 3 attempts |
| `AuthFailed { tried }` | Nothing worked | List what was tried |
| `Unreachable { reason }` | DNS, refused, timeout (10 s) | Show the reason |

**Order of attempts**

1. Host key check against `~/.ssh/known_hosts` (hashed and plain entries, `[host]:port` for non-22 ports).
2. ssh-agent: `SSH_AUTH_SOCK` on Linux and macOS. On Windows, russh 0.64.1's `AgentClient::connect_named_pipe` on `\\.\pipe\openssh-ssh-agent`, then `connect_pageant`.
3. Key files: `IdentityFile` entries from `~/.ssh/config`, else `id_ed25519`, `id_ecdsa`, `id_rsa`.
4. Password, if the server offers it.

**Trusting a host** appends one line to `~/.ssh/known_hosts` in OpenSSH's format.

**Secrets** are never written to disk or logged. A password is used for one connect and dropped. A decrypted key is dropped once the connection is up, so a new connection asks for the passphrase again; to avoid the prompt, the user loads the key into ssh-agent.

## Open and save

**Open**

1. `remote_read` resolves symlinks with SFTP `realpath`, then reads the file and its `mtime` and `size`.
2. TypeScript decodes it with the existing `decodeUtf8`, so a non-UTF-8 file is refused the same way as a local one.
3. The tab keeps the `RemoteStat` beside the text as its last known server version.
4. The path goes into recent files.

**Save**

1. `stat` the target. If `mtime` or `size` differs from the tab's `RemoteStat`, return `Conflict` and write nothing. If the file is gone, return `Conflict { deleted: true }`.
2. Write the text to `.<name>.gonq-<random>.tmp` in the same folder, with the original's permission bits.
3. Flush with `fsync@openssh.com` when the server offers it.
4. Swap it into place with `posix-rename@openssh.com`.
5. `stat` again and return the new `RemoteStat`; the tab stores it and clears its unsaved mark.

| Situation | Behaviour |
| --- | --- |
| No `posix-rename` extension | Write in place (truncate and write). Not atomic. Warn once per host. |
| Folder not writable, file is | Write in place, same caveat. |
| Temp file left after a failure | Removed on the next successful save to that folder. |

**Conflict dialog:** "*notes.md* changed on the server since you opened it." **Overwrite** (retry with `force`) or **Cancel** (tab stays unsaved).

**Known gap:** SFTP v3 times are whole seconds; a same-second, same-size server edit goes undetected.

**Save As** on a remote document opens the local save dialog. Saving to a new remote name is out of v1.

## Remote folders in the navigator

- **One root, as today.** `App.tsx` holds a single `folder` string. Connect to Server sets it to the folder the user picked after connecting, replacing any local folder.
- **Same rows** as `folder.rs`: folders and `.md` / `.markdown` only, no dotfiles, folders first, A–Z ignoring case.
- **Lazy, uncached.** Each expand is one SFTP `readdir`.
- **Latency.** A remote expand shows a spinner on its row after 150 ms. `ROW_CHUNK` (200) still applies.
- **Header** shows the folder name with `user@host` beneath it.
- **Errors** use the existing error row, with new kinds `disconnected` ("Lost connection to nas. Retry") and `auth_required` (opens the Connect dialog pre-filled).
- **Clicking a file** goes through `openKnownPath` like a local one.

## Connection loss and errors

Losing the connection never loses an edit: the text stays in its tab, still marked unsaved.

| Event | What Gonq does |
| --- | --- |
| Keepalive fails while idle | Marks the host disconnected. Nothing shown until the user acts. |
| Save while disconnected | Reconnects silently if the agent or an unencrypted key works; otherwise shows the Connect dialog, then continues the save. |
| Connection drops mid-save | The original is untouched. "Couldn't save to nas: connection lost"; tab stays unsaved. |
| Expand a folder while disconnected | Reconnects as above; on failure a `disconnected` error row with Retry. |
| Close the app with unsaved remote tabs | The existing unsaved-changes dialog. |
| Remote recent file, host unreachable | "Couldn't reach nas". The entry stays in recents. |

All remote commands return `RemoteError`, serialised like `ListError` (`{kind, message}`), with kinds `unreachable`, `auth_required`, `host_key_changed`, `disconnected`, `not_found`, `permission_denied`, `conflict`, `not_allowed`, `io`.

## User experience

**Menu.** File > "Connect to Server…" under "Open Folder…", desktop only (`foldersSupported()`). Shortcut Ctrl+Shift+K / Cmd+Shift+K.

**Connect dialog**, built like `PreferencesDialog`:

1. **Choose a host.** One field takes `user@host`, a `~/.ssh/config` alias or a pasted `ssh://` URI. Below it: the last 5 folders opened (host + folder, in `settings.json`, no secrets), then every `Host` from `~/.ssh/config`.
2. **Connect.** Spinner while `ssh_connect` runs; the dialog swaps in host-key approval, passphrase or password only if needed.
3. **Pick a folder.** A remote folder browser starting in home, or the last folder used on this host. Folders only, a typeable path field, an Up button. **Open** picks the folder shown; double-click enters a folder.
4. **Done.** The navigator opens on that folder only.

A recent entry skips step 3. Cancel works at every step and closes the session if no tab uses it.

**Remote markers:** a server icon on remote tabs (tooltip = full `ssh://` path), `user@host` after remote recents, `user@host` under the navigator header. A remote save above 1 s shows "Saving to nas…".

## Security

- **Remote allow-list.** Rust keeps allowed `ssh://` roots: one per folder the user picks, one per remote recent file the app recorded. Every `remote_*` command except `remote_list_folders` checks its URI is under an allowed root after `..` is resolved, else `not_allowed`. `remote_list_folders` returns folder names only, never files.
- **Writes are Markdown-only.** `remote_write` refuses names not ending `.md` / `.markdown`.
- **Host keys** are never auto-accepted; a changed key is a hard stop.
- **Secrets** stay in Rust memory, never go to the webview, logs, `settings.json` or recents. Zeroised after use (`zeroize`).
- **No new Tauri plugin permissions.**

## Testing

| Layer | How | Key cases |
| --- | --- | --- |
| `ssh/uri.rs` | Rust unit tests | Default port dropped, host lower-cased, `~` resolved, `%` round-trip, spaces |
| `ssh/known_hosts.rs` | Unit tests over sample files | Plain and hashed entries, `[host]:port`, unknown vs changed, append format |
| `ssh/config.rs` | Unit tests over sample configs | Alias → `HostName`, `User`, `Port`, `IdentityFile`; wildcard hosts skipped; missing file |
| `ssh/fs.rs` + `pool.rs` | Integration tests against an in-process `russh` server with `russh-sftp`'s server side, temp dir, random port | List filter/sort; exact bytes incl. BOM and CRLF; atomic save; conflict on mtime/size; conflict on delete; in-place fallback; reconnect after drop; `not_allowed` outside a root and after `..`; `remote_list_folders` never returns files |
| Auth | Same test server per case | Agent (Linux socket), unencrypted key, encrypted key, password with 3 attempts, unknown host key, changed host key |
| `files.ts`, `folders.ts` | Vitest with mocked `invoke` | `ssh://` routing; error kinds → messages; web build hides the feature |
| Connect / conflict dialogs | React Testing Library | Each step incl. folder picker; Cancel at every step; no override on changed key; Overwrite vs Cancel |

**Manual check before release:** connect from all three desktop builds using an agent key and a password.

## Stories (v1)

1. **SSH connection foundation** (backend): `ssh/uri.rs`, `config.rs`, `known_hosts.rs`, `auth.rs`, `pool.rs`; `ssh_list_hosts`, `ssh_connect`; the in-process test SFTP server harness.
2. **Remote file commands** (backend): `remote_list_folders`, `remote_open_root`, `remote_list_directory`, `remote_read`, `remote_write`, `remote_exists`, `ssh_disconnect`; allow-list; atomic save and conflicts; `RemoteError`.
3. **Remote documents in the app** (frontend): `ssh://` routing in `files.ts` / `folders.ts`; tab `RemoteStat`; conflict dialog; error messages; remote markers.
4. **Connect to Server and remote tree** (frontend): menu item and shortcut; Connect dialog with host list, auth prompts and folder picker; navigator on a remote root.

Later (v2): relative images in remote documents; multiple navigator roots; creating or renaming remote files.
