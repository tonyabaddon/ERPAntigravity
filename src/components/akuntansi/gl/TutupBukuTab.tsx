/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { CalendarCheck, Lock, RotateCcw, Archive } from 'lucide-react';
import { fetchAccountingPeriods } from '../../../lib/akuntansi/glQueries';
import type { AccountingPeriod } from '../../../lib/akuntansi/types';
import PeriodCloseModal from './PeriodCloseModal';
import YearEndCloseModal from './YearEndCloseModal';
import { captureError } from '../../../lib/captureError';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wibYearMonth(): { year: number; month: number } {
  const now = new Date();
  const year = parseInt(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }),
  );
  const month = parseInt(
    now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', month: 'numeric' }),
  );
  return { year, month };
}

function periodMonthLabel(p: AccountingPeriod): string {
  return `${MONTH_NAMES_ID[p.period_month - 1]} ${p.period_year}`;
}

function formatClosedAt(isoTs: string): string {
  return new Date(isoTs).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TutupBukuTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TutupBukuTab({ showToast }: TutupBukuTabProps): React.ReactElement {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalPeriod, setModalPeriod] = useState<AccountingPeriod | null>(null);
  const [yearEndModalOpen, setYearEndModalOpen] = useState(false);

  const loadPeriods = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAccountingPeriods();
      // sorted DESC by year/month — limit to last 12
      setPeriods(data.slice(0, 12));
    } catch (err) {
      captureError(err, { feature: 'akuntansi_tutup_buku', action: 'load_periods' });
      showToast('Gagal memuat daftar periode akuntansi', 'warning');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  const { year: currentYear, month: currentMonth } = wibYearMonth();

  // ─── Row render helpers ────────────────────────────────────────────────────

  function renderPeriodRow(p: AccountingPeriod): React.ReactElement {
    const isCurrentMonth = p.period_year === currentYear && p.period_month === currentMonth;
    const isCloseable =
      p.status === 'OPEN' &&
      (p.period_year < currentYear ||
        (p.period_year === currentYear && p.period_month < currentMonth));
    const isOlderYear = p.period_year < currentYear;

    let rowBg = 'bg-gray-50';
    if (isCurrentMonth) rowBg = 'bg-white';
    else if (isCloseable) rowBg = 'bg-amber-50/30';

    return (
      <div
        key={p.id}
        className={`${rowBg} flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-b-0`}
        style={isOlderYear ? { opacity: 0.7 } : undefined}
      >
        {/* Left: label + status chip */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <span className="text-caleo-13 font-medium text-[#1a1a1a]">
              {periodMonthLabel(p)}
              {isCurrentMonth && (
                <span className="ml-1.5 text-xs font-normal text-gray-500">(berjalan)</span>
              )}
            </span>
          </div>

          {/* Status chip */}
          {isCurrentMonth ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-bold bg-emerald-100 text-emerald-800 whitespace-nowrap">
              OPEN
            </span>
          ) : p.status === 'CLOSED' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caleo-10 font-bold bg-gray-200 text-gray-600 whitespace-nowrap">
              <Lock className="w-2.5 h-2.5" />
              CLOSED
              {p.closed_at && ` · ${formatClosedAt(p.closed_at)}`}
            </span>
          ) : p.status === 'REOPENED' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caleo-10 font-bold bg-blue-100 text-blue-700 whitespace-nowrap">
              <RotateCcw className="w-2.5 h-2.5" />
              REOPENED
              {p.closed_at && ` · ${formatClosedAt(p.closed_at)}`}
            </span>
          ) : isCloseable ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-bold bg-amber-100 text-amber-800 whitespace-nowrap">
              OPEN
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-bold bg-emerald-100 text-emerald-800 whitespace-nowrap">
              OPEN
            </span>
          )}
        </div>

        {/* Right: Tutup Buku button for closeable periods */}
        {isCloseable && (
          <button
            type="button"
            className="ml-4 shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold text-white transition-colors"
            style={{ background: '#dc2626' }}
            onClick={() => setModalPeriod(p)}
          >
            <Lock className="w-3 h-3" />
            Tutup Buku
          </button>
        )}
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)] shrink-0">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-caleo-primary)]">Status Periode Akuntansi</h3>
              <p className="text-xs text-gray-600">Per period status overview · last 12 periods</p>
            </div>
          </div>
          {/* Year-End Close button */}
          <button
            type="button"
            onClick={() => setYearEndModalOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full text-xs font-bold px-3.5 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
            title="Tutup tahun fiskal — post Pendapatan/Beban ke Ikhtisar Laba Rugi"
          >
            <Archive className="w-3.5 h-3.5" />
            Tutup Tahun Fiskal
          </button>
        </div>

        {/* Period list */}
        {loading ? (
          <LoadingState label="Memuat..." />
        ) : periods.length === 0 ? (
          <EmptyState message="Belum ada periode akuntansi." />
        ) : (
          <div className="divide-y divide-gray-100">
            {periods.map(p => renderPeriodRow(p))}
          </div>
        )}
      </div>

      {/* Period Close Modal */}
      {modalPeriod && (
        <PeriodCloseModal
          open={true}
          period={modalPeriod}
          onClose={() => setModalPeriod(null)}
          onClosed={() => {
            setModalPeriod(null);
            loadPeriods();
          }}
          showToast={showToast}
        />
      )}

      {/* Year-End Close Modal */}
      <YearEndCloseModal
        open={yearEndModalOpen}
        defaultYear={currentYear - 1}
        onClose={() => setYearEndModalOpen(false)}
        onClosed={() => {
          setYearEndModalOpen(false);
          loadPeriods();
        }}
        showToast={showToast}
      />
    </>
  );
}
