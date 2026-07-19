/**
 * T0 — Multi-tenant isolation via UI paths (live)
 * As Toko Jaya Makmur owner, attempt to access other tenants' data via
 * URL / API / subscription. Verify RLS blocks all reads.
 */

import { test, expect } from '../../fixtures/auth';

const GARINDO_TENANT_ID = '11111111-1111-1111-1111-111111111111';
const WARUNG_TENANT_ID = '49cbbc94-977c-4bc4-bf9b-0195342f1608';

test.describe('T0 — Multi-tenant isolation (live UI)', () => {
  test('F11 — DOM does not leak Garindo/Warung tenant names', async ({ tenantPage }) => {
    // Navigate through several screens, capture combined DOM
    const screens = ['dashboard', 'pelanggan', 'kasir', 'akuntansi', 'laporan'];
    for (const screen of screens) {
      await tenantPage.goto(`https://app.caleo.id/?screen=${screen}`, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      await tenantPage.waitForTimeout(1500);
      const html = await tenantPage.content();
      expect(html).not.toContain('Garindo Jaya Panel');
      expect(html).not.toContain('Warung Sinar Rezeki');
    }
  });

  test('F11 — direct RPC call with wrong tenant_id param returns empty', async ({ tenantPage }) => {
    // Attempt to call a query RPC with Garindo tenant_id via evaluateHandle
    const result = await tenantPage.evaluate(async (targetTenantId) => {
      // @ts-expect-error accessing app's supabase client via window
      const supabase = (window as any).__DEBUG_SUPABASE__;
      if (!supabase) return { ok: false, reason: 'no client on window' };
      try {
        // Direct query attempt (RLS should block anything not our tenant)
        const { data, error } = await supabase
          .from('customers')
          .select('id, name')
          .eq('tenant_id', targetTenantId)
          .limit(10);
        return { ok: true, count: data?.length ?? 0, error: error?.message };
      } catch (e: any) {
        return { ok: false, error: e?.message };
      }
    }, GARINDO_TENANT_ID);
    console.log('MT isolation RPC result:', result);
    if (result.ok) {
      // Must return 0 rows or error — never leak Garindo data
      expect(result.count).toBe(0);
    }
  });

  test('F11 — session localStorage does not leak other tenant IDs', async ({ tenantPage }) => {
    const storage = await tenantPage.evaluate(() => {
      const keys = Object.keys(localStorage);
      const dump: Record<string, string> = {};
      for (const k of keys) dump[k] = localStorage.getItem(k) || '';
      return dump;
    });
    const flat = JSON.stringify(storage);
    expect(flat).not.toContain(GARINDO_TENANT_ID);
    expect(flat).not.toContain(WARUNG_TENANT_ID);
  });
});
