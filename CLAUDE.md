# gonq — Project Map

## Framework / Runtime
Tauri 2 desktop app (Rust) with a React 18 + TypeScript + Vite 5 frontend and a CodeMirror 6 editor. Node 22.

## Key Directories
The per-file map is generated, not written here: run `npm run map` and read PROJECT_MAP.md (gitignored, one line per
source file, taken from each file's header comment). `npm run map -- --json` prints the same as JSON.

- apps/desktop/ — the npm workspace for the desktop/web app (@gonq/desktop; root package.json `workspaces: [apps/*, packages/*]`, one package-lock.json and node_modules at the root; its own package.json holds the frontend deps and the dev/build/test/test:e2e/tauri scripts, and index.html, vite.config.ts, tsconfig.json, tailwind/postcss configs, components.json and playwright.config.ts live here). Root `npm test` and `npm run build` fan out to the workspaces; `npm run tauri ...` runs from apps/desktop. Paths below without a prefix are relative to apps/desktop/.
- src/            — React + TypeScript frontend: App.tsx shell, components/ (RepoNavigator = the navigator's GitHub root; ui/ = shadcn/ui primitives themed by CSS vars in styles/tokens.css), editor/ (the one CodeMirror 6 editor), document/ (open tabs), commands/ (the command registry: defineCommand/defineMenu, CommandContext), features/ (one folder per menu feature, each index.ts registers its commands; features/github/ = Open Repo/Open PR (sign-in itself runs inside the Settings dialog: components/SettingsDialog.tsx + GitHubSignInPanel.tsx), the in-memory session branch list sessionBranches.ts and the scripted PR title/body defaults prDefaults.ts), dialogs/ (DialogHost: registerDialog/openDialog/<DialogHost/> mount every app dialog; dialogs.tsx registers them), platform/ (native/web boundary; github.ts is the only caller of the github_* commands and owns the github:// path format, which routes files.ts/folders.ts to GitHub the way ssh:// goes to remote.ts), comment-threads/ (Markdown comment-threads library, barrel in index.ts), agent-skill/ (bundled SKILL.md), lib/ (theme, utils), testing/ (test helpers), styles/
- crates/gonq-core/ + apps/desktop/src-tauri/ — Cargo workspace (root Cargo.toml, one Cargo.lock/target at the root). gonq-core: github/, ssh/, settings, recents, folder and the shared command list (commands.rs); desktop: Tauri shell (lib.rs `run`), tauri.conf.json, capabilities, icons.
- e2e/            — (apps/desktop/e2e) opt-in Playwright Chromium tests against the web build (`npm run test:e2e`; playwright.config.ts builds + serves via vite preview; needs `npx playwright install chromium`; excluded from vitest, not run by Jenkins)
- scripts/        — repo tooling (project-map.mjs: `npm run map` / `npm run map:check`)
- docs/           — design notes and specs (not shipped); github-review.md is the user-facing guide to the GitHub review flow
- .github/workflows/ — build-desktop.yml (workflow_dispatch with `sha`, dispatched by Jenkins only), rust-checks.yml (workflow_dispatch with `sha` + `request_id`; cargo test + clippy -D warnings, runs as a matrix on GitHub-hosted ubuntu-22.04, windows-latest and macos-latest runners, not on Jenkins; dispatched and awaited by the Jenkinsfile `Rust checks` stage on PR builds to dev, which skips (logged) unless the PR changes a file under src-tauri/ incl. Cargo.toml/Cargo.lock, and fails on any GitHub API/dispatch error) and release-desktop.yml (`v*` tag push, tagged by Jenkins only); never add other triggers or run/tag by hand
- assets/        — logo sources (OUTLINE = FULL with text as paths, MICRO for 16/24px), render-icons.js that builds apps/desktop/src-tauri/icons, preview/ PNG renders
- packages/editor/ — empty npm workspace (@gonq/editor, package.json only); the shared editor code moves here later
- apps/desktop/dist/ — web build output (gitignored); served by nginx in the Dockerfile for beta

## Entry Points
- apps/desktop/index.html → apps/desktop/src/main.tsx → apps/desktop/src/App.tsx
- apps/desktop/src-tauri/src/main.rs → lib.rs (`run`)

## Conventions
- `npm run dev` is the web dev loop (port 1420); `npm run build` type-checks then builds the web frontend.
- `npm run tauri build` makes the native bundle (nsis/dmg/appimage, unsigned). Updater is disabled.
- Beta deploys the web build (Dockerfile → nginx). Jenkinsfile follows /agent-docs template; don't hand-edit its shared stages.
- Branches: feature|bugfix|chore/<reference>-description, targeting `dev`.
- Every source file starts with a header comment saying what it is for; keep it accurate when you change the file. `npm run map:check` fails the build if one is missing. (TS/TSX: a leading `/** ... */` block; Rust: `//!` lines. The map shows its first paragraph, so lead with what the file is for and what it exports that others use; tests get one line naming what they cover.)
- Native calls stay in src/platform/. The web build never diverges from desktop in UI: never hide or disable UI by platform; a platform function throws a clear error (shown in the error banner) when the browser can't do an action.
- All text editing (typing, clipboard, history, Enter/list continuation, IME) is CodeMirror's own: Gonq code in src/editor/ only adds decorations, widgets and app integration.
- Menus and shortcuts come from the command registry. To add a menu item, shortcut or menu, add or edit `src/features/<feature>/index.ts` (auto-loaded) with `defineCommand({id, menu, group, order, label, shortcut?, enabled?, run})`; add `contextMenu: {group, order}` to also list a command in the editor's right-click menu (with or without `menu`); if `run` needs something new, add it to `CommandContext` (src/commands/context.ts) and fill it in App.tsx. Never edit MenuBar.tsx or add MenuBar props, and never add a keydown handler: shortcuts are bound from `shortcut`. Keys CodeMirror owns are shown with `hint`, not bound. Feature modules never import `isTauri` (nothing is hidden or disabled by platform).
- Comment shortcuts: Alt+M (the `Add Comment` command, shown in the right-click menu too; Alt alone, read from `event.code` so macOS Option works, ignored on key repeat, never with Ctrl/Shift/AltGr) adds a comment at the selection or caret, or focuses the draft already open; Ctrl/Cmd+Enter saves in the new-comment, reply and edit boxes (once per body, ignoring IME and repeat). The boxes and buttons carry a tooltip and `aria-keyshortcuts`. Alt+M collides with no other registered shortcut (the registry throws on duplicates).
- The navigator's Refresh (button beside the folder/repo name, always rendered, disabled with nothing open or while listing; View > Refresh Navigator, no shortcut) re-lists in place for local, ssh:// and github:// roots, keeps expanded folders, and switches to the default branch (via App's changeBranch, which warns about unsaved changes) when the open branch was deleted. No timers or watchers.
  User guide: docs/navigator-refresh.md. Tests: src/components/NavigatorRefresh*.test.tsx (tree, ssh, GitHub; DOM-node identity is what proves scroll/expansion/highlight survive, since jsdom does not scroll), src/features/view/refreshKeepsTabs.test.tsx, src/features/github/refreshDeletedBranch.test.tsx.
- Components use theme tokens only (styles/tokens.css; `.dark` on <html> swaps them); the logo is never recoloured.
- src/agent-skill/SKILL.md stays in step with src/comment-threads/README.md.

## Test Framework
Vitest + jsdom + React Testing Library (`npm test`, setup in src/setupTests.ts). Browser tests: Playwright in e2e/ (opt-in, `npm run test:e2e`).
- New App-level tests go in a per-feature file next to the feature (e.g. src/features/<x>/<x>.test.tsx or src/components/<X>.test.tsx) and render the app with `renderApp()` from src/testing/renderApp.tsx (with `menu()` / `openDocument()`), not by copying another file's setup.
- New Playwright tests go in `e2e/<feature>.spec.ts`, not appended to e2e/smoke.spec.ts.
- e2e/smoke.spec.ts and src/App.edit.test.tsx are frozen except for fixes.
- Before reading the DOM of a bare EditorView call `settleView(view)` (`settleEditors(root)` for App/dialog tests; `shownText` already does): CodeMirror parses with a 20 ms budget, so under load the tree is partial.
