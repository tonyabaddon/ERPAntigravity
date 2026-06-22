import { describe, it, expect, afterEach } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('accrue_period_taxes RPC (PPh Final 0.5% UMKM)', () => {
  // Use a unique month per test run to avoid conflicts
  const testMonth = Math.floor(Math.random() * 12) + 1;
  const testDate = `2099-${String(testMonth).padStart(2, '0')}-15`;
  const testMonthEnd = `2099-${String(testMonth).padStart(2, '0')}-${new Date(2099, testMonth, 0).getDate()}`;

  const cleanupTestMonth = async () => {
    const { data: entries } = await supabaseAdmin
      .from('journal_entries').select('id')
      .gte('entry_date', `2099-${String(testMonth).padStart(2, '0')}-01`)
      .lte('entry_date', testMonthEnd)
      .is('tenant_id', null);
    for (const e of entries || []) {
      await supabaseAdmin.from('journal_entries').delete().eq('id', e.id);
    }
  };

  afterEach(async () => {
    await cleanupTestMonth();
  });

  it('posts tax accrual entry based on monthly omzet', async () => {
    // Cleanup before test to ensure fresh state
    await cleanupTestMonth();

    // Seed sample sale
    const sale = await supabaseAdmin.rpc('_post_journal_entry', {
      p_entry_date: testDate,
      p_source_type: 'BACKFILL',
      p_description: 'tax accrual test sale',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 1000000 },
        { account_code: '4-1110', side: 'CREDIT', amount: 1000000 },
      ],
      p_tenant_id: null,
    });
    expect(sale.error).toBeNull();

    const { data, error } = await supabaseAdmin.rpc('accrue_period_taxes', {
      p_year: 2099, p_month: testMonth, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data!.omzet)).toBe(1000000);
    expect(Number(data!.tax)).toBe(5000);  // 0.5% × 1jt = 5rb
    expect(data!.ok).toBe(true);
  });

  it('skips accrual when omzet zero', async () => {
    const { data, error } = await supabaseAdmin.rpc('accrue_period_taxes', {
      p_year: 2098, p_month: 1, p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(Number(data!.omzet)).toBe(0);
    expect(Number(data!.tax ?? 0)).toBe(0);
  });
});
