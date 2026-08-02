/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { FileDown, Grid, FileText, X, List } from 'lucide-react';
import { fetchMutasi } from '../../../lib/akuntansi/reportQueries';
import type { MutasiRow, MutasiFilters } from '../../../lib/akuntansi/reportQueries';
import { fetchCashAccountBalances } from '../../../lib/kasbank/service';
import type { CashAccountBalance } from '../../../lib/kasbank/types';
import { wibDateString } from '../../../lib/format';
import { captureError } from '../../../lib/captureError';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MutasiTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type DirectionFilter = 'ALL' | 'IN' | 'OUT';
type PeriodPreset = 'bulan-ini' | '30-hari' | 'tahun-ini';

interface PeriodRange {
  fromDate: string;
  toDate: string;
}

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

function idMonthYear(isoDate: string): string {
  const ID_MONTHS = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
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

function formatNum(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function getAccountTypeColor(accountType: string): {
  bg: string;
  text: string;
} {
  switch (accountType) {
    case 'BANK':
      return { bg: 'bg-blue-100', text: 'text-blue-800' };
    case 'KAS':
      return { bg: 'bg-emerald-100', text: 'text-emerald-800' };
    case 'E_WALLET':
      return { bg: 'bg-amber-100', text: 'text-amber-800' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-800' };
  }
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Component ────────────────────────────────────────────────────────────────

export default function MutasiTab({ showToast }: MutasiTabProps): React.ReactElement {
  // Accounts state
  const [accounts, setAccounts] = useState<CashAccountBalance[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // Filters
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<PeriodRange>(() => getMonthBounds(new Date()));
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('bulan-ini');
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [category, setCategory] = useState<string>('ALL');
  const [includePersonal, setIncludePersonal] = useState(false);

  // Account picker modal state
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Data state
  const [rows, setRows] = useState<MutasiRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  // Pagination
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Load accounts on mount ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoadingAccounts(true);
    fetchCashAccountBalances()
      .then(data => {
        if (!cancelled) {
          // Filter to active business accounts (non-personal purposes)
          const active = data.filter(a => a.is_active);
          setAccounts(active);
        }
      })
      .catch(err => {
        captureError(err, { feature: 'laporan_mutasi', action: 'fetch_cash_account_balances' });
        if (!cancelled) showToast('Gagal memuat daftar akun', 'warning');
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load mutasi rows ────────────────────────────────────────────────────────

  const loadMutasi = useCallback(
    (accountIds: Set<string>, fromDate: string, toDate: string, dir: DirectionFilter, cat: string) => {
      setLoadingRows(true);
      setVisibleCount(PAGE_SIZE);

      const filters: MutasiFilters = {
        accountIds: Array.from(accountIds),
        fromDate,
        toDate,
        direction: dir === 'ALL' ? undefined : (dir as 'IN' | 'OUT'),
        category: cat === 'ALL' ? undefined : cat,
        includePersonal,
      };

      fetchMutasi(filters)
        .then(data => setRows(data))
        .catch(err => {
          captureError(err, { feature: 'laporan_mutasi', action: 'fetch_mutasi' });
          showToast('Gagal memuat mutasi', 'warning');
        })
        .finally(() => setLoadingRows(false));
    },
    [includePersonal, showToast],
  );

  useEffect(() => {
    loadMutasi(selectedAccountIds, period.fromDate, period.toDate, direction, category);
  }, [selectedAccountIds, period, direction, category, loadMutasi]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handlePeriodPreset(preset: PeriodPreset) {
    setPeriodPreset(preset);
    const now = new Date();
    if (preset === 'bulan-ini') {
      setPeriod(getMonthBounds(now));
    } else if (preset === '30-hari') {
      const toDate = wibDateString(now);
      const from = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      setPeriod({ fromDate: wibDateString(from), toDate });
    } else if (preset === 'tahun-ini') {
      const wibNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      setPeriod({
        fromDate: `${wibNow.getFullYear()}-01-01`,
        toDate: `${wibNow.getFullYear()}-12-31`,
      });
    }
  }

  function handleAccountSelect(accountId: string) {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }

  function handleRemoveAccount(accountId: string) {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      next.delete(accountId);
      return next;
    });
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const selectedAccounts = accounts.filter(a => selectedAccountIds.has(a.cash_account_id));
  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  const totalIn = rows.reduce((s, r) => s + r.in_amount, 0);
  const totalOut = rows.reduce((s, r) => s + r.out_amount, 0);
  const net = totalIn - totalOut;

  const periodLabel = idMonthYear(period.fromDate);

  // Unique categories from rows
  const uniqueCategories = Array.from(new Set(rows.map(r => r.category))).sort();

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="p-6 border-b border-gray-200 flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-bold" style={{ color: '#1e3d60' }}>
            <List className="inline w-5 h-5 mr-2 text-blue-700" />
            Mutasi Akun
          </h3>
          <p className="text-xs text-gray-600">
            {periodLabel} · {rows.length} entries
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => showToast('Export PDF hadir di Phase 4', 'info')}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors"
          >
            <FileDown className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            onClick={() => showToast('Export Excel hadir di Phase 4', 'info')}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors"
          >
            <Grid className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            onClick={() => showToast('Export CSV hadir di Phase 4', 'info')}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      {/* ── Filter row ── */}
      <div className="p-6 grid grid-cols-12 gap-3 text-xs">
        {/* Akun (multi-select) */}
        <div className="col-span-4">
          <label className="block font-bold text-caleo-10 uppercase text-gray-600 mb-1">
            Akun (multi-select)
          </label>
          <div
            className="rounded p-2 flex flex-wrap gap-1.5"
            style={{ border: '1px solid var(--color-caleo-mist-dark)', background: '#fafbff' }}
          >
            {selectedAccounts.map(acc => {
              const color = getAccountTypeColor(acc.account_type);
              return (
                <span
                  key={acc.cash_account_id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caleo-10 font-bold uppercase tracking-0.5 ${color.bg} ${color.text}`}
                >
                  {acc.internal_label}
                  <button
                    onClick={() => handleRemoveAccount(acc.cash_account_id)}
                    className="hover:opacity-70"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            <button
              onClick={() => setShowAccountPicker(!showAccountPicker)}
              className="text-caleo-10 text-blue-700 font-bold"
            >
              + Pilih
            </button>

            {/* Account picker dropdown */}
            {showAccountPicker && (
              <div
                className="col-span-4 fixed mt-8 bg-white border border-[var(--color-caleo-mist-dark)] rounded shadow-lg p-3 z-50 max-h-64 overflow-y-auto"
                style={{ width: '280px' }}
              >
                {loadingAccounts ? (
                  <div className="text-caleo-11 text-gray-500">Memuat...</div>
                ) : (
                  <div className="space-y-1">
                    {accounts.map(acc => {
                      const color = getAccountTypeColor(acc.account_type);
                      const isSelected = selectedAccountIds.has(acc.cash_account_id);
                      return (
                        <label
                          key={acc.cash_account_id}
                          className="flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-blue-50 text-caleo-11"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleAccountSelect(acc.cash_account_id)}
                            className="w-4 h-4 rounded"
                          />
                          <span
                            className={`px-1.5 py-0.5 rounded text-caleo-9 font-bold uppercase ${color.bg} ${color.text}`}
                          >
                            {acc.account_type}
                          </span>
                          <span className="font-semibold">{acc.internal_label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Periode */}
        <div className="col-span-3">
          <label className="block font-bold text-caleo-10 uppercase text-gray-600 mb-1">
            Periode
          </label>
          <select
            className="w-full border border-[var(--color-caleo-mist-dark)] rounded px-3 py-1.5 text-xs bg-white text-[#43474e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            value={periodPreset}
            onChange={e => handlePeriodPreset(e.target.value as PeriodPreset)}
          >
            <option value="bulan-ini">Bulan ini ({idMonthYear(period.fromDate).split(' ')[0]})</option>
            <option value="30-hari">30 hari</option>
            <option value="tahun-ini">Tahun ini</option>
          </select>
        </div>

        {/* Arah */}
        <div className="col-span-2">
          <label className="block font-bold text-caleo-10 uppercase text-gray-600 mb-1">
            Arah
          </label>
          <select
            className="w-full border border-[var(--color-caleo-mist-dark)] rounded px-3 py-1.5 text-xs bg-white text-[#43474e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            value={direction}
            onChange={e => setDirection(e.target.value as DirectionFilter)}
          >
            <option value="ALL">Semua</option>
            <option value="IN">IN saja</option>
            <option value="OUT">OUT saja</option>
          </select>
        </div>

        {/* Kategori */}
        <div className="col-span-3">
          <label className="block font-bold text-caleo-10 uppercase text-gray-600 mb-1">
            Kategori
          </label>
          <select
            className="w-full border border-[var(--color-caleo-mist-dark)] rounded px-3 py-1.5 text-xs bg-white text-[#43474e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="ALL">Semua</option>
            {uniqueCategories.map(cat => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div className="px-6 pb-4 flex items-center gap-6 text-caleo-13 flex-wrap">
        <span>
          <strong className="text-gray-600">Total IN:</strong>{' '}
          <strong className="text-emerald-700">Rp {formatNum(totalIn)}</strong>
        </span>
        <span>
          <strong className="text-gray-600">Total OUT:</strong>{' '}
          <strong className="text-rose-700">Rp {formatNum(totalOut)}</strong>
        </span>
        <span>
          <strong className="text-gray-600">Net:</strong>{' '}
          <strong style={{ color: '#1e3d60' }}>
            {net >= 0 ? '+ ' : '− '}Rp {formatNum(Math.abs(net))}
          </strong>
        </span>
        <span className="text-gray-500">· {rows.length} mutasi</span>
        <label className="ml-auto flex items-center gap-2 text-caleo-11">
          <input
            type="checkbox"
            checked={includePersonal}
            onChange={e => setIncludePersonal(e.target.checked)}
            className="w-4 h-4 rounded"
          />
          <span>Include akun Pribadi</span>
        </label>
      </div>

      {/* ── Table ── */}
      <div className="border-t border-gray-200 relative">
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--color-caleo-cloud)' }}>
            <tr className="text-caleo-10 uppercase font-extrabold text-gray-600">
              <th className="text-left py-2 px-3">Tanggal</th>
              <th className="text-left py-2 px-3">Akun</th>
              <th className="text-left py-2 px-3">Kategori</th>
              <th className="text-left py-2 px-3">Keterangan</th>
              <th className="text-right py-2 px-3">IN</th>
              <th className="text-right py-2 px-3">OUT</th>
            </tr>
          </thead>
          <tbody>
            {loadingRows ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-caleo-13 text-gray-500">
                  Memuat mutasi...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-caleo-13 text-gray-500">
                  Belum ada mutasi dalam periode + filter ini.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, idx) => {
                const acc = accounts.find(a => a.cash_account_id === row.account_id);
                const color = acc ? getAccountTypeColor(acc.account_type) : { bg: 'bg-gray-100', text: 'text-gray-800' };
                const isPenyesuaian = row.category === 'Penyesuaian';
                return (
                  <tr
                    key={`${row.entry_id}-${row.account_id}-${idx}`}
                    className={`border-t border-gray-100 ${isPenyesuaian ? 'bg-amber-50/30' : 'hover:bg-blue-50/30'}`}
                  >
                    <td className="py-2 px-3 font-mono text-gray-600">
                      {formatEntryDate(row.entry_date)}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-caleo-10 font-bold uppercase tracking-0.5 ${color.bg} ${color.text}`}
                      >
                        {row.account_label}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-700">{row.category}</td>
                    <td className="py-2 px-3 text-gray-700">{row.description}</td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-700">
                      {row.in_amount > 0 ? formatNum(row.in_amount) : ''}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-rose-700">
                      {row.out_amount > 0 ? formatNum(row.out_amount) : ''}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2" style={{ background: 'var(--color-caleo-cloud)', borderColor: '#1e40af' }}>
              <tr className="font-extrabold" style={{ color: '#1e3d60' }}>
                <td colSpan={4} className="py-3 px-3 text-right">
                  TOTAL
                </td>
                <td className="py-3 px-3 text-right text-emerald-700">
                  {formatNum(totalIn)}
                </td>
                <td className="py-3 px-3 text-right text-rose-700">
                  {formatNum(totalOut)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Pagination footer ── */}
      {rows.length > 0 && (
        <div className="px-6 py-3 text-caleo-11 text-center text-gray-500">
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
      )}
    </div>
  );
}
