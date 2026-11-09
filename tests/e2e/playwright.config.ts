import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (web + api + worker) with the demo seed.
 * Start it with `pnpm dev` (or docker compose) and run `pnpm test:e2e`.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
});
