/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  }
}));

import { supabase } from '../supabaseClient';
import {
  setOpeningBalance,
  closeAccountingPeriod,
  closeFiscalYear,
  accruePeriodTaxes,
  fetchCoa,
  fetchAccountingConfig,
  fetchAccountingPeriods,
  fetchTrialBalance,
  fetchGeneralLedger,
} from './service';

describe('akuntansi service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('setOpeningBalance', () => {
    it('calls RPC with correct payload', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({ data: { ok: true, entry_id: 'abc', entry_number: 'OB-001' }, error: null });

      const result = await setOpeningBalance('2025-05-31', [
        { account_code: '1-1110', side: 'DEBIT', amount: 100 },
        { account_code: '3-1100', side: 'CREDIT', amount: 100 },
      ]);

      expect(mockRpc).toHaveBeenCalledWith('set_opening_balance', expect.objectContaining({
        p_balance_date: '2025-05-31',
        p_lines: expect.any(Array),
        p_tenant_id: null,
      }));
      expect(result).toMatchObject({ ok: true });
    });

    it('returns entry_id and entry_number on success', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-123', entry_number: 'OB-001' },
        error: null
      });

      const result = await setOpeningBalance('2025-05-31', [
        { account_code: '1-1110', side: 'DEBIT', amount: 100 },
      ]);

      expect(result.entry_id).toBe('entry-123');
      expect(result.entry_number).toBe('OB-001');
    });
  });

  describe('closeAccountingPeriod', () => {
    it('calls RPC with correct payload', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

      await closeAccountingPeriod(2026, 6);

      expect(mockRpc).toHaveBeenCalledWith('close_accounting_period', {
        p_year: 2026,
        p_month: 6,
        p_tenant_id: null
      });
    });

    it('returns ok flag on success', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({ data: { ok: true }, error: null });

      const result = await closeAccountingPeriod(2026, 6);
      expect(result.ok).toBe(true);
    });
  });

  describe('closeFiscalYear', () => {
    it('calls RPC with correct payload', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          fiscal_year: 2025,
          net_income: 5000000,
          total_pendapatan: 100000000,
          total_beban: 95000000,
          prive_closed: 0
        },
        error: null
      });

      await closeFiscalYear(2025);

      expect(mockRpc).toHaveBeenCalledWith('close_fiscal_year', {
        p_year: 2025,
        p_tenant_id: null
      });
    });

    it('returns fiscal year closing summary', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: {
          ok: true,
          fiscal_year: 2025,
          net_income: 5000000,
          total_pendapatan: 100000000,
          total_beban: 95000000,
          prive_closed: 0
        },
        error: null
      });

      const result = await closeFiscalYear(2025);
      expect(result.ok).toBe(true);
      expect(result.fiscal_year).toBe(2025);
      expect(result.net_income).toBe(5000000);
    });
  });

  describe('accruePeriodTaxes', () => {
    it('calls RPC with correct payload', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, omzet: 50000000, tax: 1000000, pph_rate_pct: 2 },
        error: null
      });

      await accruePeriodTaxes(2026, 6);

      expect(mockRpc).toHaveBeenCalledWith('accrue_period_taxes', {
        p_year: 2026,
        p_month: 6,
        p_tenant_id: null
      });
    });

    it('returns tax accrual summary', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, omzet: 50000000, tax: 1000000, pph_rate_pct: 2 },
        error: null
      });

      const result = await accruePeriodTaxes(2026, 6);
      expect(result.ok).toBe(true);
      expect(result.omzet).toBe(50000000);
      expect(result.tax).toBe(1000000);
    });
  });

  describe('fetchCoa', () => {
    it('fetches and returns chart of accounts', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'coa-1',
                account_code: '1-1110',
                account_name: 'Kas',
                account_type: 'ASET',
                account_subtype: null,
                parent_id: null,
                normal_balance: 'DEBIT',
                is_active: true,
                is_system: true,
                is_control_account: false,
                description: 'Cash account',
                tenant_id: null,
              }
            ],
            error: null
          })
        })
      });

      const rows = await fetchCoa();
      expect(rows).toHaveLength(1);
      expect(rows[0].account_code).toBe('1-1110');
      expect(mockFrom).toHaveBeenCalledWith('chart_of_accounts');
    });

    it('returns empty array on no data', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      });

      const rows = await fetchCoa();
      expect(rows).toEqual([]);
    });
  });

  describe('fetchAccountingConfig', () => {
    it('fetches accounting configuration', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'cfg-1',
                tenant_id: null,
                ppn_mode: 'NON_PKP',
                ppn_rate_pct: 0,
                pph_mode: 'UMKM_FINAL_0_5',
                pph_rate_pct: 0.5,
                fiscal_year_start_month: 1,
                enable_dual_write_to_gl: true,
                enable_strict_period_close: false,
                opening_balance_set: true,
                opening_balance_date: '2025-01-01',
                auto_accrue_pph_monthly: false,
                auto_accrue_ppn_monthly: false,
              },
              error: null
            })
          })
        })
      });

      const config = await fetchAccountingConfig();
      expect(config).not.toBeNull();
      expect(config?.ppn_mode).toBe('NON_PKP');
      expect(mockFrom).toHaveBeenCalledWith('accounting_config');
    });

    it('returns null when no config exists', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null
            })
          })
        })
      });

      const config = await fetchAccountingConfig();
      expect(config).toBeNull();
    });
  });

  describe('fetchAccountingPeriods', () => {
    it('fetches accounting periods', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'period-1',
                    tenant_id: null,
                    period_year: 2026,
                    period_month: 6,
                    status: 'OPEN',
                    closed_at: null,
                    closed_by: null,
                  }
                ],
                error: null
              })
            })
          })
        })
      });

      const periods = await fetchAccountingPeriods();
      expect(periods).toHaveLength(1);
      expect(periods[0].period_year).toBe(2026);
      expect(mockFrom).toHaveBeenCalledWith('accounting_periods');
    });
  });

  describe('fetchTrialBalance', () => {
    it('fetches trial balance rows', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                account_id: 'acc-1',
                account_code: '1-1110',
                account_name: 'Kas',
                account_type: 'ASET',
                account_subtype: null,
                normal_balance: 'DEBIT',
                total_debit: 100000,
                total_credit: 50000,
                balance: 50000,
              }
            ],
            error: null
          })
        })
      });

      const rows = await fetchTrialBalance();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].account_code).toBe('1-1110');
      expect(mockFrom).toHaveBeenCalledWith('trial_balance');
    });
  });

  describe('fetchGeneralLedger', () => {
    it('fetches general ledger entries for account', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      account_id: 'acc-1',
                      account_code: '1-1110',
                      account_name: 'Kas',
                      entry_id: 'entry-1',
                      entry_number: 'JE-001',
                      entry_date: '2026-06-01',
                      entry_description: 'Opening balance',
                      line_description: null,
                      side: 'DEBIT',
                      amount: 100000,
                      debit: 100000,
                      credit: 0,
                      running_balance: 100000,
                      source_type: 'OPENING_BALANCE',
                      source_ref_table: null,
                      source_ref_id: null,
                    }
                  ],
                  error: null
                })
              })
            })
          })
        })
      });

      const rows = await fetchGeneralLedger('acc-1', '2026-06-01', '2026-06-30');
      expect(rows).toHaveLength(1);
      expect(rows[0].account_code).toBe('1-1110');
      expect(mockFrom).toHaveBeenCalledWith('general_ledger');
    });

    it('passes correct date filters', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      const mockEq = vi.fn();
      const mockGte = vi.fn();
      const mockLte = vi.fn();
      const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });

      mockLte.mockReturnValue({ order: mockOrder });
      mockGte.mockReturnValue({ lte: mockLte });
      mockEq.mockReturnValue({ gte: mockGte });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: mockEq })
      });

      await fetchGeneralLedger('acc-1', '2026-06-01', '2026-06-30');

      expect(mockEq).toHaveBeenCalledWith('account_id', 'acc-1');
      expect(mockGte).toHaveBeenCalledWith('entry_date', '2026-06-01');
      expect(mockLte).toHaveBeenCalledWith('entry_date', '2026-06-30');
    });
  });
});
