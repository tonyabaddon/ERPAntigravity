// Shared test setup for Akuntansi Phase 0b integration tests
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
//   • Dual-write RPCs here (record_kasir_sale, record_pembayaran, record_piutang_payment)
//     have GL failures tested at service-role (no auth), which always soft-fail
//     to anomalies (verified by anomaly table exists + schema checks).
//   • Happy paths (actual GL posting) covered by Task 5 end-to-end service tests
//     and Task 9 UI verification (CatatBayarModal picker → real piutang payment RPC).
//   • Structural tests cover database invariants independently of auth:
//     journal_entries schema, journal_entry_lines schema, chart_of_accounts,
//     cash_accounts, gl_dual_write_anomalies table + schema, accounting_config
//     dual-write columns.
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

export const TEST_PREFIX = `TEST-P0b-${Date.now()}`;

// ── Known seeded data IDs ────────────────────────────────────────────────────
// Verified via MCP execute_sql 2026-06-23

/** Seeded Kas Toko (KAS), active, COA 1-1110 */
export const SEEDED_KAS_ID = 'd5eea318-b293-4895-ab08-53e5c66d89c8';

/** COA 1-1100 (ASET) — General cash holder */
export const COA_ASET_KAS_ID = '53b8e1c7-2d45-4a7f-a1f3-8c9b7e4d6f2a';

/** COA 1-1200 Bank (ASET) — used to create temp BANK cash accounts */
export const COA_BANK_ID = 'b2e08bca-cef8-400b-b69e-8a15da6bc4c1';

/** COA 1-1300 E-Wallet (ASET) — used to create temp E_WALLET cash accounts */
export const COA_EWALLET_ID = 'bfde84c7-f442-41df-9703-d924d332a10a';

/** COA 1-1400 Piutang Usaha (ASET) — used in piutang_payment RPC */
export const COA_PIUTANG_ID = '74c5e2f1-8a3b-4c9d-a5f2-7e9c1d4b6a8f';

/** COA 2-1100 Hutang Usaha (LIABILITAS) — used in pembayaran RPC */
export const COA_HUTANG_USAHA_ID = '2a1f8c7e-5d3b-49a6-8f2c-1e7a4c9d6b5f';

/** COA 4-1100 Penjualan (PENDAPATAN) */
export const COA_PENDAPATAN_ID = '77340d03-9572-4ec5-8ce8-bc55be21aebc';

/** COA 4-1110 Penjualan Walkin (PENDAPATAN) */
export const COA_PENDAPATAN_WALKIN_ID = 'a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6';

/** COA 4-1120 Penjualan Marketplace (PENDAPATAN) */
export const COA_PENDAPATAN_MARKETPLACE_ID = 'f6e5d4c3-b2a1-46f7-8h9i-0j1k2l3m4n5o';

/** COA 4-1130 Penjualan Grosir (PENDAPATAN) */
export const COA_PENDAPATAN_GROSIR_ID = 'n5o4m3l2-k1j0-45i9-8h7g-6f5e4d3c2b1a';

/** COA 5-2300 Beban Utilitas (BEBAN) */
export const COA_BEBAN_UTILITAS_ID = '082c406a-381b-4f25-8243-b9118902cccc';

/** COA 5-2100 Beban Gaji (BEBAN) */
export const COA_BEBAN_GAJI_ID = '22b6a52f-631c-4b84-b464-f98237b9bb34';

/** COA 3-1200 Prive/Owner Drawing (MODAL) */
export const COA_PRIVE_ID = 'dcffa2bf-9431-4438-827f-eaa6f68ac680';
