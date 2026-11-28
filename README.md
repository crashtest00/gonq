# Gonq

Tauri 2 + React/Vite desktop app.

- `npm ci` — install
- `npm run dev` — web dev loop at http://localhost:1420
- `npm test` — Vitest
- `npm run test:e2e` — Playwright (not run per PR; see docs/e2e-testing.md)
- `npm run build` — web build into `apps/desktop/dist/`
- `npm run tauri build` — (runs in apps/desktop) native unsigned bundle (needs Rust and platform libs)
- `docker build -t gonq .` — nginx image serving the web build (beta)
