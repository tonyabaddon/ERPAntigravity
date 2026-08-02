/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { X, Lock, AlertTriangle, CheckCircle, Calendar } from 'lucide-react';
import { closeFiscalYear } from '../../../lib/akuntansi/periodClose';
import { fetchAccountingPeriods } from '../../../lib/akuntansi/glQueries';
import type { AccountingPeriod } from '../../../lib/akuntansi/types';
import { supabase } from '../../../lib/supabaseClient';
import { formatRp } from '../../../lib/format';
import { captureError } from '../../../lib/captureError';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface YearEndCloseModalProps {
  open: boolean;
  defaultYear: number;
  onClose: () => void;
  onClosed: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface YearSnapshot {
  totalPendapatan: number;
  totalBeban: number;
  netIncome: number;
  allMonthsClosed: boolean;
  closedMonths: number;
  totalMonths: number;
}

export default function YearEndCloseModal({
  open,
  defaultYear,
  onClose,
  onClosed,
  showToast,
}: YearEndCloseModalProps): React.ReactElement | null {
  const [year, setYear] = useState(defaultYear);
  const [snapshot, setSnapshot] = useState<YearSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadSnapshot = useCallback(async (targetYear: number) => {
    if (!supabase) {
      showToast('Supabase tidak terkonfigurasi', 'warning');
      return;
    }
    setLoading(true);
    try {
      const yearStart = `${targetYear}-01-01`;
      const yearEnd = `${targetYear}-12-31`;

      // Fetch P&L aggregation: Pendapatan + Beban for the year
      const { data: lines, error } = await supabase
        .from('journal_entry_lines')
        .select(`
          side,
          amount,
          journal_entries!inner(entry_date),
          chart_of_accounts!inner(account_type)
        `)
        .gte('journal_entries.entry_date', yearStart)
        .lte('journal_entries.entry_date', yearEnd);

      if (error) throw error;

      let pendapatan = 0;
      let beban = 0;
      type RawLine = {
        side: 'DEBIT' | 'CREDIT';
        amount: number;
        chart_of_accounts: { account_type: string } | { account_type: string }[];
      };
      for (const row of (lines ?? []) as RawLine[]) {
        const coa = Array.isArray(row.chart_of_accounts) ? row.chart_of_accounts[0] : row.chart_of_accounts;
        if (!coa) continue;
        const amt = Number(row.amount);
        if (coa.account_type === 'PENDAPATAN') {
          // PENDAPATAN normal CREDIT — net = credit - debit
          pendapatan += row.side === 'CREDIT' ? amt : -amt;
        } else if (coa.account_type === 'BEBAN') {
          // BEBAN normal DEBIT — net = debit - credit
          beban += row.side === 'DEBIT' ? amt : -amt;
        }
      }

      // Check all months closed
      const periods = await fetchAccountingPeriods();
      const yearPeriods = periods.filter(p => p.period_year === targetYear);
      const closedCount = yearPeriods.filter(p => p.status === 'CLOSED').length;
      const totalMonths = yearPeriods.length;
      const allMonthsClosed = totalMonths > 0 && closedCount === totalMonths;

      setSnapshot({
        totalPendapatan: pendapatan,
        totalBeban: beban,
        netIncome: pendapatan - beban,
        allMonthsClosed,
        closedMonths: closedCount,
        totalMonths,
      });
    } catch (err) {
      captureError(err, { feature: 'akuntansi_year_end', action: 'load_snapshot' });
      showToast('Gagal memuat snapshot tahun ' + targetYear, 'warning');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) {
      setYear(defaultYear);
      loadSnapshot(defaultYear);
    }
  }, [open, defaultYear, loadSnapshot]);

  async function handleSubmit() {
    if (!snapshot) return;
    if (!snapshot.allMonthsClosed) {
      showToast(`Tutup semua periode bulanan ${year} dulu sebelum tutup tahun fiskal.`, 'warning');
      return;
    }
    if (!confirm(`Konfirmasi tutup buku tahun fiskal ${year}?\n\nIni akan post JE: Pendapatan + Beban → Ikhtisar Laba Rugi, lalu Ikhtisar → Laba Ditahan, lalu Prive → Modal Owner. Tidak bisa di-undo otomatis.`)) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await closeFiscalYear(year);
      showToast(
        `✓ Tahun ${year} berhasil ditutup. Net income: ${formatRp(result.net_income)} → Laba Ditahan`,
        'success',
      );
      onClosed();
    } catch (err) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal tutup tahun: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // Year selector range: last 3 years + current year - 1 (default)
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-white rounded-sm max-w-2xl w-full shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header rose-themed */}
        <div className="p-6 border-b border-gray-200 flex items-start justify-between" style={{ background: '#fef2f2' }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-sm bg-rose-100 flex items-center justify-center text-rose-700 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-red-900">Tutup Tahun Fiskal</h2>
              <p className="text-xs text-red-700 mt-0.5">
                Post Pendapatan + Beban → Ikhtisar Laba Rugi → Laba Ditahan + Prive reset
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="text-gray-500 hover:text-gray-700 p-1 rounded-sm hover:bg-gray-100"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-[13px]">
          {/* Year selector */}
          <div>
            <label className="block font-bold mb-1 text-[#1e3d60]">Tahun Fiskal *</label>
            <select
              value={year}
              onChange={(e) => {
                const newYear = parseInt(e.target.value);
                setYear(newYear);
                loadSnapshot(newYear);
              }}
              disabled={loading || submitting}
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 bg-white"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1">
              Tutup buku tahun fiskal yang sudah selesai. Tahun berjalan ({currentYear}) belum bisa ditutup.
            </p>
          </div>

          {loading && (
            <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-6 text-center text-[13px] text-gray-500">
              Memuat snapshot...
            </div>
          )}

          {!loading && snapshot && (
            <>
              {/* Prerequisite check */}
              {!snapshot.allMonthsClosed ? (
                <div
                  className="rounded-sm p-3 flex items-start gap-3 border"
                  style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
                >
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="text-[12px] text-amber-900">
                    <strong>Periode bulanan belum semua ditutup.</strong>
                    <p className="mt-0.5">
                      {snapshot.closedMonths} dari {snapshot.totalMonths} bulan sudah CLOSED.
                      Tutup semua bulan {year} dulu di list di atas, baru tutup tahun fiskal.
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-sm p-3 flex items-start gap-3 border"
                  style={{ background: '#d1fae5', borderColor: '#6ee7b7' }}
                >
                  <CheckCircle className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="text-[12px] text-emerald-900">
                    <strong>Semua periode bulanan {year} sudah ditutup.</strong>
                    <p className="mt-0.5">
                      {snapshot.closedMonths}/{snapshot.totalMonths} bulan CLOSED. Tahun fiskal siap ditutup.
                    </p>
                  </div>
                </div>
              )}

              {/* Snapshot */}
              <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-4 space-y-2">
                <div className="font-extrabold text-[#1e3d60] flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Snapshot {year}
                </div>
                <div className="flex justify-between border-t border-[var(--color-caleo-mist-dark)] pt-2">
                  <span className="text-gray-600">Total Pendapatan</span>
                  <span className="font-bold text-emerald-700">{formatRp(snapshot.totalPendapatan)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Beban</span>
                  <span className="font-bold text-rose-700">({formatRp(snapshot.totalBeban)})</span>
                </div>
                <div
                  className="flex justify-between border-t-2 pt-2 font-extrabold text-[14px]"
                  style={{ borderColor: '#1e40af', color: '#1e3d60' }}
                >
                  <span>LABA NETO TAHUN BERJALAN</span>
                  <span className={snapshot.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                    {formatRp(snapshot.netIncome)}
                  </span>
                </div>
              </div>

              {/* JE preview */}
              <div className="rounded-sm p-3 border" style={{ background: '#fef3c7', borderColor: '#fbbf24' }}>
                <div className="font-extrabold text-amber-900 mb-2 text-[12px]">
                  Journal entries yang akan posted (4 step):
                </div>
                <ol className="space-y-1 text-[11px] text-amber-900 font-mono pl-4 list-decimal">
                  <li>D 4-XXXX Pendapatan {formatRp(snapshot.totalPendapatan)} / K 3-1900 Ikhtisar</li>
                  <li>D 3-1900 Ikhtisar {formatRp(snapshot.totalBeban)} / K 5-XXXX Beban</li>
                  <li>
                    {snapshot.netIncome >= 0
                      ? `D 3-1900 Ikhtisar / K 3-1100 Laba Ditahan ${formatRp(snapshot.netIncome)}`
                      : `D 3-1100 Laba Ditahan / K 3-1900 Ikhtisar ${formatRp(Math.abs(snapshot.netIncome))}`}
                  </li>
                  <li>D 3-1100 Modal Owner / K 3-1200 Prive — reset drawing</li>
                </ol>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] rounded-full text-xs font-bold px-4 py-2 hover:bg-[var(--color-caleo-cloud)] disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loading || !snapshot || !snapshot.allMonthsClosed}
            className="bg-red-600 text-white rounded-full text-xs font-bold px-4 py-2 hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Lock className="w-3.5 h-3.5" />
            {submitting ? 'Memproses...' : `Tutup Tahun ${year}`}
          </button>
        </div>
      </div>
    </div>
  );
}
