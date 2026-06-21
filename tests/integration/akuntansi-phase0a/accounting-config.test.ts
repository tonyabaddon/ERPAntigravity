import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('accounting_config table + Garindo seed', () => {
  it('Garindo default config exists with tenant_id NULL', async () => {
    const { data, error } = await supabaseAdmin
      .from('accounting_config')
      .select('*')
      .is('tenant_id', null)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.ppn_mode).toBe('NON_PKP');
    expect(data!.pph_mode).toBe('UMKM_FINAL_0_5');
    expect(Number(data!.pph_rate_pct)).toBe(0.5);
    expect(data!.opening_balance_set).toBe(false);
    expect(data!.enable_dual_write_to_gl).toBe(false);
    expect(data!.auto_accrue_pph_monthly).toBe(true);
    expect(data!.fiscal_year_start_month).toBe(1);
  });

  it('rejects invalid ppn_mode', async () => {
    const { error } = await supabaseAdmin
      .from('accounting_config')
      .insert({ ppn_mode: 'INVALID', pph_mode: 'UMKM_FINAL_0_5' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/ppn_mode|violates/i);
  });

  it('rejects invalid pph_mode', async () => {
    const { error } = await supabaseAdmin
      .from('accounting_config')
      .insert({ ppn_mode: 'NON_PKP', pph_mode: 'INVALID' });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/pph_mode|violates/i);
  });
});
