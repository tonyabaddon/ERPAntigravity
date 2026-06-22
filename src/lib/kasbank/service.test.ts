/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  }
}));

vi.mock('../akuntansi/service', () => ({
  fetchGeneralLedger: vi.fn(),
}));

import { supabase } from '../supabaseClient';
import { fetchGeneralLedger } from '../akuntansi/service';
import {
  fetchCashAccounts,
  fetchCashAccountBalances,
  createCashAccount,
  updateCashAccount,
  fetchAccountLedger,
} from './service';
import type { CashAccountInput } from './types';

describe('kasbank service', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('fetchCashAccounts', () => {
    it('fetches all cash accounts ordered by sort_order', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'cash-1',
                account_type: 'KAS',
                bank_code: null,
                account_number: null,
                account_holder: null,
                internal_label: 'Kas Toko',
                provider: null,
                purpose: 'PETTY_CASH',
                show_in_invoice: true,
                sort_order: 1,
                is_active: true,
                opening_balance: 0,
                opening_balance_date: null,
                coa_account_id: 'coa-1',
                tenant_id: null,
                created_at: '2026-06-20T10:00:00Z',
                updated_at: '2026-06-20T10:00:00Z',
              }
            ],
            error: null
          })
        })
      });

      const accounts = await fetchCashAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].internal_label).toBe('Kas Toko');
      expect(mockFrom).toHaveBeenCalledWith('cash_accounts');
    });

    it('returns empty array when no accounts exist', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        })
      });

      const accounts = await fetchCashAccounts();
      expect(accounts).toEqual([]);
    });

    it('orders by sort_order ascending', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      const mockOrder = vi.fn().mockResolvedValue({
        data: [],
        error: null
      });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({ order: mockOrder })
      });

      await fetchCashAccounts();
      expect(mockOrder).toHaveBeenCalledWith('sort_order', { ascending: true });
    });
  });

  describe('fetchCashAccountBalances', () => {
    it('fetches all cash account balances from view', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                cash_account_id: 'cash-1',
                internal_label: 'Kas Toko',
                account_type: 'KAS',
                purpose: 'PETTY_CASH',
                bank_code: null,
                account_number: null,
                account_holder: null,
                provider: null,
                sort_order: 1,
                is_active: true,
                tenant_id: null,
                opening_balance: 0,
                total_debit: 100000,
                total_credit: 50000,
                pending_in: 0,
                current_balance: 50000,
                last_movement_date: '2026-06-20',
                movements_this_month: 5,
              }
            ],
            error: null
          })
        })
      });

      const balances = await fetchCashAccountBalances();
      expect(balances).toHaveLength(1);
      expect(balances[0].current_balance).toBe(50000);
      expect(mockFrom).toHaveBeenCalledWith('cash_account_balances');
    });

    it('orders by sort_order ascending', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      const mockOrder = vi.fn().mockResolvedValue({
        data: [],
        error: null
      });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({ order: mockOrder })
      });

      await fetchCashAccountBalances();
      expect(mockOrder).toHaveBeenCalledWith('sort_order', { ascending: true });
    });
  });

  describe('createCashAccount', () => {
    it('inserts a new cash account', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      const mockInsert = vi.fn();
      const mockSelect = vi.fn();
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'cash-new',
          account_type: 'BANK',
          bank_code: 'BCA',
          account_number: '123456789',
          account_holder: 'PT Toko',
          internal_label: 'BCA Operasional',
          provider: null,
          purpose: 'OPERATIONAL',
          show_in_invoice: true,
          sort_order: 2,
          is_active: true,
          opening_balance: 5000000,
          opening_balance_date: '2026-06-01',
          coa_account_id: 'coa-2',
          tenant_id: null,
          created_at: '2026-06-20T11:00:00Z',
          updated_at: '2026-06-20T11:00:00Z',
        },
        error: null
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const input: CashAccountInput = {
        account_type: 'BANK',
        bank_code: 'BCA',
        account_number: '123456789',
        account_holder: 'PT Toko',
        internal_label: 'BCA Operasional',
        purpose: 'OPERATIONAL',
        sort_order: 2,
        opening_balance: 5000000,
        opening_balance_date: '2026-06-01',
        coa_account_id: 'coa-2',
      };

      const result = await createCashAccount(input);
      expect(result.id).toBe('cash-new');
      expect(result.internal_label).toBe('BCA Operasional');
      expect(mockInsert).toHaveBeenCalledWith([input]);
    });
  });

  describe('updateCashAccount', () => {
    it('updates an existing cash account', async () => {
      const mockFrom = supabase!.from as ReturnType<typeof vi.fn>;
      const mockUpdate = vi.fn();
      const mockEq = vi.fn();
      const mockSelect = vi.fn();
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'cash-1',
          account_type: 'KAS',
          bank_code: null,
          account_number: null,
          account_holder: null,
          internal_label: 'Kas Toko Updated',
          provider: null,
          purpose: 'OPERATIONAL',
          show_in_invoice: false,
          sort_order: 2,
          is_active: true,
          opening_balance: 0,
          opening_balance_date: null,
          coa_account_id: 'coa-1',
          tenant_id: null,
          created_at: '2026-06-20T10:00:00Z',
          updated_at: '2026-06-20T12:00:00Z',
        },
        error: null
      });

      mockSelect.mockReturnValue({ single: mockSingle });
      mockEq.mockReturnValue({ select: mockSelect });
      mockUpdate.mockReturnValue({ eq: mockEq });
      mockFrom.mockReturnValue({ update: mockUpdate });

      const patch: Partial<CashAccountInput> = {
        internal_label: 'Kas Toko Updated',
        purpose: 'OPERATIONAL',
        show_in_invoice: false,
      };

      const result = await updateCashAccount('cash-1', patch);
      expect(result.id).toBe('cash-1');
      expect(result.internal_label).toBe('Kas Toko Updated');
      expect(mockUpdate).toHaveBeenCalledWith(patch);
      expect(mockEq).toHaveBeenCalledWith('id', 'cash-1');
    });
  });

  describe('fetchAccountLedger', () => {
    it('delegates to fetchGeneralLedger', async () => {
      const mockGeneralLedger = fetchGeneralLedger as ReturnType<typeof vi.fn>;
      mockGeneralLedger.mockResolvedValue([
        {
          account_id: 'coa-1',
          account_code: '1-1110',
          account_name: 'Kas',
          entry_id: 'entry-1',
          entry_number: 'JE-001',
          entry_date: '2026-06-20',
          entry_description: 'Test',
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
      ]);

      const result = await fetchAccountLedger('coa-1', '2026-06-01', '2026-06-30');
      expect(result).toHaveLength(1);
      expect(result[0].account_code).toBe('1-1110');
      expect(mockGeneralLedger).toHaveBeenCalledWith('coa-1', '2026-06-01', '2026-06-30');
    });

    it('passes date range correctly', async () => {
      const mockGeneralLedger = fetchGeneralLedger as ReturnType<typeof vi.fn>;
      mockGeneralLedger.mockResolvedValue([]);

      await fetchAccountLedger('coa-1', '2026-06-15', '2026-06-25');
      expect(mockGeneralLedger).toHaveBeenCalledWith('coa-1', '2026-06-15', '2026-06-25');
    });
  });
});
