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
