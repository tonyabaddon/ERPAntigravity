/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Scale, KeyRound, X, Save } from 'lucide-react';
import PinPad from '../../ui/PinPad';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { fetchAdjustmentCounterparts } from '../../../lib/akuntansi/coaQueries';
import type { CoaOption } from '../../../lib/akuntansi/coaQueries';
import { recordBalanceAdjustment } from '../../../lib/akuntansi/manualEntry';
import type { AdjustmentDirection } from '../../../lib/akuntansi/manualEntry';
import JournalEntryPreview from './JournalEntryPreview';
import type { JEPreviewLine } from './JournalEntryPreview';
import { wibDateString } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BalanceAdjustmentModalProps {
  open: boolean;
  cashAccount: CashAccountBalance;
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

/** Get account display label */
function accountLabel(acc: CashAccountBalance): string {
  const emoji =
    acc.account_type === 'BANK' ? '🏦' : acc.account_type === 'KAS' ? '💵' : '👛';
  const code = acc.account_code ?? '';
  return `${emoji} ${code ? code + ' · ' : ''}${acc.internal_label}`;
}

/** Sort counterparts: preferred type floats to top */
function sortCounterparts(options: CoaOption[], direction: AdjustmentDirection): CoaOption[] {
  const preferredType = direction === 'UP' ? 'PENDAPATAN' : 'BEBAN';
  return [...options].sort((a, b) => {
    const aPreferred = a.account_type === preferredType ? 0 : 1;
    const bPreferred = b.account_type === preferredType ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return (a.account_code ?? '').localeCompare(b.account_code ?? '');
  });
}

// ---------------------------------------------------------------------------
// PIN_LENGTH constant
// ---------------------------------------------------------------------------

const PIN_LENGTH = 6;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BalanceAdjustmentModal({
  open,
  cashAccount,
  onClose,
  onPosted,
  showToast,
}: BalanceAdjustmentModalProps): React.ReactElement | null {
  // ------- form state -------------------------------------------------------
  const [direction, setDirection] = useState<AdjustmentDirection>('UP');
  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [counterparts, setCounterparts] = useState<CoaOption[]>([]);
  const [counterpartCoaId, setCounterpartCoaId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [entryDate, setEntryDate] = useState<string>(today());
  const [pin, setPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ------- load counterparts on open ----------------------------------------
  useEffect(() => {
    if (!open) return;

    // Reset form
    setDirection('UP');
    setAmountDisplay('');
    setAmount(0);
    setCounterpartCoaId('');
    setReason('');
    setEntryDate(today());
    setPin('');
    setPinError(null);
    setSaving(false);
    setFetchError(null);
    setCounterparts([]);

    fetchAdjustmentCounterparts()
      .then((data) => {
        setCounterparts(data);
        // Auto-select first option if available
        if (data.length > 0) {
          const sorted = sortCounterparts(data, 'UP');
          setCounterpartCoaId(sorted[0].id);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Gagal memuat daftar akun lawan';
        setFetchError(msg);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-sort and reset selection when direction changes
  const handleDirectionChange = useCallback((newDir: AdjustmentDirection) => {
    setDirection(newDir);
    if (counterparts.length > 0) {
      const sorted = sortCounterparts(counterparts, newDir);
      setCounterpartCoaId(sorted[0].id);
    }
  }, [counterparts]);

  // ------- Sorted counterparts for display -----------------------------------
  const sortedCounterparts = sortCounterparts(counterparts, direction);

  // ------- Resolved selected counterpart ------------------------------------
  const selectedCounterpart: CoaOption | undefined =
    counterpartCoaId
      ? counterparts.find((c) => c.id === counterpartCoaId)
      : undefined;

  // ------- Journal Entry Preview lines -------------------------------------
  const previewLines: JEPreviewLine[] = [];
  if (amount > 0 && selectedCounterpart) {
    const cashCode = cashAccount.account_code ?? '';
    const cashName = cashAccount.internal_label;
    const cpCode = selectedCounterpart.account_code ?? '';
    const cpName = selectedCounterpart.account_name;

    if (direction === 'UP') {
      // D cash / K counterpart
      previewLines.push({
        accountCode: cashCode,
        accountName: cashName,
        debit: amount,
        credit: 0,
      });
      previewLines.push({
        accountCode: cpCode,
        accountName: cpName,
        debit: 0,
        credit: amount,
      });
    } else {
      // D counterpart / K cash
      previewLines.push({
        accountCode: cpCode,
        accountName: cpName,
        debit: amount,
        credit: 0,
      });
      previewLines.push({
        accountCode: cashCode,
        accountName: cashName,
        debit: 0,
        credit: amount,
      });
    }
  }

  // ------- Amount field handlers -------------------------------------------
  function handleAmountFocus() {
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
  const canSubmit =
    amount > 0 &&
    reason.trim().length >= 10 &&
    counterpartCoaId !== '' &&
    pin.length === PIN_LENGTH &&
    !saving;

  // ------- Submit -----------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    if (amount <= 0) {
      showToast('Jumlah harus lebih dari Rp 0', 'warning');
      return;
    }
    if (reason.trim().length < 10) {
      showToast('Alasan minimal 10 karakter', 'warning');
      return;
    }
    if (!counterpartCoaId) {
      showToast('Pilih akun lawan terlebih dahulu', 'warning');
      return;
    }
    if (pin.length !== PIN_LENGTH) {
      showToast('Masukkan 6 digit PIN Owner', 'warning');
      return;
    }

    setSaving(true);
    setPinError(null);
    try {
      const result = await recordBalanceAdjustment({
        cashAccountId: cashAccount.cash_account_id,
        direction,
        amount,
        counterpartCoaId,
        reason: reason.trim(),
        pin,
        entryDate,
      });
      showToast(`✓ Penyesuaian dicatat — ${result.entry_number}`, 'success');
      onPosted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mencatat penyesuaian';
      if (msg.startsWith('INVALID_PIN')) {
        setPin('');
        setPinError('PIN salah — coba lagi');
        showToast('PIN salah', 'warning');
      } else if (msg.startsWith('PIN_LOCKED')) {
        showToast('Akun terkunci 10 menit', 'warning');
        onClose();
      } else if (msg.startsWith('INVALID_REASON')) {
        showToast('Alasan minimal 10 karakter', 'warning');
      } else {
        showToast(msg, 'warning');
      }
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAccount.cash_account_id, direction, amount, counterpartCoaId, reason, pin, entryDate]);

  // ------- Render guard ----------------------------------------------------
  if (!open) return null;

  const reasonOk = reason.trim().length >= 10;

  // ------- Render ----------------------------------------------------------
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="bg-white rounded-sm max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">

        {/* Header — rose themed */}
        <div
          className="p-5 border-b border-red-100 flex items-start justify-between"
          style={{ background: '#fee2e2' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-sm flex items-center justify-center flex-shrink-0"
              style={{ background: '#fecaca', color: '#991b1b' }}
            >
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-red-900">
                Penyesuaian Saldo
              </h2>
              <p className="text-xs text-red-700 mt-0.5">
                Defensif · PIN-gate · reason ≥10 char wajib
              </p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-red-400 hover:text-red-700 p-1 rounded-sm hover:bg-white/60"
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

          {/* 1. Warning sub-card */}
          <div
            className="rounded-sm border p-3"
            style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
          >
            <p className="text-[12px] text-amber-900">
              ⚠ <strong>Owner PIN dibutuhkan.</strong> Audit log + timestamp + reason permanent.
            </p>
          </div>

          {/* 2. Account info sub-card */}
          <div className="border border-slate-200 rounded-sm bg-[#fafbff] p-3 text-[12px]">
            <strong>Akun:</strong>{' '}
            {cashAccount.account_code && (
              <span className="font-mono">{cashAccount.account_code}</span>
            )}{' '}
            {cashAccount.internal_label}
            {' · '}
            <strong>Saldo sistem: Rp {new Intl.NumberFormat('id-ID').format(cashAccount.current_balance)}</strong>
          </div>

          {/* 3. Direction + Amount grid */}
          <div className="grid grid-cols-2 gap-3">
            {/* Direction toggle */}
            <div>
              <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
                Arah koreksi *
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleDirectionChange('UP')}
                  disabled={saving}
                  className={`flex-1 py-2 rounded-sm border font-bold text-[12px] transition-colors disabled:opacity-60 ${
                    direction === 'UP'
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  + Tambah
                </button>
                <button
                  type="button"
                  onClick={() => handleDirectionChange('DOWN')}
                  disabled={saving}
                  className={`flex-1 py-2 rounded-sm border font-bold text-[12px] transition-colors disabled:opacity-60 ${
                    direction === 'DOWN'
                      ? 'bg-rose-100 border-rose-300 text-rose-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  − Kurangi
                </button>
              </div>
            </div>

            {/* Amount */}
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
                className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm text-right font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 disabled:opacity-60"
              />
            </div>
          </div>

          {/* 4. Counterpart picker */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Counterpart account *
            </label>
            <select
              value={counterpartCoaId}
              onChange={(e) => setCounterpartCoaId(e.target.value)}
              disabled={saving || counterparts.length === 0}
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 bg-white disabled:opacity-60"
            >
              {counterparts.length === 0 && (
                <option value="">Memuat...</option>
              )}
              {sortedCounterparts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.account_code} {c.account_name}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Reason textarea */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#1e3d60' }}>
              Alasan *{' '}
              <span className="text-[10px] font-normal text-gray-500">(min 10 char)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              rows={2}
              placeholder="Mis. cek m-banking saldo BCA Rp 12.550.000, koreksi +50rb (bunga deposito)"
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 disabled:opacity-60 resize-none"
            />
            <p className={`text-[10px] mt-0.5 ${reasonOk ? 'text-gray-500' : 'text-red-500'}`}>
              {reason.length} / 10 min
            </p>
          </div>

          {/* 6. JE Preview */}
          {previewLines.length > 0 ? (
            <JournalEntryPreview lines={previewLines} />
          ) : (
            <div className="je-preview p-4 text-[12px] text-amber-800 text-center">
              Isi jumlah dan pilih akun lawan untuk melihat preview journal entry
            </div>
          )}

          {/* 7. Owner PIN block — uses shared PinPad for cross-flow consistency */}
          <div className="rounded-sm p-4 bg-[var(--color-caleo-primary)]">
            <div className="text-[11px] uppercase tracking-widest text-blue-200 font-extrabold mb-3 flex items-center gap-2">
              <KeyRound className="w-3.5 h-3.5" />
              Owner PIN
            </div>
            <div className="bg-white rounded-sm">
              <PinPad
                compact
                title=""
                onPinChange={setPin}
                externalError={pinError}
                disabled={saving}
              />
            </div>
            <p className="text-[10px] text-blue-200 mt-2">3 salah → akun terkunci 10 menit</p>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="border border-[#c7d7f5] bg-white text-[#1e3d60] rounded-full text-xs font-bold px-4 py-2 hover:bg-[#eff4ff] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-rose-600 text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : 'Submit Penyesuaian'}
          </button>
        </div>
      </div>
    </div>
  );
}
