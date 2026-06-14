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
let ownerId: string;
const createdSessionIds: number[] = [];

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: users } = await svc.from('admin_users').select('id, role').limit(20);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  witnessId = users!.filter(u => u.role !== 'Owner' && u.id !== counterId)[0].id;
  ownerId   = users!.find(u => u.role === 'Owner')!.id;

  testSku = `QA-OPNAUDIT-${Date.now()}`;
  await svc.from('stocks').insert({
    sku: testSku, name: 'QA audit', category: 'QA',
    price: 1000, harga_modal: 500, stock: 10, stock_atas: 10, stock_bawah: 0, status: 'Sinkron',
  });
});

afterAll(async () => {
  if (createdSessionIds.length) {
    await svc.from('stock_opname_counts').delete().in('session_id', createdSessionIds);
    await svc.from('stock_opname_sessions').delete().in('id', createdSessionIds);
  }
  await svc.from('stocks').delete().eq('sku', testSku);
});

async function freshSessionWithVariance(): Promise<{ sessionId: number; approvalId: number }> {
  // Reset stock_atas to a known value so each test starts from the same
  // snapshot regardless of prior commit_opname mutations.
  await svc.from('stocks').update({ stock: 10, stock_atas: 10, stock_bawah: 0 }).eq('sku', testSku);

  const { data: sid } = await svc.rpc('start_opname_session', {
    p_opname_type: 'per_sku_list',
    p_scope_payload: { skus: [testSku] },
    p_counted_by: counterId,
    p_witnessed_by: witnessId,
  });
  const sessionId = sid as number;
  createdSessionIds.push(sessionId);

  // Trigger variance so submit goes to pending_owner (creates approval_request).
  // Snapshot=10 atas, counted=8 → variance -2.
  await svc.rpc('record_opname_count', {
    p_session_id: sessionId, p_sku: testSku, p_warehouse: 'atas',
    p_counted_qty: 8, p_actor_user_id: counterId,
  });
  await svc.rpc('record_opname_count', {
    p_session_id: sessionId, p_sku: testSku, p_warehouse: 'bawah',
    p_counted_qty: 0, p_actor_user_id: counterId,
  });
  await svc.rpc('witness_acknowledge_opname', {
    p_session_id: sessionId, p_actor_user_id: witnessId,
  });
  const { data: submit, error: submitErr } = await svc.rpc('submit_opname_for_owner', {
    p_session_id: sessionId, p_actor_user_id: counterId,
  });
  if (submitErr) throw new Error(`submit failed: ${submitErr.message}`);
  if (submit![0].auto) {
    throw new Error(`expected pending_owner branch but got auto-commit for session ${sessionId}`);
  }
  return { sessionId, approvalId: submit![0].approval_id as number };
}

describe('audit_log entries for commit/reject paths', () => {
  test('Owner commit writes opname_owner_commit with counter+witness+approver names', async () => {
    const { sessionId, approvalId } = await freshSessionWithVariance();

    // Approve the request (canonical _transition_approval is locked down for
    // anon/authenticated; service role can UPDATE directly).
    await svc.from('approval_requests')
      .update({ status: 'approved', decided_by: ownerId, decided_at: new Date().toISOString() })
      .eq('id', approvalId);

    const { error } = await svc.rpc('commit_opname', { p_approval_id: approvalId });
    expect(error).toBeNull();

    const { data: audit } = await svc.from('audit_log')
      .select('payload')
      .eq('event_type', 'opname_owner_commit')
      .eq('payload->>session_id', String(sessionId))
      .limit(1);
    expect(audit!.length).toBe(1);
    const p = audit![0].payload as any;
    expect(p.counter_user_id).toBe(counterId);
    expect(p.witness_user_id).toBe(witnessId);
    expect(p.approved_by_user_id).toBe(ownerId);
    expect(p.counter_name).toBeTruthy();
    expect(p.witness_name).toBeTruthy();
    expect(p.approved_by_name).toBeTruthy();
    expect(p.movement_count).toBeGreaterThanOrEqual(1);
  });

  test('Owner reject writes opname_owner_reject and flips session to rejected', async () => {
    const { sessionId, approvalId } = await freshSessionWithVariance();

    // Reject via direct UPDATE (service role bypass). Trigger fires AFTER UPDATE.
    await svc.from('approval_requests')
      .update({ status: 'rejected', decided_by: ownerId, decided_at: new Date().toISOString() })
      .eq('id', approvalId);

    // Session should be flipped to rejected by the trigger.
    const { data: sess } = await svc.from('stock_opname_sessions')
      .select('status').eq('id', sessionId).single();
    expect(sess!.status).toBe('rejected');

    // Audit row exists.
    const { data: audit } = await svc.from('audit_log')
      .select('payload')
      .eq('event_type', 'opname_owner_reject')
      .eq('payload->>session_id', String(sessionId))
      .limit(1);
    expect(audit!.length).toBe(1);
    const p = audit![0].payload as any;
    expect(p.rejected_by_user_id).toBe(ownerId);
    expect(p.rejected_by_name).toBeTruthy();
    expect(p.counter_name).toBeTruthy();
    expect(p.witness_name).toBeTruthy();
  });
});
