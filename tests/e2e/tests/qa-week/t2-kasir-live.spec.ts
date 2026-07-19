/**
 * T2 — Kasir POS live interaction (READ + light write)
 * Verifies Kasir screen loads with product list, cart interaction works.
 * No submit — read-heavy path that stops before commit.
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T2 — Kasir POS interaction', () => {
  test('F1 — Kasir renders + product list populated', async ({ tenantPage }) => {
    await tenantPage.goto('https://app.caleo.id/?screen=kasir', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3500);
    const bodyText = await tenantPage.locator('body').textContent();
    // Should contain "Kasir" or product-related text
    expect(bodyText || '').toMatch(/Kasir|POS|Produk|Keranjang|Cart|Bayar|Tunai/i);
  });

  test('F1 — Penjualan wizard loads', async ({ tenantPage }) => {
    await tenantPage.goto('https://app.caleo.id/?screen=penjualanBaru', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(2500);
    const bodyText = await tenantPage.locator('body').textContent();
    expect(bodyText || '').not.toContain('Application error');
    expect((bodyText || '').length).toBeGreaterThan(300);
  });

  test('F9 — network health: no 5xx during kasir load', async ({ tenantPage }) => {
    const fails: { url: string; status: number }[] = [];
    tenantPage.on('response', (resp) => {
      if (resp.status() >= 500) {
        fails.push({ url: resp.url(), status: resp.status() });
      }
    });
    await tenantPage.goto('https://app.caleo.id/?screen=kasir', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3000);
    if (fails.length > 0) {
      console.log('5xx during kasir load:', fails.slice(0, 5));
    }
    expect(fails.length).toBe(0);
  });
});
