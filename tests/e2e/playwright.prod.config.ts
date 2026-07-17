import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for production tests.
 *
 * Runs against https://app.caleo.id and https://admin.caleo.id.
 * Includes both unauthenticated (phase1-comprehensive) and authenticated
 * (phase1-authenticated) tests.
 *
 * Auth tests auto-skip in CI if PLAYWRIGHT_TOKO_EMAIL is not set.
 *
 * Usage (from project root, with env loaded):
 *   npx dotenv -e .env -- npx playwright test --config=tests/e2e/playwright.prod.config.ts
 *
 * Or via npm scripts in tests/e2e/ (env vars must already be exported):
 *   npm run test:auth   — auth tests only
 *   npm run test:prod   — comprehensive (unauthenticated) only
 *
 * Simplest local run (sources .env before running):
 *   set -a && source .env && set +a && cd tests/e2e && npm run test:auth
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  reporter: 'line',
  use: {
    baseURL: process.env.PROD_APP_URL ?? 'https://app.caleo.id',
    headless: true,
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
