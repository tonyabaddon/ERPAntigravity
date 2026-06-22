/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as periodCloseModule from './periodClose';

// Mock supabaseClient
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from '../supabaseClient';

describe('periodClose.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('closeAccountingPeriod', () => {
    it('should call RPC with correct parameters and return result', async () => {
      const mockResult = {
        ok: true,
        closed_at: '2026-06-22T10:30:00Z',
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockResult,
        error: null,
      });

      const result = await periodCloseModule.closeAccountingPeriod(2026, 6);

      expect(supabase.rpc).toHaveBeenCalledOnce();
      expect(supabase.rpc).toHaveBeenCalledWith('close_accounting_period', {
        p_year: 2026,
        p_month: 6,
        p_tenant_id: null,
      });
      expect(result).toEqual(mockResult);
      expect(result.ok).toBe(true);
    });

    it('should throw error when RPC returns error', async () => {
      const mockError = { message: 'period_not_open_or_not_found: year=2026 month=6' };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      await expect(
        periodCloseModule.closeAccountingPeriod(2026, 6)
      ).rejects.toThrow('period_not_open_or_not_found: year=2026 month=6');
    });

    it('should use correct RPC name (close_accounting_period)', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: { ok: true, closed_at: '2026-06-22T10:30:00Z' },
        error: null,
      });

      await periodCloseModule.closeAccountingPeriod(2026, 5);

      const callArgs = (supabase.rpc as any).mock.calls[0];
      expect(callArgs[0]).toBe('close_accounting_period');
    });
  });
});
