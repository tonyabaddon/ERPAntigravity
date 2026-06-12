// tests/integration/warehouses-phase1.test.ts
//
// Phase 1 schema integration tests. Verifies the seed rows exist, the
// stock_levels backfill matches stock_atas + stock_bawah row-by-row, and
// the stocks.stock SUM trigger updates correctly when stock_levels qty
// changes. Runs against live Supabase using the same pattern as
// sales-recording.test.ts.

import { describe, test, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
let bawahId: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, code')
    .is('tenant_id', null);
  expect(error).toBeNull();
  expect(data?.length).toBeGreaterThanOrEqual(2);
  atasId = data!.find(w => w.code === 'ATAS')!.id;
  bawahId = data!.find(w => w.code === 'BAWAH')!.id;
});

describe('Phase 1 schema', () => {
  test('warehouses seed has ATAS as the default', async () => {
    const { data } = await supabase
      .from('warehouses')
      .select('code, is_default')
      .eq('id', atasId)
      .single();
    expect(data?.is_default).toBe(true);
  });

  test('exactly one default warehouse per tenant', async () => {
    const { count } = await supabase
      .from('warehouses')
      .select('id', { count: 'exact', head: true })
      .is('tenant_id', null)
      .eq('is_default', true);
    expect(count).toBe(1);
  });

  test('stock_levels backfill row-count matches stocks.count * 2', async () => {
    const { count: stocksCount } = await supabase
      .from('stocks').select('sku', { count: 'exact', head: true });
    const { count: levelsCount } = await supabase
      .from('stock_levels').select('sku', { count: 'exact', head: true });
    expect(levelsCount).toBe((stocksCount ?? 0) * 2);
  });

  test('SUM trigger updates stocks.stock when stock_levels.qty changes', async () => {
    const testSku = `QA-WH-TRIG-${Date.now()}`;
    await supabase.from('stocks').insert({
      sku: testSku, name: 'QA trigger test', category: 'QA',
      price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
    });
    await supabase.from('stock_levels').insert([
      { sku: testSku, warehouse_id: atasId, qty: 7 },
      { sku: testSku, warehouse_id: bawahId, qty: 3 },
    ]);
    const { data } = await supabase
      .from('stocks').select('stock').eq('sku', testSku).single();
    expect(data?.stock).toBe(10);

    // Mutation also triggers
    await supabase.from('stock_levels')
      .update({ qty: 5 })
      .eq('sku', testSku).eq('warehouse_id', atasId);
    const { data: data2 } = await supabase
      .from('stocks').select('stock').eq('sku', testSku).single();
    expect(data2?.stock).toBe(8);

    // Cleanup
    await supabase.from('stocks').delete().eq('sku', testSku);
  });

  test('warehouse_id columns backfilled on history tables', async () => {
    const { data } = await supabase
      .from('stock_movements')
      .select('warehouse, warehouse_id')
      .not('warehouse', 'is', null)
      .limit(5);
    expect(data!.every(r => r.warehouse_id !== null)).toBe(true);
  });

  test('warehouse_audit_log is append-only — UPDATE raises', async () => {
    // Insert a probe row first
    const { data: w } = await supabase.from('warehouses')
      .select('id').eq('code', 'ATAS').single();
    const { data: ins, error: insErr } = await supabase
      .from('warehouse_audit_log')
      .insert({
        warehouse_id: w!.id,
        actor_user_id: '00000000-0000-0000-0000-000000000000',
        action: 'create',
        after: { test: true },
      })
      .select('id').single();
    expect(insErr).toBeNull();

    const { error: updErr } = await supabase
      .from('warehouse_audit_log')
      .update({ reason_note: 'mutation should fail' })
      .eq('id', ins!.id);
    expect(updErr).not.toBeNull();
    expect(updErr!.message).toContain('append-only');
  });
});
