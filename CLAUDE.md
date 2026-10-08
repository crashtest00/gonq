# gonq — Project Map

## Framework / Runtime
Tauri 2 desktop app (Rust) with a React 18 + TypeScript + Vite 5 frontend. Node 22.

## Key Directories
- src/            — React frontend (components, tests alongside as *.test.tsx)
- src-tauri/      — Rust crate, tauri.conf.json, capabilities, icons
- .github/workflows/ — build-desktop.yml (workflow_dispatch with `sha`, dispatched by Jenkins only) and release-desktop.yml (`v*` tag push, tagged by Jenkins only); never add other triggers or run/tag by hand
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
