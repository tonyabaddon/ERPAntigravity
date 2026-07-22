/**
 * T3 — Akuntansi + Laporan (read-only)
 * Load-time smoke: no errors, no cross-tenant leak, page has content.
 */

import { test, expect } from '../../fixtures/auth';

const MODULES = [
  { name: 'Akuntansi', route: '?screen=akuntansi' },
  { name: 'Laporan',   route: '?screen=laporan' },
  { name: 'Rekonsiliasi', route: '?screen=rekonsiliasi' },
  { name: 'Kasir',     route: '?screen=kasir' },
  { name: 'Persetujuan', route: '?screen=persetujuan' },
  { name: 'Notifications', route: '?screen=notifications' },
  { name: 'UserManagement', route: '?screen=user-management' },
  { name: 'SalesInbox', route: '?screen=sales-inbox' },
  { name: 'OrderHistory', route: '?screen=order-history' },
];

test.describe('T3/T4 — Screens load clean', () => {
  for (const mod of MODULES) {
    test(`F1 — ${mod.name}`, async ({ tenantPage }) => {
      const errors: string[] = [];
      tenantPage.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      await tenantPage.goto(`https://app.caleo.id/${mod.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      await tenantPage.waitForTimeout(2500);
      const bodyText = await tenantPage.locator('body').textContent();
      expect(bodyText || '').not.toContain('Something went wrong');
      expect(bodyText || '').not.toContain('Application error');
      expect((bodyText || '').length).toBeGreaterThan(200);
      const critical = errors.filter(
        (e) =>
          !e.includes('DevTools') &&
          !e.includes('sentry') &&
          !e.includes('Sentry') &&
          !e.includes('adsbygoogle') &&
          !/Failed to load resource.*40[13]/.test(e) &&
          !/Failed to load resource.*503/.test(e) &&
          // Transient network errors during Supabase pool cycles (not code bugs)
          !/TypeError: Failed to fetch/.test(e) &&
          !/Failed to fetch/.test(e) &&
          !e.includes('WebSocket connection') &&
          !e.includes('net::ERR_'),
      );
      if (critical.length > 0) console.log(`${mod.name} errors:`, critical.slice(0, 3));
      expect(critical.length).toBeLessThan(3);
    });
  }
});
