// tests/integration/warehouses-phase2a-rpcs.test.ts
//
// Integration tests for Migration 2a: transfer_warehouse / decrement_stock /
// seed_stock_row uuid-aware overloads. Runs against live Supabase using the
// same pattern as warehouses-phase1.test.ts.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
let bawahId: string;
const TEST_SKU = `QA-WHRPC-${Date.now()}`;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data } = await supabase.from('warehouses').select('id, code').is('tenant_id', null);
  atasId = data!.find(w => w.code === 'ATAS')!.id;
  bawahId = data!.find(w => w.code === 'BAWAH')!.id;
  // Seed a fresh SKU with 10 in ATAS, 0 in BAWAH
  await supabase.from('stocks').insert({
    sku: TEST_SKU, name: 'QA RPC test', category: 'QA',
    price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
  });
  await supabase.from('stock_levels').insert([
    { sku: TEST_SKU, warehouse_id: atasId, qty: 10 },
    { sku: TEST_SKU, warehouse_id: bawahId, qty: 0 },
  ]);
});

afterAll(async () => {
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('transfer_warehouse(uuid, uuid)', () => {
  test('happy path: 3 from ATAS to BAWAH', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: bawahId, p_qty: 3,
    });
    expect(error).toBeNull();
    const { data: levels } = await supabase
      .from('stock_levels').select('warehouse_id, qty').eq('sku', TEST_SKU);
    const map = Object.fromEntries(levels!.map(l => [l.warehouse_id, l.qty]));
    expect(map[atasId]).toBe(7);
    expect(map[bawahId]).toBe(3);
  });

  test('insufficient stock raises', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: bawahId, p_qty: 9999,
    });
    expect(error?.message).toMatch(/tidak cukup/i);
  });

  test('same source and destination raises', async () => {
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from_warehouse_id: atasId, p_to_warehouse_id: atasId, p_qty: 1,
    });
    expect(error?.message).toMatch(/source and destination must differ/i);
  });
});

describe('transfer_warehouse(text, text) legacy overload', () => {
  test('still works via the wrapper', async () => {
    // Move 1 from BAWAH back to ATAS using the legacy text args
    const { error } = await supabase.rpc('transfer_warehouse', {
      p_sku: TEST_SKU, p_from: 'bawah', p_to: 'atas', p_qty: 1,
    });
    expect(error).toBeNull();
  });
});

describe('decrement_stock(uuid)', () => {
  test('happy path', async () => {
    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU, p_warehouse_id: atasId, p_qty: 1,
    });
    expect(error).toBeNull();
  });

  test('insufficient raises', async () => {
    const { error } = await supabase.rpc('decrement_stock', {
      p_sku: TEST_SKU, p_warehouse_id: bawahId, p_qty: 9999,
    });
    expect(error?.message).toMatch(/tidak cukup/i);
  });
});
