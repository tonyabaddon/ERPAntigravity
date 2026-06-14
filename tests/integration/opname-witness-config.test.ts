import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: 'backend-go/.env', override: false });
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;
let counterId: string;
let testSku: string;
const createdSessionIds: number[] = [];

async function setWitnessRequired(required: boolean) {
  await svc.from('company_settings').update({ opname_require_witness: required }).neq('id', -1);
}

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: users } = await svc.from('admin_users').select('id, role').limit(5);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  testSku = `QA-OPNWIT-${Date.now()}`;
  await svc.from('stocks').insert({
    sku: testSku, name: 'QA witness config', category: 'QA',
    price: 1000, harga_modal: 500, stock: 10, stock_atas: 10, stock_bawah: 0, status: 'Sinkron',
  });
});

afterAll(async () => {
  await setWitnessRequired(true);
  if (createdSessionIds.length) {
    await svc.from('stock_opname_counts').delete().in('session_id', createdSessionIds);
    await svc.from('stock_opname_sessions').delete().in('id', createdSessionIds);
  }
  await svc.from('stocks').delete().eq('sku', testSku);
});

describe('witness configurability — start_opname_session', () => {
  test('require_witness=TRUE + NULL witness → reject', async () => {
    await setWitnessRequired(true);
    const { error } = await svc.rpc('start_opname_session', {
      p_opname_type: 'per_sku_list',
      p_scope_payload: { skus: [testSku] },
      p_counted_by: counterId,
      p_witnessed_by: null,
    });
    expect(error?.message).toMatch(/witness is required/i);
  });

  test('require_witness=FALSE + NULL witness → accepted', async () => {
    await setWitnessRequired(false);
    const { data, error } = await svc.rpc('start_opname_session', {
      p_opname_type: 'per_sku_list',
      p_scope_payload: { skus: [testSku] },
      p_counted_by: counterId,
      p_witnessed_by: null,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    createdSessionIds.push(data as number);
  });
});

describe('witness configurability — submit_opname_for_owner', () => {
  test('require_witness=FALSE → solo counter can submit without witness ack', async () => {
    await setWitnessRequired(false);
    // Reset stock so this run has a known snapshot.
    await svc.from('stocks').update({ stock: 10, stock_atas: 10, stock_bawah: 0 }).eq('sku', testSku);

    const { data: sid } = await svc.rpc('start_opname_session', {
      p_opname_type: 'per_sku_list',
      p_scope_payload: { skus: [testSku] },
      p_counted_by: counterId,
      p_witnessed_by: null,
    });
    const sessionId = sid as number;
    createdSessionIds.push(sessionId);

    await svc.rpc('record_opname_count', {
      p_session_id: sessionId, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    await svc.rpc('record_opname_count', {
      p_session_id: sessionId, p_sku: testSku, p_warehouse: 'bawah',
      p_counted_qty: 0, p_actor_user_id: counterId,
    });

    // No witness_acknowledge_opname called — should still be allowed.
    const { data, error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sessionId, p_actor_user_id: counterId,
    });
    expect(error).toBeNull();
    expect(data![0].status).toBe('committed');  // all-match → auto-commit
    expect(data![0].auto).toBe(true);
  });
});
