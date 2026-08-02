/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Scale, FileDown, Grid, CheckCircle, AlertTriangle } from 'lucide-react';
import {
  fetchTrialBalanceAsOf,
  fetchAccountingPeriods,
} from '../../../lib/akuntansi/glQueries';
import type { TrialBalanceRowWithMetadata } from '../../../lib/akuntansi/glQueries';
import type { AccountingPeriod, AccountType } from '../../../lib/akuntansi/types';
import { formatRp } from '../../../lib/format';
import { captureError } from '../../../lib/captureError';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'ASET',
  'LIABILITAS',
  'MODAL',
  'PENDAPATAN',
  'BEBAN',
];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASET: '1 ASET',
  LIABILITAS: '2 LIABILITAS',
  MODAL: '3 MODAL',
  PENDAPATAN: '4 PENDAPATAN',
  BEBAN: '5 BEBAN',
};

interface TypeStyle {
  headerBg: string;
  headerColor: string;
  rowHover: string;
  balanceColor: string;
}

const ACCOUNT_TYPE_STYLES: Record<AccountType, TypeStyle> = {
  ASET: {
    headerBg: 'bg-blue-50/30',
    headerColor: '#1e40af',
    rowHover: 'hover:bg-blue-50/30',
    balanceColor: 'text-blue-700',
  },
  LIABILITAS: {
    headerBg: 'bg-rose-50/30',
    headerColor: '#9f1239',
    rowHover: 'hover:bg-rose-50/30',
    balanceColor: 'text-rose-700',
  },
  MODAL: {
    headerBg: 'bg-violet-50/30',
    headerColor: '#6b21a8',
    rowHover: 'hover:bg-violet-50/30',
    balanceColor: 'text-violet-700',
  },
  PENDAPATAN: {
    headerBg: 'bg-emerald-50/30',
    headerColor: '#065f46',
    rowHover: 'hover:bg-emerald-50/30',
    balanceColor: 'text-emerald-700',
  },
  BEBAN: {
    headerBg: 'bg-orange-50/30',
    headerColor: '#9a3412',
    rowHover: 'hover:bg-orange-50/30',
    balanceColor: 'text-orange-700',
  },
};

