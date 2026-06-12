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

describe('seed_stock_row(jsonb) overload', () => {
  const NEW_SKU = `QA-SEEDJ-${Date.now()}`;

  test('creates stocks row + stock_levels rows per warehouse_id + ledger row', async () => {
    // We need an actor with Owner role. The session uses the service-role key,
    // so auth.uid() returns NULL — but the existing Owner-gate code uses
    // p_actor_user_id when passed. Pull the first Owner from admin_users.
    const { data: owner } = await supabase.from('admin_users')
      .select('id').eq('role', 'Owner').order('id').limit(1).single();
    expect(owner?.id).toBeDefined();

    const initialLevels = {
      [atasId]: 4,
      [bawahId]: 0,  // explicit zero — exercises the if (qty > 0) branch
    };

    const { data, error } = await supabase.rpc('seed_stock_row', {
      p_sku: NEW_SKU,
      p_name: 'QA seed jsonb',
      p_category: 'QA',
      p_price: 1000,
      p_harga_modal: 600,
      p_initial_levels: initialLevels,
      p_actor_user_id: owner!.id,
    });
    expect(error).toBeNull();
    expect(data).toBe(NEW_SKU);

    // Verify stock_levels rows exist for both warehouses
    const { data: levels } = await supabase.from('stock_levels')
      .select('warehouse_id, qty').eq('sku', NEW_SKU);
    const map = Object.fromEntries(levels!.map(l => [l.warehouse_id, l.qty]));
    expect(map[atasId]).toBe(4);
    expect(map[bawahId]).toBe(0);

    // Verify a single ledger row exists for the non-zero warehouse, with warehouse_id set
    const { data: movements } = await supabase.from('stock_movements')
      .select('warehouse_id, qty_delta, source').eq('sku', NEW_SKU);
    expect(movements!.length).toBe(1);
    expect(movements![0].warehouse_id).toBe(atasId);
    expect(movements![0].qty_delta).toBe(4);
    expect(movements![0].source).toBe('seed');

    // Cleanup — CASCADE on stocks delete handles stock_levels.
    // stock_movements is append-only, cannot be deleted.
    await supabase.from('stocks').delete().eq('sku', NEW_SKU);
  });
});
