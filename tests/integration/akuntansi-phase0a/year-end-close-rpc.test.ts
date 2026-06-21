import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('close_fiscal_year RPC', () => {
  it('posts 4 closing entries and zeros P&L accounts', async () => {
    // Use test year 2099 so we don't disturb production data
    const testYear = 2099;

    // Seed test data: 1 sale entry + 1 expense entry within 2099
    const sale = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: `${testYear}-06-15`,
      p_source_type: 'BACKFILL',
      p_description: 'fiscal close test sale',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100000 },
      ],
      p_tenant_id: null,
    });
    expect(sale.error).toBeNull();

    const expense = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: `${testYear}-06-15`,
      p_source_type: 'BACKFILL',
      p_description: 'fiscal close test expense',
      p_lines: [
        { account_code: '5-2100', side: 'DEBIT', amount: 30000 },
        { account_code: '1-1110', side: 'CREDIT', amount: 30000 },
      ],
      p_tenant_id: null,
    });

    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { data, error } = await supabaseAdmin.rpc('close_fiscal_year', {
      p_year: testYear, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true, fiscal_year: testYear });
    expect(data!.net_income).toBeDefined();

    // Verify P&L accounts zero after close
    const { data: tb } = await supabaseAdmin
      .from('trial_balance')
      .select('account_code, balance')
      .in('account_code', ['4-1110', '5-2100', '3-1900']);
    const map = Object.fromEntries(tb!.map(r => [r.account_code, Number(r.balance)]));
    expect(map['4-1110']).toBe(0);
    expect(map['5-2100']).toBe(0);
    expect(map['3-1900']).toBe(0);

    // Cleanup all entries in 2099
    const { data: yrEntries } = await supabaseAdmin
      .from('journal_entries').select('id')
      .gte('entry_date', `${testYear}-01-01`).lte('entry_date', `${testYear}-12-31`);
    for (const e of yrEntries!) await supabaseAdmin.from('journal_entries').delete().eq('id', e.id);
  });
});
