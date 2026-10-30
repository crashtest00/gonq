/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Test configuration only until M-07 scaffolds the mobile build.
export default defineConfig({
  test: { environment: 'jsdom', globals: true },
});
