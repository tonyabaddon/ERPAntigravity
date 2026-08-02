/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, ArrowDown } from 'lucide-react';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { fetchCashAccountBalances } from '../../../lib/kasbank/service';
import { recordOwnerDrawing } from '../../../lib/akuntansi/manualEntry';
import JournalEntryPreview from './JournalEntryPreview';
import type { JEPreviewLine } from './JournalEntryPreview';
import { wibDateString } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnerDrawingModalProps {
  open: boolean;
  sourceAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
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
function accountLabel(acc: CashAccountBalance): string {
  const emoji =
    acc.account_type === 'BANK' ? '🏦' : acc.account_type === 'KAS' ? '💵' : '👛';
  const code = acc.account_code ?? '';
  return `${emoji} ${code ? code + ' · ' : ''}${acc.internal_label}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OwnerDrawingModal({
  open,
  sourceAccount,
  onClose,
  onPosted,
  showToast,
}: OwnerDrawingModalProps): React.ReactElement | null {
  // ------- form state -------------------------------------------------------
  const [personalAccounts, setPersonalAccounts] = useState<CashAccountBalance[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // selectedPersonalId: which personal account is selected (empty string = "Tidak track destination")
  const [selectedPersonalId, setSelectedPersonalId] = useState<string>('');

  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [entryDate, setEntryDate] = useState<string>(today());
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // ------- load accounts on open -------------------------------------------
  useEffect(() => {
    if (!open) return;

    // Reset form state
    setSelectedPersonalId('');
    setAmountDisplay('');
    setAmount(0);
    setEntryDate(today());
    setReason('');
    setSaving(false);
    setFetchError(null);

    fetchCashAccountBalances()
      .then((data) => {
        const personal = data.filter(
          (a) => a.purpose === 'OWNER_PERSONAL' && a.is_active,
        );
        setPersonalAccounts(personal);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat daftar akun pribadi';
        setFetchError(msg);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ------- Resolve selected personal account --------------------------------
  const selectedPersonalAccount: CashAccountBalance | undefined =
    selectedPersonalId
      ? personalAccounts.find((a) => a.cash_account_id === selectedPersonalId)
      : undefined;

  // ------- Journal Entry Preview lines -------------------------------------
  // Always: D 3-1200 Prive Owner (hardcoded), K source account
  const previewLines: JEPreviewLine[] = [];
  if (amount > 0) {
    // Debit: Prive (display-only, no real account lookup)
    previewLines.push({
      accountCode: '3-1200',
      accountName: 'Prive Owner',
      debit: amount,
      credit: 0,
    });
    // Credit: source account
    previewLines.push({
      accountCode: sourceAccount.account_code ?? '',
      accountName: sourceAccount.internal_label,
      debit: 0,
      credit: amount,
    });
  }

  // ------- Amount field handlers -------------------------------------------
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

  // ------- Validation -------------------------------------------------------
  function validate(): string | null {
    if (amount <= 0) return 'Jumlah harus lebih dari Rp 0';
    if (!entryDate) return 'Tanggal wajib diisi';
    return null;
  }

  // ------- Submit ----------------------------------------------------------
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
      const result = await recordOwnerDrawing({
        fromCashId: sourceAccount.cash_account_id,
        amount,
        entryDate,
        reason: reason.trim() || '',
        personalMemo: selectedPersonalAccount?.internal_label ?? null,
      });
      showToast(`✓ Tarik Pribadi dicatat — ${result.entry_number}`, 'success');
      onPosted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mencatat tarik pribadi';
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceAccount.cash_account_id, amount, entryDate, reason, selectedPersonalAccount?.internal_label]);

  // ------- Render guard ----------------------------------------------------
  if (!open) return null;

  const isFuture = entryDate > today();

  // ------- Render ----------------------------------------------------------
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
          style={{ background: '#f3f4f6' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 bg-gray-300 text-gray-700">
              <ArrowDown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: '#1e3d60' }}>
                Tarik Pribadi (Owner Drawing)
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">Dari bisnis ke pribadi · contra-equity</p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-white/60"
            disabled={saving}
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-3 text-[13px]">

          {/* Fetch error */}
          {fetchError && (
            <div className="border border-rose-200 bg-rose-50 rounded p-3 text-[12px] text-rose-700">
              ⚠ {fetchError}
            </div>
          )}

          {/* From akun bisnis (LOCKED) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Dari akun bisnis *
            </label>
            <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded px-3 py-2 text-[12px]">
              {accountLabel(sourceAccount)}
              <span className="ml-2 font-mono text-gray-500 text-[11px]">
                Rp {new Intl.NumberFormat('id-ID').format(sourceAccount.current_balance)}
              </span>
            </div>
          </div>

          {/* To akun pribadi (OPTIONAL) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Ke akun pribadi (opsional)
            </label>
            <select
              value={selectedPersonalId}
              onChange={(e) => setSelectedPersonalId(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 bg-white disabled:opacity-60"
            >
              <option value="">— Tidak track destination —</option>
              {personalAccounts.map((a) => (
                <option key={a.cash_account_id} value={a.cash_account_id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1">
              Kalau pilih: hanya catat OUT bisnis ke Prive, destination untuk audit saja.
            </p>
          </div>

          {/* Jumlah */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
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
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm text-right font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 disabled:opacity-60"
            />
          </div>

          {/* Tanggal */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Tanggal *
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 disabled:opacity-60"
            />
            {isFuture && (
              <p className="text-[11px] text-amber-700 mt-1">
                ⚠ Tanggal di masa depan — entry tetap akan dicatat
              </p>
            )}
          </div>

          {/* Alasan (OPTIONAL) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Alasan (audit)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              rows={2}
              placeholder="Mis. bayar SPP anak"
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2 disabled:opacity-60 resize-none"
            />
          </div>

          {/* JE Preview */}
          {previewLines.length > 0 && (
            <JournalEntryPreview lines={previewLines} />
          )}
          {previewLines.length === 0 && (
            <div className="je-preview p-4 text-[12px] text-amber-800 text-center">
              Isi jumlah untuk melihat preview journal entry
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] rounded-full text-xs font-bold px-4 py-2 hover:bg-[var(--color-caleo-cloud)] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-[#01365e] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : 'Catat Tarik Pribadi'}
          </button>
        </div>
      </div>
    </div>
  );
}
