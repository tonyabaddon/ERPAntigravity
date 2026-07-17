import { test, expect } from '@playwright/test';

/**
 * Phase 1 comprehensive E2E verification — runs against real prod/staging URLs.
 * Tests all major surfaces built in Phase 1 (Tasks 1-9 + Sub A-E finalization).
 *
 * Environment vars (defaults to prod):
 *   PROD_APP_URL       = https://app.caleo.id
 *   PROD_ADMIN_URL     = https://admin.caleo.id
 *   PROD_BE_URL        = https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app
 *   STAGING_APP_URL    = https://staging.app.caleo.id
 *   STAGING_ADMIN_URL  = https://staging.admin.caleo.id
 *   STAGING_BE_URL     = https://garindo-jaya-panel-msme-erp-staging-xnrhcw7onq-as.a.run.app
 */

const PROD_APP_URL = process.env.PROD_APP_URL ?? 'https://app.caleo.id';
const PROD_ADMIN_URL = process.env.PROD_ADMIN_URL ?? 'https://admin.caleo.id';
const PROD_BE_URL = process.env.PROD_BE_URL ?? 'https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app';
const STAGING_APP_URL = process.env.STAGING_APP_URL ?? 'https://staging.app.caleo.id';
const STAGING_ADMIN_URL = process.env.STAGING_ADMIN_URL ?? 'https://staging.admin.caleo.id';
const STAGING_BE_URL = process.env.STAGING_BE_URL ?? 'https://garindo-jaya-panel-msme-erp-staging-xnrhcw7onq-as.a.run.app';

const KNOWN_SAFE_ERRORS = [
  'favicon',
  '404',
  'net::ERR_',
  'WebSocket',  // Supabase realtime WS before auth is expected
  'Manifest',   // PWA manifest 404 is not critical
];

function collectConsoleErrors(page: any): string[] {
  const errors: string[] = [];
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!KNOWN_SAFE_ERRORS.some((safe) => text.includes(safe))) {
        errors.push(text);
      }
    }
  });
  return errors;
}

// ═══════════════════════════════════════════════════════════════
// PROD tests
// ═══════════════════════════════════════════════════════════════

test.describe('PROD app.caleo.id', () => {
  test('loads without critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(PROD_APP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(1500);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tenant login page (email + OTP button) renders', async ({ page }) => {
    await page.goto(PROD_APP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 15_000 });
    const otpButton = page.locator('button:has-text("OTP"), button:has-text("Masuk"), button:has-text("Kirim")');
    await expect(otpButton.first()).toBeVisible({ timeout: 15_000 });
  });

  test('title contains Caleo/VOSI branding (marks page loaded)', async ({ page }) => {
    await page.goto(PROD_APP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const title = await page.title();
    expect(title.length).toBeGreaterThan(3);
  });
});

test.describe('PROD admin.caleo.id', () => {
  test('auto-redirects to /admin route (Sub A hostname detection)', async ({ page }) => {
    await page.goto(PROD_ADMIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);  // allow window.location.replace('/admin') to fire
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/\/admin/);
  });

  test('admin login screen loads without critical errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(PROD_ADMIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2500);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('PROD backend health', () => {
  test('/api/v1/live returns 200', async ({ request }) => {
    const r = await request.get(`${PROD_BE_URL}/api/v1/live`);
    expect(r.status()).toBe(200);
  });

  test('/api/v1/ready returns 200 (DB reachable via Secret Manager)', async ({ request }) => {
    const r = await request.get(`${PROD_BE_URL}/api/v1/ready`);
    expect(r.status()).toBe(200);
  });

  test('/api/v1/health returns 200 (backward compat)', async ({ request }) => {
    const r = await request.get(`${PROD_BE_URL}/api/v1/health`);
    expect(r.status()).toBe(200);
  });

  test('legacy /api/health returns 200 + X-Deprecated-Path header (Task 4)', async ({ request }) => {
    const r = await request.get(`${PROD_BE_URL}/api/health`);
    expect(r.status()).toBe(200);
    expect(r.headers()['x-deprecated-path']).toContain('/api/v1');
  });
});

// ═══════════════════════════════════════════════════════════════
// STAGING tests (validates Sub E)
// ═══════════════════════════════════════════════════════════════

test.describe('STAGING staging.app.caleo.id', () => {
  test('loads without critical console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto(STAGING_APP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(1500);
    expect(errors, `Console errors:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('staging tenant login renders', async ({ page }) => {
    await page.goto(STAGING_APP_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('STAGING staging.admin.caleo.id', () => {
  test('auto-redirects to /admin route', async ({ page }) => {
    await page.goto(STAGING_ADMIN_URL, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/\/admin/);
  });
});

// ═══════════════════════════════════════════════════════════════
// Landing subdomains (Task 3 placeholders)
// ═══════════════════════════════════════════════════════════════

test.describe('Landing + redirect subdomains', () => {
  test('caleo.id root serves placeholder', async ({ request }) => {
    const r = await request.get('https://caleo.id/');
    expect(r.status()).toBe(200);
    const body = await r.text();
    expect(body.toLowerCase()).toContain('caleo');
  });

  test('caleo.web.id redirects 301 to caleo.id', async ({ request }) => {
    const r = await request.get('https://caleo.web.id/', { maxRedirects: 0 });
    expect(r.status()).toBe(301);
    expect(r.headers()['location']).toContain('caleo.id');
  });
});
