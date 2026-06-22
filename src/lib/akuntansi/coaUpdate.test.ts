/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as coaUpdateModule from './coaUpdate';

// Mock supabaseClient
vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from '../supabaseClient';

describe('coaUpdate.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateCoaAccount', () => {
    it('should call RPC with correct parameters and return result', async () => {
      const mockResult = {
        ok: true,
        updated_at: '2026-06-22T10:30:00Z',
      };

      const input = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accountName: 'Aset Lancar',
        description: 'Current assets account',
        isActive: true,
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockResult,
        error: null,
      });

      const result = await coaUpdateModule.updateCoaAccount(input);

      expect(supabase.rpc).toHaveBeenCalledOnce();
      expect(supabase.rpc).toHaveBeenCalledWith('update_coa_account', {
        p_id: '550e8400-e29b-41d4-a716-446655440000',
        p_account_name: 'Aset Lancar',
        p_description: 'Current assets account',
        p_is_active: true,
      });
      expect(result).toEqual(mockResult);
      expect(result.ok).toBe(true);
    });

    it('should handle null description', async () => {
      const mockResult = {
        ok: true,
        updated_at: '2026-06-22T10:30:00Z',
      };

      const input = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accountName: 'Bank Mandiri',
        description: null,
        isActive: true,
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: mockResult,
        error: null,
      });

      const result = await coaUpdateModule.updateCoaAccount(input);

      expect(supabase.rpc).toHaveBeenCalledWith('update_coa_account', {
        p_id: '550e8400-e29b-41d4-a716-446655440000',
        p_account_name: 'Bank Mandiri',
        p_description: null,
        p_is_active: true,
      });
      expect(result.ok).toBe(true);
    });

    it('should throw error when RPC returns error', async () => {
      const mockError = {
        message: 'COA_NOT_FOUND: Akun COA dengan id 550e8400-e29b-41d4-a716-446655440000 tidak ditemukan',
      };

      const input = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accountName: 'Test Account',
        description: null,
        isActive: true,
      };

      (supabase.rpc as any).mockResolvedValueOnce({
        data: null,
        error: mockError,
      });

      await expect(coaUpdateModule.updateCoaAccount(input)).rejects.toThrow(
        'COA_NOT_FOUND: Akun COA dengan id 550e8400-e29b-41d4-a716-446655440000 tidak ditemukan'
      );
    });

    it('should use correct RPC name (update_coa_account)', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: { ok: true, updated_at: '2026-06-22T10:30:00Z' },
        error: null,
      });

      const input = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accountName: 'Updated Account',
        description: 'New description',
        isActive: false,
      };

      await coaUpdateModule.updateCoaAccount(input);

      const callArgs = (supabase.rpc as any).mock.calls[0];
      expect(callArgs[0]).toBe('update_coa_account');
    });

    it('should map camelCase input to snake_case RPC parameters', async () => {
      (supabase.rpc as any).mockResolvedValueOnce({
        data: { ok: true, updated_at: '2026-06-22T10:30:00Z' },
        error: null,
      });

      const input = {
        id: 'test-id',
        accountName: 'Test Name',
        description: 'Test Desc',
        isActive: true,
      };

      await coaUpdateModule.updateCoaAccount(input);

      const callArgs = (supabase.rpc as any).mock.calls[0][1];
      expect(callArgs).toHaveProperty('p_id');
      expect(callArgs).toHaveProperty('p_account_name');
      expect(callArgs).toHaveProperty('p_description');
      expect(callArgs).toHaveProperty('p_is_active');
      expect(callArgs.p_id).toBe('test-id');
      expect(callArgs.p_account_name).toBe('Test Name');
    });
  });
});
