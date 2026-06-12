// tests/integration/warehouses-phase3-cutover.test.ts
//
// Phase 3 cutover integration tests. These assertions are expected to FAIL
// before 20260613000003_warehouses_phase3_cutover.sql is applied, and to
// PASS after. Do not run this suite against pre-cutover Supabase.
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;

beforeAll(() => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
});

describe('Phase 3 cutover', () => {
  test('stocks.stock_atas column no longer exists', async () => {
    const { error } = await supabase
      .from('stocks').select('stock_atas').limit(1);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/column .* stock_atas|stock_atas .* not exist/i);
  });

  test('stocks.stock_bawah column no longer exists', async () => {
    const { error } = await supabase
      .from('stocks').select('stock_bawah').limit(1);
    expect(error).not.toBeNull();
  });

  test('stock_movements.warehouse text column no longer exists', async () => {
    const { error } = await supabase
      .from('stock_movements').select('warehouse').limit(1);
    expect(error).not.toBeNull();
  });

  test('stocks.stock still updates via the new SUM trigger', async () => {
    const sku = `QA-CUT-${Date.now()}`;
    const { data: w } = await supabase.from('warehouses').select('id')
      .eq('code', 'ATAS').is('tenant_id', null).single();
    expect(w?.id).toBeDefined();
    await supabase.from('stocks').insert({
      sku, name: 'QA cutover', category: 'QA',
      price: 100, harga_modal: 50, stock: 0, status: 'Sinkron',
    });
    await supabase.from('stock_levels').insert({ sku, warehouse_id: w!.id, qty: 5 });
    const { data } = await supabase.from('stocks').select('stock').eq('sku', sku).single();
    expect(data?.stock).toBe(5);
    await supabase.from('stocks').delete().eq('sku', sku);
  });

  test('legacy transfer_warehouse(text, text) overload no longer exists', async () => {
    // Call the legacy text-arg form — should fail with "function does not exist"
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: 'NONEXISTENT', p_from: 'atas', p_to: 'bawah', p_qty: 1,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/function .* does not exist|invalid input/i);
  });
});
