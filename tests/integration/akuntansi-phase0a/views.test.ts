import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('trial_balance + general_ledger views', () => {
  let testEntries: string[] = [];

  it('trial_balance returns balanced totals system-wide', async () => {
    // Post 2 sample balanced entries
    const r1 = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'tb test 1',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 50000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 50000 },
      ],
      p_tenant_id: null,
    });
    expect(r1.error).toBeNull();
    testEntries.push(r1.data!.entry_id);

    const r2 = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'tb test 2',
      p_lines: [
        { account_code: '5-2100', side: 'DEBIT', amount: 30000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 30000 },
      ],
      p_tenant_id: null,
    });
    expect(r2.error).toBeNull();
    testEntries.push(r2.data!.entry_id);

    const { data, error } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, total_debit, total_credit, balance');
    expect(error).toBeNull();

    const systemDebit = data!.reduce((sum, r: any) => sum + Number(r.total_debit), 0);
    const systemCredit = data!.reduce((sum, r: any) => sum + Number(r.total_credit), 0);
    expect(systemDebit).toBe(systemCredit);
  });

  it('general_ledger shows running_balance per account', async () => {
    const { data, error } = await supabaseAdmin
      .from('general_ledger')
      .select('account_code, entry_date, debit, credit, running_balance')
      .eq('account_code', '1-1110')
      .order('entry_date', { ascending: true });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    // Last row's running_balance should be > 0 (we deposited 50000 to Kas Toko)
    expect(Number(data![data!.length - 1].running_balance)).toBeGreaterThanOrEqual(50000);
  });

  // Cleanup
  it('cleanup test entries', async () => {
    for (const id of testEntries) {
      await supabaseAdmin.from('journal_entries').delete().eq('id', id);
    }
  });
});
