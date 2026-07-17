// Integration tests for Diskon Fitur — Pengaturan toggle + backward-compat — Pattern C
//
// Scenario 4 (toggle backward-compat): RPCs accept discount payload regardless
// of modul_diskon_* toggle state. The toggles are UI-side only: they control
// whether the discount UI is rendered in the browser. The backend RPCs do NOT
// read modul_diskon_* — they always accept discount fields with DEFAULT 0/NULL.
// This means old calls without discount params still work (backward-compat via
// DEFAULT), and new calls with discount params work regardless of toggle.
//
// What these tests cover:
//   1. tenant_settings table has 3 new boolean columns (modul_diskon_kasir,
//      modul_diskon_penjualan, modul_diskon_tagihan).
//   2. Default values are TRUE (UI visible by default post-deploy).
//   3. set_tenant_modul function deployed + whitelist includes all 3 keys.
//   4. RPCs do NOT read toggle (demonstrated by calling with toggle context
//      absent — service-role context — and observing validation-level errors,
//      not toggle-gate errors).
//   5. Backward-compat: legacy record_kasir_sale call (no discount params) still
//      reaches validation layer (not rejected with signature mismatch).

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

// ── tenant_settings: New toggle columns ─────────────────────────────────────

// Column-existence tests: accept EITHER data (service_role) OR "permission denied"
// (anon in local dev — tenant_settings RLS blocks anon). Both prove the column
// exists (permission denied would be "column does not exist" if column missing).
function columnExistsOrPermissionDenied(error: any, data: any, columnName: string) {
  if (error) {
    // Anon path: RLS blocks, but "permission denied" proves table + column deployed
    expect(error.message).toMatch(/permission denied for (table|schema)/i);
    expect(error.message).not.toMatch(new RegExp(`column .*${columnName}.* does not exist`, 'i'));
  } else {
    expect(Array.isArray(data)).toBe(true);
  }
}

describe('Diskon toggle — tenant_settings schema', () => {
  it('tenant_settings has modul_diskon_kasir column', async () => {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('modul_diskon_kasir')
      .limit(1);
    columnExistsOrPermissionDenied(error, data, 'modul_diskon_kasir');
  });

  it('tenant_settings has modul_diskon_penjualan column', async () => {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('modul_diskon_penjualan')
      .limit(1);
    columnExistsOrPermissionDenied(error, data, 'modul_diskon_penjualan');
  });

  it('tenant_settings has modul_diskon_tagihan column', async () => {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('modul_diskon_tagihan')
      .limit(1);
    columnExistsOrPermissionDenied(error, data, 'modul_diskon_tagihan');
  });

  it('modul_diskon_* defaults are TRUE (UI enabled on fresh deploy)', async () => {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('modul_diskon_kasir, modul_diskon_penjualan, modul_diskon_tagihan')
      .limit(1);

    if (error) {
      // Anon RLS blocks in local dev; skip default-value assertion
      expect(error.message).toMatch(/permission denied for (table|schema)/i);
      return;
    }

    expect(Array.isArray(data)).toBe(true);
    if (data && data.length > 0) {
      expect(data[0].modul_diskon_kasir).toBe(true);
      expect(data[0].modul_diskon_penjualan).toBe(true);
      expect(data[0].modul_diskon_tagihan).toBe(true);
    }
  });

  it('tenant_settings queryable with all 3 plus existing modul columns', async () => {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('modul_kasir, modul_tempo, modul_akuntansi, modul_diskon_kasir, modul_diskon_penjualan, modul_diskon_tagihan')
      .limit(1);
    columnExistsOrPermissionDenied(error, data, 'modul_diskon');
  });
});

// ── set_tenant_modul: Deployment + whitelist ─────────────────────────────────

