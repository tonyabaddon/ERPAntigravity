import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin, setAuthUid } from './_setup';

describe('set_opening_balance RPC', () => {
  let ownerId: string;

  beforeAll(async () => {
    // Get or create test Owner+Aktif user for tests
    const { data: existing } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('role', 'Owner')
      .eq('status', 'Aktif')
      .limit(1);

    if (existing && existing.length > 0) {
      ownerId = existing[0].id;
    } else {
      // Try to create a test Owner - will work if using service_role key
      const { data: created, error } = await supabaseAdmin
        .from('admin_users')
        .insert([{ name: `Test Owner ${Date.now()}`, role: 'Owner', status: 'Aktif' }])
        .select('id');

      if (created && created.length > 0) {
        ownerId = created[0].id;
      } else {
        // If we can't create (RLS), skip tests
        console.warn('Skipping tests: no Owner user and cannot create one', error?.message);
        return;
      }
    }
  });

  afterAll(async () => {
    await setAuthUid(null);
  });

  it('posts opening balance + flips config flag', async () => {
    if (!ownerId) {
      console.warn('Skipping test: no Owner user available');
      return;
    }

    // Reset config flag for test
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);

    await setAuthUid(ownerId);

    const { data, error } = await supabaseAdmin.rpc('set_opening_balance', {
      p_balance_date: '2025-05-31',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 500000 },
        { account_code: '1-1210', side: 'DEBIT', amount: 8500000 },
        { account_code: '3-1100', side: 'CREDIT', amount: 9000000 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });

    const { data: cfg } = await supabaseAdmin
      .from('accounting_config')
      .select('opening_balance_set, opening_balance_date')
      .is('tenant_id', null).single();
    expect(cfg!.opening_balance_set).toBe(true);
    expect(cfg!.opening_balance_date).toBe('2025-05-31');

    // Cleanup
    await supabaseAdmin.from('journal_entries').delete().eq('id', data!.entry_id);
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);
  });

  it('rejects second call when opening_balance_set=true', async () => {
    if (!ownerId) {
      console.warn('Skipping test: no Owner user available');
      return;
    }

    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: true,
      opening_balance_date: '2025-05-31',
    }).is('tenant_id', null);

    await setAuthUid(ownerId);

    const { error } = await supabaseAdmin.rpc('set_opening_balance', {
      p_balance_date: '2025-05-31',
      p_lines: [
        { account_code: '1-1110', side: 'DEBIT', amount: 100 },
        { account_code: '3-1100', side: 'CREDIT', amount: 100 },
      ],
      p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/opening_balance_already_set/i);

    // Cleanup
    await supabaseAdmin.from('accounting_config').update({
      opening_balance_set: false,
      opening_balance_date: null,
    }).is('tenant_id', null);
  });
});
