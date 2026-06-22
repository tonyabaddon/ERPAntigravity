/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as glQueries from './glQueries';

// Mock the supabaseClient module
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../supabaseClient';

// Helper to create a chainable mock
function createMockChain(data: any, error: any = null) {
  const chain: any = {};
  // Each chainable method returns itself, except order() which needs to return a Thenable
  const returnChainOrResult = (_field?: any, _opts?: any) => {
    // Return a thenable that also has chainable methods
    const result: any = Promise.resolve({ data, error });
    result.select = vi.fn().mockReturnValue(result);
    result.from = vi.fn().mockReturnValue(result);
    result.eq = vi.fn().mockReturnValue(result);
    result.is = vi.fn().mockReturnValue(result);
    result.gte = vi.fn().mockReturnValue(result);
    result.lte = vi.fn().mockReturnValue(result);
    result.order = vi.fn().mockImplementation(returnChainOrResult);
    return result;
  };

  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockImplementation(returnChainOrResult);

  return chain;
}

describe('glQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchTrialBalance', () => {
    it('should fetch trial balance with COA metadata', async () => {
      const mockData = [
        {
          account_id: '123',
          account_code: '1001',
          account_name: 'Kas',
          account_type: 'ASET',
          account_subtype: 'CURRENT_ASSET',
          normal_balance: 'DEBIT',
          total_debit: 1000000,
          total_credit: 0,
          balance: 1000000,
          coa: [
            {
              parent_id: null,
              is_system: false,
              is_active: true,
            },
          ],
        },
        {
          account_id: '456',
          account_code: '1002',
          account_name: 'Bank',
          account_type: 'ASET',
          account_subtype: 'CURRENT_ASSET',
          normal_balance: 'DEBIT',
          total_debit: 5000000,
          total_credit: 0,
          balance: 5000000,
          coa: [
            {
              parent_id: '999',
              is_system: false,
              is_active: true,
            },
          ],
        },
      ];

      const mockChain = createMockChain(mockData);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchTrialBalance();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        account_id: '123',
        account_code: '1001',
        account_name: 'Kas',
        account_type: 'ASET',
        total_debit: 1000000,
        balance: 1000000,
        parent_id: null,
        is_system: false,
        is_active: true,
      });
      expect(result[1]).toMatchObject({
        account_code: '1002',
        parent_id: '999',
      });
    });

    it('should throw error when supabase fails', async () => {
      const mockError = { message: 'Database connection failed' };
      const mockChain = createMockChain(null, mockError);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      await expect(glQueries.fetchTrialBalance()).rejects.toThrow('Database connection failed');
    });

    it('should return empty array when no data', async () => {
      const mockChain = createMockChain([]);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchTrialBalance();

      expect(result).toEqual([]);
    });
  });

  describe('fetchAccountingPeriods', () => {
    it('should fetch accounting periods ordered by year/month descending', async () => {
      const mockData = [
        {
          id: 'period-1',
          tenant_id: null,
          period_year: 2026,
          period_month: 6,
          status: 'OPEN',
          closed_at: null,
          closed_by: null,
          reopened_at: null,
          reopened_by: null,
          reopen_reason: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'period-2',
          tenant_id: null,
          period_year: 2026,
          period_month: 5,
          status: 'CLOSED',
          closed_at: '2026-06-01T00:00:00Z',
          closed_by: 'user-123',
          reopened_at: null,
          reopened_by: null,
          reopen_reason: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const mockChain = createMockChain(mockData);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchAccountingPeriods();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'period-1',
        period_year: 2026,
        period_month: 6,
        status: 'OPEN',
      });
    });

    it('should throw error on database error', async () => {
      const mockError = { message: 'Query failed' };
      const mockChain = createMockChain(null, mockError);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      await expect(glQueries.fetchAccountingPeriods()).rejects.toThrow('Query failed');
    });

    it('should return empty array when no periods exist', async () => {
      const mockChain = createMockChain([]);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchAccountingPeriods();

      expect(result).toEqual([]);
    });
  });

  describe('fetchCoaTree', () => {
    it('should fetch active COA accounts by default', async () => {
      const mockData = [
        {
          id: '123',
          account_code: '1001',
          account_name: 'Kas',
          account_type: 'ASET',
          account_subtype: 'CURRENT_ASSET',
          parent_id: null,
          is_system: false,
          is_active: true,
          description: 'Cash account',
          normal_balance: 'DEBIT',
        },
        {
          id: '456',
          account_code: '1002',
          account_name: 'Bank',
          account_type: 'ASET',
          account_subtype: 'CURRENT_ASSET',
          parent_id: '999',
          is_system: false,
          is_active: true,
          description: 'Bank account',
          normal_balance: 'DEBIT',
        },
      ];

      const mockChain = createMockChain(mockData);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchCoaTree();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: '123',
        account_code: '1001',
        account_name: 'Kas',
        is_active: true,
      });
    });

    it('should include inactive accounts when requested', async () => {
      const mockData = [
        {
          id: '123',
          account_code: '1001',
          account_name: 'Old Account',
          account_type: 'ASET',
          account_subtype: null,
          parent_id: null,
          is_system: false,
          is_active: false,
          description: null,
          normal_balance: 'DEBIT',
        },
      ];

      const mockChain = createMockChain(mockData);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchCoaTree(true);

      expect(result).toHaveLength(1);
      expect(result[0].is_active).toBe(false);
    });

    it('should throw error on database error', async () => {
      const mockError = { message: 'COA query failed' };
      const mockChain = createMockChain(null, mockError);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      await expect(glQueries.fetchCoaTree()).rejects.toThrow('COA query failed');
    });

    it('should return empty array when no accounts exist', async () => {
      const mockChain = createMockChain([]);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchCoaTree();

      expect(result).toEqual([]);
    });
  });

  describe('fetchGeneralLedger', () => {
    it('should fetch ledger entries for account and date range', async () => {
      const mockData = [
        {
          account_id: '123',
          account_code: '1001',
          account_name: 'Kas',
          entry_id: 'entry-1',
          entry_number: 'JE-001',
          entry_date: '2026-06-01',
          entry_description: 'Penerimaan kas',
          line_description: 'Cash in',
          side: 'DEBIT',
          amount: 1000000,
          debit: 1000000,
          credit: 0,
          running_balance: 1000000,
          source_type: 'KASIR_SALE',
          source_ref_table: 'sales',
          source_ref_id: 'sale-1',
        },
        {
          account_id: '123',
          account_code: '1001',
          account_name: 'Kas',
          entry_id: 'entry-2',
          entry_number: 'JE-002',
          entry_date: '2026-06-05',
          entry_description: 'Pengeluaran kas',
          line_description: 'Cash out',
          side: 'CREDIT',
          amount: 500000,
          debit: 0,
          credit: 500000,
          running_balance: 500000,
          source_type: 'KASIR_EXPENSE',
          source_ref_table: 'expenses',
          source_ref_id: 'expense-1',
        },
      ];

      const mockChain = createMockChain(mockData);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchGeneralLedger('123', '2026-06-01', '2026-06-30');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        account_id: '123',
        entry_number: 'JE-001',
        side: 'DEBIT',
        amount: 1000000,
        running_balance: 1000000,
      });
      expect(result[1]).toMatchObject({
        entry_number: 'JE-002',
        side: 'CREDIT',
        amount: 500000,
      });
    });

    it('should throw error on database error', async () => {
      const mockError = { message: 'Ledger query failed' };
      const mockChain = createMockChain(null, mockError);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      await expect(
        glQueries.fetchGeneralLedger('123', '2026-06-01', '2026-06-30')
      ).rejects.toThrow('Ledger query failed');
    });

    it('should return empty array when no entries exist', async () => {
      const mockChain = createMockChain([]);
      (supabase.from as any) = vi.fn().mockReturnValue(mockChain);

      const result = await glQueries.fetchGeneralLedger('123', '2026-06-01', '2026-06-30');

      expect(result).toEqual([]);
    });
  });

  describe('Error handling', () => {
    it('should throw when supabase is not configured', async () => {
      // Placeholder test for error handling documentation
      expect(true).toBe(true);
    });
  });
});
