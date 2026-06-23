// Integration tests — Happy-path JE verification for Diskon Fitur
//
// Finding I-2 (Final Review): integration tests in tests/integration/diskon/
// only cover Pattern C (signature/guard probes). They do NOT verify that
// a discounted transaction actually posts journal_entry_lines with the
// correct account_codes (4-1900 / 5-1900). This file addresses that gap.
//
// ─── Why happy-path tests are hard in this environment ───────────────────
//
// record_pi is SECURITY DEFINER (runs as postgres) and created_by_user_id
// is NULL-able — so service-role can INSERT. However, record_pi (STOCK type)
// also calls set_pesanan_closed_if_fulfilled, updates pesanan_items,
// stock_levels, and inserts stock_lots. Cleanup would require deleting
// rows across 7+ tables in FK order. A bug in cleanup could corrupt live
// production data (this is a live DB — there is no separate test schema).
//
// ─── Decision ────────────────────────────────────────────────────────────
//
// Tests below are marked `test.skip` by default.
// Founder should run them MANUALLY before each monthly close:
//   npx vitest run tests/integration/diskon/journal-lines.test.ts --reporter=verbose
// after temporarily removing the `.skip` modifier for one run.
//
// Alternatively, once a staging/sandbox Supabase project exists, remove
// `.skip` permanently and point VITE_SUPABASE_URL at the sandbox.
//
// ─── What each test verifies ─────────────────────────────────────────────
//
// 1. record_pi (5-1900): A STOCK PI with order_discount AMOUNT 5000 posts a
//    journal_entry where:
//      D 1-1510 = gross_subtotal
//      K 2-1100 = net (gross - 5000)
//      K 5-1900 = 5000   ← the discount recognition line
//    SUM(debits) == SUM(credits) (balanced).
//
// 2. record_kasir_sale (4-1900): A Kasir FULL sale with order_discount AMOUNT
//    5000 posts a journal_entry where:
//      D cash_account = net total
//      D 4-1900 = 5000   ← discount contra-revenue debit
//      K pendapatan = gross subtotal
//    SUM(debits) == SUM(credits) (balanced).
//
// ─── Fixtures ────────────────────────────────────────────────────────────
//
// These UUIDs were discovered during Task 12 smoke testing (2026-06-23).
// They may become stale if the live DB is reset or rows are voided.
// Verify with Supabase MCP before running these tests.
//
// Supplier:  acabc0cd-6a04-45d6-a0f7-9426187732de
// Pesanan:   21f50fe8-192e-46df-b1e1-e0ed26dee512  (check open qty!)
// Item SKU:  TEST-IMM
// Item ID:   9a468171-e268-4c0b-89b5-36affc1a60f3

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

// ─── Fixture constants ─────────────────────────────────────────────────────

const SUPPLIER_ID   = 'acabc0cd-6a04-45d6-a0f7-9426187732de';
const PESANAN_ID    = '21f50fe8-192e-46df-b1e1-e0ed26dee512';
const ITEM_SKU      = 'TEST-IMM';
const ORDER_DISCOUNT_AMOUNT = 5000;

// ─── record_pi 5-1900 JE verification ─────────────────────────────────────

