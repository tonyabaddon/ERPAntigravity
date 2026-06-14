import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: 'backend-go/.env', override: false }); // SUPABASE_SERVICE_KEY lives in backend-go/.env
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;
let sessionId: number;
let testSku: string;
let counterId: string;
let witnessId: string;

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: users } = await svc.from('admin_users').select('id, role').limit(20);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  witnessId = users!.filter(u => u.role !== 'Owner' && u.id !== counterId)[0].id;

  testSku = `QA-OPNMASK-${Date.now()}`;
  // `stock` is a legacy NOT NULL column (total across warehouses) — kept for
  // schema compat while warehouse-id cutover is pending soak. Set to sum of
  // per-warehouse columns.
  const { error: insErr } = await svc.from('stocks').insert({
    sku: testSku, name: 'QA mask test', category: 'QA',
    price: 1000, harga_modal: 1000, stock: 25, stock_atas: 25, stock_bawah: 0, status: 'Sinkron',
  });
  if (insErr) throw new Error(`stocks insert failed: ${insErr.message}`);

  // start_opname_session — real signature uses p_counted_by / p_witnessed_by
  const { data: sess, error: rpcErr } = await svc.rpc('start_opname_session', {
    p_opname_type: 'per_sku_list',
    p_scope_payload: { skus: [testSku] },
    p_counted_by: counterId,
    p_witnessed_by: witnessId,
  });
  if (rpcErr) throw new Error(`start_opname_session failed: ${rpcErr.message}`);
  sessionId = sess as number;
});

afterAll(async () => {
  if (sessionId) {
    await svc.from('stock_opname_counts').delete().eq('session_id', sessionId);
    await svc.from('stock_opname_sessions').delete().eq('id', sessionId);
  }
  await svc.from('stocks').delete().eq('sku', testSku);
});

describe('fetch_opname_counts masking', () => {
  test('non-Owner caller during in_progress receives masked rows', async () => {
    // Service role has auth.uid() = NULL → role lookup returns NULL → default-deny
    // kicks in → caller is treated as non-Owner → mask applies.
    const { data, error } = await svc.rpc('fetch_opname_counts', { p_session_id: sessionId });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // Mask hides system_qty_snapshot and variance; counted_qty stays visible.
    expect(data![0].system_qty_snapshot).toBeNull();
    expect(data![0].variance).toBeNull();
    expect(Number(data![0].variance_value)).toBe(0);
  });

  test('non-Owner caller AFTER status flips out of in_progress sees full data', async () => {
    // Once status is committed/pending_owner/rejected, mask lifts for all callers.
    await svc.from('stock_opname_sessions')
      .update({ status: 'committed' }).eq('id', sessionId);

    const { data, error } = await svc.rpc('fetch_opname_counts', { p_session_id: sessionId });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].system_qty_snapshot).toBe(25);

    // Reset for cleanup symmetry
    await svc.from('stock_opname_sessions')
      .update({ status: 'in_progress' }).eq('id', sessionId);
  });
});
