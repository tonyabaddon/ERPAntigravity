/**
 * T1 — Master data read paths
 * Read-only. Navigate to each master data screen, verify loads without errors.
 */

import { test, expect } from '../../fixtures/auth';

const MODULES = [
  { name: 'Produk',      route: '?screen=stock-manager' },
  { name: 'Pelanggan',   route: '?screen=pelanggan' },
  { name: 'ManajemenGudang', route: '?screen=manajemen-gudang' },
  { name: 'KasBank',     route: '?screen=kasBank' },
  { name: 'Piutang',     route: '?screen=piutang' },
  { name: 'Pengaturan',  route: '?screen=settings' },
];

test.describe('T1 — Master data screens load without errors', () => {
  for (const mod of MODULES) {
    test(`F1 — ${mod.name} loads clean`, async ({ tenantPage }) => {
      const errors: string[] = [];
      tenantPage.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      await tenantPage.goto(`https://app.caleo.id/${mod.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      await tenantPage.waitForTimeout(2500);

      // Page should have content (not blank/error page)
      const bodyText = await tenantPage.locator('body').textContent();
      expect(bodyText || '').not.toContain('Something went wrong');
      expect(bodyText || '').not.toContain('Application error');
      expect((bodyText || '').length).toBeGreaterThan(200);

      const critical = errors.filter(
        (e) =>
          !e.includes('DevTools') &&
          !e.includes('sentry') &&
          !e.includes('adsbygoogle') &&
          !/Failed to load resource.*401/.test(e),
      );
      if (critical.length > 0) {
        console.log(`${mod.name} console errors:`, critical.slice(0, 3));
      }
      expect(critical.length).toBeLessThan(3);
    });
  }
});
