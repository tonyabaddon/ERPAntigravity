/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, FileDown, Grid, BookOpen } from 'lucide-react';
import {
  fetchGeneralLedger,
  fetchCoaTree,
} from '../../../lib/akuntansi/glQueries';
import type { CoaTreeRow } from '../../../lib/akuntansi/glQueries';
import type { GeneralLedgerRow, AccountType, NormalBalance } from '../../../lib/akuntansi/types';
import { formatRp, wibDateString } from '../../../lib/format';
import { captureError } from '../../../lib/captureError';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BukuBesarTabProps {
  initialAccountId: string | null;
  onBackToTB?: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type PeriodPreset = 'bulan-ini' | '30-hari' | 'tahun-ini';

interface PeriodRange {
  fromDate: string;
  toDate: string;
}

// ─── Account-type display labels ─────────────────────────────────────────────

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASET: 'Aset',
  LIABILITAS: 'Liabilitas',
  MODAL: 'Modal',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'ASET',
  'LIABILITAS',
  'MODAL',
  'PENDAPATAN',
  'BEBAN',
];

// ─── Period helpers ───────────────────────────────────────────────────────────

function getMonthBounds(date: Date): PeriodRange {
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const firstDay = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1);
  const lastDay = new Date(wibNow.getFullYear(), wibNow.getMonth() + 1, 0);
  return {
    fromDate: wibDateString(firstDay),
    toDate: wibDateString(lastDay),
  };
}

