/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  FileDown,
  Grid,
  Settings2,
  AlertTriangle,
  List,
  Hourglass,
  Info,
} from 'lucide-react';
import { fetchCashAccountBalances, fetchAccountLedger } from '../../lib/kasbank/service';
import { supabase } from '../../lib/supabaseClient';
import type { CashAccountBalance } from '../../lib/kasbank/types';
import type { GeneralLedgerRow, JournalSource } from '../../lib/akuntansi/types';
import { formatRp, wibDateString } from '../../lib/format';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AccountDetailScreenProps {
  cashAccountId: string;
  currentUser: { name: string; role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

type PeriodPreset = 'bulan-ini' | '30-hari' | 'tahun-ini';

function getMonthBounds(date: Date): { fromDate: string; toDate: string } {
  // First day of current month in WIB
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const firstDay = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1);
  const lastDay = new Date(wibNow.getFullYear(), wibNow.getMonth() + 1, 0);
  return {
    fromDate: wibDateString(firstDay),
    toDate: wibDateString(lastDay),
  };
}

function getLast30DaysBounds(date: Date): { fromDate: string; toDate: string } {
  const toDate = wibDateString(date);
  const from = new Date(date.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { fromDate: wibDateString(from), toDate };
}

function getYearBounds(date: Date): { fromDate: string; toDate: string } {
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return {
    fromDate: `${wibNow.getFullYear()}-01-01`,
    toDate: `${wibNow.getFullYear()}-12-31`,
  };
}

function periodsFromPreset(preset: PeriodPreset): { fromDate: string; toDate: string } {
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

// ---------------------------------------------------------------------------
// Indonesian month abbreviations
// ---------------------------------------------------------------------------

const ID_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGT', 'SEP', 'OKT', 'NOV', 'DES'];

function idMonthYear(isoDate: string): string {
  // isoDate = YYYY-MM-DD
  const parts = isoDate.split('-');
  const year = parts[0];
  const month = parseInt(parts[1] ?? '1', 10);
  return `${ID_MONTHS[month - 1] ?? ''} ${year}`;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Format date from ISO to "DD/MM HH:mm" (only date part from entry_date) */
function formatEntryDate(isoDate: string): string {
  // entry_date is YYYY-MM-DD, no time component in GeneralLedgerRow
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

function formatAmount(n: number): string {
  if (n === 0) return '—';
  return new Intl.NumberFormat('id-ID').format(n);
}

// ---------------------------------------------------------------------------
// Status chip logic — derived from source_type (no status field in GL view)
// ---------------------------------------------------------------------------

type StatusVariant = 'cleared' | 'recon';

const ADJUSTMENT_SOURCES: JournalSource[] = ['ADJUSTMENT', 'STOCK_OPNAME_ADJ'];

function getStatusVariant(sourceType: JournalSource): StatusVariant {
  if (ADJUSTMENT_SOURCES.includes(sourceType)) return 'recon';
  return 'cleared';
}

interface StatusChipProps {
  variant: StatusVariant;
}

function StatusChip({ variant }: StatusChipProps) {
  if (variant === 'recon') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-violet-100 text-violet-800">
        Recon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-100 text-emerald-800">
      Cleared
    </span>
  );
}

// ---------------------------------------------------------------------------
// COA metadata (fetched once after we know coa_account_id)
// ---------------------------------------------------------------------------

interface CoaMeta {
  account_type: string;
  account_subtype: string | null;
  normal_balance: string;
}

async function fetchCoaMeta(coaAccountId: string): Promise<CoaMeta | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('account_type, account_subtype, normal_balance')
    .eq('id', coaAccountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CoaMeta;
}

// ---------------------------------------------------------------------------
// Page size for client-side pagination
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AccountDetailScreen({
  cashAccountId,
  showToast,
  onBack,
}: AccountDetailScreenProps) {
  // Account balance meta
  const [balance, setBalance] = useState<CashAccountBalance | null>(null);
  const [coaMeta, setCoaMeta] = useState<CoaMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Ledger rows
  const [rows, setRows] = useState<GeneralLedgerRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  // Period filter
  const [activePreset, setActivePreset] = useState<PeriodPreset>('bulan-ini');
  const [period, setPeriod] = useState(() => periodsFromPreset('bulan-ini'));

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Active tab
  const [activeTab, setActiveTab] = useState<'riwayat' | 'belum-cair' | 'info'>('riwayat');

  // ---------------------------------------------------------------------------
  // Load balance meta on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoadingMeta(true);
    fetchCashAccountBalances()
      .then(async (balances) => {
        const found = balances.find(b => b.cash_account_id === cashAccountId) ?? null;
        setBalance(found);
        if (found?.coa_account_id) {
          const meta = await fetchCoaMeta(found.coa_account_id);
          setCoaMeta(meta);
        }
      })
      .catch(err => {
        console.error('[AccountDetailScreen] fetchCashAccountBalances error', err);
        showToast('Gagal memuat data akun', 'warning');
      })
      .finally(() => setLoadingMeta(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAccountId]);

  // ---------------------------------------------------------------------------
  // Load ledger rows whenever period or coaAccountId changes
  // ---------------------------------------------------------------------------

  const loadLedger = useCallback(
    (coaAccountId: string, fromDate: string, toDate: string) => {
      setLoadingRows(true);
      setVisibleCount(PAGE_SIZE);
      fetchAccountLedger(coaAccountId, fromDate, toDate)
        .then(data => setRows(data))
        .catch(err => {
          console.error('[AccountDetailScreen] fetchAccountLedger error', err);
          showToast('Gagal memuat riwayat', 'warning');
        })
        .finally(() => setLoadingRows(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (balance?.coa_account_id) {
      loadLedger(balance.coa_account_id, period.fromDate, period.toDate);
    }
  }, [balance, period, loadLedger]);

  // ---------------------------------------------------------------------------
  // Period filter handlers
  // ---------------------------------------------------------------------------

  function handlePreset(preset: PeriodPreset) {
    setActivePreset(preset);
    setPeriod(periodsFromPreset(preset));
  }

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  // Footer totals (all loaded rows, not just visible page)
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  const finalBalance = rows.length > 0 ? (rows[rows.length - 1]?.running_balance ?? 0) : 0;

  // Footer label: "TOTAL JUN 2026 (cleared only)"
  const footerLabel = `TOTAL ${idMonthYear(period.fromDate)} (cleared only)`;

  // Subtitle parts
  const typeLabel = coaMeta?.account_type
    ? coaMeta.account_type.charAt(0).toUpperCase() + coaMeta.account_type.slice(1).toLowerCase()
    : '';
  const subtypeLabel = coaMeta?.account_subtype ?? '';
  const normalBalanceLabel = coaMeta?.normal_balance
    ? coaMeta.normal_balance.charAt(0).toUpperCase() + coaMeta.normal_balance.slice(1).toLowerCase()
    : 'Debit';

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loadingMeta) {
    return (
      <div className="p-8 text-[13px] text-[#43474e]">
        Memuat data akun...
      </div>
    );
  }

  if (!balance) {
    return (
      <div className="p-8">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-[#012749] font-bold hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Kas &amp; Bank
        </button>
        <p className="text-[13px] text-gray-500">Akun tidak ditemukan.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-5xl">
      {/* Hero header */}
      <div
        className="p-6 text-white"
        style={{ background: 'linear-gradient(135deg, #1e40af, #1e3a8a)' }}
      >
        {/* Back link */}
        <button
          onClick={onBack}
          className="text-[11px] text-blue-100 hover:underline inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Kas &amp; Bank
        </button>

        {/* Account title */}
        <h3 className="text-2xl font-extrabold mt-1">
          {balance.internal_label}{' '}
          {balance.account_code && (
            <span className="text-[14px] font-bold text-blue-200 font-mono ml-2">
              {balance.account_code}
            </span>
          )}
        </h3>

        {/* Subtitle */}
        <p className="text-[12px] text-blue-100 mt-1">
          {[
            typeLabel && subtypeLabel ? `${typeLabel} / ${subtypeLabel}` : typeLabel || subtypeLabel,
            balance.bank_code,
            balance.account_number,
            balance.account_holder,
            normalBalanceLabel ? `normal balance: ${normalBalanceLabel}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* 4-card stat row */}
        <div className="mt-4 grid grid-cols-4 gap-3 text-[12px]">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[10px] uppercase text-blue-100 mb-0.5">Saldo Awal</div>
            <div className="font-extrabold text-base">{formatRp(balance.opening_balance)}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[10px] uppercase text-blue-100 mb-0.5">Total Debit (in)</div>
            <div className="font-extrabold text-base text-emerald-200">
              + {formatRp(balance.total_debit)}
            </div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[10px] uppercase text-blue-100 mb-0.5">Total Kredit (out)</div>
            <div className="font-extrabold text-base text-rose-200">
              − {formatRp(balance.total_credit)}
            </div>
          </div>
          <div className="bg-white/15 rounded-xl p-3 ring-2 ring-emerald-300">
            <div className="text-[10px] uppercase text-emerald-100 mb-0.5">Saldo Akhir</div>
            <div className="font-extrabold text-base text-emerald-200">
              {formatRp(balance.current_balance)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 px-6 flex gap-1 overflow-x-auto bg-white">
        <button
          onClick={() => setActiveTab('riwayat')}
          className={`px-4 py-3 text-[13px] font-extrabold whitespace-nowrap transition-colors ${
            activeTab === 'riwayat'
              ? 'border-b-2 border-emerald-600 text-[#012749]'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <List className="inline w-3.5 h-3.5 mr-1" />
          Riwayat
          {rows.length > 0 && (
            <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-700">
              {rows.length}
            </span>
          )}
        </button>
        <button
          disabled
          className="px-4 py-3 text-[13px] font-bold text-gray-300 cursor-not-allowed whitespace-nowrap"
        >
          <Hourglass className="inline w-3.5 h-3.5 mr-1" />
          Belum Cair
          {balance.pending_in > 0 && (
            <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800">
              Phase 2
            </span>
          )}
        </button>
        <button
          disabled
          className="px-4 py-3 text-[13px] font-bold text-gray-300 cursor-not-allowed whitespace-nowrap"
        >
          <Info className="inline w-3.5 h-3.5 mr-1" />
          Info Akun
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'riwayat' && (
        <div className="bg-white">
          {/* Pending banner */}
          {balance.pending_in > 0 && (
            <div
              className="mx-6 mt-6 rounded-xl p-3 flex items-center gap-3 border"
              style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
            >
              <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <p className="text-[12px] text-amber-900">
                <strong>Saldo termasuk {formatRp(balance.pending_in)} marketplace PENDING.</strong>{' '}
                Transaksi PENDING belum dihitung di saldo cleared.
              </p>
            </div>
          )}

          {/* Filter bar */}
          <div className="px-6 py-4 flex items-center gap-3 text-[12px] flex-wrap">
            <span className="font-bold text-gray-600 text-xs">Periode:</span>

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

            {/* Export buttons */}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => showToast('Export PDF hadir di Phase 2', 'info')}
                className="text-[11px] font-bold px-3.5 py-1.5 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors inline-flex items-center gap-1.5"
              >
                <FileDown className="w-3 h-3" />
                PDF
              </button>
              <button
                onClick={() => showToast('Export Excel hadir di Phase 2', 'info')}
                className="text-[11px] font-bold px-3.5 py-1.5 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors inline-flex items-center gap-1.5"
              >
                <Grid className="w-3 h-3" />
                Excel
              </button>
            </div>
          </div>

          {/* Ledger table */}
          <div className="border-t border-gray-200">
            {loadingRows ? (
              <div className="p-8 text-center text-[13px] text-gray-500">
                Memuat riwayat...
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center text-[13px] text-gray-500">
                <List className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                <p>Belum ada transaksi dalam periode ini.</p>
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
                      <th className="text-center py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, idx) => {
                      const isAdjustment = ADJUSTMENT_SOURCES.includes(row.source_type);
                      const status = getStatusVariant(row.source_type);
                      const rowBg = isAdjustment
                        ? 'bg-amber-50/50 hover:bg-amber-50'
                        : 'hover:bg-blue-50/30';

                      return (
                        <tr
                          key={`${row.entry_id}-${row.side}-${idx}`}
                          className={`${rowBg} border-t border-gray-100`}
                        >
                          <td className="py-2 px-3 font-mono text-gray-600">
                            {formatEntryDate(row.entry_date)}
                          </td>
                          <td className="py-2 px-3 font-mono text-blue-700">
                            {row.entry_number}
                          </td>
                          <td className="py-2 px-3 text-gray-700">
                            {isAdjustment && (
                              <Settings2 className="inline w-3 h-3 mr-1 text-amber-600" />
                            )}
                            {row.line_description ?? row.entry_description}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-700">
                            {formatAmount(row.debit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-rose-700">
                            {formatAmount(row.credit)}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-blue-700">
                            {new Intl.NumberFormat('id-ID').format(row.running_balance)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <StatusChip variant={status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot
                    className="border-t-2"
                    style={{ background: '#eff4ff', borderColor: '#1e40af' }}
                  >
                    <tr className="font-extrabold" style={{ color: 'var(--color-primary)' }}>
                      <td colSpan={3} className="py-3 px-3 text-right text-[11px] uppercase tracking-wide">
                        {footerLabel}
                      </td>
                      <td className="py-3 px-3 text-right text-emerald-700">
                        {new Intl.NumberFormat('id-ID').format(totalDebit)}
                      </td>
                      <td className="py-3 px-3 text-right text-rose-700">
                        {new Intl.NumberFormat('id-ID').format(totalCredit)}
                      </td>
                      <td className="py-3 px-3 text-right text-blue-700">
                        {formatRp(finalBalance)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>

                {/* Pagination */}
                <div className="px-6 py-3 text-[11px] text-center text-gray-500">
                  Menampilkan {Math.min(visibleCount, rows.length)} dari {rows.length}{' '}
                  {hasMore && (
                    <>
                      ·{' '}
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
        </div>
      )}
    </div>
  );
}
