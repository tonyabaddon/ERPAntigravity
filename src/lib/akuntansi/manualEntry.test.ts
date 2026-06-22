/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
  }
}));

import { supabase } from '../supabaseClient';
import {
  recordInternalTransfer,
  recordOwnerDrawing,
  recordBalanceAdjustment,
  recordWalletSpend,
  recordManualExpense,
} from './manualEntry';

describe('manual entry RPCs', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('recordInternalTransfer', () => {
    it('calls record_internal_transfer RPC with correct args and default source_subtype', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-123', entry_number: 'JE-001' },
        error: null
      });

      const result = await recordInternalTransfer({
        fromCashId: 'cash-1',
        toCashId: 'cash-2',
        amount: 100000,
        entryDate: '2026-06-22',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_internal_transfer', {
        p_from_cash_id: 'cash-1',
        p_to_cash_id: 'cash-2',
        p_amount: 100000,
        p_entry_date: '2026-06-22',
        p_notes: null,
        p_proof_url: null,
        p_source_subtype: 'TRANSFER',
      });
      expect(result.entry_number).toBe('JE-001');
      expect(result.ok).toBe(true);
    });

    it('passes notes and proof_url when provided', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-123', entry_number: 'JE-001' },
        error: null
      });

      await recordInternalTransfer({
        fromCashId: 'cash-1',
        toCashId: 'cash-2',
        amount: 100000,
        entryDate: '2026-06-22',
        notes: 'Topup deposit',
        proofUrl: 'https://example.com/proof.png',
        sourceSubtype: 'CASH_DEPOSIT',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_internal_transfer', {
        p_from_cash_id: 'cash-1',
        p_to_cash_id: 'cash-2',
        p_amount: 100000,
        p_entry_date: '2026-06-22',
        p_notes: 'Topup deposit',
        p_proof_url: 'https://example.com/proof.png',
        p_source_subtype: 'CASH_DEPOSIT',
      });
    });

    it('throws error when RPC fails', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'CASH_ACCOUNT_NOT_FOUND: Akun kas tidak ditemukan' }
      });

      await expect(
        recordInternalTransfer({
          fromCashId: 'cash-invalid',
          toCashId: 'cash-2',
          amount: 100000,
          entryDate: '2026-06-22',
        })
      ).rejects.toThrow('CASH_ACCOUNT_NOT_FOUND: Akun kas tidak ditemukan');
    });

    it('throws error if Supabase is not configured', async () => {
      vi.resetModules();
      vi.doMock('../supabaseClient', () => ({
        supabase: null,
      }));

      const { recordInternalTransfer: fn } = await import('./manualEntry');
      await expect(
        fn({
          fromCashId: 'cash-1',
          toCashId: 'cash-2',
          amount: 100000,
          entryDate: '2026-06-22',
        })
      ).rejects.toThrow('Supabase not configured');

      vi.doUnmock('../supabaseClient');
    });
  });

  describe('recordOwnerDrawing', () => {
    it('calls record_owner_drawing RPC with correct args', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-456', entry_number: 'JE-002' },
        error: null
      });

      const result = await recordOwnerDrawing({
        fromCashId: 'cash-1',
        amount: 500000,
        entryDate: '2026-06-22',
        reason: 'Weekly drawing',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_owner_drawing', {
        p_from_cash_id: 'cash-1',
        p_amount: 500000,
        p_entry_date: '2026-06-22',
        p_reason: 'Weekly drawing',
        p_personal_memo: null,
      });
      expect(result.entry_number).toBe('JE-002');
    });

    it('passes personal_memo when provided', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-456', entry_number: 'JE-002' },
        error: null
      });

      await recordOwnerDrawing({
        fromCashId: 'cash-1',
        amount: 500000,
        entryDate: '2026-06-22',
        reason: 'Weekly drawing',
        personalMemo: 'Personal expense',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_owner_drawing', {
        p_from_cash_id: 'cash-1',
        p_amount: 500000,
        p_entry_date: '2026-06-22',
        p_reason: 'Weekly drawing',
        p_personal_memo: 'Personal expense',
      });
    });

    it('throws error when RPC fails', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'COA_NOT_FOUND: Akun Prive tidak ditemukan' }
      });

      await expect(
        recordOwnerDrawing({
          fromCashId: 'cash-1',
          amount: 500000,
          entryDate: '2026-06-22',
          reason: 'Weekly drawing',
        })
      ).rejects.toThrow('COA_NOT_FOUND: Akun Prive tidak ditemukan');
    });
  });

  describe('recordBalanceAdjustment', () => {
    it('calls record_balance_adjustment RPC with direction UP', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-789', entry_number: 'JE-003' },
        error: null
      });

      const result = await recordBalanceAdjustment({
        cashAccountId: 'cash-1',
        direction: 'UP',
        amount: 50000,
        counterpartCoaId: 'coa-revenue',
        reason: 'Found missing cash',
        pin: '123456',
        entryDate: '2026-06-22',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_balance_adjustment', {
        p_cash_account_id: 'cash-1',
        p_direction: 'UP',
        p_amount: 50000,
        p_counterpart_coa_id: 'coa-revenue',
        p_reason: 'Found missing cash',
        p_pin: '123456',
        p_entry_date: '2026-06-22',
      });
      expect(result.entry_number).toBe('JE-003');
    });

    it('calls record_balance_adjustment RPC with direction DOWN', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-789', entry_number: 'JE-003' },
        error: null
      });

      await recordBalanceAdjustment({
        cashAccountId: 'cash-1',
        direction: 'DOWN',
        amount: 25000,
        counterpartCoaId: 'coa-expense',
        reason: 'Inventory loss',
        pin: '123456',
        entryDate: '2026-06-22',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_balance_adjustment', {
        p_cash_account_id: 'cash-1',
        p_direction: 'DOWN',
        p_amount: 25000,
        p_counterpart_coa_id: 'coa-expense',
        p_reason: 'Inventory loss',
        p_pin: '123456',
        p_entry_date: '2026-06-22',
      });
    });

    it('throws error when PIN verification fails', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'INVALID_PIN: PIN tidak valid' }
      });

      await expect(
        recordBalanceAdjustment({
          cashAccountId: 'cash-1',
          direction: 'UP',
          amount: 50000,
          counterpartCoaId: 'coa-revenue',
          reason: 'Found missing cash',
          pin: 'wrong-pin',
          entryDate: '2026-06-22',
        })
      ).rejects.toThrow('INVALID_PIN: PIN tidak valid');
    });
  });

  describe('recordWalletSpend', () => {
    it('calls record_wallet_spend RPC with correct args', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-abc', entry_number: 'JE-004' },
        error: null
      });

      const result = await recordWalletSpend({
        walletCashId: 'wallet-shopee',
        bebanCoaId: 'coa-shipping',
        amount: 30000,
        entryDate: '2026-06-22',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_wallet_spend', {
        p_wallet_cash_id: 'wallet-shopee',
        p_beban_coa_id: 'coa-shipping',
        p_amount: 30000,
        p_entry_date: '2026-06-22',
        p_order_id: null,
        p_notes: null,
      });
      expect(result.entry_number).toBe('JE-004');
    });

    it('passes order_id and notes when provided', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-abc', entry_number: 'JE-004' },
        error: null
      });

      await recordWalletSpend({
        walletCashId: 'wallet-shopee',
        bebanCoaId: 'coa-shipping',
        amount: 30000,
        entryDate: '2026-06-22',
        orderId: 'order-123',
        notes: 'Lalamove delivery',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_wallet_spend', {
        p_wallet_cash_id: 'wallet-shopee',
        p_beban_coa_id: 'coa-shipping',
        p_amount: 30000,
        p_entry_date: '2026-06-22',
        p_order_id: 'order-123',
        p_notes: 'Lalamove delivery',
      });
    });

    it('throws error when RPC fails', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'INVALID_WALLET: Akun kas harus bertipe E_WALLET' }
      });

      await expect(
        recordWalletSpend({
          walletCashId: 'not-wallet',
          bebanCoaId: 'coa-shipping',
          amount: 30000,
          entryDate: '2026-06-22',
        })
      ).rejects.toThrow('INVALID_WALLET: Akun kas harus bertipe E_WALLET');
    });
  });

  describe('recordManualExpense', () => {
    it('calls record_manual_expense RPC with correct args', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-def', entry_number: 'JE-005' },
        error: null
      });

      const result = await recordManualExpense({
        bebanCoaId: 'coa-utility',
        sourceCashId: 'cash-1',
        amount: 150000,
        entryDate: '2026-06-22',
        description: 'Electricity bill',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_manual_expense', {
        p_beban_coa_id: 'coa-utility',
        p_source_cash_id: 'cash-1',
        p_amount: 150000,
        p_entry_date: '2026-06-22',
        p_description: 'Electricity bill',
        p_proof_url: null,
      });
      expect(result.entry_number).toBe('JE-005');
    });

    it('passes proof_url when provided', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: { ok: true, entry_id: 'entry-def', entry_number: 'JE-005' },
        error: null
      });

      await recordManualExpense({
        bebanCoaId: 'coa-utility',
        sourceCashId: 'cash-1',
        amount: 150000,
        entryDate: '2026-06-22',
        description: 'Electricity bill',
        proofUrl: 'https://example.com/receipt.pdf',
      });

      expect(mockRpc).toHaveBeenCalledWith('record_manual_expense', {
        p_beban_coa_id: 'coa-utility',
        p_source_cash_id: 'cash-1',
        p_amount: 150000,
        p_entry_date: '2026-06-22',
        p_description: 'Electricity bill',
        p_proof_url: 'https://example.com/receipt.pdf',
      });
    });

    it('throws error when RPC fails', async () => {
      const mockRpc = supabase!.rpc as ReturnType<typeof vi.fn>;
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'COA_NOT_FOUND: Akun beban tidak ditemukan' }
      });

      await expect(
        recordManualExpense({
          bebanCoaId: 'coa-invalid',
          sourceCashId: 'cash-1',
          amount: 150000,
          entryDate: '2026-06-22',
          description: 'Electricity bill',
        })
      ).rejects.toThrow('COA_NOT_FOUND: Akun beban tidak ditemukan');
    });
  });
});
