import { test, expect } from '@playwright/test';

/**
 * Staging smoke tests — run against https://staging.app.caleo.id
 * before any prod promotion in the Cloud Build pipeline.
 *
 * These tests validate that:
 *   1. The FE bundle loaded correctly (JS didn't crash on boot)
 *   2. The login page is reachable and renders correctly
 *   3. The admin subdomain routes to /admin automatically
 *
 * Tests T4 + T5 (auth-required flows) are skipped pending platform_admin
 * session injection setup (post-Sub-D when service key moves to Secret Manager).
 */

const STAGING_APP_URL = process.env.STAGING_APP_URL ?? 'https://staging.app.caleo.id';
const STAGING_ADMIN_URL =
  process.env.STAGING_ADMIN_URL ?? 'https://staging.admin.caleo.id';
const STAGING_BE_URL =
  process.env.STAGING_BE_URL ??
  'https://garindo-jaya-panel-msme-erp-staging-422860632808.asia-southeast1.run.app';

test.describe('T1 — FE loads without JS console errors', () => {
  test('landing page returns 200 and has no critical JS errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const response = await page.goto(STAGING_APP_URL, { waitUntil: 'networkidle' });
    expect(response?.status()).toBe(200);

    // Filter known non-critical errors (e.g., favicon 404)
    const criticalErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('404') &&
        !e.includes('net::ERR_') &&
        // Supabase realtime websocket before auth is expected
        !e.includes('WebSocket')
    );
    expect(criticalErrors, `Console errors: ${criticalErrors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('T2 — Login page renders', () => {
  test('email input and OTP button are present on auth screen', async ({ page }) => {
    // The app uses OTP login — no password field. Navigate to root (unauthenticated
    // session → AuthScreen renders automatically).
    await page.goto(STAGING_APP_URL, { waitUntil: 'networkidle' });

    // Email input (type="email" or placeholder containing "email")
    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]'
    );
    await expect(emailInput.first()).toBeVisible({ timeout: 15_000 });

    // OTP submit button
    const otpButton = page.locator('button:has-text("OTP"), button:has-text("Masuk"), button:has-text("Kirim")');
    await expect(otpButton.first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('T3 — Admin subdomain auto-redirects to /admin', () => {
  test('staging.admin.caleo.id redirects to /admin route', async ({ page }) => {
    // This test requires the real staging.admin.caleo.id hostname (Cloud Run domain
    // mapping + SSL must be provisioned). When STAGING_ADMIN_URL is set to a direct
    // Cloud Run URL in local testing, skip because hostname detection won't trigger.
    if (!STAGING_ADMIN_URL.includes('staging.admin.caleo.id')) {
      test.skip();
      return;
    }

    await page.goto(STAGING_ADMIN_URL, { waitUntil: 'networkidle' });

    // After hostname detection, App.tsx should window.location.replace('/admin')
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/\/admin/);
  });
});

test.describe('T4 — Backend /api/v1/ready (direct HTTP, no auth)', () => {
  test('backend readiness probe responds 200', async ({ request }) => {
    const resp = await request.get(`${STAGING_BE_URL}/api/v1/ready`);
    expect(resp.status()).toBe(200);
  });
});

// T5: /admin/tenants with platform_admin session — skipped until Sub D
// (service key needs to be in Secret Manager before we inject sessions in CI)
test.describe('T5 — Admin tenants page (requires platform_admin session)', () => {
  test.skip('admin/tenants renders with platform_admin session — pending Sub D', async () => {
    // TODO: inject Supabase service-role JWT into localStorage and verify
    // /admin/tenants renders the tenant list table.
  });
});
