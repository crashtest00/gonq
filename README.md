# Gonq

Tauri 2 + React/Vite desktop app.

- `npm ci` — install
- `npm run dev` — web dev loop at http://localhost:1420
- `npm test` — Vitest
- `npm run build` — web build into `dist/`
- `npm run tauri build` — native unsigned bundle (needs Rust and platform libs)
- `docker build -t gonq .` — nginx image serving the web build (beta)
