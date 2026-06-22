// Shared test setup for Akuntansi Phase 0d integration tests
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
//   • Brief note: every validation check (INVALID_ACCOUNT_NAME,
//     SYSTEM_ACCOUNT_PROTECTED) fires AFTER _assert_owner_active() per the
//     migration source — they are unreachable without real Owner auth.
//     Covered by Task 1 MCP smoke tests.
//   • Structural tests cover database invariants independently of auth:
//     trial_balance view schema + filtering, general_ledger view schema +
//     filtering, chart_of_accounts table with seeded COA IDs.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY required for integration tests');
}

/** Service-role client — bypasses RLS, but auth.uid() is NULL for all calls. */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export const TEST_PREFIX = `TEST-P0d-${Date.now()}`;

// ── Known seeded data IDs ────────────────────────────────────────────────────
// Phase 0d: Akuntansi GL. Extracted from Phase 3 setup + Phase 0d migrations.
// Verified seeded in 20260715000002_chart_of_accounts_seed.sql
// Verified via MCP execute_sql 2026-06-22

/** COA 4-1100 Penjualan (PENDAPATAN PENJUALAN) */
export const COA_PENJUALAN_ID = '77340d03-9572-4ec5-8ce8-bc55be21aebc';

/** COA 5-2100 Beban Gaji (BEBAN) */
export const COA_BEBAN_GAJI_ID = '22b6a52f-631c-4b84-b464-f98237b9bb34';

/** COA 5-2300 Beban Utilitas (BEBAN) */
export const COA_BEBAN_UTILITAS_ID = '082c406a-381b-4f25-8243-b9118902cccc';

/** COA 3-1200 Prive/Owner Drawing (MODAL PRIVE) — is_system=true, cannot deactivate */
export const COA_PRIVE_ID = 'dcffa2bf-9431-4438-827f-eaa6f68ac680';

/** COA 1-1200 Bank (ASET) — system account */
export const COA_BANK_ID = 'b2e08bca-cef8-400b-b69e-8a15da6bc4c1';

/** COA 1-1000 ASET LANCAR (ASET, control account) */
export const COA_ASET_LANCAR_ID = '8ef6ef2a-15e4-4122-be5d-401b6cf3f3d3';
