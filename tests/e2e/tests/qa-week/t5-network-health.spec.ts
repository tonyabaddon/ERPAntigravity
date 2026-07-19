/**
 * T5 — Network health across all major screens
 * Capture 4xx/5xx per screen. Any 5xx is a P1 finding.
 */

import { test, expect } from '../../fixtures/auth';

const SCREENS = [
  'dashboard', 'pelanggan', 'piutang', 'laporan', 'pembelian', 'kasir',
  'penjualan', 'rekonsiliasi', 'akuntansi', 'kasBank', 'salesLanding',
  'daftarPesanan', 'daftarPenawaran', 'manajemen-gudang', 'warehouse-transfer',
  'stok-opname', 'sales-inbox', 'order-history', 'notifications', 'settings',
  'user-management', 'persetujuan', 'keputusan-owner',
];

test.describe('T5 — Network health per screen', () => {
  test.setTimeout(180_000);
  test('No 5xx across all screens', async ({ tenantPage }) => {
    const allFails: { screen: string; url: string; status: number }[] = [];

    tenantPage.on('response', (resp) => {
      const status = resp.status();
      if (status >= 500) {
        allFails.push({ screen: 'unknown', url: resp.url(), status });
      }
    });

    for (const screen of SCREENS) {
      const before = allFails.length;
      await tenantPage.goto(`https://app.caleo.id/?screen=${screen}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      await tenantPage.waitForTimeout(2500);
      // Tag any new fails with this screen
      for (let i = before; i < allFails.length; i++) {
        allFails[i].screen = screen;
      }
    }

    if (allFails.length > 0) {
      console.log('5xx errors found:');
      for (const f of allFails.slice(0, 20)) {
        console.log(`  [${f.screen}] ${f.status} ${f.url.substring(0, 120)}`);
      }
    }
    expect(allFails.length).toBe(0);
  });
});
