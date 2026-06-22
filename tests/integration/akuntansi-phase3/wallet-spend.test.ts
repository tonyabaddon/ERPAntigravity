// Integration tests for record_wallet_spend RPC — Pattern C
//
// RPCs run _assert_owner_active() first. Service-role (auth.uid()=NULL) always
// returns INSUFFICIENT_ROLE before INVALID_AMOUNT, INVALID_WALLET, etc.
//
// What these tests cover:
//   1. RPC deployed + role gate wired → INSUFFICIENT_ROLE (not 404)
//   2. Structural: WALLET_SPEND source_type valid in enum
//   3. Structural: E_WALLET cash account type constraint exists (can create/read)
//   4. Structural: BEBAN COA requirement for wallet spend counterpart
//
// Happy paths (WALLET_SPEND journal entry creation) covered by
// Task 1 MCP smoke tests (17/17 PASS).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  supabaseAdmin,
  SEEDED_KAS_ID,
  COA_BEBAN_UTILITAS_ID,
  COA_EWALLET_ID,
  TEST_PREFIX,
} from './_setup';

describe('record_wallet_spend — deployment + role gate', () => {
  it('function is deployed: no-auth call returns INSUFFICIENT_ROLE (not 404)', async () => {
    const { data, error } = await supabaseAdmin.rpc('record_wallet_spend', {
      p_wallet_cash_id: SEEDED_KAS_ID,
      p_beban_coa_id: COA_BEBAN_UTILITAS_ID,
      p_amount: 50000,
      p_entry_date: '2026-06-22',
      p_order_id: null,
      p_notes: null,
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INSUFFICIENT_ROLE/i);
  });
});

describe('record_wallet_spend — structural: source_type enum', () => {
  it("journal_entry_source enum includes 'WALLET_SPEND'", async () => {
    const { data, error } = await supabaseAdmin
      .from('journal_entries')
      .select('source_type')
      .eq('source_type', 'WALLET_SPEND')
      .limit(1);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('record_wallet_spend — structural: E_WALLET cash account type', () => {
  let tempEWalletId: string | null = null;

  beforeAll(async () => {
    // Create a temp E_WALLET cash account to verify the account_type constraint works
    const { data } = await supabaseAdmin
      .from('cash_accounts')
      .insert({
        account_type: 'E_WALLET',
        internal_label: `${TEST_PREFIX}-EWALLET`,
        provider: 'Shopee Pay',
        coa_account_id: COA_EWALLET_ID,
        is_active: true,
        purpose: 'OPERATIONAL',
      })
      .select('id')
      .single();

    if (data) {
      tempEWalletId = data.id as string;
    }
  });

  afterAll(async () => {
    if (tempEWalletId) {
      await supabaseAdmin.from('cash_accounts').delete().eq('id', tempEWalletId);
    }
  });

  it('E_WALLET cash account can be created and appears in cash_accounts', async () => {
    expect(tempEWalletId).not.toBeNull();

    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('id, account_type, provider, is_active, coa_account_id')
      .eq('id', tempEWalletId!)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('E_WALLET');
    expect(data!.provider).toBe('Shopee Pay');
    expect(data!.is_active).toBe(true);
    expect(data!.coa_account_id).toBe(COA_EWALLET_ID);
  });

  it('E_WALLET account requires provider (non-null constraint enforced by check)', async () => {
    // Per cash-accounts-schema.test.ts: E_WALLET without provider is rejected
    const { error } = await supabaseAdmin.from('cash_accounts').insert({
      account_type: 'E_WALLET',
      internal_label: `${TEST_PREFIX}-EWALLET-NOPROVIDER`,
    });
    expect(error).toBeTruthy();
  });
});

describe('record_wallet_spend — structural: BEBAN COA requirement', () => {
  it('BEBAN COA used for wallet spend counterpart exists and is active', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type, is_active')
      .eq('id', COA_BEBAN_UTILITAS_ID)
      .single();

    expect(error).toBeNull();
    expect(data!.account_type).toBe('BEBAN');
    expect(data!.is_active).toBe(true);
    expect(data!.account_code).toBe('5-2300');
  });
});
