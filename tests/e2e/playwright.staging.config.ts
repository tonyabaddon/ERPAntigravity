import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for staging smoke tests.
 *
 * Runs in Cloud Build Step 4 against https://staging.app.caleo.id
 * after the staging deploy and before prod promotion.
 *
 * Tests are intentionally minimal:
 *   - T1: FE loads without JS console errors
 *   - T2: Login page renders (email + password inputs present)
 *   - T3: staging.admin.caleo.id auto-redirects to /admin route
 *
 * Tests skipped for now (require auth session injection — post-Sub-D):
 *   - T4: /admin/tenants page renders with platform_admin session
 *   - T5: Backend /api/v1/ready reachable from browser fetch
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Short timeout for smoke tests — if staging is unreachable after 30s, fail fast
  timeout: 30_000,
  reporter: 'line',
  use: {
    baseURL: process.env.STAGING_APP_URL ?? 'https://staging.app.caleo.id',
    // Headless Chromium in Cloud Build
    headless: true,
    // Wait for network idle so JS bundle is fully loaded
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Capture screenshot on failure for debugging
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
