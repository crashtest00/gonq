import { defineConfig, devices } from '@playwright/test';

// Opt-in browser tests against the web build. Not part of `npm test` or the
// Jenkins pipeline: run `npm run test:e2e` (after `npx playwright install chromium`).
const PORT = 4173;
const MOBILE_PORT = 4174; // the mobile web build, served under its /mobile/ base

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /mobile-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      testMatch: /mobile-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${MOBILE_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npm run build -w @gonq/mobile && npm run preview -w @gonq/mobile -- --port ${MOBILE_PORT} --strictPort`,
      url: `http://localhost:${MOBILE_PORT}/mobile/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