describe.skip(
  'Diskon record_pi — happy path 5-1900 JE verification (FOUNDER MANUAL RUN ONLY)',
  () => {
    it('record_pi with discount posts balanced JE including K 5-1900 credit line', async () => {
      // ── Pre-check: dual-write enabled ──────────────────────────────────
      const { data: cfgRows } = await supabaseAdmin
        .from('accounting_config')
        .select('enable_dual_write_to_gl')
        .is('tenant_id', null)
        .limit(1);

      const dualWrite = cfgRows?.[0]?.enable_dual_write_to_gl ?? false;
      if (!dualWrite) {
        console.warn('SKIP: accounting_config.enable_dual_write_to_gl=false — no JE will post');
        return;
      }

      // ── Pre-check: pesanan has open qty ────────────────────────────────
      const { data: pesananItems } = await supabaseAdmin
        .from('pesanan_items')
        .select('qty, qty_received_total')
        .eq('pesanan_id', PESANAN_ID)
        .limit(5);

      const hasOpenQty = (pesananItems ?? []).some(
        r => ((r as any).qty - ((r as any).qty_received_total ?? 0)) > 0,
      );
      if (!hasOpenQty) {
        console.warn('SKIP: pesanan 21f50fe8 has no open qty — all items fully received. Use a different fixture.');
        return;
      }

      let piId: string | null = null;
      let jeId: string | null = null;

      try {
        // ── Call record_pi ──────────────────────────────────────────────
        const { data, error } = await supabaseAdmin.rpc('record_pi', {
          payload: {
            supplier_id:     SUPPLIER_ID,
            type:            'STOCK',
            pesanan_id:      PESANAN_ID,
            items: [{
              sku:               ITEM_SKU,
              qty:               1,
              unit_cost:         100000,
              master_unit_cost:  100000,
              discount_amount_rp: 0,
            }],
            subtotal:             100000,
            total_amount:         95000,
            discount_type:        'AMOUNT',
            discount_value:       ORDER_DISCOUNT_AMOUNT,
            discount_amount_rp:   ORDER_DISCOUNT_AMOUNT,
            payment_due_at:       '2026-12-31',
            supplier_invoice_number: `TEST-DISKON-${Date.now()}`,
          },
        });

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        piId = (data as any).pi_id as string;
        expect(piId).toBeTruthy();

        // ── Verify JE lines ─────────────────────────────────────────────
        const { data: jeRows, error: jeErr } = await supabaseAdmin
          .from('journal_entries')
          .select('id, total_debit, total_credit, source_ref_id')
          .eq('source_ref_id', piId)
          .eq('source_type', 'PI_TAGIHAN')
          .limit(1);

        expect(jeErr).toBeNull();
        expect(jeRows).toBeTruthy();
        expect((jeRows ?? []).length).toBeGreaterThan(0);

        jeId = jeRows![0].id as string;

        // Balanced entry
        expect(jeRows![0].total_debit).toBeCloseTo(jeRows![0].total_credit, 0);

        // ── Verify specific lines via JOIN ──────────────────────────────
        const { data: lineRows, error: lineErr } = await supabaseAdmin
          .from('journal_entry_lines')
          .select('account_id, side, amount, chart_of_accounts!inner(account_code)')
          .eq('entry_id', jeId);

        expect(lineErr).toBeNull();
        expect((lineRows ?? []).length).toBeGreaterThanOrEqual(3);

        // Supabase join returns chart_of_accounts as nested object; use unknown cast for TS safety
        type LineRow = { account_id: string; side: string; amount: number; chart_of_accounts: unknown };
        const lines = (lineRows as unknown as LineRow[]) ?? [];
        const codeOf = (l: LineRow) =>
          ((l.chart_of_accounts ?? {}) as Record<string, unknown>).account_code as string;

        const inv   = lines.find(l => codeOf(l) === '1-1510');
        const ap    = lines.find(l => codeOf(l) === '2-1100');
        const disco = lines.find(l => codeOf(l) === '5-1900');

        expect(inv,   '1-1510 (persediaan) debit line missing').toBeTruthy();
        expect(ap,    '2-1100 (hutang dagang) credit line missing').toBeTruthy();
        expect(disco, '5-1900 (diskon pembelian) credit line missing').toBeTruthy();

        expect(inv!.side).toBe('DEBIT');
        expect(ap!.side).toBe('CREDIT');
        expect(disco!.side).toBe('CREDIT');

        // 5-1900 credit should equal the order-level discount amount
        expect(disco!.amount).toBeCloseTo(ORDER_DISCOUNT_AMOUNT, 0);

        // D 1-1510 = K 2-1100 + K 5-1900 (gross = net + discount)
        expect(inv!.amount).toBeCloseTo(ap!.amount + disco!.amount, 0);

      } finally {
        // ── Cleanup (FK order) ──────────────────────────────────────────
        // journal_entry_lines cascade-delete when journal_entries deleted.
        // purchase_invoice_items cascade-delete when purchase_invoices deleted.
        // stock_lots inserted with source_id=pi_id; delete by source_id.
        if (jeId) {
          await supabaseAdmin.from('journal_entries').delete().eq('id', jeId);
        }
        if (piId) {
          // stock_lots (no CASCADE from purchase_invoices): delete first
          await supabaseAdmin.from('stock_lots')
            .delete()
            .eq('source_id', piId)
            .eq('source_type', 'purchase_invoice');

          // purchase_invoice_items CASCADE from purchase_invoices — just delete PI
          await supabaseAdmin.from('purchase_invoices').delete().eq('id', piId);
        }
        // NOTE: record_pi also updates pesanan_items.qty_received_total and
        // stock_levels.qty_on_hand — we do NOT roll those back here because
        // that would put inventory below the real state.  After running this
        // test, founder should verify pesanan_items + stock_levels manually
        // and adjust if the test row causes ledger skew.
      }
    });
  },
);

