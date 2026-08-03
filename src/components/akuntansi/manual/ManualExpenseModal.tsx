/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, CreditCard } from 'lucide-react';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { recordManualExpense } from '../../../lib/akuntansi/manualEntry';
import { fetchBebanCategories } from '../../../lib/akuntansi/coaQueries';
import { fetchCashAccountBalances } from '../../../lib/kasbank/service';
import JournalEntryPreview from './JournalEntryPreview';
import type { JEPreviewLine } from './JournalEntryPreview';
import type { CoaOption } from '../../../lib/akuntansi/coaQueries';
import { wibDateString } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManualExpenseModalProps {
  open: boolean;
  sourceAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface CashAccountOption {
  cash_account_id: string;
  internal_label: string;
  account_code: string | null;
  account_type: string;
  current_balance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return wibDateString();
}

/** Format integer as Rupiah string: e.g. 3000000 → "Rp 3.000.000" */
function formatRupiah(n: number): string {
  if (n === 0) return '';
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(n);
}

/** Parse a Rupiah-formatted string to a number. Returns 0 on bad input. */
function parseRupiah(s: string): number {
  const cleaned = s.replace(/[^\d]/g, '');
  if (!cleaned) return 0;
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

/** Get account display emoji + code + label */
function accountLabel(acc: CashAccountOption): string {
  const emoji =
    acc.account_type === 'BANK'
      ? '🏦'
      : acc.account_type === 'KAS'
        ? '💵'
        : '👛';
  const code = acc.account_code ?? '';
  return `${emoji} ${code ? code + ' · ' : ''}${acc.internal_label}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ManualExpenseModal({
  open,
  sourceAccount,
  onClose,
  onPosted,
  showToast,
}: ManualExpenseModalProps): React.ReactElement | null {
  // ------- form state -------------------------------------------------------
  const [bebanCategories, setBebanCategories] = useState<CoaOption[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccountOption[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedBebanId, setSelectedBebanId] = useState<string>('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(sourceAccount.cash_account_id);
  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [entryDate, setEntryDate] = useState<string>(today());
  const [description, setDescription] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // ------- Load data on open ------------------------------------------------
  useEffect(() => {
    if (!open) return;

    // Reset form state
    setSelectedBebanId('');
    setSelectedSourceId(sourceAccount.cash_account_id);
    setAmountDisplay('');
    setAmount(0);
    setEntryDate(today());
    setDescription('');
    setSaving(false);
    setFetchError(null);

    // Fetch beban categories and cash accounts
    Promise.all([
      fetchBebanCategories().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat kategori beban';
        setFetchError(msg);
        return [];
      }),
      fetchCashAccountBalances().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat akun sumber dana';
        setFetchError(msg);
        return [];
      }),
    ]).then(([beban, cash]) => {
      setBebanCategories(beban);
      // Filter to active business accounts only (exclude OWNER_PERSONAL)
      const filtered = cash
        .filter(
          (acc) =>
            acc.is_active === true &&
            acc.purpose !== 'OWNER_PERSONAL',
        )
        .map((acc) => ({
          cash_account_id: acc.cash_account_id,
          internal_label: acc.internal_label,
          account_code: acc.account_code,
          account_type: acc.account_type,
          current_balance: acc.current_balance,
        }));
      setCashAccounts(filtered);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ------- Resolve selected beban info ----------------------------------------
  const selectedBebanInfo = bebanCategories.find((b) => b.id === selectedBebanId);

  // ------- Resolve selected source account info --------------------------------
  const selectedSourceInfo = cashAccounts.find(
    (acc) => acc.cash_account_id === selectedSourceId,
  );

  // ------- Journal Entry Preview lines ----------------------------------------
  const previewLines: JEPreviewLine[] = [];
  if (amount > 0 && selectedBebanInfo && selectedSourceInfo) {
    // Debit: beban account
    previewLines.push({
      accountCode: selectedBebanInfo.account_code,
      accountName: selectedBebanInfo.account_name,
      debit: amount,
      credit: 0,
    });
    // Credit: source cash account
    previewLines.push({
      accountCode: selectedSourceInfo.account_code ?? '',
      accountName: selectedSourceInfo.internal_label,
      debit: 0,
      credit: amount,
    });
  }

  // ------- Amount field handlers -----------------------------------------------
  function handleAmountFocus() {
    // On focus: show raw digits so user can edit
    if (amount > 0) {
      setAmountDisplay(String(amount));
    }
  }

  function handleAmountBlur() {
    const parsed = parseRupiah(amountDisplay);
    setAmount(parsed);
    setAmountDisplay(parsed > 0 ? formatRupiah(parsed) : '');
  }

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    setAmountDisplay(e.target.value);
  }

  // ------- Validation --------------------------------------------------------
  function validate(): string | null {
    if (!selectedBebanId) return 'Kategori Beban wajib dipilih';
    if (!selectedBebanInfo) return 'Akun beban tidak ditemukan';
    if (!selectedSourceId) return 'Sumber dana wajib dipilih';
    if (!selectedSourceInfo) return 'Akun sumber dana tidak ditemukan';
    if (amount <= 0) return 'Jumlah harus lebih dari Rp 0';
    const trimmedDesc = description.trim();
    if (trimmedDesc.length < 3) return 'Keterangan minimal 3 karakter';
    if (!entryDate) return 'Tanggal wajib diisi';
    return null;
  }

  // ------- Submit -----------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    const err = validate();
    if (err) {
      showToast(err, 'warning');
      return;
    }

    // Warn (but allow) future date
    if (entryDate > today()) {
      showToast('⚠ Tanggal di masa depan — entry tetap dicatat', 'info');
    }

    setSaving(true);
    try {
      const result = await recordManualExpense({
        bebanCoaId: selectedBebanInfo?.id ?? '',
        sourceCashId: selectedSourceId,
        amount,
        entryDate,
        description: description.trim(),
        proofUrl: null,
      });
      showToast(
        `✓ Pengeluaran dicatat — ${result.entry_number}`,
        'success',
      );
      onPosted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mencatat pengeluaran';
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBebanInfo?.id,
    selectedSourceId,
    amount,
    entryDate,
    description,
  ]);

  // ------- Render guard ------------------------------------------------------
  if (!open) return null;

  const isFuture = entryDate > today();

  // ------- Render -----------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-white rounded max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div
          className="p-5 border-b border-gray-200 flex items-start justify-between"
          style={{ background: '#ffedd5' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 bg-orange-200 text-orange-700">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: '#7c2d12' }}>
                Catat Pengeluaran
              </h2>
              <p className="text-xs text-orange-700 mt-0.5">
                Beban operasional · pilih kategori + sumber dana
              </p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-orange-500 hover:text-orange-700 p-1 rounded hover:bg-white/60"
            disabled={saving}
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-3 text-caleo-13">

          {/* Fetch error */}
          {fetchError && (
            <div className="border border-orange-200 bg-orange-50 rounded p-3 text-xs text-orange-700">
              ⚠ {fetchError}
            </div>
          )}

          {/* Kategori Beban */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Kategori Beban *
            </label>
            <select
              value={selectedBebanId}
              onChange={(e) => setSelectedBebanId(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 bg-white disabled:opacity-60"
            >
              <option value="">— Pilih kategori beban —</option>
              {bebanCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.account_code} {cat.account_name}
                </option>
              ))}
            </select>
          </div>

          {/* Sumber dana */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Sumber dana *
            </label>
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 bg-white disabled:opacity-60"
            >
              <option value="">— Pilih sumber dana —</option>
              {cashAccounts.map((acc) => (
                <option key={acc.cash_account_id} value={acc.cash_account_id}>
                  {accountLabel(acc)} · Rp{' '}
                  {new Intl.NumberFormat('id-ID').format(acc.current_balance)}
                </option>
              ))}
            </select>
          </div>

          {/* Jumlah */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Jumlah *
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={amountDisplay}
              onChange={handleAmountChange}
              onFocus={handleAmountFocus}
              onBlur={handleAmountBlur}
              placeholder="Rp 0"
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-right font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 disabled:opacity-60"
            />
          </div>

          {/* Tanggal */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Tanggal *
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 disabled:opacity-60"
            />
            {isFuture && (
              <p className="text-caleo-11 text-amber-700 mt-1">
                ⚠ Tanggal di masa depan — entry tetap akan dicatat
              </p>
            )}
          </div>

          {/* Keterangan */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Keterangan *
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              placeholder="Mis. gaji Andi periode Juni 2026"
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 disabled:opacity-60"
            />
            {description.trim().length > 0 && description.trim().length < 3 && (
              <p className="text-caleo-11 text-caleo-danger mt-1">
                ⚠ Minimal 3 karakter
              </p>
            )}
          </div>

          {/* Bukti pengeluaran (opsional) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#7c2d12' }}>
              Bukti pengeluaran (opsional)
            </label>
            <div
              className="border-2 border-slate-200 rounded px-3 py-3 text-center text-xs text-gray-500 flex flex-col items-center gap-1"
              style={{ borderStyle: 'dashed' }}
            >
              <svg
                className="w-5 h-5 text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                />
              </svg>
              <div>Upload struk</div>
            </div>
          </div>

          {/* JE Preview */}
          {previewLines.length > 0 && (
            <JournalEntryPreview lines={previewLines} />
          )}
          {previewLines.length === 0 && amount > 0 && !selectedBebanInfo && (
            <div className="je-preview p-4 text-xs text-amber-800 text-center">
              ⚠ Akun beban tidak ditemukan — hubungi admin
            </div>
          )}
          {previewLines.length === 0 && (amount === 0 || !selectedBebanId) && (
            <div className="je-preview p-4 text-xs text-amber-800 text-center">
              Isi kategori dan jumlah untuk melihat preview journal entry
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="border border-slate-200 bg-white text-slate-700 rounded-full text-xs font-bold px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-orange-600 text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-orange-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : 'Catat Pengeluaran'}
          </button>
        </div>
      </div>
    </div>
  );
}
