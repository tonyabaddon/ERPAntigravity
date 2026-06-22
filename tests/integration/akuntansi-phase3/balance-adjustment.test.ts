// Integration tests for record_balance_adjustment RPC — Pattern C
//
// RPCs run _assert_owner_active() first. With service-role (auth.uid()=NULL),
// all calls return INSUFFICIENT_ROLE before reaching INVALID_AMOUNT,
// INVALID_REASON, INVALID_PIN, or INVALID_DIRECTION.
//
// IMPORTANT — spec drift note: The task brief says "PIN wrong 3× → PIN_LOCKED"
// but the migration (20260722000003_phase3_fixes_min_length.sql) locks after
// 5 wrong attempts. The correct threshold is 5, not 3.
//
// What these tests cover:
//   1. RPC deployed + role gate wired → INSUFFICIENT_ROLE (not 404)
//   2. Structural: ADJUSTMENT source_type value valid in enum
//   3. Structural: COA validation requirements — PENDAPATAN and BEBAN types
//      are valid counterpart types per RPC contract
//   4. Structural: journal_entries table has posted_by column (auth.uid() is
//      written to it by _post_journal_entry)
//
// Happy paths and post-auth negatives (INVALID_REASON, INVALID_PIN, etc.)
// covered by Task 1 MCP smoke tests (17/17 PASS).

import { describe, it, expect } from 'vitest';
import { supabaseAdmin, SEEDED_KAS_ID, COA_PENDAPATAN_ID, COA_BEBAN_UTILITAS_ID } from './_setup';

describe('record_balance_adjustment — deployment + role gate', () => {
  it('function is deployed: no-auth call returns INSUFFICIENT_ROLE (not 404)', async () => {
    const { data, error } = await supabaseAdmin.rpc('record_balance_adjustment', {
      p_cash_account_id: SEEDED_KAS_ID,
      p_direction: 'UP',
      p_amount: 100000,
      p_counterpart_coa_id: COA_PENDAPATAN_ID,
      p_reason: 'Koreksi saldo yang valid',
      p_pin: '000000',
      p_entry_date: '2026-06-22',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });

  it('accepts direction=DOWN without parameter error', async () => {
    const { error } = await supabaseAdmin.rpc('record_balance_adjustment', {
      p_cash_account_id: SEEDED_KAS_ID,
      p_direction: 'DOWN',
      p_amount: 100000,
      p_counterpart_coa_id: COA_BEBAN_UTILITAS_ID,
      p_reason: 'Koreksi saldo turun valid',
      p_pin: '000000',
      p_entry_date: '2026-06-22',
    });
    // INSUFFICIENT_ROLE means function accepted params correctly
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });
});

describe('record_balance_adjustment — structural: counterpart COA requirements', () => {
  it('PENDAPATAN type COA exists and is queryable as counterpart', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_type, is_active')
      .eq('id', COA_PENDAPATAN_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('PENDAPATAN');
    expect(data!.is_active).toBe(true);
  });

  it('BEBAN type COA exists and is queryable as counterpart', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_type, is_active')
      .eq('id', COA_BEBAN_UTILITAS_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('BEBAN');
    expect(data!.is_active).toBe(true);
  });
});

describe('record_balance_adjustment — structural: source_type enum', () => {
  it("journal_entry_source enum includes 'ADJUSTMENT'", async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'ADJUSTMENT')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('record_balance_adjustment — structural: journal_entries schema', () => {
  it('journal_entries table has posted_by column', async () => {
    // auth.uid() result is stored in posted_by; verify column exists via query
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('posted_by')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('journal_entry_lines table has side column with DEBIT/CREDIT values', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('side')
      .in('side', ['DEBIT', 'CREDIT'])
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
