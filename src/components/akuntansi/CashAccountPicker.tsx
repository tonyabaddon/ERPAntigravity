/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { fetchCashAccountBalances } from '../../lib/kasbank/service';
import type { CashAccountBalance } from '../../lib/kasbank/types';
import { formatRp } from '../../lib/format';

/**
 * Props for CashAccountPicker component.
 */
export interface CashAccountPickerProps {
  value: string | null;
  onChange: (cashAccountId: string | null) => void;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'edc';
  purposeFilter?: 'business-only' | 'all';
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  showBalance?: boolean;
}

/**
 * CashAccountPicker — shared select component for choosing a cash/bank account.
 *
 * Filters accounts based on paymentMethod and purposeFilter:
 * - paymentMethod='cash' → account_type='KAS'
 * - paymentMethod='transfer'|'qris'|'edc' → account_type='BANK'
 * - paymentMethod undefined → all types
 * - purposeFilter='business-only' → exclude purpose='OWNER_PERSONAL'
 *
 * Renders: label (optional) + select element styled per design tokens.
 * Option format: {emoji} {account_code} {internal_label}{showBalance ? ' · Rp X' : ''}
 */
export default function CashAccountPicker({
  value,
  onChange,
  paymentMethod,
  purposeFilter = 'all',
  label,
  placeholder,
  required = false,
  disabled = false,
  showBalance = true,
}: CashAccountPickerProps): React.ReactElement {
  const [allAccounts, setAllAccounts] = useState<CashAccountBalance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load all cash accounts on mount
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCashAccountBalances()
      .then((data) => {
        setAllAccounts(data);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat akun';
        console.error('CashAccountPicker fetch error:', msg);
        setError(msg);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  /**
   * Filter accounts based on paymentMethod and purposeFilter.
   */
  function filterAccounts(accounts: CashAccountBalance[]): CashAccountBalance[] {
    return accounts.filter((a) => {
      // Filter by paymentMethod (account_type)
      if (paymentMethod === 'cash') {
        if (a.account_type !== 'KAS') return false;
      } else if (paymentMethod === 'transfer' || paymentMethod === 'qris' || paymentMethod === 'edc') {
        if (a.account_type !== 'BANK') return false;
      }
      // If paymentMethod is undefined, allow all types

      // Filter by purposeFilter
      if (purposeFilter === 'business-only') {
        if (a.purpose === 'OWNER_PERSONAL') return false;
      }

      return true;
    });
  }

  /**
   * Get emoji for account type.
   */
  function getTypeEmoji(type: string): string {
    switch (type) {
      case 'BANK':
        return '🏦';
      case 'KAS':
        return '💵';
      case 'E_WALLET':
        return '👛';
      default:
        return '💳';
    }
  }

  /**
   * Build option label.
   */
  function getOptionLabel(acc: CashAccountBalance): string {
    const emoji = getTypeEmoji(acc.account_type);
    const code = acc.account_code ?? '';
    const label = acc.internal_label;
    const balance = showBalance ? ` · ${formatRp(acc.current_balance)}` : '';
    return `${emoji} ${code}${code ? ' · ' : ''}${label}${balance}`;
  }

  const filteredAccounts = filterAccounts(allAccounts);
  const defaultPlaceholder = placeholder ?? 'Pilih akun...';

  // Loading state
  if (loading) {
    return (
      <div>
        {label && (
          <label className="block font-bold mb-1 text-[13px]" style={{ color: '#1e3d60' }}>
            {label}
            {required && <span className="text-rose-600"> *</span>}
          </label>
        )}
        <select
          disabled
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white disabled:opacity-60"
        >
          <option>Memuat akun...</option>
        </select>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div>
        {label && (
          <label className="block font-bold mb-1 text-[13px]" style={{ color: '#1e3d60' }}>
            {label}
            {required && <span className="text-rose-600"> *</span>}
          </label>
        )}
        <select
          disabled
          className="w-full border border-rose-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white disabled:opacity-60"
        >
          <option>Gagal memuat akun</option>
        </select>
      </div>
    );
  }

  // Normal render
  return (
    <div>
      {label && (
        <label className="block font-bold mb-1 text-[13px]" style={{ color: '#1e3d60' }}>
          {label}
          {required && <span className="text-rose-600"> *</span>}
        </label>
      )}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white disabled:opacity-60"
      >
        <option value="">{defaultPlaceholder}</option>
        {filteredAccounts.map((a) => (
          <option key={a.cash_account_id} value={a.cash_account_id}>
            {getOptionLabel(a)}
          </option>
        ))}
      </select>
      {required && !value && (
        <p className="text-[10px] text-rose-600 mt-1">Wajib dipilih</p>
      )}
    </div>
  );
}
