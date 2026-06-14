// tests/integration/piutang-tempo-phase1a.test.ts
//
// Phase 1A integration tests for the Piutang & Tempo feature.
// Covers 8 RPC scenarios across activate (5), limit_change (2), and deactivate (1).
//
// IMPORTANT: Tests are deferred — do NOT run until founder has applied migrations
// T1-T7 (20260614000008 through 20260614000014) via Supabase Studio SQL editor.
//
// Required env vars (either naming convention works):
//   SUPABASE_URL  or  VITE_SUPABASE_URL
//   SUPABASE_ANON_KEY  or  VITE_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE  or  SUPABASE_SERVICE_KEY
//   OWNER_PIN  (defaults to '0000' for dev)
//
// Run: npx vitest run --no-file-parallelism tests/integration/piutang-tempo-phase1a.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE!;
const OWNER_PIN = process.env.OWNER_PIN ?? '0000'; // dev default

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE) {
  throw new Error(
    'Missing Supabase env. Need SUPABASE_URL (or VITE_SUPABASE_URL), ' +
    'SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY), and ' +
    'SUPABASE_SERVICE_ROLE (or SUPABASE_SERVICE_KEY).'
  );
}

let admin: SupabaseClient; // service-role for setup / teardown (bypasses RLS)
let user: SupabaseClient;  // anon-key for RPCs (exercises real auth path)

const TEST_CUSTOMER = 'GJP-CUST-PIUTANG-T1';

beforeEach(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  user  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Clean prior test state
  await admin.from('approval_requests')
    .delete()
    .in('request_type', [
      'customer_credit_activate',
      'customer_credit_limit_change',
      'customer_credit_deactivate',
    ]);
  await admin.from('customers').delete().eq('id', TEST_CUSTOMER);

  // Seed test customer
  await admin.from('customers').insert({
    id: TEST_CUSTOMER,
    wa_number: '+62811000001',
    name: 'Test Customer Piutang',
  });
});

// ---------------------------------------------------------------------------
// activate — 5 tests
// ---------------------------------------------------------------------------
describe('piutang phase 1A — customer credit activate', () => {
  it('happy path: request → approve → customer becomes allows_tempo=true', async () => {
    const { data: reqId, error: reqErr } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 50_000_000,
      p_reason: 'langganan grosir',
    });
    expect(reqErr).toBeNull();
    expect(typeof reqId).toBe('number');

    const { error: appErr } = await user.rpc('approve_customer_credit_activate', {
      p_request_id: reqId,
      p_owner_pin: OWNER_PIN,
    });
    expect(appErr).toBeNull();

    const { data: cust } = await admin
      .from('customers')
      .select('allows_tempo, term_days, credit_limit, tempo_activated_at')
      .eq('id', TEST_CUSTOMER)
      .single();
    expect(cust?.allows_tempo).toBe(true);
    expect(cust?.term_days).toBe(30);
    expect(Number(cust?.credit_limit)).toBe(50_000_000);
    expect(cust?.tempo_activated_at).not.toBeNull();
  });

  it('rejects term_days not in piutang_settings.term_days_allowed', async () => {
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 45,  // not in default {7,14,30,60,90}
      p_credit_limit: 10_000_000,
      p_reason: 'test',
    });
    expect(error?.message).toMatch(/term_days_not_allowed/);
  });

  it('rejects credit_limit <= 0', async () => {
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 0,
      p_reason: 'test',
    });
    expect(error?.message).toMatch(/credit_limit_must_be_positive/);
  });

  it('rejects wrong PIN at approve', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 10_000_000,
      p_reason: 'test',
    });
    const { error } = await user.rpc('approve_customer_credit_activate', {
      p_request_id: reqId,
      p_owner_pin: '9999',
    });
    expect(error?.message).toMatch(/pin_invalid/);
  });

  it('rejects re-activating an already-active customer', async () => {
    // First activation
    const { data: req1 } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 10_000_000,
      p_reason: 'first',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: req1, p_owner_pin: OWNER_PIN });

    // Second request should fail
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 60,
      p_credit_limit: 20_000_000,
      p_reason: 'second',
    });
    expect(error?.message).toMatch(/customer_already_activated/);
  });
});

// ---------------------------------------------------------------------------
// limit_change — 2 tests
// ---------------------------------------------------------------------------
describe('piutang phase 1A — limit change', () => {
  beforeEach(async () => {
    // Pre-activate the customer so limit_change tests have a valid starting state
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 50_000_000,
      p_reason: 'init',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });
  });

  it('happy path: request → approve → credit_limit updated', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_limit_change', {
      p_customer_id: TEST_CUSTOMER,
      p_new_limit: 100_000_000,
      p_reason: 'pesanan besar',
    });
    await user.rpc('approve_customer_credit_limit_change', { p_request_id: reqId, p_owner_pin: OWNER_PIN });

    const { data: cust } = await admin
      .from('customers')
      .select('credit_limit')
      .eq('id', TEST_CUSTOMER)
      .single();
    expect(Number(cust?.credit_limit)).toBe(100_000_000);
  });

  it('rejects too-short reason (<5 chars)', async () => {
    const { error } = await user.rpc('request_customer_credit_limit_change', {
      p_customer_id: TEST_CUSTOMER,
      p_new_limit: 80_000_000,
      p_reason: 'xx',
    });
    expect(error?.message).toMatch(/reason_required/);
  });
});

// ---------------------------------------------------------------------------
// deactivate — 1 test
// ---------------------------------------------------------------------------
describe('piutang phase 1A — deactivate', () => {
  beforeEach(async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 50_000_000,
      p_reason: 'init',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });
  });

  it('happy path: deactivate sets allows_tempo=false, retains term_days/credit_limit as history', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_deactivate', {
      p_customer_id: TEST_CUSTOMER,
      p_reason: 'customer pindah supplier lain',
    });
    await user.rpc('approve_customer_credit_deactivate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });

    const { data: cust } = await admin
      .from('customers')
      .select('allows_tempo, term_days, credit_limit')
      .eq('id', TEST_CUSTOMER)
      .single();
    expect(cust?.allows_tempo).toBe(false);
    expect(cust?.term_days).toBe(30);           // retained as audit history
    expect(Number(cust?.credit_limit)).toBe(50_000_000); // retained as audit history
  });
});
