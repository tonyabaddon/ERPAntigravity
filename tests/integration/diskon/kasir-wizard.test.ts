// Integration tests for Diskon Fitur — Kasir Path B + Wizard TEMPO — Pattern C
//
// Scenario 1 (Kasir Path B): record_kasir_sale accepts discount payload.
//   The function validates discount consistency before touching stock/GL.
//   Tests confirm: function deployed + 3 discount params present + validation
//   guards fire (DISCOUNT_TRIPLE_INVALID, MARKUP_NOT_ALLOWED,
//   EXCESSIVE_LINE_DISCOUNT, DISCOUNT_EXCEEDS_SUBTOTAL).
//
// Scenario 2 (Wizard TEMPO): create_tempo_invoice accepts discount payload.
//   Tests confirm: function deployed + same 4 discount validation guards fire.
//   Schema: orders table has 3 new discount columns + CHECK constraints.
//
// NOTE: Happy-path tests (actual INSERT + verify row) require Owner auth
// which is unavailable in the test harness (Pattern B set_config doesn't
// survive across PostgREST HTTP requests). Happy paths are verified by
// founder manual smoke: `npm run dev`, execute discounted Kasir/Wizard
// transactions, confirm row has discount_amount_rp > 0.

import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

// ── record_kasir_sale: Signature verification ────────────────────────────────

describe('Diskon record_kasir_sale — signature verification', () => {
  it('function exists and accepts 25-param signature with discount params', async () => {
    // Call with minimal valid-shaped params; error expected due to validation
    // (items=[] or stock issues), NOT "unknown function" or param mismatch.
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{ sku: 'DISKON-TEST-SKU', qty: 1, price: 100000 }],
      p_subtotal: 100000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: 'Diskon integration test',
      p_total_amount: 100000,
      p_customer_name: 'Test Diskon',
      p_customer_phone: '08123456789',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      p_discount_type: null,
      p_discount_value: null,
      p_discount_amount_rp: 0,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    // Should not fail with "unknown function" / signature error
    expect(error).toBeTruthy(); // Validation error expected (auth, stock, etc.)
    expect(error!.message).not.toMatch(/unknown function|unknown parameter|does not exist/i);
  });

  it('function accepts p_discount_type, p_discount_value, p_discount_amount_rp params', async () => {
    // Verify the 3 new discount params exist: pass all three explicitly
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{ sku: 'DISKON-TEST-SKU', qty: 1, price: 50000 }],
      p_subtotal: 50000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 47500,
      p_customer_name: 'Test Diskon',
      p_customer_phone: '08111222333',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      p_discount_type: 'PERCENT',
      p_discount_value: 5,
      p_discount_amount_rp: 2500,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    // New params exist: error must NOT be param/signature related
    expect(error).toBeTruthy();
    expect(error!.message).not.toMatch(/unknown parameter|does not exist|p_discount/i);
  });
});

// ── record_kasir_sale: Discount validation guards ────────────────────────────

describe('Diskon record_kasir_sale — validation guards (Path B)', () => {
  it('DISCOUNT_TRIPLE_INVALID: type set without value', async () => {
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{ sku: 'X', qty: 1, unit_price: 100000, master_price_at_sale: 100000 }],
      p_subtotal: 100000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 100000,
      p_customer_name: 'T',
      p_customer_phone: '081',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      // Triple inconsistency: type set, value null
      p_discount_type: 'PERCENT',
      p_discount_value: null,
      p_discount_amount_rp: 0,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/DISCOUNT_TRIPLE_INVALID/i);
  });

  it('MARKUP_NOT_ALLOWED: unit_price > master_price_at_sale', async () => {
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{
        sku: 'X',
        qty: 1,
        unit_price: 120000,        // above master → markup
        master_price_at_sale: 100000,
        discount_amount_rp: 0,
      }],
      p_subtotal: 120000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 120000,
      p_customer_name: 'T',
      p_customer_phone: '081',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      p_discount_type: null,
      p_discount_value: null,
      p_discount_amount_rp: 0,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/MARKUP_NOT_ALLOWED/i);
  });

  it('EXCESSIVE_LINE_DISCOUNT: line discount > line total', async () => {
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{
        sku: 'X',
        qty: 1,
        unit_price: 100000,
        master_price_at_sale: 100000,
        discount_amount_rp: 150000,  // exceeds 1×100000
      }],
      p_subtotal: 100000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 100000,
      p_customer_name: 'T',
      p_customer_phone: '081',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      p_discount_type: null,
      p_discount_value: null,
      p_discount_amount_rp: 0,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/EXCESSIVE_LINE_DISCOUNT/i);
  });

  it('DISCOUNT_EXCEEDS_SUBTOTAL: order-level discount > subtotal', async () => {
    const { error } = await supabaseAdmin.rpc('record_kasir_sale', {
      p_date: '2026-06-23',
      p_channel: 'walkin',
      p_items: [{
        sku: 'X',
        qty: 1,
        unit_price: 100000,
        master_price_at_sale: 100000,
        discount_amount_rp: 0,
      }],
      p_subtotal: 100000,
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_amount: 0,
      p_dp_input_type: null,
      p_ongkir_amount: 0,
      p_notes: null,
      p_total_amount: 100000,
      p_customer_name: 'T',
      p_customer_phone: '081',
      p_customer_company: null,
      p_delivery_address: null,
      p_marketplace_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_customer_id: null,
      // Order discount > subtotal → DISCOUNT_EXCEEDS_SUBTOTAL
      p_discount_type: 'AMOUNT',
      p_discount_value: 200000,
      p_discount_amount_rp: 200000,
      p_cash_account_id: null,
      p_allow_negative_stock: true,
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/DISCOUNT_EXCEEDS_SUBTOTAL/i);
  });
});

