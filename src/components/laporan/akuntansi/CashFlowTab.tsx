/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Droplet } from 'lucide-react';
import { fetchCashFlow } from '../../../lib/akuntansi/reportQueries';
import type { CashFlowResult } from '../../../lib/akuntansi/reportQueries';
import { captureError } from '../../../lib/captureError';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CashFlowTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type ViewMode = 'net' | 'gross-in' | 'gross-out';

// ─── Format helper ────────────────────────────────────────────────────────────

/**
 * Format number in shortened "jt" format for compact display.
 * Examples: 15200000 → "15.2jt", 1500000 → "1.5jt", 500 → "500"
 */
function formatShort(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  let formatted: string;

  if (abs >= 1_000_000) {
    formatted = `${(abs / 1_000_000).toFixed(1)}jt`;
  } else if (abs >= 1_000) {
    formatted = `${(abs / 1_000).toFixed(0)}rb`;
  } else {
    formatted = abs.toFixed(0);
  }

  return n < 0 ? `-${formatted}` : formatted;
}

/**
 * Format value with +/- prefix for net cash flow rows.
 */
function formatNetValue(n: number): string {
  const formatted = formatShort(n);
  if (formatted === '—') return formatted;
  return n >= 0 ? `+${formatted}` : formatted;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CashFlowTab({ showToast }: CashFlowTabProps): React.ReactElement {
  const [data, setData] = useState<CashFlowResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('net');

  // ── Load cash flow on mount ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // Compute current year + month in WIB
    const now = new Date();
    const wibStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const wibDate = new Date(wibStr);
    const endYear = wibDate.getFullYear();
    const endMonth = wibDate.getMonth() + 1; // 1-12

    fetchCashFlow(endYear, endMonth, 6)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(err => {
        captureError(err, { feature: 'laporan_akuntansi', action: 'fetch_cash_flow' });
        if (!cancelled) showToast('Gagal memuat cash flow', 'warning');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  // ── Compute current month index ────────────────────────────────────────────

  let currentMonthIdx = -1;
  if (data) {
    const now = new Date();
    const wibStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const wibDate = new Date(wibStr);
    const endYear = wibDate.getFullYear();
    const endMonth = wibDate.getMonth() + 1;
    currentMonthIdx = data.monthDates.findIndex(
      m => m.year === endYear && m.month === endMonth
    );
  }

  // ── Render loading state ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white p-8 text-center">
        <Droplet className="w-8 h-8 mx-auto text-gray-400 mb-2 animate-pulse" />
        <p className="text-sm text-gray-600">Memuat Cash Flow Matrix...</p>
      </div>
    );
  }

  // ── Render empty state ─────────────────────────────────────────────────────

  if (!data || (data.uangMasuk.length === 0 && data.uangKeluar.length === 0)) {
    return (
      <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white p-8 text-center">
        <Droplet className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600">Belum ada cash flow di 6 bulan terakhir</p>
      </div>
    );
  }

  // ── Helper: Get cell value based on view mode ──────────────────────────────

  function getCellValue(month: string): number {
    const monthData = data.monthDates.find(m => m.label === month);
    if (!monthData) return 0;

    // For the current implementation, we show monthly values
    // The cell values come from the CashFlowCell array within each category
    return 0; // Will be overridden in the table rendering loop
  }

  // ── Render main table ──────────────────────────────────────────────────────

  return (
    <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="p-6 border-b border-gray-200 flex items-baseline justify-between">
        <div>
          <h3 className="text-base font-bold" style={{ color: '#1e3d60' }}>
            <Droplet className="inline w-5 h-5 mr-2 text-emerald-700" />
            Cash Flow Matrix
          </h3>
          <p className="text-xs text-gray-600">6 bulan terakhir · pivot per kategori</p>
        </div>

        {/* View mode pills */}
        <div className="flex gap-2 text-[12px]">
          <button
            onClick={() => setViewMode('net')}
            className={`px-3.5 py-1.5 rounded-full font-bold transition-all ${
              viewMode === 'net'
                ? 'bg-[var(--color-caleo-primary)] text-white'
                : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
            }`}
          >
            Net
          </button>
          <button
            onClick={() => setViewMode('gross-in')}
            className={`px-3.5 py-1.5 rounded-full font-bold transition-all ${
              viewMode === 'gross-in'
                ? 'bg-[var(--color-caleo-primary)] text-white'
                : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
            }`}
          >
            Gross IN
          </button>
          <button
            onClick={() => setViewMode('gross-out')}
            className={`px-3.5 py-1.5 rounded-full font-bold transition-all ${
              viewMode === 'gross-out'
                ? 'bg-[var(--color-caleo-primary)] text-white'
                : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
            }`}
          >
            Gross OUT
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="p-6 overflow-x-auto">
        <table className="w-full text-[12px]">
          {/* ── thead ── */}
          <thead style={{ background: 'var(--color-caleo-cloud)' }}>
            <tr className="text-[10px] uppercase font-extrabold text-gray-600">
              <th
                className="text-left py-2 px-3 sticky left-0"
                style={{ background: 'var(--color-caleo-cloud)' }}
              >
                Kategori
              </th>
              {data.months.map((month, idx) => (
                <th
                  key={month}
                  className="text-right py-2 px-2"
                  style={
                    idx === currentMonthIdx ? { background: '#dbeafe' } : undefined
                  }
                >
                  {month}
                </th>
              ))}
              <th
                className="text-right py-2 px-2"
                style={{ background: '#d1fae5' }}
              >
                Total 6 bln
              </th>
            </tr>
          </thead>

          {/* ── tbody ── */}
          <tbody>
            {/* ↓ UANG MASUK section */}
            <tr style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
              <td
                colSpan={data.months.length + 2}
                className="py-2 px-3 font-bold text-emerald-900"
              >
                ↓ UANG MASUK
              </td>
            </tr>

            {data.uangMasuk.map(category => (
              <tr key={`in-${category.category}`} className="border-t border-gray-100">
                <td className="py-2 px-3 pl-8 text-gray-700">{category.category}</td>
                {category.cells.map((cell, idx) => (
                  <td
                    key={`in-${category.category}-${cell.month}`}
                    className="text-right py-2 px-2 text-emerald-700 font-semibold"
                    style={
                      idx === currentMonthIdx
                        ? { background: '#dbeafe', fontWeight: '700' }
                        : undefined
                    }
                  >
                    {viewMode === 'net'
                      ? formatShort(cell.net)
                      : viewMode === 'gross-in'
                      ? formatShort(cell.grossIn)
                      : formatShort(cell.grossOut)}
                  </td>
                ))}
                <td
                  className="text-right py-2 px-2 text-emerald-700 font-extrabold"
                  style={{ background: '#d1fae5' }}
                >
                  {viewMode === 'net'
                    ? formatShort(category.totalNet)
                    : viewMode === 'gross-in'
                    ? formatShort(category.totalIn)
                    : formatShort(category.totalOut)}
                </td>
              </tr>
            ))}

            {/* ↑ UANG KELUAR section */}
            <tr style={{ background: 'rgba(239, 68, 68, 0.15)' }}>
              <td
                colSpan={data.months.length + 2}
                className="py-2 px-3 font-bold text-rose-900"
              >
                ↑ UANG KELUAR
              </td>
            </tr>

            {data.uangKeluar.map(category => (
              <tr key={`out-${category.category}`} className="border-t border-gray-100">
                <td className="py-2 px-3 pl-8 text-gray-700">{category.category}</td>
                {category.cells.map((cell, idx) => (
                  <td
                    key={`out-${category.category}-${cell.month}`}
                    className="text-right py-2 px-2 text-rose-700 font-semibold"
                    style={
                      idx === currentMonthIdx
                        ? { background: '#dbeafe', fontWeight: '700' }
                        : undefined
                    }
                  >
                    {viewMode === 'net'
                      ? formatShort(cell.net)
                      : viewMode === 'gross-in'
                      ? formatShort(cell.grossIn)
                      : formatShort(cell.grossOut)}
                  </td>
                ))}
                <td
                  className="text-right py-2 px-2 text-rose-700 font-extrabold"
                  style={{ background: '#fee2e2' }}
                >
                  {viewMode === 'net'
                    ? formatShort(category.totalNet)
                    : viewMode === 'gross-in'
                    ? formatShort(category.totalIn)
                    : formatShort(category.totalOut)}
                </td>
              </tr>
            ))}
          </tbody>

          {/* ── tfoot ── */}
          <tfoot style={{ background: '#f1f5f9', borderTop: '2px solid #475569' }}>
            <tr style={{ color: '#1e3d60', fontWeight: '700' }}>
              <td className="py-3 px-3 text-left">NET CASH FLOW</td>
              {data.netPerMonth.map((netVal, idx) => {
                const isPositive = netVal >= 0;
                return (
                  <td
                    key={`net-${idx}`}
                    className={`text-right py-3 px-2 ${
                      isPositive ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                    style={
                      idx === currentMonthIdx
                        ? {
                            background: '#dbeafe',
                            fontWeight: '900',
                          }
                        : { fontWeight: '700' }
                    }
                  >
                    {formatNetValue(netVal)}
                  </td>
                );
              })}
              <td
                className="text-right py-3 px-2 font-black"
                style={{
                  background: '#d1fae5',
                  color: data.totalNet >= 0 ? '#047857' : '#dc2626',
                }}
              >
                {formatNetValue(data.totalNet)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
