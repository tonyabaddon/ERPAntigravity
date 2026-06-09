/**
 * Integration tests for Sales Recording overhaul against live Supabase.
 *
 * Strategy: each test creates rows with customer_name prefixed `QA-TEST-` so
 * cleanup can identify and delete them. Uses anon key (same as the UI does).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
// Tests need to write — anon role is SELECT-only per current RLS.
// Use service_role if available; fall back to anon (some tests will fail).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('VITE_SUPABASE_URL or SUPABASE_SERVICE_KEY/VITE_SUPABASE_ANON_KEY missing');
}

let supabase: SupabaseClient;
const TEST_PREFIX = `QA-TEST-${Date.now()}`;
const TEST_SKU = `QA-TEST-SKU-${Date.now()}`;

// ─── lifecycle ────────────────────────────────────────────────────

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Seed a single stock item so we can test per-row warehouse decrement
  // without disturbing real inventory.
  const { error: seedErr } = await supabase.from('stocks').insert({
    sku: TEST_SKU,
    name: 'QA Test Stock Item',
    category: 'QA Test',
    price: 50000,
    harga_modal: 30000,
    stock_atas: 100,
    stock_bawah: 50,
    stock: 150,
    status: 'aman',
  });
  if (seedErr) {
    throw new Error(`Failed to seed test stock: ${seedErr.message}`);
  }
});

afterAll(async () => {
  // Cleanup: delete all rows we created during this test run
  await supabase.from('kasir_transactions').delete().like('customer_name', `${TEST_PREFIX}%`);
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

// ─── helpers ──────────────────────────────────────────────────────

function basePayload(opts: { suffix: string; channel?: string; payment_type?: string; dp_amount?: number; status?: string } = { suffix: '' }) {
  return {
    date: new Date().toISOString().slice(0, 10),
    type: 'income',
    channel: opts.channel ?? 'walkin',
    items: [
      { sku: TEST_SKU, name: 'Test Item', qty: 1, unit_price: 50000, hpp_per_unit: 30000, subtotal: 50000, hpp_subtotal: 30000, warehouse: 'atas' },
    ],
    subtotal: 50000,
    hpp_total: 30000,
    total_amount: 50000,
    payment_method: 'cash' as const,
    payment_subtype: null,
    payment_type: opts.payment_type ?? 'FULL',
    dp_amount: opts.dp_amount ?? 0,
    dp_input_type: null,
    ongkir_amount: 0,
    notes: null,
    tokped_order_no: null,
    wa_phone: null,
    wa_chat_url: null,
    status: opts.status ?? (opts.payment_type === 'DP' ? 'AWAITING_LUNAS' : 'PAID'),
    customer_name: `${TEST_PREFIX}-${opts.suffix}`,
    customer_phone: '0812-TEST-' + opts.suffix,
    customer_company: 'QA Test Co.',
    invoice_number: `QA-INV-${opts.suffix}-${Date.now()}`,
  };
}

// ─── save flow tests ──────────────────────────────────────────────

describe('Save flow — kasir_transactions inserts', () => {
  test('walk-in Full payment inserts with status=PAID', async () => {
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert(basePayload({ suffix: 'walkin-full' }))
      .select().single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.channel).toBe('walkin');
    expect(data!.payment_type).toBe('FULL');
    expect(data!.status).toBe('PAID');
    expect(data!.dp_amount).toBe(0);
  });

  test('tokopedia DP transaction sets AWAITING_LUNAS + tokped_order_no', async () => {
    const payload = {
      ...basePayload({ suffix: 'tokped-dp', channel: 'tokopedia', payment_type: 'DP', dp_amount: 20000, status: 'AWAITING_LUNAS' }),
      dp_input_type: 'AMOUNT',
      tokped_order_no: 'INV/240607/MPL/QA-TEST',
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.channel).toBe('tokopedia');
    expect(data!.payment_type).toBe('DP');
    expect(data!.status).toBe('AWAITING_LUNAS');
    expect(data!.dp_amount).toBe(20000);
    expect(data!.tokped_order_no).toBe('INV/240607/MPL/QA-TEST');
    expect(data!.dp_input_type).toBe('AMOUNT');
  });

  test('whatsapp channel persists wa_phone + wa_chat_url', async () => {
    const payload = {
      ...basePayload({ suffix: 'wa-manual', channel: 'whatsapp' }),
      wa_phone: '081234567890',
      wa_chat_url: 'https://wa.me/6281234567890',
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.channel).toBe('whatsapp');
    expect(data!.wa_phone).toBe('081234567890');
    expect(data!.wa_chat_url).toBe('https://wa.me/6281234567890');
  });

  test('EDC payment with subtype=qris persists both', async () => {
    const payload = {
      ...basePayload({ suffix: 'edc-qris' }),
      payment_method: 'edc' as const,
      payment_subtype: 'qris',
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.payment_method).toBe('edc');
    expect(data!.payment_subtype).toBe('qris');
  });

  test('EDC payment with subtype=debit persists both', async () => {
    const payload = {
      ...basePayload({ suffix: 'edc-debit' }),
      payment_method: 'edc' as const,
      payment_subtype: 'debit',
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.payment_subtype).toBe('debit');
  });

  test('ongkir + notes persist', async () => {
    const payload = {
      ...basePayload({ suffix: 'ongkir-notes' }),
      ongkir_amount: 25000,
      notes: 'QA Test: Garansi 1 bulan. Antar Sabtu pagi.',
      total_amount: 75000, // subtotal 50k + ongkir 25k
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(Number(data!.ongkir_amount)).toBe(25000);
    expect(data!.notes).toBe('QA Test: Garansi 1 bulan. Antar Sabtu pagi.');
    expect(Number(data!.total_amount)).toBe(75000);
  });

  test('delivery_address persists when shipping', async () => {
    const payload = {
      ...basePayload({ suffix: 'delivery' }),
      delivery_address: 'Jl. Merdeka No. 12, Jakarta Utara 14140',
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.delivery_address).toBe('Jl. Merdeka No. 12, Jakarta Utara 14140');
  });

  test('delivery_address null when not shipping', async () => {
    const payload = basePayload({ suffix: 'no-delivery' });
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    expect(data!.delivery_address).toBeNull();
  });

  test('per-row warehouse persists in items JSON', async () => {
    const payload = {
      ...basePayload({ suffix: 'wh-mixed' }),
      items: [
        { sku: TEST_SKU, name: 'Item A', qty: 2, unit_price: 50000, hpp_per_unit: 30000, subtotal: 100000, hpp_subtotal: 60000, warehouse: 'atas' },
        { sku: TEST_SKU, name: 'Item B', qty: 3, unit_price: 50000, hpp_per_unit: 30000, subtotal: 150000, hpp_subtotal: 90000, warehouse: 'bawah' },
      ],
      subtotal: 250000,
      hpp_total: 150000,
      total_amount: 250000,
    };
    const { data, error } = await supabase.from('kasir_transactions').insert(payload).select().single();

    expect(error).toBeNull();
    const items = data!.items as any[];
    expect(items).toHaveLength(2);
    expect(items[0].warehouse).toBe('atas');
    expect(items[1].warehouse).toBe('bawah');
  });
});

// ─── pelunasan flow tests ─────────────────────────────────────────

describe('Pelunasan flow — markLunas state transition', () => {
  test('AWAITING_LUNAS → COMPLETED records lunas_at + payment method', async () => {
    // 1. Create a DP transaction
    const dpPayload = {
      ...basePayload({ suffix: 'pelunasan-1', payment_type: 'DP', dp_amount: 20000, status: 'AWAITING_LUNAS' }),
      dp_input_type: 'AMOUNT',
    };
    const { data: dp, error: e1 } = await supabase.from('kasir_transactions').insert(dpPayload).select().single();
    expect(e1).toBeNull();

    // 2. Mark it lunas (mimics kasirService.markLunas internal logic)
    const updates = {
      status: 'COMPLETED',
      lunas_at: new Date().toISOString(),
      lunas_payment_method: 'cash',
      lunas_payment_subtype: null,
    };
    const { data: updated, error: e2 } = await supabase.from('kasir_transactions').update(updates).eq('id', dp!.id).select().single();
    expect(e2).toBeNull();
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.lunas_at).not.toBeNull();
    expect(updated!.lunas_payment_method).toBe('cash');
  });

  test('markLunas with EDC sub-type records both', async () => {
    const dpPayload = {
      ...basePayload({ suffix: 'pelunasan-edc', payment_type: 'DP', dp_amount: 20000, status: 'AWAITING_LUNAS' }),
      dp_input_type: 'AMOUNT',
    };
    const { data: dp } = await supabase.from('kasir_transactions').insert(dpPayload).select().single();

    const { data: updated, error } = await supabase
      .from('kasir_transactions')
      .update({
        status: 'COMPLETED',
        lunas_at: new Date().toISOString(),
        lunas_payment_method: 'edc',
        lunas_payment_subtype: 'qris',
      })
      .eq('id', dp!.id).select().single();

    expect(error).toBeNull();
    expect(updated!.lunas_payment_method).toBe('edc');
    expect(updated!.lunas_payment_subtype).toBe('qris');
  });

  test('cancelTransaction sets status=CANCELLED', async () => {
    const payload = basePayload({ suffix: 'cancel-1' });
    const { data: row } = await supabase.from('kasir_transactions').insert(payload).select().single();

    const { data: cancelled, error } = await supabase
      .from('kasir_transactions')
      .update({ status: 'CANCELLED' })
      .eq('id', row!.id).select().single();

    expect(error).toBeNull();
    expect(cancelled!.status).toBe('CANCELLED');
  });
});

// ─── stock decrement tests ────────────────────────────────────────

describe('Per-warehouse stock decrement', () => {
  test('decrement from stock_atas only decreases stock_atas', async () => {
    // Snapshot current stock
    const { data: before } = await supabase.from('stocks').select('stock_atas, stock_bawah').eq('sku', TEST_SKU).single();
    const beforeAtas = before!.stock_atas;
    const beforeBawah = before!.stock_bawah;

    // Call the same RPC the UI uses
    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU,
      p_qty: 5,
      p_warehouse: 'atas',
    });
    expect(error).toBeNull();

    const { data: after } = await supabase.from('stocks').select('stock_atas, stock_bawah').eq('sku', TEST_SKU).single();
    expect(after!.stock_atas).toBe(beforeAtas - 5);
    expect(after!.stock_bawah).toBe(beforeBawah);
  });

  test('decrement from stock_bawah only decreases stock_bawah', async () => {
    const { data: before } = await supabase.from('stocks').select('stock_atas, stock_bawah').eq('sku', TEST_SKU).single();
    const beforeAtas = before!.stock_atas;
    const beforeBawah = before!.stock_bawah;

    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU,
      p_qty: 3,
      p_warehouse: 'bawah',
    });
    expect(error).toBeNull();

    const { data: after } = await supabase.from('stocks').select('stock_atas, stock_bawah').eq('sku', TEST_SKU).single();
    expect(after!.stock_atas).toBe(beforeAtas);
    expect(after!.stock_bawah).toBe(beforeBawah - 3);
  });
});

// ─── constraint enforcement tests (negative) ──────────────────────

describe('CHECK constraint enforcement', () => {
  test('rejects invalid payment_type', async () => {
    const payload = { ...basePayload({ suffix: 'bad-pt' }), payment_type: 'PARTIAL' as any };
    const { error } = await supabase.from('kasir_transactions').insert(payload);
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/);
  });

  test('rejects invalid status', async () => {
    const payload = { ...basePayload({ suffix: 'bad-status' }), status: 'EXPIRED' as any };
    const { error } = await supabase.from('kasir_transactions').insert(payload);
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/);
  });

  test('rejects invalid payment_subtype', async () => {
    const payload = { ...basePayload({ suffix: 'bad-st' }), payment_method: 'edc' as const, payment_subtype: 'cash' as any };
    const { error } = await supabase.from('kasir_transactions').insert(payload);
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/);
  });

  test('rejects invalid dp_input_type', async () => {
    const payload = {
      ...basePayload({ suffix: 'bad-dpit', payment_type: 'DP', dp_amount: 10000, status: 'AWAITING_LUNAS' }),
      dp_input_type: 'PERCENTAGE' as any,  // valid for orders, NOT for kasir_transactions
    };
    const { error } = await supabase.from('kasir_transactions').insert(payload);
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/check|constraint/);
  });
});

// ─── record_kasir_sale RPC (production save path) ─────────────────
//
// The tests above insert into kasir_transactions directly to verify the
// schema. In production every sale now goes through the
// record_kasir_sale RPC instead, which bundles FIFO + counter + insert
// atomically. These two tests pin the RPC's contract from the TS side.
// (Backend-go has 3 deeper RPC tests in record_kasir_sale_test.go;
// these are the TS-side smoke that the same RPC remains callable from
// supabase-js with the payload shape PenjualanBaruScreen sends.)

describe('record_kasir_sale RPC', () => {
  test('RPC inserts a row with server-generated invoice + hpp_total', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('record_kasir_sale', {
      p_date:              today,
      p_channel:           'walkin',
      p_items:             [
        { sku: TEST_SKU, name: 'Test', qty: 2, unit_price: 50000, subtotal: 100000, warehouse: 'atas' },
      ],
      p_subtotal:          100000,
      p_payment_method:    'cash',
      p_payment_subtype:   null,
      p_payment_type:      'FULL',
      p_dp_amount:         0,
      p_dp_input_type:     null,
      p_ongkir_amount:     0,
      p_notes:             null,
      p_total_amount:      100000,
      p_customer_name:     `${TEST_PREFIX}-rpc-happy`,
      p_customer_phone:    '0812-TEST-rpc-happy',
      p_customer_company:  'QA Test Co.',
      p_delivery_address:  null,
      p_tokped_order_no:   null,
      p_wa_phone:          null,
      p_wa_chat_url:       null,
      p_customer_id:       null,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.invoice_number).toMatch(/^WLK-\d{8}-\d{3}$/);
    expect(data.status).toBe('PAID');
    expect(Number(data.hpp_total)).toBeGreaterThan(0); // FIFO walked the seeded lot
    expect(data.channel).toBe('walkin');
  });

  test('RPC rejects unknown payment_subtype before any side effect', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.rpc('record_kasir_sale', {
      p_date:              today,
      p_channel:           'walkin',
      p_items:             [
        { sku: TEST_SKU, name: 'Test', qty: 1, unit_price: 50000, subtotal: 50000, warehouse: 'atas' },
      ],
      p_subtotal:          50000,
      p_payment_method:    'edc',
      p_payment_subtype:   'cash',  // invalid: chk_kasir_payment_subtype allows debit|qris only
      p_payment_type:      'FULL',
      p_dp_amount:         0,
      p_dp_input_type:     null,
      p_ongkir_amount:     0,
      p_notes:             null,
      p_total_amount:      50000,
      p_customer_name:     `${TEST_PREFIX}-rpc-bad-subtype`,
      p_customer_phone:    '0812-TEST-rpc-bad-subtype',
      p_customer_company:  null,
      p_delivery_address:  null,
      p_tokped_order_no:   null,
      p_wa_phone:          null,
      p_wa_chat_url:       null,
      p_customer_id:       null,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/invalid payment_subtype/);
  });
});
