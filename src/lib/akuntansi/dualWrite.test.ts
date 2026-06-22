/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as dualWriteModule from './dualWrite';

// Mock supabaseClient
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from '../supabaseClient';

describe('dualWrite.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordPiutangPayment', () => {
    it('should call RPC with correct parameters and return result', async () => {
      const mockResult = {
        ok: true,
        order_id: 'ORD-2026-001',
        je_entry_id: 'JE-2026-0042',
      };

      const input = {
        orderId: 'ORD-2026-001',
        cashAccountId: 'cash-001',
        proofUrl: 'https://example.com/proof.png',
        verifiedByUserId: 'user-verified-id',
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockResult,
        error: null,
      });

      const result = await dualWriteModule.recordPiutangPayment(input);

      expect(supabase.rpc).toHaveBeenCalledOnce();
      expect(supabase.rpc).toHaveBeenCalledWith('record_piutang_payment', {
        p_order_id: 'ORD-2026-001',
        p_cash_account_id: 'cash-001',
        p_proof_url: 'https://example.com/proof.png',
        p_verified_by_user_id: 'user-verified-id',
      });
      expect(result).toEqual(mockResult);
      expect(result.ok).toBe(true);
    });

    it('should handle null proofUrl', async () => {
      const mockResult = {
        ok: true,
        order_id: 'ORD-2026-002',
        je_entry_id: 'JE-2026-0043',
      };

      const input = {
        orderId: 'ORD-2026-002',
        cashAccountId: 'cash-002',
        proofUrl: null,
        verifiedByUserId: 'user-verified-id',
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockResult,
        error: null,
      });

      const result = await dualWriteModule.recordPiutangPayment(input);

      expect(supabase.rpc).toHaveBeenCalledWith('record_piutang_payment', {
        p_order_id: 'ORD-2026-002',
        p_cash_account_id: 'cash-002',
        p_proof_url: null,
        p_verified_by_user_id: 'user-verified-id',
      });
      expect(result.ok).toBe(true);
    });

    it('should throw error when RPC returns error', async () => {
      const mockError = {
        message: 'ORDER_NOT_FOUND: Order dengan id ORD-2026-999 tidak ditemukan',
      };

      const input = {
        orderId: 'ORD-2026-999',
        cashAccountId: 'cash-invalid',
        proofUrl: null,
        verifiedByUserId: 'user-verified-id',
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      await expect(dualWriteModule.recordPiutangPayment(input)).rejects.toThrow(
        'ORDER_NOT_FOUND: Order dengan id ORD-2026-999 tidak ditemukan'
      );
    });

    it('should throw error when Supabase is not configured', async () => {
      const input = {
        orderId: 'ORD-2026-001',
        cashAccountId: 'cash-001',
        proofUrl: null,
        verifiedByUserId: 'user-verified-id',
      };

      // Temporarily make supabase null by mocking its absence
      vi.resetModules();
      vi.doMock('../supabaseClient', () => ({
        supabase: null,
      }));

      // Re-import the module to get the updated mock
      const { recordPiutangPayment } = await import('./dualWrite');

      await expect(recordPiutangPayment(input)).rejects.toThrow('Supabase not configured');
    });
  });
});
