// Shared test setup for Akuntansi Phase 0c integration tests
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
//   • Dual-write RPCs here (record_kasir_sale, record_pi) have GL failures
//     tested at service-role (no auth), which always soft-fail to anomalies
//     (verified by anomaly table exists + schema checks).
//   • Happy paths (actual GL posting) covered by Task 5 end-to-end service tests
//     and Task 9 UI verification.
//   • Structural tests cover database invariants independently of auth:
//     chart_of_accounts, journal_entries, journal_entry_lines schema,
//     gl_dual_write_anomalies table + schema, backfill function.
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

export const TEST_PREFIX = `TEST-P0c-${Date.now()}`;

// ── Phase 0c COA IDs ─────────────────────────────────────────────────────────
// Verified via MCP execute_sql 2026-06-23

/** COA 5-1100 HPP (BEBAN) — added in Task 1 */
export const COA_HPP_ID = 'e8f7a3b2-9c4d-4e2a-8f1c-7d5e9a3b2c4f';

/** COA 1-1510 Persediaan (ASET) — used in HPP + record_pi */
export const COA_PERSEDIAAN_ID = '6c5d8e9f-2a3b-4c5d-6e7f-8a9b0c1d2e3f';

/** COA 2-1100 Hutang Usaha (LIABILITAS) — used in record_pi */
export const COA_HUTANG_USAHA_ID = '2a1f8c7e-5d3b-49a6-8f2c-1e7a4c9d6b5f';