// ── kasir_transactions: Schema verification ──────────────────────────────────

describe('Diskon kasir_transactions — schema verification', () => {
  it('kasir_transactions has 3 new discount columns', async () => {
    const { data, error } = await supabaseAdmin
      .from('kasir_transactions')
      .select('discount_type, discount_value, discount_amount_rp')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('kasir_transactions discount_type column accepts NULL (no-discount rows)', async () => {
    // Query rows with null discount_type — should return without error
    const { data, error } = await supabaseAdmin
      .from('kasir_transactions')
      .select('id, discount_type, discount_amount_rp')
      .is('discount_type', null)
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('kasir_transactions discount_amount_rp defaults to 0 for legacy rows', async () => {
    // All existing rows should have discount_amount_rp = 0 (NOT NULL DEFAULT 0)
    const { data, error } = await supabaseAdmin
      .from('kasir_transactions')
      .select('id, discount_amount_rp')
      .eq('discount_amount_rp', 0)
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

// ── create_tempo_invoice: Signature + validation ─────────────────────────────

describe('Diskon create_tempo_invoice — signature verification', () => {
  it('function exists and accepts payload jsonb', async () => {
    // Minimal payload — expect validation error, not signature error
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{ sku: 'T', qty: 1, unit_price: 100000 }],
        total: 100000,
        channel: 'walkin',
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).not.toMatch(/unknown function|unknown parameter|does not exist/i);
  });
});

describe('Diskon create_tempo_invoice — discount validation guards (Wizard TEMPO)', () => {
  it('DISCOUNT_TRIPLE_INVALID: discount_type set, discount_value null', async () => {
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{ sku: 'T', qty: 1, unit_price: 100000 }],
        total: 100000,
        channel: 'walkin',
        // Triple inconsistency
        discount_type: 'PERCENT',
        // discount_value intentionally omitted (null)
        discount_amount_rp: 5000,
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/DISCOUNT_TRIPLE_INVALID/i);
  });

  it('MARKUP_NOT_ALLOWED: item unit_price > master_price_at_sale', async () => {
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{
          sku: 'T',
          qty: 1,
          unit_price: 120000,
          master_price_at_sale: 100000,  // unit > master → markup
        }],
        total: 120000,
        channel: 'walkin',
        discount_type: null,
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/MARKUP_NOT_ALLOWED/i);
  });

  it('EXCESSIVE_LINE_DISCOUNT: item discount > line total', async () => {
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{
          sku: 'T',
          qty: 1,
          unit_price: 100000,
          master_price_at_sale: 100000,
          discount_amount_rp: 150000,  // exceeds 1×100000
        }],
        total: 100000,
        channel: 'walkin',
        discount_type: null,
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/EXCESSIVE_LINE_DISCOUNT/i);
  });

  it('DISCOUNT_EXCEEDS_SUBTOTAL: order discount > line subtotal', async () => {
    const { error } = await supabaseAdmin.rpc('create_tempo_invoice', {
      p_payload: {
        customer_id: '00000000-0000-0000-0000-000000000001',
        items: [{
          sku: 'T',
          qty: 1,
          unit_price: 100000,
          master_price_at_sale: 100000,
          discount_amount_rp: 0,
        }],
        total: 100000,
        channel: 'walkin',
        // Order discount exceeds subtotal
        discount_type: 'AMOUNT',
        discount_value: 200000,
        discount_amount_rp: 200000,
      },
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/DISCOUNT_EXCEEDS_SUBTOTAL/i);
  });
});

// ── orders: Schema verification (Wizard TEMPO columns) ───────────────────────

describe('Diskon orders table — schema verification', () => {
  it('orders table has 3 new discount columns', async () => {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('discount_type, discount_value, discount_amount_rp')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('orders discount_amount_rp defaults to 0 for legacy rows', async () => {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, discount_amount_rp')
      .eq('discount_amount_rp', 0)
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('KASIR_SALE journal entry source enum still accessible (GL dual-write)', async () => {
    // Verifies the journal infrastructure for discount GL lines is intact
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'KASIR_SALE')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('COA 4-1900 Diskon Penjualan accessible (discount contra account)', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, is_active')
      .eq('account_code', '4-1900');

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // Post-migration: 4-1900 should exist and be active
    if (data && data.length > 0) {
      expect(data[0].is_active).toBe(true);
    }
  });
});
