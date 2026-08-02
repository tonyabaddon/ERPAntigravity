/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { TrendingUp, FileDown, Grid, Info } from 'lucide-react';
import LoadingState from '../../ui/LoadingState';
import ErrorState from '../../ui/ErrorState';
import EmptyState from '../../ui/EmptyState';
import { fetchLabaRugi } from '../../../lib/akuntansi/reportQueries';
import type { LabaRugiResult } from '../../../lib/akuntansi/reportQueries';
import { fetchAccountingConfig } from '../../../lib/akuntansi/service';
import type { AccountingConfig } from '../../../lib/akuntansi/types';
import { tenantSettingsService } from '../../../lib/pengaturan/pengaturanServices';
import { fetchStoreSettings } from '../../../lib/pengaturan/queries';
import type { StoreSettings } from '../../../lib/pengaturan/types';
import type { DbTenantSettings } from '../../../types';
import type { LabaRugiData, PDFGenerationOptions } from '../../../lib/akuntansi/pdfExport';
import { wibDateString } from '../../../lib/format';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { captureError } from '../../../lib/captureError';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LabaRugiTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Fallback used only until fetchStoreSettings resolves + when RLS blocks the row.
const COMPANY_NAME_FALLBACK = 'Perusahaan Anda';

// ─── Period helpers ───────────────────────────────────────────────────────────

interface PeriodRange {
  fromDate: string;
  toDate: string;
}

function getMonthBounds(date: Date): PeriodRange {
  const wibNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const firstDay = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1);
  const lastDay = new Date(wibNow.getFullYear(), wibNow.getMonth() + 1, 0);
  return {
    fromDate: wibDateString(firstDay),
    toDate: wibDateString(lastDay),
  };
}

function formatPeriodLabel(fromDate: string, toDate: string): string {
  const fromParts = fromDate.split('-');
  const toParts = toDate.split('-');
  const fromYear = fromParts[0] ?? '';
  const fromMonth = parseInt(fromParts[1] ?? '1', 10);
  const fromDay = parseInt(fromParts[2] ?? '1', 10);
  const toYear = toParts[0] ?? '';
  const toMonth = parseInt(toParts[1] ?? '1', 10);
  const toDay = parseInt(toParts[2] ?? '1', 10);

  if (fromYear === toYear && fromMonth === toMonth) {
    // Same month: "1-30 Juni 2026"
    return `${fromDay}-${toDay} ${ID_MONTHS[toMonth - 1] ?? ''} ${toYear}`;
  } else {
    // Cross-month: "1 Mei - 30 Juni 2026"
    return `${fromDay} ${ID_MONTHS[fromMonth - 1] ?? ''} - ${toDay} ${ID_MONTHS[toMonth - 1] ?? ''} ${toYear}`;
  }
}

function formatPeriodSummary(fromDate: string, toDate: string): string {
  const fromParts = fromDate.split('-');
  const toParts = toDate.split('-');
  const fromMonth = parseInt(fromParts[1] ?? '1', 10);
  const fromYear = fromParts[0] ?? '';
  const toMonth = parseInt(toParts[1] ?? '1', 10);
  const toYear = toParts[0] ?? '';

  if (fromYear === toYear && fromMonth === toMonth) {
    return `${ID_MONTHS[fromMonth - 1] ?? ''} ${fromYear}`;
  }
  return `${ID_MONTHS[fromMonth - 1] ?? ''} - ${ID_MONTHS[toMonth - 1] ?? ''} ${toYear}`;
}

// ─── Number formatting ────────────────────────────────────────────────────────

