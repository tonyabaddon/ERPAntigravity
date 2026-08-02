/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, ArrowDownCircle } from 'lucide-react';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { recordWalletSpend } from '../../../lib/akuntansi/manualEntry';
import { supabase } from '../../../lib/supabaseClient';
import JournalEntryPreview from './JournalEntryPreview';
import type { JEPreviewLine } from './JournalEntryPreview';
import { wibDateString } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WalletSpendModalProps {
  open: boolean;
  walletAccount: CashAccountBalance;
  onClose: () => void;
  onPosted: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface SpendingCategory {
  label: string;
  bebanCode: string;
}

interface CoaAccountInfo {
  id: string;
  account_code: string;
  account_name: string;
}

interface Order {
  id: string;
  customer_name: string;
  total: number;
}

// ---------------------------------------------------------------------------
// Hardcoded category list
// ---------------------------------------------------------------------------

const SPENDING_CATEGORIES: SpendingCategory[] = [
  { label: 'Lalamove ongkir customer (link Order)', bebanCode: '5-2500' },
  { label: 'Lalamove ongkir promo (cover sendiri)', bebanCode: '5-2400' },
  { label: 'Logistik internal (antar gudang)', bebanCode: '5-2500' },
  { label: 'Lainnya', bebanCode: '5-2950' },
];

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
  const emoji = acc.account_type === 'E_WALLET' ? '👛' : '?';
  const code = acc.account_code ?? '';
  return `${emoji} ${code ? code + ' · ' : ''}${acc.internal_label}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WalletSpendModal({
  open,
  walletAccount,
  onClose,
  onPosted,
  showToast,
}: WalletSpendModalProps): React.ReactElement | null {
  // ------- form state -------------------------------------------------------
  const [coaLookup, setCoaLookup] = useState<Map<string, CoaAccountInfo>>(new Map());
  const [orders, setOrders] = useState<Order[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amount, setAmount] = useState<number>(0);
  const [entryDate, setEntryDate] = useState<string>(today());
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // ------- Load COA and orders on open ---------w----------------------------
  useEffect(() => {
    if (!open) return;

    // Reset form state
    setSelectedCategory('');
    setSelectedOrderId('');
    setAmountDisplay('');
    setAmount(0);
    setEntryDate(today());
    setNotes('');
    setSaving(false);
    setFetchError(null);

    // Fetch COA accounts for all spending categories
    const bebanCodes = Array.from(
      new Set(SPENDING_CATEGORIES.map((c) => c.bebanCode)),
    );

    Promise.all([
      supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name')
        .in('account_code', bebanCodes)
        .eq('is_active', true)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          const lookup = new Map<string, CoaAccountInfo>();
          if (data) {
            data.forEach((row) => {
              lookup.set(row.account_code, row);
            });
          }
          setCoaLookup(lookup);
        }),
      supabase
        .from('orders')
        .select('id, customer_name, total')
        .in('status', ['INVOICE', 'INVOICE_TEMPO'])
        .gt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          setOrders(data ?? []);
        }),
    ]).catch((e: unknown) => {
      const msg =
        e instanceof Error ? e.message : 'Gagal memuat data spending dan order';
      setFetchError(msg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ------- Resolve selected category's COA info -----------------------------
  const selectedCategoryObj = SPENDING_CATEGORIES.find(
    (c) => c.label === selectedCategory,
  );
  const selectedBebanCode = selectedCategoryObj?.bebanCode ?? '';
  const selectedBebanInfo = coaLookup.get(selectedBebanCode);

  // ------- Resolve selected order info ----------------------------------------
  const selectedOrder = selectedOrderId
    ? orders.find((o) => o.id === selectedOrderId)
    : undefined;

  // ------- Journal Entry Preview lines -----------------------------------
  const previewLines: JEPreviewLine[] = [];
  if (amount > 0 && selectedBebanInfo) {
    // Debit: spending account (beban)
    previewLines.push({
      accountCode: selectedBebanInfo.account_code,
      accountName: selectedBebanInfo.account_name,
      debit: amount,
      credit: 0,
    });
    // Credit: wallet account
    previewLines.push({
      accountCode: walletAccount.account_code ?? '',
      accountName: walletAccount.internal_label,
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
    if (!selectedCategory) return 'Kategori spending wajib dipilih';
    if (!selectedBebanInfo) return 'Akun beban tidak ditemukan';
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
      const result = await recordWalletSpend({
        walletCashId: walletAccount.cash_account_id,
        bebanCoaId: selectedBebanInfo?.id ?? '',
        amount,
        entryDate,
        orderId: selectedOrderId || null,
        notes: notes.trim() || null,
      });
      showToast(
        `✓ Spending Wallet dicatat — ${result.entry_number}`,
        'success',
      );
      onPosted();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Gagal mencatat spending wallet';
      showToast(msg, 'warning');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    walletAccount.cash_account_id,
    selectedBebanInfo?.id,
    amount,
    entryDate,
    selectedOrderId,
    notes,
  ]);

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
          style={{ background: '#fee2e2' }}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0 bg-rose-300 text-rose-700">
              <ArrowDownCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold" style={{ color: '#be123c' }}>
                Catat Spending Wallet
              </h2>
              <p className="text-xs text-rose-700 mt-0.5">
                OUT only · saat dipakai
              </p>
            </div>
          </div>
          <button
            onClick={() => !saving && onClose()}
            className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-white/60"
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
            <div className="border border-rose-200 bg-rose-50 rounded p-3 text-xs text-rose-700">
              ⚠ {fetchError}
            </div>
          )}

          {/* Wallet info (LOCKED) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
              Wallet *
            </label>
            <div className="border border-rose-200 bg-rose-50 rounded px-3 py-2 text-xs">
              {accountLabel(walletAccount)}
              <span className="ml-2 font-mono text-gray-600 text-caleo-11">
                Rp {new Intl.NumberFormat('id-ID').format(walletAccount.current_balance)}
              </span>
            </div>
          </div>

          {/* Kategori spending */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
              Kategori spending *
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 bg-white disabled:opacity-60"
            >
              <option value="">— Pilih kategori —</option>
              {SPENDING_CATEGORIES.map((cat) => (
                <option key={cat.label} value={cat.label}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Link ke Order (OPTIONAL) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
              Link ke Order (opsional)
            </label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              disabled={saving}
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 bg-white disabled:opacity-60"
            >
              <option value="">— None —</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id.slice(0, 8)} · {order.customer_name} ·{' '}
                  {formatRupiah(order.total)}
                </option>
              ))}
            </select>
            <p className="text-caleo-10 text-gray-500 mt-1">
              Untuk tracking ongkir customer dengan order tertentu.
            </p>
          </div>

          {/* Jumlah */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
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
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
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

          {/* Catatan (OPTIONAL) */}
          <div>
            <label className="block font-bold mb-1" style={{ color: '#be123c' }}>
              Catatan (opsional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              rows={2}
              placeholder="Mis. topup wallet Shopee untuk promo bulan ini"
              className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2/50 disabled:opacity-60 resize-none"
            />
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
          {previewLines.length === 0 && (amount === 0 || !selectedCategory) && (
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
            className="bg-rose-600 text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-rose-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : 'Catat Spending'}
          </button>
        </div>
      </div>
    </div>
  );
}
