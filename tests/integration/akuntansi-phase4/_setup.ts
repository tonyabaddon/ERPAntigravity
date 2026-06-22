// Shared test setup for Akuntansi Phase 4 integration tests
//
// ─── PATTERN CHOSEN: Pattern C ──────────────────────────────────────────────
//
// Pattern C (structural + role-gate tests only):
//   • Database schema validation: journal_entries, journal_entry_lines,
//     chart_of_accounts all present + queryable
//   • View validation: trial_balance and general_ledger views functional
//   • Join patterns: journal_entry_lines + chart_of_accounts + journal_entries
//   • Aggregation sanity: P&L and Balance Sheet computation on seeded data
//   • Balance equation: sum(debit) = sum(credit) across all entries
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

export const TEST_PREFIX = `TEST-P4-${Date.now()}`;

// ── Known seeded data IDs ────────────────────────────────────────────────────
// Phase 4: Akuntansi Laporan (Laba Rugi, Neraca, Mutasi, Cash Flow).
// Reuses Phase 0a infrastructure: journal_entries + journal_entry_lines + chart_of_accounts.
// Verified seeded in 20260715000002_chart_of_accounts_seed.sql

/** COA 1-1200 Bank (ASET, BANK) — system account, normal_balance=DEBIT */
export const COA_BANK_ID = 'b2e08bca-cef8-400b-b69e-8a15da6bc4c1';
export const COA_BANK_CODE = '1-1200';

/** COA 1-1100 Kas (ASET, KAS) — system account, normal_balance=DEBIT */
export const COA_KAS_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const COA_KAS_CODE = '1-1100';

/** COA 4-1100 Penjualan (PENDAPATAN, PENJUALAN) — normal_balance=CREDIT */
export const COA_PENJUALAN_ID = '77340d03-9572-4ec5-8ce8-bc55be21aebc';
export const COA_PENJUALAN_CODE = '4-1100';

/** COA 5-2100 Beban Gaji (BEBAN, BEBAN_OPERASIONAL) — normal_balance=DEBIT */
export const COA_BEBAN_GAJI_ID = '22b6a52f-631c-4b84-b464-f98237b9bb34';
export const COA_BEBAN_GAJI_CODE = '5-2100';

/** COA 3-1100 Modal Awal (MODAL) — normal_balance=CREDIT */
export const COA_MODAL_AWAL_ID = 'c4b5d6e7-f8a9-0b1c-2d3e-4f5a6b7c8d9e';
export const COA_MODAL_AWAL_CODE = '3-1100';

/** COA 2-1100 Hutang Usaha (LIABILITAS, LIABILITAS_LANCAR) — normal_balance=CREDIT */
export const COA_HUTANG_USAHA_ID = 'd5c6e7f8-a9b0-1c2d-3e4f-5a6b7c8d9e0f';
export const COA_HUTANG_USAHA_CODE = '2-1100';
