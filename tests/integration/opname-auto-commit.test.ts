import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: 'backend-go/.env', override: false });
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;
let testSku: string;
let counterId: string;
let witnessId: string;
const createdSessionIds: number[] = [];

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: users } = await svc.from('admin_users').select('id, role').limit(20);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  witnessId = users!.filter(u => u.role !== 'Owner' && u.id !== counterId)[0].id;

  testSku = `QA-OPNAUTO-${Date.now()}`;
  const { error } = await svc.from('stocks').insert({
    sku: testSku, name: 'QA auto-commit', category: 'QA',
    price: 1000, harga_modal: 500, stock: 10, stock_atas: 10, stock_bawah: 0, status: 'Sinkron',
  });
  if (error) throw new Error(`stocks insert failed: ${error.message}`);
});

afterAll(async () => {
  if (createdSessionIds.length) {
    await svc.from('stock_opname_counts').delete().in('session_id', createdSessionIds);
    await svc.from('approval_requests').delete().in(
      'payload->>session_id',
      createdSessionIds.map(String),
    );
    await svc.from('stock_opname_sessions').delete().in('id', createdSessionIds);
  }
  await svc.from('audit_log').delete().like('payload->>session_id::text', '%');
  await svc.from('stocks').delete().eq('sku', testSku);
});

async function freshSession(): Promise<number> {
  const { data, error } = await svc.rpc('start_opname_session', {
    p_opname_type: 'per_sku_list',
    p_scope_payload: { skus: [testSku] },
    p_counted_by: counterId,
    p_witnessed_by: witnessId,
  });
  if (error) throw new Error(`start failed: ${error.message}`);
  const id = data as number;
  createdSessionIds.push(id);
  return id;
}

describe('submit_opname_for_owner — auto-commit branch', () => {
  test('all counted_qty match snapshot → auto-commit, audit_log entry', async () => {
    const sid = await freshSession();
    // SKU has stock_atas=10, stock_bawah=0 → snapshot is 10 atas, 0 bawah.
    // Match both to trigger auto-commit.
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'bawah',
      p_counted_qty: 0, p_actor_user_id: counterId,
    });
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });

    const { data, error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(error).toBeNull();
    expect(data![0].status).toBe('committed');
    expect(data![0].auto).toBe(true);
    expect(data![0].approval_id).toBeNull();

    const { data: sess } = await svc.from('stock_opname_sessions')
      .select('status, committed_at').eq('id', sid).single();
    expect(sess!.status).toBe('committed');
    expect(sess!.committed_at).not.toBeNull();

    const { data: audit } = await svc.from('audit_log')
      .select('payload').eq('event_type', 'opname_auto_commit')
      .eq('payload->>session_id', String(sid))
      .limit(1);
    expect(audit!.length).toBe(1);
    const p = audit![0].payload as any;
    expect(p.counter_user_id).toBe(counterId);
    expect(p.witness_user_id).toBe(witnessId);
  });

  test('any variance ≠ 0 → pending_owner, approval_request created', async () => {
    const sid = await freshSession();
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 8, p_actor_user_id: counterId,
    });
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'bawah',
      p_counted_qty: 0, p_actor_user_id: counterId,
    });
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });

    const { data, error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(error).toBeNull();
    expect(data![0].status).toBe('pending_owner');
    expect(data![0].auto).toBe(false);
    expect(data![0].approval_id).not.toBeNull();
  });

  test('NULL counted_qty (some unfilled) → pending_owner, NOT auto-commit', async () => {
    const sid = await freshSession();
    // Only fill atas; leave bawah unfilled. Note: snapshot for bawah is 0,
    // so variance generated col is 0 - 0 = 0 even if counted_qty IS NULL.
    // Auto-commit gate must reject because counted_qty IS NULL on bawah row.
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });

    const { data } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(data![0].status).toBe('pending_owner');
    expect(data![0].auto).toBe(false);
  });

  test('witness not acked → reject', async () => {
    const sid = await freshSession();
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    const { error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(error?.message).toMatch(/witness/i);
  });
});