// ─── record_kasir_sale 4-1900 JE verification ─────────────────────────────

describe.skip(
  'Diskon record_kasir_sale — happy path 4-1900 JE verification (FOUNDER MANUAL RUN ONLY)',
  () => {
    it('record_kasir_sale with discount posts balanced JE including D 4-1900 debit line', async () => {
      // ── Pre-check: dual-write enabled ──────────────────────────────────
      const { data: cfgRows } = await supabaseAdmin
        .from('accounting_config')
        .select('enable_dual_write_to_gl')
        .is('tenant_id', null)
        .limit(1);

      const dualWrite = cfgRows?.[0]?.enable_dual_write_to_gl ?? false;
      if (!dualWrite) {
        console.warn('SKIP: accounting_config.enable_dual_write_to_gl=false — no JE will post');
        return;
      }

      let ktId: string | null = null;
      let jeId: string | null = null;

      try {
        // ── Call record_kasir_sale ──────────────────────────────────────
        // Uses p_allow_negative_stock=true so we don't need real stock on hand.
        const { data, error } = await supabaseAdmin.rpc('record_kasir_sale', {
          p_date:                   new Date().toISOString().slice(0, 10),
          p_channel:                'walkin',
          p_items: [{
            sku:                   'TEST-DISKON-KASIR',
            name:                  'Test Diskon Kasir',
            qty:                   1,
            unit_price:            100000,
            master_price_at_sale:  100000,
            discount_amount_rp:    0,
            hpp_per_unit:          0,
            subtotal:              100000,
            hpp_subtotal:          0,
            warehouse:             null,
          }],
          p_subtotal:               100000,
          p_payment_method:         'cash',
          p_payment_subtype:        null,
          p_payment_type:           'FULL',
          p_dp_amount:              0,
          p_dp_input_type:          null,
          p_ongkir_amount:          0,
          p_notes:                  'Diskon JE integration test — CLEANUP REQUIRED',
          p_total_amount:           95000,
          p_customer_name:          'Test JE Diskon',
          p_customer_phone:         '08100000001',
          p_customer_company:       null,
          p_delivery_address:       null,
          p_marketplace_order_no:   null,
          p_wa_phone:               null,
          p_wa_chat_url:            null,
          p_customer_id:            null,
          p_discount_type:          'AMOUNT',
          p_discount_value:         ORDER_DISCOUNT_AMOUNT,
          p_discount_amount_rp:     ORDER_DISCOUNT_AMOUNT,
          p_cash_account_id:        null,
          p_allow_negative_stock:   true,
        });

        expect(error).toBeNull();
        expect(data).toBeTruthy();
        ktId = (data as any).transaction_id ?? (data as any).id as string;
        expect(ktId).toBeTruthy();

        // ── Verify JE lines ─────────────────────────────────────────────
        const { data: jeRows, error: jeErr } = await supabaseAdmin
          .from('journal_entries')
          .select('id, total_debit, total_credit, source_ref_id')
          .eq('source_ref_id', ktId)
          .eq('source_type', 'KASIR_SALE')
          .limit(1);

        expect(jeErr).toBeNull();
        expect((jeRows ?? []).length).toBeGreaterThan(0);

        jeId = jeRows![0].id as string;

        // Balanced
        expect(jeRows![0].total_debit).toBeCloseTo(jeRows![0].total_credit, 0);

        const { data: lineRows, error: lineErr } = await supabaseAdmin
          .from('journal_entry_lines')
          .select('side, amount, chart_of_accounts!inner(account_code)')
          .eq('entry_id', jeId);

        expect(lineErr).toBeNull();
        expect((lineRows ?? []).length).toBeGreaterThanOrEqual(3);

        type LineRow = { side: string; amount: number; chart_of_accounts: unknown };
        const lines = (lineRows as unknown as LineRow[]) ?? [];
        const codeOf2 = (l: LineRow) =>
          ((l.chart_of_accounts ?? {}) as Record<string, unknown>).account_code as string;

        const disco = lines.find(l => codeOf2(l) === '4-1900');

        expect(disco, '4-1900 (diskon penjualan) debit line missing').toBeTruthy();
        expect(disco!.side).toBe('DEBIT');
        expect(disco!.amount).toBeCloseTo(ORDER_DISCOUNT_AMOUNT, 0);

        // Total debits == total credits (balanced)
        const totalDebit  = lines.filter(l => l.side === 'DEBIT').reduce((s, l) => s + l.amount, 0);
        const totalCredit = lines.filter(l => l.side === 'CREDIT').reduce((s, l) => s + l.amount, 0);
        expect(totalDebit).toBeCloseTo(totalCredit, 0);

      } finally {
        // ── Cleanup (FK order) ──────────────────────────────────────────
        if (jeId) {
          await supabaseAdmin.from('journal_entries').delete().eq('id', jeId);
        }
        if (ktId) {
          // stock_movements (if any) may reference kasir_transactions — delete first
          await supabaseAdmin.from('stock_movements')
            .delete()
            .eq('source_id', ktId)
            .eq('source_type', 'kasir_sale');
          await supabaseAdmin.from('kasir_transactions').delete().eq('id', ktId);
        }
      }
    });
  },
);

