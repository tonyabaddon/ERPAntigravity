import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('_post_journal_entry RPC', () => {
  it('posts a balanced 2-line entry successfully', async () => {
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_source_ref_table: 'test',
      p_source_ref_id: crypto.randomUUID(),
      p_description: 'test balanced entry',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100000 },
      ],
      p_tenant_id: null,
      p_reverses_entry_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    expect(data!.entry_id).toBeDefined();
    expect(data!.entry_number).toMatch(/^JE-202606-\d{4}$/);

    // Verify entry posted with 2 lines
    const { data: entry } = await supabaseAdmin
      .from('journal_entries')
      .select('*, journal_entry_lines(*)')
      .eq('id', data!.entry_id)
      .single();
    expect(entry!.total_debit).toBe('100000.00');
    expect(entry!.total_credit).toBe('100000.00');
    expect(entry!.journal_entry_lines.length).toBe(2);

    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
  });

  it('rejects unbalanced entry', async () => {
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'unbalanced',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 50000 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/unbalanced/i);
  });

  it('rejects entry with invalid account_code', async () => {
    const { error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2026-06-15',
      p_source_type: 'BACKFILL',
      p_description: 'bad acc',
      p_lines: [
        { account_code: '9-9999', side: 'DEBIT', amount: 100 },
        { account_code: '4-1110', side: 'CREDIT', amount: 100 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/account_not_found/i);
  });

  it('auto-creates period when missing', async () => {
    // Use future date with no period
    const { data, error } = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: '2027-03-15',
      p_source_type: 'BACKFILL',
      p_description: 'future period',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 1 },
        { account_code: '4-1110', side: 'CREDIT', amount: 1 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeNull();

    const { data: period } = await supabaseAdmin
      .from('accounting_periods')
      .select('*')
      .is('tenant_id', null)
      .eq('period_year', 2027)
      .eq('period_month', 3)
      .maybeSingle();
    expect(period).not.toBeNull();

    // Cleanup
    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
    await supabaseAdmin.from('accounting_periods').delete().eq('id', period!.id);
  });
});
