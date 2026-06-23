// Shared test setup for Diskon Fitur integration tests
//
// ─── PATTERN: Pattern C (structural + role-gate, no auth happy paths) ─────────
//
// Pattern B (inject auth.uid() via set_config) does NOT work across separate
// PostgREST HTTP calls. Each supabase.rpc(...) is a separate HTTP request →
// separate transaction → SET LOCAL config is gone. See Phase 0c _setup.ts for
// the full explanation. Same limitation applies here.
//
// Pattern A (sign in with email/password): password unknown to test suite.
//
// Pattern C used:
//   • RPC signature tests: call with invalid payload, confirm error is NOT
//     "unknown function" or "unknown parameter" — proves the function is deployed.
//   • Discount validation tests: call with well-formed but logically invalid
//     discount payload → expect specific RAISE messages (DISCOUNT_TRIPLE_INVALID,
//     MARKUP_NOT_ALLOWED, EXCESSIVE_LINE_DISCOUNT, DISCOUNT_EXCEEDS_SUBTOTAL).
//     These guards fire before any auth-dependent or stock-dependent work.
//   • Schema/structural tests: service-role SELECT on new columns and COAs.
//   • Toggle tests: service-role read of tenant_settings for new columns;
//     set_tenant_modul called without auth → NOT_AUTHENTICATED confirms deployment.
//
// ─────────────────────────────────────────────────────────────────────────────

import { config as dotenvLoad } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenvLoad();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY required for integration tests');
}

/** Service-role client — bypasses RLS, but auth.uid() is NULL for all calls. */
export const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Diskon COA codes ─────────────────────────────────────────────────────────
// Seeded by Task 1 (4-1900) and Task 2 / 20260801000002 (5-1900).

/** COA 4-1900 Diskon Penjualan (kontra, normal debit) — pre-existing */
export const COA_DISKON_PENJUALAN_CODE = '4-1900';

/** COA 5-1900 Diskon Pembelian (kontra HPP, normal credit) — seeded by Task 2 */
export const COA_DISKON_PEMBELIAN_CODE = '5-1900';
