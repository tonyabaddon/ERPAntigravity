// tests/integration/warehouses-phase2c-rpcs.test.ts
// Integration tests for Migration 2c: commit_approved_adjustment and
// commit_opname reading warehouse_id from satellite tables and mutating
// stock_levels instead of stocks.stock_atas / stocks.stock_bawah.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase env missing');

let supabase: SupabaseClient;
let atasId: string;
const TEST_SKU = `QA-PHASE2C-${Date.now()}`;
// Nil UUID is valid as requested_by (no FK on the column).
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Resolve the canonical ATAS warehouse id (system-level, tenant_id = NULL).
  const { data: wh, error: whErr } = await supabase
    .from('warehouses')
    .select('id')
    .eq('code', 'ATAS')
    .is('tenant_id', null)
    .single();
  if (whErr || !wh) throw new Error(`ATAS warehouse not found: ${whErr?.message}`);
  atasId = wh.id;

  // Seed stocks row.
  const { error: sErr } = await supabase.from('stocks').insert({
    sku: TEST_SKU,
    name: 'QA phase2c',
    category: 'QA',
    price: 1000,
    harga_modal: 500,
    stock: 0,
    status: 'Sinkron',
  });
  if (sErr) throw new Error(`stocks seed failed: ${sErr.message}`);

  // Seed stock_levels row at qty=50.
  const { error: slErr } = await supabase.from('stock_levels').insert({
    sku: TEST_SKU,
    warehouse_id: atasId,
    qty: 50,
  });
  if (slErr) throw new Error(`stock_levels seed failed: ${slErr.message}`);
});

afterAll(async () => {
  // Clean up in FK-safe order.
  await supabase.from('stock_movements').delete().eq('sku', TEST_SKU);
  await supabase.from('stock_levels').delete().eq('sku', TEST_SKU);
  await supabase.from('stocks').delete().eq('sku', TEST_SKU);
});

describe('commit_approved_adjustment with warehouse_id', () => {
  test('approved request mutates stock_levels by qty_delta', async () => {
    // Create the approval_requests gate (already 'approved' — simulates the
    // Owner having flipped it via _transition_approval out-of-band).
    const { data: ar, error: arErr } = await supabase
      .from('approval_requests')
      .insert({
        request_type: 'adjustment',
        status: 'approved',
        requested_by: NIL_UUID,
        payload: {},
      })
      .select('id')
      .single();
    if (arErr || !ar) throw new Error(`approval_request seed failed: ${arErr?.message}`);

    // Create the satellite stock_adjustments row.
    const { error: saErr } = await supabase.from('stock_adjustments').insert({
      approval_request_id: ar.id,
      sku: TEST_SKU,
      warehouse_id: atasId,
      // Legacy text column is still present; fill it for safety.
      warehouse: 'atas',
      qty_delta: -3,
      reason_code: 'koreksi_input',
      requested_by: NIL_UUID,
      evidence_urls: [],
      status: 'pending',
    });
    if (saErr) throw new Error(`stock_adjustments seed failed: ${saErr.message}`);

    // Invoke the RPC.
    const { data: movementId, error } = await supabase.rpc(
      'commit_approved_adjustment',
      { p_approval_id: ar.id },
    );
    expect(error).toBeNull();
    expect(typeof movementId).toBe('number'); // BIGINT returned as number in JS

    // 1. stock_levels qty must be 50 - 3 = 47.
    const { data: lvl } = await supabase
      .from('stock_levels')
      .select('qty')
      .eq('sku', TEST_SKU)
      .eq('warehouse_id', atasId)
      .single();
    expect(lvl?.qty).toBe(47);

    // 2. satellite row must be committed.
    const { data: sa } = await supabase
      .from('stock_adjustments')
      .select('status, committed_at, committed_movement_id')
      .eq('approval_request_id', ar.id)
      .single();
    expect(sa?.status).toBe('approved');
    expect(sa?.committed_at).not.toBeNull();
    expect(sa?.committed_movement_id).toBe(movementId);

    // 3. stock_movements row must exist with correct warehouse_id (BIGINT pattern).
    const { data: mv } = await supabase
      .from('stock_movements')
      .select('warehouse_id, source, qty_delta')
      .eq('id', movementId)
      .single();
    expect(mv?.warehouse_id).toBe(atasId);
    expect(mv?.source).toBe('adjustment');
    expect(mv?.qty_delta).toBe(-3);
  });

  test('double-commit on same approval_id raises an error', async () => {
    // Fetch the approval_request we just committed (status is already 'approved',
    // satellite committed_at is set). A second call should raise the
    // "already committed" guard.
    const { data: existing } = await supabase
      .from('stock_adjustments')
      .select('approval_request_id')
      .eq('sku', TEST_SKU)
      .not('committed_at', 'is', null)
      .limit(1)
      .single();

    if (!existing) return; // previous test may have been skipped

    const { error } = await supabase.rpc('commit_approved_adjustment', {
      p_approval_id: existing.approval_request_id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already committed/i);
  });

  test('non-approved approval_request raises an error', async () => {
    const { data: ar } = await supabase
      .from('approval_requests')
      .insert({
        request_type: 'adjustment',
        status: 'pending',
        requested_by: NIL_UUID,
        payload: {},
      })
      .select('id')
      .single();
    if (!ar) return;

    const { error } = await supabase.rpc('commit_approved_adjustment', {
      p_approval_id: ar.id,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not approved/i);
  });
});
