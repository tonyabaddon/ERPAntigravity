// Integration tests for record_manual_expense RPC — Pattern C
//
// RPCs run _assert_owner_active() first. Service-role (auth.uid()=NULL) always
// returns INSUFFICIENT_ROLE before INVALID_AMOUNT, INVALID_DESCRIPTION, etc.
//
// What these tests cover:
//   1. RPC deployed + role gate wired → INSUFFICIENT_ROLE (not 404)
//   2. Structural: KASIR_EXPENSE source_type valid in enum (reused enum value
//      per brief spec — "do NOT create new enum values")
//   3. Structural: journal_entry_lines table schema — side, amount, account_id,
//      entry_id, description columns exist
//   4. Structural: BEBAN COA prerequisites for manual expense counterpart
//
// Happy paths (KASIR_EXPENSE journal entry creation) and post-auth negatives
// (INVALID_DESCRIPTION < 3 chars) covered by Task 1 MCP smoke (17/17 PASS).

import { describe, it, expect } from 'vitest';
import { supabaseAdmin, SEEDED_KAS_ID, COA_BEBAN_GAJI_ID, COA_BEBAN_UTILITAS_ID } from './_setup';

describe('record_manual_expense — deployment + role gate', () => {
  it('function is deployed: no-auth call returns INSUFFICIENT_ROLE (not 404)', async () => {
    const { data, error } = await supabaseAdmin.rpc('record_manual_expense', {
      p_beban_coa_id: COA_BEBAN_UTILITAS_ID,
      p_source_cash_id: SEEDED_KAS_ID,
      p_amount: 100000,
      p_entry_date: '2026-06-22',
      p_description: 'Bayar listrik PLN bulan Juni',
      p_proof_url: null,
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });

  it('accepts proof_url parameter without error', async () => {
    const { error } = await supabaseAdmin.rpc('record_manual_expense', {
      p_beban_coa_id: COA_BEBAN_UTILITAS_ID,
      p_source_cash_id: SEEDED_KAS_ID,
      p_amount: 1,
      p_entry_date: '2026-06-22',
      p_description: 'Desc',
      p_proof_url: 'https://storage.example.com/receipt.jpg',
    });
    // INSUFFICIENT_ROLE means parameter parsing succeeded
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });
});

describe('record_manual_expense — structural: source_type enum', () => {
  it("journal_entry_source enum includes 'KASIR_EXPENSE' (reused value for manual expense)", async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'KASIR_EXPENSE')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('record_manual_expense — structural: journal_entry_lines schema', () => {
  it('journal_entry_lines table has required columns (entry_id, side, amount, account_id)', async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('entry_id, line_number, account_id, side, amount, description')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('journal_entry_lines side column accepts DEBIT and CREDIT filter', async () => {
    const { data: debit, error: e1 } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('side')
      .eq('side', 'DEBIT')
      .limit(1);

    const { data: credit, error: e2 } = await supabaseAdmin
      .from('journal_entry_lines')
      .select('side')
      .eq('side', 'CREDIT')
      .limit(1);

    expect(e1).toBeNull();
    expect(e2).toBeNull();
    expect(Array.isArray(debit)).toBe(true);
    expect(Array.isArray(credit)).toBe(true);
  });
});

describe('record_manual_expense — structural: BEBAN COA requirements', () => {
  it('Beban Utilitas COA (5-2300) is active and BEBAN type', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, is_active')
      .eq('id', COA_BEBAN_UTILITAS_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('BEBAN');
    expect(data!.is_active).toBe(true);
  });

  it('Beban Gaji COA (5-2100) is active and BEBAN type', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, is_active')
      .eq('id', COA_BEBAN_GAJI_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('BEBAN');
    expect(data!.is_active).toBe(true);
    expect(data!.account_code).toBe('5-2100');
  });

  it('source cash account (Kas Toko) is active and KAS type', async () => {
    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('account_type, is_active, internal_label')
      .eq('id', SEEDED_KAS_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('KAS');
    expect(data!.is_active).toBe(true);
    expect(data!.internal_label).toBe('Kas Toko');
  });
});
