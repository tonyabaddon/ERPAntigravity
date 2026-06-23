// Shared test setup for Akuntansi Phase 5 integration tests
//
// ─── PATTERN CHOSEN: Pattern C ──────────────────────────────────────────────
//
// Pattern B (inject auth.uid() via set_config) does NOT work across separate
// PostgREST HTTP calls. Each supabase.rpc(...) is a separate HTTP request →
// separate transaction → SET LOCAL config is gone by the time the next call
// arrives. is_local:false makes no difference because connection-pool routing
// is non-deterministic. This affects ALL auth-gated RPC happy-paths.
//
// Pattern A (sign in with email/password): Tony Wei has a password-auth
// account but the password is unknown to the test suite. Not viable.
//
// Pattern C (structural + role-gate tests only):
//   • Each RPC: 1 "no auth → INSUFFICIENT_ROLE" test confirms the function
//     is deployed and _assert_owner_active() is wired. (RPC exists + role gate.)
//   • Happy paths (actual GL recon matching) tested via smoke tests in production.
//   • Structural tests verify database schema independently of auth:
//     journal_entry_lines columns (bank_line_id, reconciled_at),
//     bank_statement_lines columns (lane, match_reason, matched_at, matched_by, match_confidence),
//     chart_of_accounts account_subtype='BANK' rows.
//   • Helper function _score_journal_match verified to exist and return numeric.
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

export const TEST_PREFIX = `TEST-P5-${Date.now()}`;

// ── Phase 5 COA IDs ─────────────────────────────────────────────────────────
// These are verified via live query for account_subtype='BANK'
// (Single-tenant context: exactly one BANK account exists after migration)

export async function getBANKCoaId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('chart_of_accounts')
    .select('id')
    .eq('account_subtype', 'BANK')
    .eq('is_active', true)
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new Error('BANK COA not found in chart_of_accounts');
  }

  return data[0].id;
}
