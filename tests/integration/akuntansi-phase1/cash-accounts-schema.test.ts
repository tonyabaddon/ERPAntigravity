import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('cash_accounts schema', () => {
  it('Garindo default Kas Toko seeded with COA link', async () => {
    const { data, error } = await supabaseAdmin
      .from('cash_accounts')
      .select('account_type, internal_label, coa_account_id, chart_of_accounts(account_code)')
      .eq('account_type', 'KAS')
      .eq('internal_label', 'Kas Toko')
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as any).chart_of_accounts.account_code).toBe('1-1110');
  });

  it('rejects E_WALLET without provider', async () => {
    const { error } = await supabaseAdmin.from('cash_accounts').insert({
      account_type: 'E_WALLET', internal_label: 'Bad wallet'
    });
    expect(error).toBeTruthy();
  });
});
