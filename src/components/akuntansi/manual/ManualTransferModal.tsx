/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, ArrowRightLeft, ArrowUp, ArrowUpCircle, UploadCloud } from 'lucide-react';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { fetchCashAccountBalances } from '../../../lib/kasbank/service';
import { recordInternalTransfer } from '../../../lib/akuntansi/manualEntry';
import JournalEntryPreview from './JournalEntryPreview';
import type { JEPreviewLine } from './JournalEntryPreview';
import { wibDateString } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TransferVariant = 'transfer' | 'cash_deposit' | 'wallet_topup';

export interface ManualTransferModalProps {
  open: boolean;
  variant: TransferVariant;
  sourceAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ---------------------------------------------------------------------------
// Variant configuration
// ---------------------------------------------------------------------------

interface VariantConfig {
  title: string;
  subtitle: string;
  headerBg: string;
  iconTileCls: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** true = from-side is locked to sourceAccount; false = free select */
  sourceLocked: boolean;
  /** true = to-side is locked to sourceAccount; false = free select */
  destLocked: boolean;
  sourceSubtype: 'TRANSFER' | 'CASH_DEPOSIT' | 'WALLET_TOPUP';
}

const VARIANT_CONFIG: Record<TransferVariant, VariantConfig> = {
  transfer: {
    title: 'Transfer Internal',
    subtitle: 'Pindah dana antar akun · double-entry pair',
    headerBg: '#dbeafe',
    iconTileCls: 'bg-blue-100 text-blue-700',
    Icon: ArrowRightLeft,
    sourceLocked: false,
    destLocked: false,
    sourceSubtype: 'TRANSFER',
  },
  cash_deposit: {
    title: 'Setor Kas ke Bank',
    subtitle: 'Dari Kas Toko ke akun Bank',
    headerBg: '#d1fae5',
    iconTileCls: 'bg-emerald-100 text-emerald-700',
    Icon: ArrowUp,
    sourceLocked: true,
    destLocked: false,
    sourceSubtype: 'CASH_DEPOSIT',
  },
  wallet_topup: {
    title: 'Top-Up Wallet',
    subtitle: 'Bank → E-Wallet pair',
    headerBg: '#fef3c7',
    iconTileCls: 'bg-amber-100 text-amber-800',
    Icon: ArrowUpCircle,
    sourceLocked: false,
    destLocked: true,
    sourceSubtype: 'WALLET_TOPUP',
  },
};

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

export default function ManualTransferModal({
  open,
  variant,
  sourceAccount,
  onClose,
  onPosted,
  showToast,
}: ManualTransferModalProps): React.ReactElement | null {
  const cfg = VARIANT_CONFIG[variant];

  // ------- form state -------------------------------------------------------
  const [allAccounts, setAllAccounts] = useState<CashAccountBalance[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // fromId: which cash account is the source side
  const [fromId, setFromId] = useState<string>(sourceAccount.cash_account_id);
  // toId: which cash account is the destination side
  const [toId, setToId] = useState<string>('');

  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [entryDate, setEntryDate] = useState<string>(today());
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // ------- load accounts on open -------------------------------------------
  useEffect(() => {
    if (!open) return;

    // Reset form state
    setFromId(sourceAccount.cash_account_id);
    setToId('');
    setAmountDisplay('');
    setAmount(0);
    setEntryDate(today());
    setNotes('');
    setSaving(false);
    setFetchError(null);

    fetchCashAccountBalances()
      .then((data) => {
        const active = data.filter((a) => a.is_active);
        setAllAccounts(active);

        // Set initial toId if possible
        const destList = getDestList(variant, sourceAccount, active, sourceAccount.cash_account_id);
        if (destList.length > 0 && !cfg.destLocked) {
          setToId(destList[0].cash_account_id);
        } else if (cfg.destLocked) {
          setToId(sourceAccount.cash_account_id);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat daftar akun';
        setFetchError(msg);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant, sourceAccount.cash_account_id]);

  // ------- derived lists ---------------------------------------------------

  function getDestList(
    v: TransferVariant,
    src: CashAccountBalance,
    accounts: CashAccountBalance[],
    currentFromId: string,
  ): CashAccountBalance[] {
    if (v === 'cash_deposit') {
      return accounts.filter((a) => a.account_type === 'BANK');
    }
    if (v === 'wallet_topup') {
      // dest is locked; return empty (not used for select)
      return [];
    }
    // transfer: all except current from
    return accounts.filter((a) => a.cash_account_id !== currentFromId);
  }

  function getSourceList(
    v: TransferVariant,
    accounts: CashAccountBalance[],
  ): CashAccountBalance[] {
    if (v === 'wallet_topup') {
      return accounts.filter((a) => a.account_type === 'BANK');
    }
    return accounts;
  }

  const sourceList = getSourceList(variant, allAccounts);
  const destList = getDestList(variant, sourceAccount, allAccounts, fromId);

  // Resolve actual from/to accounts for display and preview
  const fromAccount: CashAccountBalance | undefined =
    cfg.sourceLocked
      ? sourceAccount
      : allAccounts.find((a) => a.cash_account_id === fromId);

  const toAccount: CashAccountBalance | undefined =
    cfg.destLocked
      ? sourceAccount
      : allAccounts.find((a) => a.cash_account_id === toId);

  // ------- Journal Entry Preview lines -------------------------------------
  const previewLines: JEPreviewLine[] = [];
  if (toAccount && amount > 0) {
    previewLines.push({
      accountCode: toAccount.account_code ?? '',
      accountName: toAccount.internal_label,
      debit: amount,
      credit: 0,
    });
  }
  if (fromAccount && amount > 0) {
    previewLines.push({
      accountCode: fromAccount.account_code ?? '',
      accountName: fromAccount.internal_label,
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

  // ------- from select change (only for non-locked variants) ---------------
  function handleFromChange(newFromId: string) {
    setFromId(newFromId);
    // For 'transfer': reset to if same as new from
    if (variant === 'transfer' && newFromId === toId) {
      const others = allAccounts.filter((a) => a.cash_account_id !== newFromId);
      setToId(others.length > 0 ? others[0].cash_account_id : '');
    }
  }

  // ------- Validation -------------------------------------------------------
  function validate(): string | null {
    if (!fromId) return 'Pilih akun sumber terlebih dahulu';
    if (!toId) return 'Pilih akun tujuan terlebih dahulu';
    if (fromId === toId) return 'Akun sumber dan tujuan tidak boleh sama';
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
      const result = await recordInternalTransfer({
        fromCashId: fromId,
        toCashId: toId,
        amount,
        entryDate,
        notes: notes.trim() || null,
        proofUrl: null,
        sourceSubtype: cfg.sourceSubtype,
      });
      showToast(`✓ Journal entry dicatat — ${result.entry_number}`, 'success');
      onPosted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mencatat journal entry';
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId, amount, entryDate, notes, cfg.sourceSubtype]);

  // ------- Render guard ----------------------------------------------------
  if (!open) return null;

  const isFuture = entryDate > today();
  const { Icon } = cfg;

  // ------- Render ----------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-white rounded-sm max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div
          className="p-5 border-b border-gray-200 flex items-start justify-between"
          style={{ background: cfg.headerBg }}
        >
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0 ${cfg.iconTileCls}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: '#1e3d60' }}>
                {cfg.title}
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">{cfg.subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-gray-500 hover:text-gray-700 p-1 rounded-sm hover:bg-white/60"
            disabled={saving}
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-[13px]">

          {/* Fetch error */}
          {fetchError && (
            <div className="border border-rose-200 bg-rose-50 rounded-sm p-3 text-[12px] text-rose-700">
              ⚠ {fetchError}
            </div>
          )}

          {/* From + To — 2 col grid */}
          <div className="grid grid-cols-2 gap-4">

            {/* FROM */}
            <div>
              <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
                Dari akun *
              </label>
              {cfg.sourceLocked ? (
                /* Locked: sub-card display */
                <div className="border border-[#c7d7f5] bg-[#fafbff] rounded-sm px-3 py-2 text-[12px]">
                  {accountLabel(sourceAccount)}
                  <span className="ml-2 font-mono text-gray-500 text-[11px]">
                    Rp {new Intl.NumberFormat('id-ID').format(sourceAccount.current_balance)}
                  </span>
                </div>
              ) : (
                <select
                  value={fromId}
                  onChange={(e) => handleFromChange(e.target.value)}
                  disabled={saving}
                  className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white disabled:opacity-60"
                >
                  {sourceList.length === 0 && (
                    <option value="">— Tidak ada akun tersedia —</option>
                  )}
                  {sourceList.map((a) => (
                    <option key={a.cash_account_id} value={a.cash_account_id}>
                      {accountLabel(a)} · Rp {new Intl.NumberFormat('id-ID').format(a.current_balance)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* TO */}
            <div>
              <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
                Ke akun *
              </label>
              {cfg.destLocked ? (
                /* Locked: sub-card display */
                <div className="border border-[#c7d7f5] bg-[#fafbff] rounded-sm px-3 py-2 text-[12px]">
                  {accountLabel(sourceAccount)}
                  <span className="ml-2 font-mono text-gray-500 text-[11px]">
                    Rp {new Intl.NumberFormat('id-ID').format(sourceAccount.current_balance)}
                  </span>
                </div>
              ) : (
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  disabled={saving}
                  className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 bg-white disabled:opacity-60"
                >
                  {destList.length === 0 && (
                    <option value="">— Tidak ada akun tersedia —</option>
                  )}
                  {destList.map((a) => (
                    <option key={a.cash_account_id} value={a.cash_account_id}>
                      {accountLabel(a)} · Rp {new Intl.NumberFormat('id-ID').format(a.current_balance)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Amount + Date — 2 col grid */}
          <div className="grid grid-cols-2 gap-4">
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
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm text-right font-bold focus:outline-none focus:ring-2 focus:ring-[#012749]/30 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
                Tanggal *
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                disabled={saving}
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 disabled:opacity-60"
              />
              {isFuture && (
                <p className="text-[11px] text-amber-700 mt-1">
                  ⚠ Tanggal di masa depan — entry tetap akan dicatat
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Keterangan
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="Mis. pindah dana untuk bayar supplier besok"
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#012749]/30 disabled:opacity-60"
            />
          </div>

          {/* Proof upload placeholder */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Bukti transfer (opsional)
            </label>
            <div
              className="border border-[#c7d7f5] bg-[#fafbff] rounded-sm p-4 text-center text-[12px] text-gray-500"
              style={{ borderStyle: 'dashed' }}
            >
              <UploadCloud className="w-6 h-6 mx-auto text-blue-400 mb-1" />
              <div>
                Drag-drop atau{' '}
                <span className="text-blue-700 font-bold cursor-pointer">pilih file</span>
              </div>
            </div>
          </div>

          {/* JE Preview */}
          {previewLines.length > 0 && (
            <JournalEntryPreview lines={previewLines} />
          )}
          {previewLines.length === 0 && (
            <div className="je-preview p-4 text-[12px] text-amber-800 text-center">
              Isi jumlah dan pilih akun untuk melihat preview journal entry
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="border border-[#c7d7f5] bg-white text-[#1e3d60] rounded-full text-xs font-bold px-4 py-2 hover:bg-[#eff4ff] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#012749] text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-[#01365e] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : 'Submit Journal Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
