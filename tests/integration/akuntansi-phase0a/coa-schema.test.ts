import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('chart_of_accounts table schema', () => {
  it('table exists', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('id')
      .limit(1);
    expect(error).toBeNull();
  });

  it('rejects invalid account_type', async () => {
    const { error } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-1',
        account_name: 'Test',
        account_type: 'INVALID_TYPE',
        normal_balance: 'DEBIT',
      });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/account_type/i);
  });

  it('rejects invalid normal_balance', async () => {
    const { error } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-2',
        account_name: 'Test',
        account_type: 'ASET',
        normal_balance: 'INVALID',
      });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/normal_balance/i);
  });

  it('UNIQUE (tenant_id, account_code) enforced', async () => {
    // Insert first row
    const { error: e1 } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-UNIQ-1',
        account_name: 'Test Uniq',
        account_type: 'ASET',
        normal_balance: 'DEBIT',
      });
    expect(e1).toBeNull();

    // Duplicate should fail
    const { error: e2 } = await supabaseAdmin
      .from('chart_of_accounts')
      .insert({
        account_code: 'TEST-UNIQ-1',
        account_name: 'Test Uniq 2',
        account_type: 'ASET',
        normal_balance: 'DEBIT',
      });
    expect(e2).toBeTruthy();
    expect(e2!.message).toMatch(/duplicate|unique/i);

    // Cleanup
    await supabaseAdmin.from('chart_of_accounts').delete().eq('account_code', 'TEST-UNIQ-1');
  });
});
