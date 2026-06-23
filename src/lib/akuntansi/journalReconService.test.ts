/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchUnreconciledBankLines,
  fetchUnreconciledJournalLines,
  matchJournalToBankLine,
  autoMatchJournalLinesToBank,
} from './journalReconService';
import * as supabaseClient from '../supabaseClient';

// Mock the supabase client
vi.mock('../supabaseClient', () => ({
  supabase: null,
}));

describe('journalReconService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchUnreconciledBankLines', () => {
    it('should return unmatched bank statement lines for given account and date range', async () => {
      const mockData = [
        {
          id: 'bank-line-1',
          bank_account_id: 'bank-acct-1',
          txn_date: '2026-06-01',
          description: 'Customer payment',
          amount: 100000,
          direction: 'IN',
          lane: 'GRAY',
        },
        {
          id: 'bank-line-2',
          bank_account_id: 'bank-acct-1',
          txn_date: '2026-06-05',
          description: 'Supplier payment',
          amount: 50000,
          direction: 'OUT',
          lane: 'YELLOW',
        },
      ];

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                gte: vi.fn()
                  .mockReturnValueOnce({
                    lte: vi.fn()
                      .mockReturnValueOnce({
                        is: vi.fn().mockResolvedValue({
                          data: mockData,
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchUnreconciledBankLines('bank-acct-1', '2026-06-01', '2026-06-30');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'bank-line-1',
        bank_account_id: 'bank-acct-1',
        date: '2026-06-01', // txn_date mapped to date
        description: 'Customer payment',
        amount: 100000,
        direction: 'IN',
        lane: 'GRAY',
      });
      expect(result[1].direction).toBe('OUT');
      expect(result[1].lane).toBe('YELLOW');
    });

    it('should return empty array when no unmatched bank lines exist', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                gte: vi.fn()
                  .mockReturnValueOnce({
                    lte: vi.fn()
                      .mockReturnValueOnce({
                        is: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchUnreconciledBankLines('bank-acct-1', '2026-06-01', '2026-06-30');

      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      const mockError = { message: 'Database error' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                gte: vi.fn()
                  .mockReturnValueOnce({
                    lte: vi.fn()
                      .mockReturnValueOnce({
                        is: vi.fn().mockResolvedValue({
                          data: null,
                          error: mockError,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      await expect(
        fetchUnreconciledBankLines('bank-acct-1', '2026-06-01', '2026-06-30'),
      ).rejects.toThrow('Database error');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(
        fetchUnreconciledBankLines('bank-acct-1', '2026-06-01', '2026-06-30'),
      ).rejects.toThrow('Supabase not configured');
    });

    it('should return null data as empty array', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                gte: vi.fn()
                  .mockReturnValueOnce({
                    lte: vi.fn()
                      .mockReturnValueOnce({
                        is: vi.fn().mockResolvedValue({
                          data: null,
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchUnreconciledBankLines('bank-acct-1', '2026-06-01', '2026-06-30');

      expect(result).toEqual([]);
    });
  });

  describe('fetchUnreconciledJournalLines', () => {
    it('should return unmatched journal entry lines with related data', async () => {
      const mockData = [
        {
          id: 'jel-1',
          entry_id: 'entry-1',
          account_id: 'coa-bank-1',
          side: 'DEBIT',
          amount: 100000,
          description: 'Customer payment received',
          journal_entries: {
            id: 'entry-1',
            entry_number: 'JE-001',
            entry_date: '2026-06-01',
          },
          chart_of_accounts: {
            account_code: '1-1100',
          },
        },
        {
          id: 'jel-2',
          entry_id: 'entry-2',
          account_id: 'coa-bank-1',
          side: 'CREDIT',
          amount: 50000,
          description: 'Supplier payment',
          journal_entries: {
            id: 'entry-2',
            entry_number: 'JE-002',
            entry_date: '2026-06-05',
          },
          chart_of_accounts: {
            account_code: '1-1100',
          },
        },
      ];

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                is: vi.fn()
                  .mockReturnValueOnce({
                    gte: vi.fn()
                      .mockReturnValueOnce({
                        lte: vi.fn().mockResolvedValue({
                          data: mockData,
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchUnreconciledJournalLines('coa-bank-1', '2026-06-01', '2026-06-30');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'jel-1',
        entry_id: 'entry-1',
        entry_number: 'JE-001',
        entry_date: '2026-06-01',
        description: 'Customer payment received',
        account_code: '1-1100',
        account_id: 'coa-bank-1',
        side: 'DEBIT',
        amount: 100000,
      });
      expect(result[1].side).toBe('CREDIT');
    });

    it('should return empty array when no unmatched journal lines exist', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                is: vi.fn()
                  .mockReturnValueOnce({
                    gte: vi.fn()
                      .mockReturnValueOnce({
                        lte: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      const result = await fetchUnreconciledJournalLines('coa-bank-1', '2026-06-01', '2026-06-30');

      expect(result).toEqual([]);
    });

    it('should throw error when query fails', async () => {
      const mockError = { message: 'Query failed' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn()
              .mockReturnValueOnce({
                is: vi.fn()
                  .mockReturnValueOnce({
                    gte: vi.fn()
                      .mockReturnValueOnce({
                        lte: vi.fn().mockResolvedValue({
                          data: null,
                          error: mockError,
                        }),
                      }),
                  }),
              }),
          }),
        }),
      } as any);

      await expect(
        fetchUnreconciledJournalLines('coa-bank-1', '2026-06-01', '2026-06-30'),
      ).rejects.toThrow('Query failed');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(
        fetchUnreconciledJournalLines('coa-bank-1', '2026-06-01', '2026-06-30'),
      ).rejects.toThrow('Supabase not configured');
    });
  });

  describe('matchJournalToBankLine', () => {
    it('should successfully match journal lines to bank line', async () => {
      const mockResult = {
        ok: true,
        matched_count: 1,
        total_amount_matched: 100000,
      };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockResult,
          error: null,
        }),
      } as any);

      const result = await matchJournalToBankLine({
        bankLineId: 'bank-line-1',
        journalEntryLineIds: ['jel-1'],
        matchReason: 'manual match',
      });

      expect(result).toEqual(mockResult);
      expect(result.ok).toBe(true);
      expect(result.matched_count).toBe(1);
    });

    it('should match multiple journal lines to bank line', async () => {
      const mockResult = {
        ok: true,
        matched_count: 2,
        total_amount_matched: 150000,
      };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockResult,
          error: null,
        }),
      } as any);

      const result = await matchJournalToBankLine({
        bankLineId: 'bank-line-1',
        journalEntryLineIds: ['jel-1', 'jel-2'],
      });

      expect(result.matched_count).toBe(2);
      expect(result.total_amount_matched).toBe(150000);
    });

    it('should throw error when RPC fails', async () => {
      const mockError = { message: 'RPC error: side mismatch' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: mockError,
        }),
      } as any);

      await expect(
        matchJournalToBankLine({
          bankLineId: 'bank-line-1',
          journalEntryLineIds: ['jel-1'],
        }),
      ).rejects.toThrow('RPC error: side mismatch');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(
        matchJournalToBankLine({
          bankLineId: 'bank-line-1',
          journalEntryLineIds: ['jel-1'],
        }),
      ).rejects.toThrow('Supabase not configured');
    });

    it('should match with null matchReason', async () => {
      const mockResult = {
        ok: true,
        matched_count: 1,
        total_amount_matched: 100000,
      };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockResult,
          error: null,
        }),
      } as any);

      const result = await matchJournalToBankLine({
        bankLineId: 'bank-line-1',
        journalEntryLineIds: ['jel-1'],
        matchReason: null,
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('autoMatchJournalLinesToBank', () => {
    it('should return auto-match result with matched and pending counts', async () => {
      const mockResult = {
        auto_matched: 5,
        candidates_pending_manual: 3,
      };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockResult,
          error: null,
        }),
      } as any);

      const result = await autoMatchJournalLinesToBank({
        bankAccountId: 'bank-acct-1',
        periodYear: 2026,
        periodMonth: 6,
      });

      expect(result).toEqual(mockResult);
      expect(result.auto_matched).toBe(5);
      expect(result.candidates_pending_manual).toBe(3);
    });

    it('should return zero matched when no candidates match', async () => {
      const mockResult = {
        auto_matched: 0,
        candidates_pending_manual: 10,
      };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: mockResult,
          error: null,
        }),
      } as any);

      const result = await autoMatchJournalLinesToBank({
        bankAccountId: 'bank-acct-1',
        periodYear: 2026,
        periodMonth: 6,
      });

      expect(result.auto_matched).toBe(0);
      expect(result.candidates_pending_manual).toBe(10);
    });

    it('should throw error when RPC fails', async () => {
      const mockError = { message: 'RPC error: bank account not found' };

      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue({
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: mockError,
        }),
      } as any);

      await expect(
        autoMatchJournalLinesToBank({
          bankAccountId: 'invalid-id',
          periodYear: 2026,
          periodMonth: 6,
        }),
      ).rejects.toThrow('RPC error: bank account not found');
    });

    it('should throw error when Supabase is not configured', async () => {
      vi.spyOn(supabaseClient, 'supabase', 'get').mockReturnValue(null as any);

      await expect(
        autoMatchJournalLinesToBank({
          bankAccountId: 'bank-acct-1',
          periodYear: 2026,
          periodMonth: 6,
        }),
      ).rejects.toThrow('Supabase not configured');
    });
  });
});