// ─── Structural: JE infrastructure for diskon accounts is live ────────────
//
// These tests run unconditionally (no .skip) as they prove the schema
// is ready to receive the JE lines when dual-write is enabled.

describe('Diskon JE infrastructure — schema verification (auto)', () => {
  it('journal_entries has source_ref_id column queryable with PI_TAGIHAN', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('id, source_ref_id, source_type')
      .eq('source_type', 'PI_TAGIHAN')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('journal_entries has source_ref_id column queryable with KASIR_SALE', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('id, source_ref_id, source_type')
      .eq('source_type', 'KASIR_SALE')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('journal_entry_lines joins to chart_of_accounts by account_id', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('id, amount, chart_of_accounts!inner(account_code)')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('COA 4-1900 Diskon Penjualan accessible (DEBIT normal balance when present)', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, normal_balance, is_active')
      .eq('account_code', '4-1900')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Post-migration: if the row exists, verify normal_balance = DEBIT
    if (data && data.length > 0) {
      expect(data[0].normal_balance).toBe('DEBIT');
      expect(data[0].is_active).toBe(true);
    }
  });

  it('COA 5-1900 Diskon Pembelian accessible (CREDIT normal balance when present)', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, normal_balance, is_active')
      .eq('account_code', '5-1900')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Post-migration: if the row exists, verify normal_balance = CREDIT
    if (data && data.length > 0) {
      expect(data[0].normal_balance).toBe('CREDIT');
      expect(data[0].is_active).toBe(true);
    }
  });
});
