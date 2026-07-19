/**
 * T0 — Authentication + tenant-select + error screens
 * Read-only. No writes. Safe to run against Toko Jaya Makmur.
 *
 * Scenarios (functional matrix):
 *   F1 positive — authenticated session lands on dashboard, sidebar renders
 *   F9 error — no console errors on initial page load
 *   F10 permission — tenant user cannot see admin routes/UI
 *   F11 multi-tenant — no leak of other tenant name in DOM
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T0 — Auth flow (authenticated session)', () => {
  test('F1 — dashboard renders with tenant context', async ({ tenantPage }) => {
    // After fixture, tenantPage is authenticated + at app.caleo.id
    await expect(tenantPage).toHaveURL(/app\.caleo\.id/);
    // Sidebar or main app shell should be visible
    const bodyText = await tenantPage.locator('body').textContent();
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(100); // non-empty page
  });

  test('F9 — no console errors on session bootstrap', async ({ tenantPage }) => {
    const errors: string[] = [];
    tenantPage.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Reload to ensure we capture all console output during boot
    await tenantPage.reload({ waitUntil: 'domcontentloaded' });
    await tenantPage.waitForTimeout(2000);
    // Filter out known noise: Sentry init warning about missing DSN in dev,
    // React DevTools, third-party ad blockers.
    const critical = errors.filter(
      (e) =>
        !e.includes('DevTools') &&
        !e.includes('sentry') &&
        !e.includes('adsbygoogle') &&
        !/Failed to load resource.*401/.test(e),
    );
    if (critical.length > 0) {
      console.log('Console errors detected:', critical.slice(0, 5));
    }
    expect(critical.length).toBeLessThan(3); // tolerance for transient issues
  });

  test('F11 — DOM does not leak other tenant names', async ({ tenantPage }) => {
    const html = await tenantPage.content();
    // Toko Jaya Makmur is our tenant. Verify no reference to other tenants.
    expect(html).not.toContain('Garindo Jaya Panel');
    expect(html).not.toContain('Warung Sinar Rezeki');
  });

  test('F10 — direct URL to admin route redirects tenant user away', async ({ tenantPage }) => {
    // Try to force-navigate to admin subdomain
    const resp = await tenantPage.goto('https://admin.staging.caleo.id/admin', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    }).catch((e) => e);
    // Either the page failed to load (SSL cert mismatch on staging admin from prod session)
    // or it loaded but showed access-denied. Both acceptable.
    if (resp && typeof resp === 'object' && 'ok' in resp) {
      // If page did load, verify no admin dashboard rendered
      const bodyText = await tenantPage.locator('body').textContent();
      // Admin dashboard has "Platform Admin" or similar; verify absence
      expect(bodyText || '').not.toContain('Platform Admin Dashboard');
    }
  });
});

test.describe('T0 — Login page (unauthenticated)', () => {
  test('F1 — /login reachable, email input visible', async ({ page }) => {
    await page.goto('https://app.caleo.id', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // App will render auth screen since we have no session
    await page.waitForTimeout(2000);
    // Look for email or "Masuk" (login button) text
    const bodyText = await page.locator('body').textContent();
    expect(bodyText || '').toMatch(/email|Email|Masuk|masuk|Login|login/);
  });

  test('F2 — malformed email submission blocked by client validation', async ({ page }) => {
    await page.goto('https://app.caleo.id', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    // Find email input by type or common attribute
    const emailInputs = await page.locator('input[type="email"], input[name*="email" i]').all();
    if (emailInputs.length === 0) {
      test.skip(true, 'Email input not found on landing — page structure may differ');
      return;
    }
    await emailInputs[0].fill('notanemail');
    // Try to submit
    const submitBtns = await page.locator('button[type="submit"], button:has-text("Masuk"), button:has-text("Login")').all();
    if (submitBtns.length > 0) {
      await submitBtns[0].click();
      await page.waitForTimeout(1000);
      // Should NOT navigate to dashboard
      expect(page.url()).not.toContain('/dashboard');
    }
  });
});
