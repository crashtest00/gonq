# gonq — Project Map

## Framework / Runtime
Tauri 2 desktop app (Rust) with a React 18 + TypeScript + Vite 5 frontend and a CodeMirror 6 editor. Node 22.

## Key Directories
- src/            — React frontend (components, tests alongside as *.test.tsx)
- src/comment-threads/ — Markdown comment-threads library (barrel in index.ts; editor/ is unbuilt, excluded from tsc, not exported)
- src/components/ — app shell (toolbar, menus, sidebars, dialogs) (ConnectDialog.tsx: File > Connect to Server, shown on every build (errors in the banner on web), registered as the platform setConnectHandler); ui/ holds shadcn/ui primitives (Tailwind, themed by CSS vars in src/styles/tokens.css)
- src/agent-skill/ — the bundled SKILL.md for AI agents (imported ?raw; shown by Help > Agent skill…, keep in step with src/comment-threads/README.md); fixtures/ holds a .md hand-edited per SKILL.md (tested)
- src/editor/     — the one CodeMirror 6 editor for the document (MarkdownEditor.tsx: one EditorView whose state is swapped per tab; extensions.ts: lang-markdown + history + Raw/Formatted mode compartment; livePreview.ts: syntax-tree decorations for the visible range, syntax hidden until the caret touches the construct, task checkbox widget). All text editing (typing, clipboard, history, Enter/list continuation, IME) is CodeMirror's own: Gonq code only adds decorations/widgets and app integration. MarkdownPreview.tsx is the read-only view in the Agent skill dialog. Thread markers/blocks, images and tables show as Markdown source
- src/document/   — document state: the open tabs (text as the editor holds it with `\n` breaks, the file as last read/saved, dirty tracking, undo/redo availability, raw mode); eol.ts converts back on save (untouched file byte-identical, edited CRLF file CRLF throughout). Each tab's editor state (caret, scroll, undo history) lives in MarkdownEditor
- src/testing/    — test helpers that drive the editor view (typing, selection, shown text) via transactions
- src/platform/   — native/web file-access boundary (Tauri dialog+fs open/save, window-close guard; browser fallback); keep native calls here; web must never diverge from desktop in UI: never hide/disable UI by platform, platform functions throw a clear error (shown in the error banner) when the browser can't do an action
- src/platform/ also wraps folder listing/Open Folder (folders.ts) and recent documents (recents.ts, settings.ts author name (localStorage on web)); remote.ts is the ssh:// boundary (remote_read/write/list/exists wrappers, RemoteStat, error wording, setConnectHandler hook for the Connect flow; files.ts/folders.ts route ssh:// paths to it); connect.ts is the Connect to Server boundary (ssh_list_hosts/ssh_connect/remote_list_folders/remote_open_root/ssh_disconnect wrappers, ssh:// input parsing, last 5 opened remote folders in localStorage); external.ts holds REPO_URL and opens links in the default browser (opener plugin)
- src-tauri/      — Rust crate (folder.rs listing, recents.rs recent.json in app data dir, settings.rs settings.json (author name) in app config dir; commands in lib.rs), src/ssh/ (SSH connection foundation: uri RemotePath/ConnKey, ~/.ssh/config, known_hosts, auth, connection pool; commands ssh_list_hosts/ssh_connect; fs.rs remote list/read/atomic save with conflicts, allow.rs the remote allow-list; commands remote_*/ssh_disconnect in mod.rs; test_server.rs is the in-process russh+SFTP server over a real temp folder that the tests use), tauri.conf.json, capabilities, icons
- .github/workflows/ — build-desktop.yml (workflow_dispatch with `sha`, dispatched by Jenkins only) and release-desktop.yml (`v*` tag push, tagged by Jenkins only); never add other triggers or run/tag by hand
- e2e/            — opt-in Playwright Chromium tests against the web build (`npm run test:e2e`; playwright.config.ts builds + serves via vite preview; needs `npx playwright install chromium`; excluded from vitest, not run by Jenkins)
- assets/        — logo sources (OUTLINE = FULL with text as paths, MICRO for 16/24px), render-icons.js that builds src-tauri/icons, preview/ PNG renders
- dist/           — web build output (gitignored); served by nginx in the Dockerfile for beta

## Entry Points
- index.html → src/main.tsx → src/App.tsx
- src-tauri/src/main.rs → lib.rs (`run`)

## Conventions
- `npm run dev` is the web dev loop (port 1420); `npm run build` type-checks then builds the web frontend.
- `npm run tauri build` makes the native bundle (nsis/dmg/appimage, unsigned). Updater is disabled.
- Beta deploys the web build (Dockerfile → nginx). Jenkinsfile follows /agent-docs template; don't hand-edit its shared stages.
- Branches: feature|bugfix|chore/<reference>-description, targeting `dev`.

## Test Framework
Vitest + jsdom + React Testing Library (`npm test`, setup in src/setupTests.ts). Browser tests: Playwright in e2e/ (opt-in, `npm run test:e2e`).