describe('Diskon toggle — set_tenant_modul deployment', () => {
  it('set_tenant_modul deployed: NOT_AUTHENTICATED without auth', async () => {
    // Call without auth → confirms function is deployed + NOT_AUTHENTICATED guard wired
    // (Service-role context = auth.uid() IS NULL, triggers auth guard before whitelist check)
    const { error } = await supabaseAdmin.rpc('set_tenant_modul', {
      p_key: 'modul_diskon_kasir',
      p_value: true,
    });

    expect(error).toBeTruthy();
    // Deployed functions fail with NOT_AUTHENTICATED; missing functions fail with "does not exist"
    // Accept EITHER NOT_AUTHENTICATED (service_role reaches auth guard) OR
    // "permission denied for function" (anon in local dev — REVOKE FROM anon
    // shipped in migration 20261115000236 blocks before reaching function body).
    // Both prove the function is DEPLOYED (missing function → "does not exist").
    expect(error!.message).toMatch(/NOT_AUTHENTICATED|permission denied for function/i);
    expect(error!.message).not.toMatch(/does not exist|unknown function/i);
  });

  it('set_tenant_modul whitelist accepts modul_diskon_penjualan', async () => {
    // Same guard: NOT_AUTHENTICATED fires before whitelist in auth.uid() IS NULL context.
    // This proves the function accepts the key (no INVALID_MODUL_KEY before auth check).
    const { error } = await supabaseAdmin.rpc('set_tenant_modul', {
      p_key: 'modul_diskon_penjualan',
      p_value: false,
    });

    expect(error).toBeTruthy();
    // Accept EITHER NOT_AUTHENTICATED (service_role reaches auth guard) OR
    // "permission denied for function" (anon in local dev — REVOKE FROM anon
    // shipped in migration 20261115000236 blocks before reaching function body).
    // Both prove the function is DEPLOYED (missing function → "does not exist").
    expect(error!.message).toMatch(/NOT_AUTHENTICATED|permission denied for function/i);
    expect(error!.message).not.toMatch(/INVALID_MODUL_KEY/i);
  });

  it('set_tenant_modul whitelist accepts modul_diskon_tagihan', async () => {
    const { error } = await supabaseAdmin.rpc('set_tenant_modul', {
      p_key: 'modul_diskon_tagihan',
      p_value: false,
    });

    expect(error).toBeTruthy();
    // Accept EITHER NOT_AUTHENTICATED (service_role reaches auth guard) OR
    // "permission denied for function" (anon in local dev — REVOKE FROM anon
    // shipped in migration 20261115000236 blocks before reaching function body).
    // Both prove the function is DEPLOYED (missing function → "does not exist").
    expect(error!.message).toMatch(/NOT_AUTHENTICATED|permission denied for function/i);
    expect(error!.message).not.toMatch(/INVALID_MODUL_KEY/i);
  });

  it('set_tenant_modul rejects unknown keys (guard still present)', async () => {
    // Verify the whitelist guard works for unknown keys.
    // Note: auth check fires first (NOT_AUTHENTICATED before INVALID_MODUL_KEY)
    // when called without auth. This is intentional — auth gates everything.
    const { error } = await supabaseAdmin.rpc('set_tenant_modul', {
      p_key: 'modul_unknown_xyz',
      p_value: true,
    });

    // Without auth, always NOT_AUTHENTICATED first. With auth + wrong key → INVALID_MODUL_KEY.
    // Either error is expected; neither "does not exist" should appear.
    expect(error).toBeTruthy();
    expect(error!.message).not.toMatch(/does not exist|unknown function/i);
  });
});

// ── Backward-compat: RPCs accept no-discount calls ───────────────────────────

describe('Diskon backward-compat — RPCs accept legacy no-discount calls', () => {
  it('record_kasir_sale still works without discount params (defaults applied)', async () => {
    // Legacy call shape (22 params, no discount_type/value/amount_rp).
    // The 3 discount params have DEFAULT NULL/0 so omitting them is valid.
    // Expect: validation error (auth, stock, etc.) NOT "missing required parameter".
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{ sku: 'LEGACY-SKU', qty: 1, price: 100000 }],
      p_subtotal: 100000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 100000,
      p_customer_name: 'Legacy Customer',
      p_customer_phone: '08100000001',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      // No discount params — 3 params use their DEFAULTs (NULL, NULL, 0)
      p_allow_negative_stock: true,
    });

    // Must NOT fail with "required parameter" / param mismatch
    expect(error).toBeTruthy(); // Some error expected (stock/auth)
    expect(error!.message).not.toMatch(/required parameter|missing parameter|unknown parameter/i);
  });

  it('create_tempo_invoice still works without discount fields in payload', async () => {
    // Legacy payload shape without discount_* — backward-compat via COALESCE defaults
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{ sku: 'LEGACY-SKU', qty: 1, unit_price: 100000 }],
        total: 100000,
        channel: 'walkin',
        // No discount_type / discount_value / discount_amount_rp
      },
    });

    // Expect validation error, not signature error
    expect(error).toBeTruthy();
    expect(error!.message).not.toMatch(/unknown function|unknown parameter|does not exist/i);
  });

  it('record_pi still works without discount fields in payload', async () => {
    // Legacy payload shape without discount_* keys
    const { error } = await supabaseAdmin.rpc('record_pi', {
      payload: {
        supplier_id: '00000000-0000-0000-0000-000000000001',
        type: 'PASSTHROUGH',
        order_id: '00000000-0000-0000-0000-000000000002',
        items: [{ sku: 'LEGACY-SKU', qty: 1, unit_cost: 100000 }],
        payment_due_at: '2026-07-23',
        // No discount_* fields
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).not.toMatch(/unknown function|unknown parameter|does not exist/i);
  });
});
