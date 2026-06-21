import { describe, it, expect } from 'vitest';
import { supabaseAdmin } from './_setup';

describe('SAK EMKM COA seed', () => {
  it('seeds at least 45 system accounts', async () => {
    const { data, error } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, is_system')
      .eq('is_system', true);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(45);
  });

  it('all 5 kelompok represented (Aset, Liab, Modal, Pendapatan, Beban)', async () => {
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_type')
      .eq('is_system', true);
    const types = new Set(data!.map(r => r.account_type));
    expect(types.has('ASET')).toBe(true);
    expect(types.has('LIABILITAS')).toBe(true);
    expect(types.has('MODAL')).toBe(true);
    expect(types.has('PENDAPATAN')).toBe(true);
    expect(types.has('BEBAN')).toBe(true);
  });

  it('includes rev3 critical accounts (2-1500 DP, 3-1900 Ikhtisar, 5-1100 HPP, 4-1230 Untung Opname, 5-3150 Rugi Opname)', async () => {
    const requiredCodes = ['2-1500', '3-1900', '5-1100', '4-1230', '5-3150', '5-3300', '2-1210', '3-1200'];
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code')
      .in('account_code', requiredCodes);
    expect(data!.length).toBe(requiredCodes.length);
  });

  it('normal_balance correct per kelompok (sample check)', async () => {
    const { data } = await supabaseAdmin
      .from('chart_of_accounts')
      .select('account_code, account_type, normal_balance')
      .in('account_code', ['1-1110', '2-1100', '3-1100', '4-1110', '5-2100', '3-1200']);
    const map = Object.fromEntries(data!.map(r => [r.account_code, r.normal_balance]));
    expect(map['1-1110']).toBe('DEBIT');   // Aset = Debit
    expect(map['2-1100']).toBe('CREDIT');  // Liabilitas = Credit
    expect(map['3-1100']).toBe('CREDIT');  // Modal = Credit
    expect(map['4-1110']).toBe('CREDIT');  // Pendapatan = Credit
    expect(map['5-2100']).toBe('DEBIT');   // Beban = Debit
    expect(map['3-1200']).toBe('DEBIT');   // Prive = Debit (contra-equity)
  });
});
