# gonq — Project Map

## Framework / Runtime
Tauri 2 desktop app (Rust) with a React 18 + TypeScript + Vite 5 frontend. Node 22.

## Key Directories
- src/            — React frontend (components, tests alongside as *.test.tsx)
- src/comment-threads/ — Markdown comment-threads library (barrel in index.ts; editor/ is unbuilt, excluded from tsc, not exported)
- src/components/ — app shell + Markdown view; ui/ holds shadcn/ui primitives (Tailwind, themed by CSS vars in src/styles/tokens.css)
- src/agent-skill/ — the bundled SKILL.md for AI agents (imported ?raw; shown by Help > Agent skill…, keep in step with src/comment-threads/README.md); fixtures/ holds a .md hand-edited per SKILL.md (tested)
- src/document/   — document state: the open tabs (each with its own undo/redo history, dirty tracking, scroll, raw mode) and the one block open for editing (edits splice source text; nothing is re-serialised)
- src/testing/    — test helpers for in-place editing (caret placement, active-block queries); components/inplace.ts maps rendered carets to source offsets
- src/platform/   — native/web file-access boundary (Tauri dialog+fs open/save, window-close guard; browser fallback); keep native calls here
- src/platform/ also wraps folder listing/Open Folder (folders.ts) and recent documents (recents.ts, settings.ts author name + View > Show markers in active block (Markdown syntax markers; not yet consumed by the editor); localStorage on web); remote.ts is the ssh:// boundary (remote_read/write/list/exists wrappers, RemoteStat, error wording, setConnectHandler hook for the Connect flow; files.ts/folders.ts route ssh:// paths to it); external.ts holds REPO_URL and opens links in the default browser (opener plugin)
- src-tauri/      — Rust crate (folder.rs listing, recents.rs recent.json in app data dir, settings.rs settings.json (author name, show-markers option) in app config dir; commands in lib.rs), src/ssh/ (SSH connection foundation: uri RemotePath/ConnKey, ~/.ssh/config, known_hosts, auth, connection pool; commands ssh_list_hosts/ssh_connect; fs.rs remote list/read/atomic save with conflicts, allow.rs the remote allow-list; commands remote_*/ssh_disconnect in mod.rs; test_server.rs is the in-process russh+SFTP server over a real temp folder that the tests use), tauri.conf.json, capabilities, icons
- .github/workflows/ — build-desktop.yml (workflow_dispatch with `sha`, dispatched by Jenkins only) and release-desktop.yml (`v*` tag push, tagged by Jenkins only); never add other triggers or run/tag by hand
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
Vitest + jsdom + React Testing Library (`npm test`, setup in src/setupTests.ts).