function formatRupiah(n: number): string {
  if (n === 0) return '—';
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(n));
  return n < 0 ? `(${formatted})` : formatted;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LabaRugiTab({ showToast }: LabaRugiTabProps): React.ReactElement {
  // Period state
  const [period, setPeriod] = useState<PeriodRange>(() => getMonthBounds(new Date()));
  const [periodPreset, setPeriodPreset] = useState<'bulan-ini' | '30-hari' | 'tahun-ini'>('bulan-ini');

  // Data state
  const [data, setData] = useState<LabaRugiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config state (loaded once)
  const [accountingConfig, setAccountingConfig] = useState<AccountingConfig | null>(null);
  const [tenantSettings, setTenantSettings] = useState<DbTenantSettings | null>(null);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const companyName = storeSettings?.nama_toko ?? COMPANY_NAME_FALLBACK;

  // Export state
  const [exporting, setExporting] = useState(false);

  // ── Load config once on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAccountingConfig().catch(() => null),
      tenantSettingsService.fetch().catch(() => null),
      fetchStoreSettings().catch(() => null),
    ]).then(([cfg, ts, ss]) => {
      if (!cancelled) {
        setAccountingConfig(cfg);
        setTenantSettings(ts);
        setStoreSettings(ss);
        setConfigLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // ── Load P&L on period change ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLabaRugi(period.fromDate, period.toDate)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch((err: Error) => {
        captureError(err, { feature: 'laporan_akuntansi', action: 'fetch_laba_rugi' });
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [period]);

  // ── Period preset handler ─────────────────────────────────────────────────
  function handlePeriodPreset(preset: 'bulan-ini' | '30-hari' | 'tahun-ini') {
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

  // ── PDF export ────────────────────────────────────────────────────────────
  async function handlePdfExport() {
    if (!data) return;
    setExporting(true);
    try {
      const periodLabel = formatPeriodLabel(period.fromDate, period.toDate);

      const pdfData: LabaRugiData = {
        periodLabel,
        startDate: period.fromDate,
        endDate: period.toDate,
        pendapatan: data.pendapatan,
        diskonPenjualan: 0,
        pendapatanBersih: data.pendapatanBersih,
        hpp: data.hpp,
        labaKotor: data.labaKotor,
        bebanOperasional: data.bebanOperasional,
        totalBebanOp: data.totalBebanOp,
        labaOperasional: data.labaOperasional,
        pendapatanLainLain: data.pendapatanLainLain,
        bebanLainLain: data.bebanLainLain,
        labaSebelumPajak: data.labaSebelumPajak,
        bebanPajak: data.bebanPajak,
        labaNeto: data.labaNeto,
      };

      const options: PDFGenerationOptions = {
        company: {
          companyName,
          npwp: tenantSettings?.pajak_npwp ?? null,
          address: null,
        },
        generatedAt: new Date(),
        fileName: `laba-rugi-${period.fromDate}-${period.toDate}.pdf`,
      };

      const { generateLabaRugiPDF } = await import('../../../lib/akuntansi/pdfExport');
      const blob = generateLabaRugiPDF(pdfData, options);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = options.fileName ?? 'laba-rugi.pdf';
      a.click();
      URL.revokeObjectURL(url);
      showToast('PDF berhasil di-download', 'success');
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal generate PDF: ${msg}`, 'warning');
    } finally {
      setExporting(false);
    }
  }

  // ── PPh rate label ────────────────────────────────────────────────────────
  const pphRate = accountingConfig?.pph_rate_pct ?? 0.5;
  const pphLabel = `(Beban PPh Final ${pphRate}% UMKM)`;

  // ── Period label for header ───────────────────────────────────────────────
  const headerPeriodLabel = formatPeriodLabel(period.fromDate, period.toDate);
  const summaryLabel = formatPeriodSummary(period.fromDate, period.toDate);

  // ── Check if all data is zero (empty state) ───────────────────────────────
  const isEmpty = data !== null && data.labaNeto === 0 &&
    data.pendapatan.length === 0 &&
    data.hpp.length === 0 &&
    data.bebanOperasional.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="rounded border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
      {/* ── Hero header ── */}
      <div
        className="p-6 text-white text-center"
        style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
      >
        <div className="flex items-center justify-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-emerald-200" />
          <h3 className="text-xl font-extrabold">{companyName}</h3>
        </div>
        <p className="text-xs text-emerald-100">
          Laporan Laba Rugi · Periode {headerPeriodLabel} · (dalam Rupiah)
        </p>
      </div>

      {/* ── Period selector row ── */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2 border-b border-gray-100">
        <span className="text-caleo-11 font-bold uppercase text-gray-500 mr-1">Periode:</span>
        {(['bulan-ini', '30-hari', 'tahun-ini'] as const).map(preset => (
          <button
            key={preset}
            onClick={() => handlePeriodPreset(preset)}
            className={`px-3 py-1 rounded-full text-caleo-11 font-bold transition-all ${
              periodPreset === preset
                ? 'bg-emerald-700 text-white'
                : 'border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)]'
            }`}
          >
            {preset === 'bulan-ini'
              ? `Bulan ini (${summaryLabel.split(' ')[0]})`
              : preset === '30-hari'
              ? '30 hari'
              : 'Tahun ini'}
          </button>
        ))}
        <span className="ml-auto text-caleo-11 text-gray-500">
          {period.fromDate} s/d {period.toDate}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="p-6">
        {loading ? (
          <LoadingState label="Memuat data…" />
        ) : error ? (
          <ErrorState message={`Gagal memuat data: ${error}`} />
        ) : isEmpty ? (
          <EmptyState message="Belum ada transaksi pada periode ini." />
        ) : data ? (
          <>
            {/* ── P&L Table ── */}
            <table className="w-full text-caleo-13">
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th className="text-left py-2 px-3 font-bold text-caleo-11 uppercase text-gray-600 w-full">
                    Keterangan
                  </th>
                  <th className="text-right py-2 px-3 font-bold text-caleo-11 uppercase text-gray-600 whitespace-nowrap w-44">
                    Rupiah
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* ── PENDAPATAN section ── */}
                <tr style={{ background: '#ecfdf5' }}>
                  <td colSpan={2} className="py-2 px-3 font-bold text-xs uppercase text-emerald-900">
                    PENDAPATAN
                  </td>
                </tr>
                {data.pendapatan.map(item => (
                  <tr key={item.code} className="border-t border-gray-50">
                    <td className="py-1.5 px-3 pl-6 text-gray-700">
                      {item.name}{' '}
                      <span className="text-caleo-10 text-gray-400">({item.code})</span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-gray-800">
                      {formatRupiah(item.amount)}
                    </td>
                  </tr>
                ))}
                {/* Pendapatan Bersih subtotal */}
                <tr className="border-t border-gray-200" style={{ background: '#f0fdf4' }}>
                  <td className="py-2 px-3 font-bold text-emerald-900">
                    Pendapatan Bersih
                  </td>
                  <td className="py-2 px-3 text-right font-bold font-mono text-emerald-900">
                    {formatRupiah(data.pendapatanBersih)}
                  </td>
                </tr>

                {/* ── HARGA POKOK PENJUALAN section ── */}
                <tr style={{ background: '#fff7ed' }}>
                  <td colSpan={2} className="py-2 px-3 font-bold text-xs uppercase text-orange-900">
                    HARGA POKOK PENJUALAN
                  </td>
                </tr>
                {data.hpp.map(item => (
                  <tr key={item.code} className="border-t border-gray-50">
                    <td className="py-1.5 px-3 pl-6 text-gray-700">
                      {item.name}{' '}
                      <span className="text-caleo-10 text-gray-400">({item.code})</span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-orange-800">
                      {formatRupiah(item.amount)}
                    </td>
                  </tr>
                ))}
                {/* HPP subtotal */}
                {data.hpp.length > 0 && (
                  <tr className="border-t border-gray-200" style={{ background: '#fff7ed' }}>
                    <td className="py-2 px-3 font-bold text-orange-900">
                      Total HPP
                    </td>
                    <td className="py-2 px-3 text-right font-bold font-mono text-orange-900">
                      ({formatRupiah(data.totalHpp)})
                    </td>
                  </tr>
                )}

                {/* ── LABA KOTOR emphasis ── */}
                <tr className="border-t-2 border-blue-300" style={{ background: '#dbeafe' }}>
                  <td className="py-2.5 px-3 font-extrabold text-blue-900">
                    LABA KOTOR
                  </td>
                  <td className="py-2.5 px-3 text-right font-extrabold font-mono text-blue-900">
                    {formatRupiah(data.labaKotor)}
                  </td>
                </tr>

                {/* ── BEBAN OPERASIONAL section ── */}
                <tr style={{ background: '#fff7ed' }}>
                  <td colSpan={2} className="py-2 px-3 font-bold text-xs uppercase text-orange-900">
                    BEBAN OPERASIONAL
                  </td>
                </tr>
                {data.bebanOperasional.map(item => (
                  <tr key={item.code} className="border-t border-gray-50">
                    <td className="py-1.5 px-3 pl-6 text-gray-700">
                      {item.name}{' '}
                      <span className="text-caleo-10 text-gray-400">({item.code})</span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-orange-800">
                      {formatRupiah(item.amount)}
                    </td>
                  </tr>
                ))}
                {/* Total Beban Op subtotal */}
                <tr className="border-t border-gray-200" style={{ background: '#fff7ed' }}>
                  <td className="py-2 px-3 font-bold text-orange-900">
                    Total Beban Operasional
                  </td>
                  <td className="py-2 px-3 text-right font-bold font-mono text-orange-900">
                    ({formatRupiah(data.totalBebanOp)})
                  </td>
                </tr>

                {/* ── LABA OPERASIONAL emphasis ── */}
                <tr className="border-t-2 border-blue-300" style={{ background: '#dbeafe' }}>
                  <td className="py-2.5 px-3 font-extrabold text-blue-900">
                    LABA OPERASIONAL
                  </td>
                  <td className="py-2.5 px-3 text-right font-extrabold font-mono text-blue-900">
                    {formatRupiah(data.labaOperasional)}
                  </td>
                </tr>

                {/* ── PENDAPATAN/(BEBAN) LAIN-LAIN section ── */}
                {(data.pendapatanLainLain.length > 0 || data.bebanLainLain.length > 0) && (
                  <>
                    <tr style={{ background: '#f9fafb' }}>
                      <td colSpan={2} className="py-2 px-3 font-bold text-xs uppercase text-gray-700">
                        PENDAPATAN/(BEBAN) LAIN-LAIN
                      </td>
                    </tr>
                    {data.pendapatanLainLain.map(item => (
                      <tr key={item.code} className="border-t border-gray-50">
                        <td className="py-1.5 px-3 pl-6 text-gray-700">
                          {item.name}{' '}
                          <span className="text-caleo-10 text-gray-400">({item.code})</span>
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-gray-800">
                          {formatRupiah(item.amount)}
                        </td>
                      </tr>
                    ))}
                    {data.bebanLainLain.map(item => (
                      <tr key={item.code} className="border-t border-gray-50">
                        <td className="py-1.5 px-3 pl-6 text-gray-700 italic">
                          {item.name}{' '}
                          <span className="text-caleo-10 text-gray-400">({item.code})</span>
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-orange-800">
                          ({formatRupiah(item.amount)})
                        </td>
                      </tr>
                    ))}
                  </>
                )}

                {/* ── LABA SEBELUM PAJAK emphasis ── */}
                <tr className="border-t-2 border-blue-300" style={{ background: '#dbeafe' }}>
                  <td className="py-2.5 px-3 font-extrabold text-blue-900">
                    LABA SEBELUM PAJAK
                  </td>
                  <td className="py-2.5 px-3 text-right font-extrabold font-mono text-blue-900">
                    {formatRupiah(data.labaSebelumPajak)}
                  </td>
                </tr>

                {/* Beban PPh row */}
                {data.bebanPajak !== 0 && (
                  <tr className="border-t border-gray-100">
                    <td className="py-1.5 px-3 pl-6 text-gray-600 italic text-xs">
                      {configLoaded ? pphLabel : '(Beban PPh Final)'}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-orange-800 text-xs">
                      ({formatRupiah(data.bebanPajak)})
                    </td>
                  </tr>
                )}

                {/* ── LABA NETO final row ── */}
                <tr
                  className="border-t-4"
                  style={{ background: '#d1fae5', borderColor: '#059669' }}
                >
                  <td className="py-3 px-3 font-black text-caleo-15 text-emerald-900">
                    LABA NETO BULAN INI
                  </td>
                  <td className="py-3 px-3 text-right font-black text-caleo-15 font-mono text-emerald-900">
                    {formatRupiah(data.labaNeto)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* ── Info banner ── */}
            <div
              className="mt-6 rounded p-3 flex items-start gap-2 text-caleo-11 text-amber-900 border"
              style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
            >
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                <strong>Format SAK EMKM sederhana:</strong> Pendapatan → HPP → Laba Kotor → Beban Op → Laba Operasional → Lain-lain → Laba Sebelum Pajak → Pajak → Laba Neto
              </span>
            </div>

            {/* ── Export buttons ── */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={handlePdfExport}
                disabled={exporting || !data}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileDown className="w-3.5 h-3.5" />
                {exporting ? 'Menghasilkan...' : 'PDF SAK EMKM'}
              </button>
              <button
                onClick={() => showToast('Export Excel akan hadir segera', 'info')}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border border-[var(--color-caleo-mist-dark)] bg-white text-[#1e3d60] hover:bg-[var(--color-caleo-cloud)] transition-colors"
              >
                <Grid className="w-3.5 h-3.5" />
                Excel
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