const MONTH_NAMES_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNum(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function wibTimestamp(): string {
  return (
    new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB'
  );
}

function periodLabel(p: AccountingPeriod): string {
  return `${MONTH_NAMES_ID[p.period_month - 1]} ${p.period_year} (${p.status === 'OPEN' ? 'Berjalan' : 'Closed'})`;
}

/**
 * Compute the "as-of date" for a trial balance query from a given period.
 * - OPEN period → today (WIB), so the TB includes all entries up to now.
 * - CLOSED/REOPENED period → last calendar day of that month.
 */
function asOfDateForPeriod(period: AccountingPeriod): string {
  if (period.status === 'OPEN') {
    // Use today in WIB timezone
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  }
  // Last day of period month
  const lastDay = new Date(period.period_year, period.period_month, 0);
  const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
  const dd = String(lastDay.getDate()).padStart(2, '0');
  return `${period.period_year}-${mm}-${dd}`;
}

/** Find the period matching today's WIB year/month, or fall back to first in list. */
function findCurrentPeriod(periods: AccountingPeriod[]): AccountingPeriod | undefined {
  const now = new Date();
  const wibYear = parseInt(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }),
  );
  const wibMonth = parseInt(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', month: 'numeric' }),
  );
  return (
    periods.find(p => p.period_year === wibYear && p.period_month === wibMonth) ??
    periods[0]
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TrialBalanceTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onDrillDown: (accountId: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrialBalanceTab({
  showToast,
  onDrillDown,
}: TrialBalanceTabProps): React.ReactElement {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<AccountingPeriod | null>(null);
  const [rows, setRows] = useState<TrialBalanceRowWithMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [timestamp] = useState<string>(wibTimestamp());

  // Load periods + initial trial balance in parallel on mount
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setLoading(true);
      try {
        const periodsData = await fetchAccountingPeriods();
        const current = findCurrentPeriod(periodsData);
        const asOfDate = current
          ? asOfDateForPeriod(current)
          : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        const balanceData = await fetchTrialBalanceAsOf(asOfDate);
        if (!cancelled) {
          setPeriods(periodsData);
          setSelectedPeriod(current ?? null);
          setRows(balanceData);
        }
      } catch (err) {
        if (!cancelled) {
          captureError(err, { feature: 'akuntansi_trial_balance', action: 'load_initial' });
          showToast('Gagal memuat Neraca Saldo', 'warning');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInitial();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when selected period changes
  function handlePeriodChange(periodId: string) {
    const period = periods.find(p => p.id === periodId) ?? null;
    setSelectedPeriod(period);
    setLoading(true);
    const asOfDate = period
      ? asOfDateForPeriod(period)
      : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    fetchTrialBalanceAsOf(asOfDate)
      .then(data => {
        setRows(data);
      })
      .catch(err => {
        captureError(err, { feature: 'akuntansi_trial_balance', action: 'fetch_on_period_change' });
        showToast('Gagal memuat Neraca Saldo', 'warning');
      })
      .finally(() => setLoading(false));
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const totalDebit = rows.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.total_credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005;
  const imbalance = Math.abs(totalDebit - totalCredit);

  // ─── Render ──────────────────────────────────────────────────────────────────

  const periodSubtitle = selectedPeriod
    ? `Periode ${MONTH_NAMES_ID[selectedPeriod.period_month - 1]} ${selectedPeriod.period_year} (${selectedPeriod.status})`
    : 'Periode —';

  return (
    <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)] shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-caleo-primary)]">Trial Balance</h3>
            <p className="text-xs text-gray-600">
              Per {timestamp} · {periodSubtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Period selector */}
          <select
            className="border border-[var(--color-caleo-mist-dark)] rounded px-3 py-1.5 text-xs text-[#43474e] bg-white w-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            value={selectedPeriod?.id ?? ''}
            onChange={e => handlePeriodChange(e.target.value)}
            disabled={loading || periods.length === 0}
          >
            {periods.length === 0 && (
              <option value="">Memuat...</option>
            )}
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {periodLabel(p)}
              </option>
            ))}
          </select>

          {/* Export placeholders */}
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--color-caleo-mist-dark)] bg-white text-xs text-[#43474e] font-medium hover:bg-[#f5f7ff] transition-colors"
            onClick={() => showToast('Export PDF/Excel hadir di Phase 4 Laporan', 'info')}
          >
            <FileDown className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--color-caleo-mist-dark)] bg-white text-xs text-[#43474e] font-medium hover:bg-[#f5f7ff] transition-colors"
            onClick={() => showToast('Export PDF/Excel hadir di Phase 4 Laporan', 'info')}
          >
            <Grid className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {/* ── Balance banner ── */}
      {!loading && rows.length > 0 && (
        <div
          className="mx-6 mt-6 rounded border p-3 flex items-center gap-3"
          style={
            isBalanced
              ? { background: '#d1fae5', borderColor: '#6ee7b7' }
              : { background: '#ffe4e6', borderColor: '#fca5a5' }
          }
        >
          {isBalanced ? (
            <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
          )}
          <p className="text-xs">
            {isBalanced ? (
              <span className="text-emerald-900">
                <strong>✓ Neraca Saldo SEIMBANG</strong> · Total Debit = Total Kredit ={' '}
                <strong>{formatRp(totalDebit)}</strong>
              </span>
            ) : (
              <span className="text-rose-900">
                <strong>⚠ TIDAK SEIMBANG</strong> · selisih{' '}
                <strong>{formatRp(imbalance)}</strong>
              </span>
            )}
          </p>
        </div>
      )}

      {/* ── Table area ── */}
      <div className="px-6 pb-6 mt-6">
        <div className="rounded border border-[var(--color-caleo-mist-dark)] overflow-hidden">
          {loading ? (
            <LoadingState label="Memuat..." />
          ) : rows.length === 0 ? (
            <EmptyState message="Belum ada transaksi di periode ini." />
          ) : (
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--color-caleo-cloud)' }}>
                <tr className="text-caleo-10 uppercase font-extrabold text-gray-600">
                  <th className="text-left py-2 px-3">Kode</th>
                  <th className="text-left py-2 px-3">Nama Akun</th>
                  <th className="text-right py-2 px-3">Debit</th>
                  <th className="text-right py-2 px-3">Kredit</th>
                  <th className="text-right py-2 px-3">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ACCOUNT_TYPE_ORDER.map(accountType => {
                  const typeRows = rows.filter(r => r.account_type === accountType);
                  if (typeRows.length === 0) return null;

                  const style = ACCOUNT_TYPE_STYLES[accountType];
                  const label = ACCOUNT_TYPE_LABELS[accountType];

                  return (
                    <React.Fragment key={accountType}>
                      {/* Section header row */}
                      <tr
                        className={`${style.headerBg} font-bold`}
                        style={{ color: style.headerColor }}
                      >
                        <td colSpan={5} className="py-2 px-3">
                          ━━ {label} ━━
                        </td>
                      </tr>

                      {/* Account rows */}
                      {typeRows.map(row => (
                        <tr
                          key={row.account_id}
                          className={`${style.rowHover} cursor-pointer border-t border-gray-100`}
                          onClick={() => onDrillDown(row.account_id)}
                        >
                          <td className="py-2 px-3 font-mono">{row.account_code}</td>
                          <td className="py-2 px-3">{row.account_name}</td>
                          <td className="py-2 px-3 text-right">
                            {formatNum(row.total_debit)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {formatNum(row.total_credit)}
                          </td>
                          <td className={`py-2 px-3 text-right font-bold ${style.balanceColor}`}>
                            {formatNum(Math.abs(row.balance))}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot style={{ background: 'var(--color-caleo-cloud)' }}>
                <tr
                  className="font-extrabold border-t-2"
                  style={{ color: 'var(--color-caleo-primary)', borderColor: '#1e40af' }}
                >
                  <td colSpan={2} className="py-3 px-3">TOTAL</td>
                  <td className="py-3 px-3 text-right">{formatNum(totalDebit)}</td>
                  <td className="py-3 px-3 text-right">{formatNum(totalCredit)}</td>
                  <td className="py-3 px-3 text-right text-emerald-700">
                    {isBalanced ? '✓ Balanced' : '⚠ Tidak'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
