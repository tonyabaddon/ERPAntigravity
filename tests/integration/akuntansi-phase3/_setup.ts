// Shared test setup for Akuntansi Phase 3 integration tests
//
// ─── PATTERN CHOSEN: Pattern C ──────────────────────────────────────────────
//
// Pattern B (inject auth.uid() via set_config) does NOT work across separate
// PostgREST HTTP calls. Each supabase.rpc(...) is a separate HTTP request →
// separate transaction → SET LOCAL config is gone by the time the next call
// arrives. is_local:false makes no difference because connection-pool routing
// is non-deterministic. This affects ALL auth-gated RPC happy-paths.
// (Phase0a's opening-balance and period-close tests fail for the same reason —
//  they were written optimistically before this limitation was discovered.)
//
// Pattern A (sign in with email/password): Tony Wei has a password-auth
// account but the password is unknown to the test suite. Not viable.
//
// Pattern C (structural + role-gate tests only):
//   • Each RPC: 1 "no auth → INSUFFICIENT_ROLE" test confirms the function
//     is deployed and _assert_owner_active() is wired. (RPC exists + role gate.)
//   • Brief note: every validation check (INVALID_AMOUNT, SAME_ACCOUNT,
//     INVALID_REASON, INVALID_PIN, INVALID_DESCRIPTION) fires AFTER
//     _assert_owner_active() per the migration source — they are unreachable
//     without real Owner auth. Covered by Task 1 MCP smoke (17/17 PASS).
//   • Structural tests cover database invariants independently of auth:
//     journal_entries schema, journal_entry_lines schema, source_type enum
//     values, _resolve_cash_coa helper, Prive COA 3-1200, cash_account_balances
//     view shape.
//
// ─────────────────────────────────────────────────────────────────────────────

import { loadEnv } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const env = loadEnv('test', process.cwd(), '');

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY required for integration tests');
}

/** Service-role client — bypasses RLS, but auth.uid() is NULL for all calls. */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export const TEST_PREFIX = `TEST-P3-${Date.now()}`;

// ── Known seeded data IDs ────────────────────────────────────────────────────
// Verified via MCP execute_sql 2026-06-22

/** Seeded Kas Toko (KAS), active, COA 1-1110 */
export const SEEDED_KAS_ID = 'd5eea318-b293-4895-ab08-53e5c66d89c8';

/** COA 1-1200 Bank (ASET) — used to create temp BANK cash accounts */
export const COA_BANK_ID = 'b2e08bca-cef8-400b-b69e-8a15da6bc4c1';

/** COA 1-1300 E-Wallet (ASET) — used to create temp E_WALLET cash accounts */
export const COA_EWALLET_ID = 'bfde84c7-f442-41df-9703-d924d332a10a';

/** COA 5-2300 Beban Utilitas (BEBAN) */
export const COA_BEBAN_UTILITAS_ID = '082c406a-381b-4f25-8243-b9118902cccc';

/** COA 5-2100 Beban Gaji (BEBAN) */
export const COA_BEBAN_GAJI_ID = '22b6a52f-631c-4b84-b464-f98237b9bb34';

/** COA 4-1100 Penjualan (PENDAPATAN) */
export const COA_PENDAPATAN_ID = '77340d03-9572-4ec5-8ce8-bc55be21aebc';

/** COA 3-1200 Prive/Owner Drawing (MODAL) */
export const COA_PRIVE_ID = 'dcffa2bf-9431-4438-827f-eaa6f68ac680';
