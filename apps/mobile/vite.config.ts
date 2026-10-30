/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import pkg from './package.json';

// The repo's assets/ folder (the real logo), reached by alias so no relative import leaves this workspace.
const repoAssets = fileURLToPath(new URL('.', import.meta.url)).split(/[\\/]apps[\\/]mobile/)[0] + '/assets';

// The web build (and its preview) is served by Beta under /mobile/; the native build (Tauri sets TAURI_ENV_PLATFORM) and the dev
// server, which Tauri's devUrl points at, are served from the root.
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  resolve: { alias: { '@repo-assets': repoAssets } },
  server: { port: 1421, strictPort: true, host: true },
  base: (command === 'build' || isPreview) && !process.env.TAURI_ENV_PLATFORM ? '/mobile/' : '/',
  define: { __GONQ_APP__: JSON.stringify('mobile'), __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    css: { include: [/editor\.css/] },
  },
}));
