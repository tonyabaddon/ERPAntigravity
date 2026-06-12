import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
const TEST_SKU = `QA-PHASE2B-${Date.now()}`;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase
    .from('warehouses')
    .select('id, code')
    .eq('code', 'ATAS')
    .is('tenant_id', null)
    .single();
  atasId = data!.id;
  await supabase.from('stocks').insert({
    sku: TEST_SKU,
    name: 'QA phase2b',
    category: 'QA',
    price: 1000,
    harga_modal: 500,
    stock: 0,
    status: 'Sinkron',
  });
  await supabase.from('stock_levels').insert({
    sku: TEST_SKU,
    warehouse_id: atasId,
    qty: 20,
  });
});

afterAll(async () => {
  await supabase
    .from('kasir_transactions')
    .delete()
    .like('customer_name', 'QA-PH2B-%');
  await supabase.from('stock_levels').delete().eq('sku', TEST_SKU);  // explicit before cascade
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('record_kasir_sale with warehouse_id', () => {
  test('items.warehouse_id deducts from stock_levels', async () => {
    const { data, error } = await supabase.rpc('record_kasir_sale', {
      p_date: '2026-06-13',
      p_channel: 'walkin',
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_input_type: null,
      p_dp_amount: 0,
      p_ongkir_amount: 0,
      p_subtotal: 5000,
      p_total_amount: 5000,
      p_notes: null,
      p_items: [
        {
          sku: TEST_SKU,
          name: 'QA phase2b',
          qty: 5,
          unit_price: 1000,
          subtotal: 5000,
          hpp_per_unit: 500,
          hpp_subtotal: 2500,
          warehouse_id: atasId,
        },
      ],
      p_customer_name: 'QA-PH2B-buyer',
      p_customer_phone: '0812-PH2B',
      p_customer_company: null,
      p_customer_id: null,
      p_delivery_address: null,
      p_tokped_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_actor_user_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();
    expect(data).not.toBeNull();

    const { data: lvl } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    expect(lvl?.qty).toBe(15);
  });

  test('legacy item.warehouse text still resolves', async () => {
    const { error } = await supabase.rpc('record_kasir_sale', {
      p_date: '2026-06-13',
      p_channel: 'walkin',
      p_payment_method: 'cash',
      p_payment_subtype: null,
      p_payment_type: 'FULL',
      p_dp_input_type: null,
      p_dp_amount: 0,
      p_ongkir_amount: 0,
      p_subtotal: 1000,
      p_total_amount: 1000,
      p_notes: null,
      p_items: [
        {
          sku: TEST_SKU,
          name: 'QA phase2b',
          qty: 1,
          unit_price: 1000,
          subtotal: 1000,
          hpp_per_unit: 500,
          hpp_subtotal: 500,
          warehouse: 'atas',
        },
      ],
      p_customer_name: 'QA-PH2B-legacy',
      p_customer_phone: '0812-PH2B-2',
      p_customer_company: null,
      p_customer_id: null,
      p_delivery_address: null,
      p_tokped_order_no: null,
      p_wa_phone: null,
      p_wa_chat_url: null,
      p_actor_user_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(error).toBeNull();

    // After first test took 5, then legacy took 1 → 14 remaining
    const { data: lvl } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    expect(lvl?.qty).toBe(14);
  });
});

describe('receive_purchase_order writes stock_levels', () => {
  // Strategy: insert a minimal QA supplier + PO + 1 item, receive it via the
  // RPC, verify stock_levels was incremented, then clean up.
  const TEST_PO_PREFIX = `QA-POREC-${Date.now()}`;

  test('5-arg form: per-line warehouse_id increments stock_levels', async () => {
    // Create a supplier (name only; payment_term_days has default 0)
    const { data: supplier, error: supErr } = await supabase
      .from('suppliers')
      .insert({ name: `${TEST_PO_PREFIX}-supplier` })
      .select('id')
      .single();
    expect(supErr).toBeNull();
    expect(supplier?.id).toBeDefined();

    // Create a draft PO in ORDERED status
    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: TEST_PO_PREFIX,
        supplier_id: supplier!.id,
        status: 'ORDERED',
        ordered_at: '2026-06-13',
        total: 1500,
      })
      .select('id')
      .single();
    expect(poErr).toBeNull();
    const testPoId = po!.id;

    // Add 1 line for our QA SKU (product_name and subtotal are NOT NULL)
    const { data: item, error: itemErr } = await supabase
      .from('purchase_order_items')
      .insert({
        po_id: testPoId,
        sku: TEST_SKU,
        product_name: 'QA phase2b item',
        qty: 3,
        unit_cost: 500,
        subtotal: 1500,
      })
      .select('id')
      .single();
    expect(itemErr).toBeNull();
    const testItemId = item!.id;

    // Read pre-state of stock_levels
    const { data: pre } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    const preQty = pre?.qty ?? 0;

    // Call 5-arg form: conditions must include qty_received + warehouse_id per line
    const conditions: Record<string, { qty_received: number; qty_damaged: number; warehouse_id: string }> = {};
    conditions[testItemId] = { qty_received: 3, qty_damaged: 0, warehouse_id: atasId };

    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: testPoId,
      p_received_at: '2026-06-13',
      p_payment_due_at: '2026-06-20',
      p_invoice_url: null,
      p_conditions: conditions,
    });
    expect(error).toBeNull();

    // Verify stock_levels incremented by 3
    const { data: post } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    expect(post?.qty).toBe(preQty + 3);

    // Cleanup
    await supabase.from('purchase_order_items').delete().eq('po_id', testPoId);
    await supabase.from('purchase_orders').delete().eq('id', testPoId);
    await supabase.from('suppliers').delete().eq('id', supplier!.id);
  });

  test('6-arg legacy form: delegates and writes stock_levels (not stocks.stock_atas)', async () => {
    // Same setup: fresh supplier + PO + 1 line
    const { data: supplier, error: supErr } = await supabase
      .from('suppliers')
      .insert({ name: `${TEST_PO_PREFIX}-supplier-6arg` })
      .select('id')
      .single();
    expect(supErr).toBeNull();

    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: `${TEST_PO_PREFIX}-6ARG`,
        supplier_id: supplier!.id,
        status: 'ORDERED',
        ordered_at: '2026-06-13',
        total: 1000,
      })
      .select('id')
      .single();
    expect(poErr).toBeNull();
    const sixArgPoId = po!.id;

    const { data: item, error: itemErr } = await supabase
      .from('purchase_order_items')
      .insert({
        po_id: sixArgPoId,
        sku: TEST_SKU,
        product_name: 'QA phase2b item 6arg',
        qty: 2,
        unit_cost: 500,
        subtotal: 1000,
      })
      .select('id')
      .single();
    expect(itemErr).toBeNull();
    const sixArgItemId = item!.id;

    const { data: pre } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    const preQty = pre?.qty ?? 0;

    // Call the 6-arg form with p_warehouse='atas'; conditions must include qty_received
    const conditions: Record<string, { qty_received: number; qty_damaged: number }> = {};
    conditions[sixArgItemId] = { qty_received: 2, qty_damaged: 0 };

    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: sixArgPoId,
      p_received_at: '2026-06-13',
      p_payment_due_at: '2026-06-20',
      p_invoice_url: null,
      p_conditions: conditions,
      p_warehouse: 'atas',
    });
    expect(error).toBeNull();

    // Verify stock_levels incremented (NOT stocks.stock_atas, which is the bug we're preventing)
    const { data: post } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    expect(post?.qty).toBe(preQty + 2);

    // Cleanup
    await supabase.from('purchase_order_items').delete().eq('po_id', sixArgPoId);
    await supabase.from('purchase_orders').delete().eq('id', sixArgPoId);
    await supabase.from('suppliers').delete().eq('id', supplier!.id);
  });
});
