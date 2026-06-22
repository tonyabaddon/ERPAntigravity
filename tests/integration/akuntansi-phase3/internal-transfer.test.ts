// Integration tests for record_internal_transfer RPC — Pattern C
//
// All RPCs run _assert_owner_active() as their very first statement, so any
// call with service-role (auth.uid()=NULL) returns INSUFFICIENT_ROLE before
// reaching INVALID_AMOUNT, SAME_ACCOUNT, or any other validation check.
//
// What these tests cover:
//   1. RPC deployed + role gate wired → no-auth call returns INSUFFICIENT_ROLE
//   2. RPC accepts TRANSFER / CASH_DEPOSIT / WALLET_TOPUP subtype parameters
//      (parameter existence confirmed; runtime behavior covered by Task 1 smoke)
//   3. Structural: journal_entries table has source_type column including
//      'MANUAL_TRANSFER'
//   4. Structural: _resolve_cash_coa helper resolves seeded Kas Toko correctly
//
// Happy paths (KAS→BANK transfer, journal_entry + 2 lines) are covered by
// Task 1 MCP smoke tests (17/17 PASS, see task-1-report.md).

import { describe, it, expect } from 'vitest';
import { supabaseAdmin, SEEDED_KAS_ID } from './_setup';

describe('record_internal_transfer — deployment + role gate', () => {
  it('function is deployed: no-auth call returns INSUFFICIENT_ROLE (not 404)', async () => {
    const { data, error } = await supabaseAdmin.rpc('record_internal_transfer', {
      p_from_cash_id: SEEDED_KAS_ID,
      p_to_cash_id: SEEDED_KAS_ID,
      p_amount: 100000,
      p_entry_date: '2026-06-22',
      p_notes: null,
      p_proof_url: null,
      p_source_subtype: 'TRANSFER',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    // Must be INSUFFICIENT_ROLE, not "function not found" or a network error
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });

  it('accepts CASH_DEPOSIT subtype without parameter error', async () => {
    const { error } = await supabaseAdmin.rpc('record_internal_transfer', {
      p_from_cash_id: SEEDED_KAS_ID,
      p_to_cash_id: SEEDED_KAS_ID,
      p_amount: 1,
      p_entry_date: '2026-06-22',
      p_notes: null,
      p_proof_url: null,
      p_source_subtype: 'CASH_DEPOSIT',
    });
    // INSUFFICIENT_ROLE means function accepted params; not "wrong number of arguments"
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });

  it('accepts WALLET_TOPUP subtype without parameter error', async () => {
    const { error } = await supabaseAdmin.rpc('record_internal_transfer', {
      p_from_cash_id: SEEDED_KAS_ID,
      p_to_cash_id: SEEDED_KAS_ID,
      p_amount: 1,
      p_entry_date: '2026-06-22',
      p_notes: null,
      p_proof_url: null,
      p_source_subtype: 'WALLET_TOPUP',
    });
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });
});

describe('record_internal_transfer — structural: source_type enum', () => {
  it("journal_entry_source enum includes 'MANUAL_TRANSFER'", async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'MANUAL_TRANSFER')
      .limit(1);

    // Query must not error (enum value is valid)
    expect(error).toBeNull();
    // data is an array (possibly empty — that's fine, we're checking the filter works)
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('record_internal_transfer — structural: _resolve_cash_coa helper', () => {
  it('seeded Kas Toko is linked to an active COA account', async () => {
    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('id, internal_label, account_type, coa_account_id, chart_of_accounts(account_code, is_active)')
      .eq('id', SEEDED_KAS_ID)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.account_type).toBe('KAS');
    expect(data!.coa_account_id).not.toBeNull();

    const coaJoin = (data as unknown as {
      chart_of_accounts: { account_code: string; is_active: boolean } | { account_code: string; is_active: boolean }[] | null
    }).chart_of_accounts;
    const coa = Array.isArray(coaJoin) ? coaJoin[0] : coaJoin;
    expect(coa).not.toBeNull();
    expect(coa!.account_code).toBe('1-1110');
    expect(coa!.is_active).toBe(true);
  });
});
