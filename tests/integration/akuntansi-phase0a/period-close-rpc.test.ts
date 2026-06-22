import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('close_accounting_period RPC', () => {
  it('closes period successfully when Owner', async () => {
    // Find an Owner user
    const { data: owner } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('role', 'Owner')
      .eq('status', 'Aktif')
      .limit(1)
      .single();

    // Impersonate Owner via service-role workaround:
    // For this test, we call RPC and rely on existing DEFINER pattern.
    // Use a test year/month that we'll create explicitly.
    const testYear = 2030;
    const testMonth = 6;

    await supabaseAdmin
      .from('accounting_periods')
      .insert({ tenant_id: null, period_year: testYear, period_month: testMonth, status: 'OPEN' });

    // Since RPC checks auth.uid() against admin_users.role='Owner', we need
    // either signed-in Owner session OR direct DB execution. Use raw SQL via
    // set_config to fake auth.uid:
    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { data, error } = await supabaseAdmin.rpc('close_accounting_period', {
      p_year: testYear, p_month: testMonth, p_tenant_id: null,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });

    const { data: period } = await supabaseAdmin
      .from('accounting_periods')
      .select('status, closed_at, closed_by')
      .eq('period_year', testYear)
      .eq('period_month', testMonth)
      .is('tenant_id', null)
      .single();
    expect(period!.status).toBe('CLOSED');
    expect(period!.closed_at).not.toBeNull();

    // Cleanup
    await supabaseAdmin.from('accounting_periods').delete()
      .eq('period_year', testYear).eq('period_month', testMonth);
  });

  it('rejects close when period not OPEN/REOPENED', async () => {
    const { data: owner } = await supabaseAdmin
      .from('admin_users').select('id').eq('role', 'Owner').eq('status', 'Aktif').limit(1).single();

    await supabaseAdmin.from('accounting_periods')
      .insert({ tenant_id: null, period_year: 2030, period_month: 7, status: 'CLOSED' });

    await supabaseAdmin.rpc('set_config' as any, {
      key: 'request.jwt.claim.sub', value: owner!.id, is_local: false
    });

    const { error } = await supabaseAdmin.rpc('close_accounting_period', {
      p_year: 2030, p_month: 7, p_tenant_id: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/period_not_open/i);

    await supabaseAdmin.from('accounting_periods').delete()
      .eq('period_year', 2030).eq('period_month', 7);
  });
});