function getLast30DaysBounds(date: Date): PeriodRange {
  const toDate = wibDateString(date);
  const from = new Date(date.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { fromDate: wibDateString(from), toDate };
}

function getYearBounds(date: Date): PeriodRange {
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return {
    fromDate: `${wibNow.getFullYear()}-01-01`,
    toDate: `${wibNow.getFullYear()}-12-31`,
  };
}

function periodsFromPreset(preset: PeriodPreset): PeriodRange {
  const now = new Date();
  switch (preset) {
    case 'bulan-ini':
      return getMonthBounds(now);
    case '30-hari':
      return getLast30DaysBounds(now);
    case 'tahun-ini':
      return getYearBounds(now);
  }
}

// ─── Indonesian month name helper ─────────────────────────────────────────────

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function idMonthYear(isoDate: string): string {
  const parts = isoDate.split('-');
  const year = parts[0] ?? '';
  const month = parseInt(parts[1] ?? '1', 10);
  return `${ID_MONTHS[month - 1] ?? ''} ${year}`;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatEntryDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

function formatAmount(n: number): string {
  if (n === 0) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

function formatNum(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

// ─── Stat calculations ────────────────────────────────────────────────────────

/**
 * Compute Saldo Awal from the first row in the filtered period.
 *
 * The general_ledger view computes running_balance as a window function
 * partitioned by account_id across ALL entries (not just the filtered range).
 * So the first row inside the date window already carries the full cumulative
 * balance up to and including that row.
 *
 * Saldo Awal = running_balance of first row MINUS that row's own contribution.
 * For DEBIT-normal: contribution = debit - credit
 * For CREDIT-normal: contribution = credit - debit
 */
function computeSaldoAwal(rows: GeneralLedgerRow[], normalBalance: NormalBalance): number {
  if (rows.length === 0) return 0;
  const first = rows[0]!;
  if (normalBalance === 'DEBIT') {
    return first.running_balance - (first.debit - first.credit);
  } else {
    return first.running_balance - (first.credit - first.debit);
  }
}

/**
 * Net movement for the period.
 * DEBIT-normal: positive = debit flow (increase).
 * CREDIT-normal: positive = credit flow (increase).
 */
function computeMovement(rows: GeneralLedgerRow[], normalBalance: NormalBalance): number {
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  if (normalBalance === 'DEBIT') return totalDebit - totalCredit;
  return totalCredit - totalDebit;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Component ────────────────────────────────────────────────────────────────

export default function BukuBesarTab({
  initialAccountId,
  onBackToTB,
  showToast,
}: BukuBesarTabProps): React.ReactElement {
  // COA picker state
  const [coaAccounts, setCoaAccounts] = useState<CoaTreeRow[]>([]);
  const [loadingCoa, setLoadingCoa] = useState(true);

  // Selected account
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  const [accountMeta, setAccountMeta] = useState<CoaTreeRow | null>(null);

  // Period filter
  const [activePreset, setActivePreset] = useState<PeriodPreset>('bulan-ini');
  const [period, setPeriod] = useState<PeriodRange>(() => periodsFromPreset('bulan-ini'));

  // Ledger rows
  const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Load COA on mount ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoadingCoa(true);
    fetchCoaTree(false)
      .then(data => {
        if (!cancelled) setCoaAccounts(data);
      })
      .catch(err => {
        captureError(err, { feature: 'akuntansi_buku_besar', action: 'fetch_coa_tree' });
        if (!cancelled) showToast('Gagal memuat daftar akun', 'warning');
      })
      .finally(() => {
        if (!cancelled) setLoadingCoa(false);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync accountMeta when coaAccounts or accountId changes ─────────────────

  useEffect(() => {
    if (!accountId || coaAccounts.length === 0) {
      setAccountMeta(null);
      return;
    }
    const found = coaAccounts.find(a => a.id === accountId) ?? null;
    setAccountMeta(found);
  }, [accountId, coaAccounts]);

  // ── Load ledger rows ────────────────────────────────────────────────────────

  const loadLedger = useCallback(
    (acctId: string, fromDate: string, toDate: string) => {
      setLoadingRows(true);
      setVisibleCount(PAGE_SIZE);
      fetchGeneralLedger(acctId, fromDate, toDate)
        .then(data => setRows(data))
        .catch(err => {
          captureError(err, { feature: 'akuntansi_buku_besar', action: 'fetch_general_ledger' });
          showToast('Gagal memuat buku besar', 'warning');
        })
        .finally(() => setLoadingRows(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (accountId) {
      loadLedger(accountId, period.fromDate, period.toDate);
    } else {
      setRows([]);
    }
  }, [accountId, period, loadLedger]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleAccountChange(id: string) {
    setAccountId(id || null);
  }

  function handlePreset(preset: PeriodPreset) {
    setActivePreset(preset);
    setPeriod(periodsFromPreset(preset));
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const normalBalance: NormalBalance = accountMeta?.normal_balance ?? 'DEBIT';

  const saldoAwal = computeSaldoAwal(rows, normalBalance);
  const movement = computeMovement(rows, normalBalance);
  const saldoAkhir = rows.length > 0 ? (rows[rows.length - 1]?.running_balance ?? 0) : 0;

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  // Subtitle parts
  const typeLabel = accountMeta?.account_type
    ? ACCOUNT_TYPE_LABELS[accountMeta.account_type as AccountType] ?? accountMeta.account_type
    : '';
  const subtypeLabel = accountMeta?.account_subtype ?? '';
  const normalBalanceLabel = normalBalance === 'DEBIT' ? 'Debit' : 'Kredit';
  const periodeLabel = idMonthYear(period.fromDate);

  // COA grouped by type for <optgroup>
  const groupedCoa = ACCOUNT_TYPE_ORDER.map(type => ({
    type,
    label: ACCOUNT_TYPE_LABELS[type],
    accounts: coaAccounts.filter(a => a.account_type === type),
  })).filter(g => g.accounts.length > 0);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-sm border border-[#c7d7f5] bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="p-6 border-b border-gray-200">
        {/* Back link */}
        {onBackToTB && (
          <button
            onClick={onBackToTB}
            className="text-[11px] text-blue-700 hover:underline inline-flex items-center gap-1 mb-3"
          >
            <ArrowLeft className="w-3 h-3" />
            Trial Balance
          </button>
        )}

        {/* Title */}
        {accountMeta ? (
          <>
            <h3 className="text-xl font-extrabold mt-1" style={{ color: '#1e3d60' }}>
              <BookOpen className="inline w-5 h-5 mr-2 text-blue-700" />
              Buku Besar:{' '}
              <span className="font-mono text-blue-700">{accountMeta.account_code}</span>{' '}
              {accountMeta.account_name}
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              {[
                typeLabel && subtypeLabel
                  ? `${typeLabel} / ${subtypeLabel}`
                  : typeLabel || subtypeLabel,
                `normal balance: ${normalBalanceLabel}`,
                `periode ${periodeLabel}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </>
        ) : (
          <h3 className="text-xl font-extrabold mt-1" style={{ color: '#1e3d60' }}>
            <BookOpen className="inline w-5 h-5 mr-2 text-blue-700" />
            Buku Besar
          </h3>
        )}
      </div>

      {/* ── Controls bar ── */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
        {/* Account picker */}
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <label className="text-[11px] font-bold text-gray-600 whitespace-nowrap">
            Akun:
          </label>
          <select
            className="border border-[#c7d7f5] rounded-sm px-3 py-1.5 text-xs text-[#43474e] bg-white flex-1 focus:outline-none focus:ring-2 focus:ring-[#c7d7f5]"
            value={accountId ?? ''}
            onChange={e => handleAccountChange(e.target.value)}
            disabled={loadingCoa}
          >
            <option value="">
              {loadingCoa ? 'Memuat...' : '— Pilih akun —'}
            </option>
            {groupedCoa.map(group => (
              <optgroup key={group.type} label={group.label}>
                {group.accounts.map(acct => (
                  <option key={acct.id} value={acct.id}>
                    {acct.account_code} — {acct.account_name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Period presets */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-gray-600">Periode:</span>
          {(
            [
              { key: 'bulan-ini', label: 'Bulan ini' },
              { key: '30-hari', label: '30 hari' },
              { key: 'tahun-ini', label: 'Tahun ini' },
            ] as { key: PeriodPreset; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={`text-[11px] font-bold px-3.5 py-1.5 rounded-full transition-colors ${
                activePreset === key
                  ? 'bg-[#012749] text-white'
                  : 'border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff]'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => showToast('Custom date picker hadir di Phase 2', 'info')}
            className="text-[11px] font-bold px-3.5 py-1.5 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors"
          >
            Custom...
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="p-6">
        {!accountId ? (
          /* No account selected */
          <div className="py-16 text-center text-[13px] text-gray-500">
            <BookOpen className="w-8 h-8 mx-auto mb-3 text-gray-300" />
            <p>Pilih akun di atas untuk melihat Buku Besar.</p>
          </div>
        ) : (
          <>
            {/* ── 3-stat sub-cards ── */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {/* Saldo Awal */}
              <div
                className="p-3 rounded-sm"
                style={{ border: '1px solid #c7d7f5', background: '#fafbff' }}
              >
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">
                  Saldo Awal
                </div>
                <div className="text-lg font-extrabold" style={{ color: '#1e3d60' }}>
                  {formatRp(saldoAwal)}
                </div>
              </div>

              {/* Movement */}
              <div
                className="p-3 rounded-sm"
                style={{ border: '1px solid #c7d7f5', background: '#fafbff' }}
              >
                <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">
                  Movement bulan ini
                </div>
                <div
                  className={`text-lg font-extrabold ${
                    movement >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {movement >= 0 ? '+ ' : '− '}
                  {formatRp(Math.abs(movement))}
                </div>
              </div>

              {/* Saldo Akhir — highlighted emerald */}
              <div
                className="p-3 rounded-sm"
                style={{ background: '#d1fae5', border: '1px solid #6ee7b7' }}
              >
                <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold mb-1">
                  Saldo Akhir
                </div>
                <div className="text-lg font-extrabold text-emerald-700">
                  {formatRp(saldoAkhir)}
                </div>
              </div>
            </div>

            {/* ── Ledger table ── */}
            <div
              className="rounded-sm overflow-hidden"
              style={{ border: '1px solid #c7d7f5' }}
            >
              {loadingRows ? (
                <div className="py-16 text-center text-[13px] text-gray-500">
                  Memuat buku besar...
                </div>
              ) : rows.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-gray-500">
                  <BookOpen className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                  <p>Belum ada transaksi di akun ini untuk periode ini.</p>
                </div>
              ) : (
                <>
                  <table className="w-full text-[12px]">
                    <thead style={{ background: '#eff4ff' }}>
                      <tr className="text-[10px] uppercase font-extrabold text-gray-600">
                        <th className="text-left py-2 px-3">Tanggal</th>
                        <th className="text-left py-2 px-3">No. Entry</th>
                        <th className="text-left py-2 px-3">Keterangan</th>
                        <th className="text-right py-2 px-3">Debit</th>
                        <th className="text-right py-2 px-3">Kredit</th>
                        <th className="text-right py-2 px-3">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, idx) => (
                        <tr
                          key={`${row.entry_id}-${row.side}-${idx}`}
                          className="border-t border-gray-100 hover:bg-blue-50/30"
                        >
                          <td className="py-2 px-3 font-mono text-gray-600">
                            {formatEntryDate(row.entry_date)}
                          </td>
                          <td className="py-2 px-3 font-mono text-blue-700">
                            {row.entry_number}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {row.line_description ?? row.entry_description}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-700">
                            {formatAmount(row.debit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-rose-700">
                            {formatAmount(row.credit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-blue-700">
                            {formatNum(row.running_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot
                      className="border-t-2"
                      style={{ background: '#eff4ff', borderColor: '#1e40af' }}
                    >
                      <tr
                        className="font-extrabold"
                        style={{ color: '#012749' }}
                      >
                        <td colSpan={3} className="py-3 px-3 text-right text-[11px] uppercase tracking-wide">
                          TOTAL {periodeLabel.toUpperCase()}
                        </td>
                        <td className="py-3 px-3 text-right text-emerald-700">
                          {formatNum(totalDebit)}
                        </td>
                        <td className="py-3 px-3 text-right text-rose-700">
                          {formatNum(totalCredit)}
                        </td>
                        <td className="py-3 px-3 text-right text-blue-700">
                          {formatRp(saldoAkhir)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {/* Pagination */}
                  <div className="px-6 py-3 text-[11px] text-center text-gray-500">
                    Menampilkan {Math.min(visibleCount, rows.length)} dari {rows.length}
                    {hasMore && (
                      <>
                        {' · '}
                        <button
                          onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                          className="text-blue-700 font-bold hover:underline"
                        >
                          Muat lebih banyak ↓
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Export buttons ── */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => showToast('Export PDF hadir di Phase 4 Laporan', 'info')}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3.5 py-1.5 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors"
              >
                <FileDown className="w-3.5 h-3.5" />
                PDF Buku Besar
              </button>
              <button
                onClick={() => showToast('Export Excel hadir di Phase 4 Laporan', 'info')}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3.5 py-1.5 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors"
              >
                <Grid className="w-3.5 h-3.5" />
                Excel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
