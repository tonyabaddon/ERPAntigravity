// Integration tests for record_owner_drawing RPC — Pattern C
//
// RPCs run _assert_owner_active() first; service-role (auth.uid()=NULL) always
// hits INSUFFICIENT_ROLE before any business validation.
//
// What these tests cover:
//   1. RPC deployed + role gate wired → INSUFFICIENT_ROLE (not 404)
//   2. Structural: Prive COA (3-1200) exists and is active — required by RPC
//   3. Structural: OWNER_DRAWING source_type value is valid in pg enum
//
// Happy paths (Prive debit + Cash credit journal entry) covered by
// Task 1 MCP smoke tests (17/17 PASS).

import { describe, it, expect } from 'vitest';
import { supabaseAdmin, SEEDED_KAS_ID, COA_PRIVE_ID } from './_setup';

describe('record_owner_drawing — deployment + role gate', () => {
  it('function is deployed: no-auth call returns INSUFFICIENT_ROLE (not 404)', async () => {
    const { data, error } = await supabaseAdmin.rpc('record_owner_drawing', {
      p_from_cash_id: SEEDED_KAS_ID,
      p_amount: 100000,
      p_entry_date: '2026-06-22',
      p_reason: 'test',
      p_personal_memo: null,
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });
});

describe('record_owner_drawing — structural: Prive COA prerequisite', () => {
  it("COA 3-1200 Prive (Owner Drawing) exists and is active", async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type, is_active')
      .eq('id', COA_PRIVE_ID)
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.account_code).toBe('3-1200');
    expect(data!.is_active).toBe(true);
  });

  it("COA 3-1200 lookup by code also resolves to an active account", async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, is_active')
      .eq('account_code', '3-1200')
      .eq('is_active', true)
      .single();

    expect(error).toBeNull();
    expect(data!.account_code).toBe('3-1200');
  });
});

describe('record_owner_drawing — structural: source_type enum', () => {
  it("journal_entry_source enum includes 'OWNER_DRAWING'", async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'OWNER_DRAWING')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});
