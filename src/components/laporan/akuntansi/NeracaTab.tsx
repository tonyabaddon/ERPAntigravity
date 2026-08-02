/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Layout, FileDown, Grid, CheckCircle, AlertTriangle } from 'lucide-react';
import { fetchNeraca } from '../../../lib/akuntansi/reportQueries';
import type { NeracaResult } from '../../../lib/akuntansi/reportQueries';
import { tenantSettingsService } from '../../../lib/pengaturan/pengaturanServices';
import { fetchStoreSettings } from '../../../lib/pengaturan/queries';
import type { StoreSettings } from '../../../lib/pengaturan/types';
import type { DbTenantSettings } from '../../../types';
import type { NeracaData, PDFGenerationOptions } from '../../../lib/akuntansi/pdfExport';
import { wibDateString } from '../../../lib/format';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { captureError } from '../../../lib/captureError';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NeracaTabProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ID_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// Fallback used only until fetchStoreSettings resolves + when RLS blocks the row.
const COMPANY_NAME_FALLBACK = 'Perusahaan Anda';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAsOfLabel(date: string): string {
  // "2026-06-30" → "Per 30 Juni 2026"
  const parts = date.split('-');
  const year = parts[0] ?? '';
  const month = parseInt(parts[1] ?? '1', 10);
  const day = parseInt(parts[2] ?? '1', 10);
  return `Per ${day} ${ID_MONTHS[month - 1] ?? ''} ${year}`;
}

function formatRupiah(n: number): string {
  if (n === 0) return '—';
  const formatted = new Intl.NumberFormat('id-ID').format(Math.abs(n));
  return n < 0 ? `(${formatted})` : formatted;
}

function formatRupiahRaw(n: number): string {
  return `Rp ${new Intl.NumberFormat('id-ID').format(Math.abs(n))}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface LineItem {
  code: string;
  name: string;
  amount: number;
}

interface SectionRowsProps {
  items: LineItem[];
  negative?: boolean;
}

function SectionRows({ items, negative = false }: SectionRowsProps): React.ReactElement {
  return (
    <>
      {items.map(item => (
        <tr key={item.code} className="border-t border-gray-50">
          <td className="py-1.5 px-3 pl-6 text-gray-700 text-[12px]">
            {item.name}{' '}
            <span className="text-[10px] text-gray-400">({item.code})</span>
          </td>
          <td className="py-1.5 px-3 text-right font-mono text-[12px] text-gray-800">
            {negative ? `(${formatRupiah(item.amount)})` : formatRupiah(item.amount)}
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NeracaTab({ showToast }: NeracaTabProps): React.ReactElement {
  // As-of date state — default today in WIB
  const [asOfDate, setAsOfDate] = useState<string>(() => wibDateString(new Date()));

  // Data state
  const [data, setData] = useState<NeracaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant settings (for NPWP in PDF header)
  const [tenantSettings, setTenantSettings] = useState<DbTenantSettings | null>(null);
  // Store settings (for company name in PDF header + on-screen title)
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const companyName = storeSettings?.nama_toko ?? COMPANY_NAME_FALLBACK;

  // Export state
  const [exporting, setExporting] = useState(false);

  // ── Load tenant + store settings once on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchStoreSettings().catch(() => null).then(ss => {
      if (!cancelled) setStoreSettings(ss);
    });
    tenantSettingsService.fetch().catch(() => null).then(ts => {
      if (!cancelled) setTenantSettings(ts);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Load Neraca on asOfDate change ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchNeraca(asOfDate)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch((err: Error) => {
        captureError(err, { feature: 'laporan_neraca', action: 'fetch_neraca' });
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [asOfDate]);

  // ── PDF export ────────────────────────────────────────────────────────────
  async function handlePdfExport() {
    if (!data) return;
    setExporting(true);
    try {
      const pdfData: NeracaData = {
        asOfDate,
        asOfLabel: formatAsOfLabel(asOfDate),
        asetLancar: data.asetLancar,
        totalAsetLancar: data.totalAsetLancar,
        asetTetap: data.asetTetap,
        akumulasiPenyusutan: data.akumulasiPenyusutan,
        totalAsetTetap: data.totalAsetTetap,
        totalAset: data.totalAset,
        liabilitasLancar: data.liabilitasLancar,
        totalLiabLancar: data.totalLiabLancar,
        liabilitasJkPanjang: data.liabilitasJkPanjang,
        totalLiabJkPanjang: data.totalLiabJkPanjang,
        totalLiabilitas: data.totalLiabilitas,
        ekuitas: data.ekuitas,
        totalEkuitas: data.totalEkuitas,
      };

      const options: PDFGenerationOptions = {
        company: {
          companyName,
          npwp: tenantSettings?.pajak_npwp ?? null,
          address: null,
        },
        generatedAt: new Date(),
        fileName: `neraca-${asOfDate}.pdf`,
      };

      const { generateNeracaPDF } = await import('../../../lib/akuntansi/pdfExport');
      const blob = generateNeracaPDF(pdfData, options);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = options.fileName ?? `neraca-${asOfDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('PDF Neraca berhasil di-download', 'success');
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal generate PDF: ${msg}`, 'warning');
    } finally {
      setExporting(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const asOfLabel = formatAsOfLabel(asOfDate);
  const isEmpty = data !== null &&
    data.asetLancar.length === 0 &&
    data.asetTetap.length === 0 &&
    data.liabilitasLancar.length === 0 &&
    data.liabilitasJkPanjang.length === 0 &&
    data.ekuitas.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-sm border border-[#c7d7f5] bg-white overflow-hidden">
      {/* ── Hero header (violet) ── */}
      <div
        className="p-6 text-white text-center rounded-t-3xl"
        style={{ background: 'linear-gradient(135deg, #6b21a8, #5b21b6)' }}
      >
        <div className="flex items-center justify-center gap-2 mb-1">
          <Layout className="w-5 h-5 text-violet-200" />
          <h3 className="text-xl font-extrabold">{companyName}</h3>
        </div>
        <p className="text-[12px] text-violet-100">
          Neraca · {asOfLabel} · (dalam Rupiah)
        </p>
      </div>

      {/* ── As-of date control row ── */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-3 border-b border-gray-100">
        <span className="text-[11px] font-bold uppercase text-gray-500">Per Tanggal:</span>
        <input
          type="date"
          value={asOfDate}
          onChange={e => setAsOfDate(e.target.value)}
          className="text-[12px] border border-[#c7d7f5] rounded-sm px-3 py-1.5 text-[#1e3d60] font-bold focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        <span className="ml-auto text-[11px] text-gray-500 font-medium">{asOfLabel}</span>
      </div>

      {/* ── Body ── */}
      <div className="p-6">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-gray-500">
            Memuat data...
          </div>
        ) : error ? (
          <div className="py-8 text-center text-[13px] text-rose-600">
            Gagal memuat data: {error}
          </div>
        ) : isEmpty ? (
          <div className="py-16 text-center text-[13px] text-gray-500">
            Belum ada data Neraca pada tanggal ini.
          </div>
        ) : data ? (
          <>
            {/* ── 2-col grid ── */}
            <div className="grid lg:grid-cols-2 gap-4">

              {/* ── LEFT: ASET ── */}
              <div className="rounded-sm border border-[#c7d7f5] overflow-hidden">
                {/* Sub-card header */}
                <div className="py-2.5 px-4" style={{ background: '#dbeafe' }}>
                  <span className="font-extrabold text-[13px] text-blue-900 uppercase">ASET</span>
                </div>

                <table className="w-full text-[12px]">
                  <tbody>
                    {/* Aset Lancar section */}
                    <tr style={{ background: 'rgba(219,234,254,0.3)' }}>
                      <td colSpan={2} className="py-2 px-3 font-bold text-[11px] uppercase text-blue-800">
                        Aset Lancar
                      </td>
                    </tr>
                    <SectionRows items={data.asetLancar} />
                    {/* Total Aset Lancar subtotal */}
                    <tr className="border-t border-gray-200" style={{ background: '#eff6ff' }}>
                      <td className="py-2 px-3 font-bold text-blue-800">Total Aset Lancar</td>
                      <td className="py-2 px-3 text-right font-bold font-mono text-blue-800">
                        {formatRupiah(data.totalAsetLancar)}
                      </td>
                    </tr>

                    {/* Aset Tetap section */}
                    <tr style={{ background: 'rgba(219,234,254,0.3)' }}>
                      <td colSpan={2} className="py-2 px-3 font-bold text-[11px] uppercase text-blue-800">
                        Aset Tetap
                      </td>
                    </tr>
                    <SectionRows items={data.asetTetap} />
                    {/* Akumulasi Penyusutan — italic gray with negative parens */}
                    {data.akumulasiPenyusutan !== 0 && (
                      <tr className="border-t border-gray-50">
                        <td className="py-1.5 px-3 pl-6 text-gray-500 italic text-[12px]">
                          (Akumulasi Penyusutan)
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-gray-500 text-[12px] italic">
                          ({formatRupiah(data.akumulasiPenyusutan)})
                        </td>
                      </tr>
                    )}
                    {/* Total Aset Tetap subtotal */}
                    <tr className="border-t border-gray-200" style={{ background: '#eff6ff' }}>
                      <td className="py-2 px-3 font-bold text-blue-800">Total Aset Tetap</td>
                      <td className="py-2 px-3 text-right font-bold font-mono text-blue-800">
                        {formatRupiah(data.totalAsetTetap)}
                      </td>
                    </tr>
                  </tbody>

                  {/* TOTAL ASET footer */}
                  <tfoot>
                    <tr
                      className="border-t-4"
                      style={{ background: '#dbeafe', borderColor: '#1e40af' }}
                    >
                      <td className="py-3 px-3 font-black text-[14px] text-blue-900">TOTAL ASET</td>
                      <td className="py-3 px-3 text-right font-black text-[14px] font-mono text-blue-900">
                        {formatRupiah(data.totalAset)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* ── RIGHT: LIABILITAS + EKUITAS stacked ── */}
              <div className="space-y-4">

                {/* LIABILITAS sub-card */}
                <div className="rounded-sm border border-[#fca5a5] overflow-hidden">
                  <div className="py-2.5 px-4" style={{ background: '#fee2e2' }}>
                    <span className="font-extrabold text-[13px] text-red-900 uppercase">LIABILITAS</span>
                  </div>

                  <table className="w-full text-[12px]">
                    <tbody>
                      {/* Liabilitas Lancar section */}
                      <tr style={{ background: 'rgba(254,226,226,0.3)' }}>
                        <td colSpan={2} className="py-2 px-3 font-bold text-[11px] uppercase text-red-800">
                          Liabilitas Lancar
                        </td>
                      </tr>
                      <SectionRows items={data.liabilitasLancar} />
                      <tr className="border-t border-gray-200" style={{ background: '#fff1f2' }}>
                        <td className="py-2 px-3 font-bold text-rose-900">Total Liabilitas Lancar</td>
                        <td className="py-2 px-3 text-right font-bold font-mono text-rose-900">
                          {formatRupiah(data.totalLiabLancar)}
                        </td>
                      </tr>

                      {/* Liabilitas Jangka Panjang section */}
                      <tr style={{ background: 'rgba(254,226,226,0.3)' }}>
                        <td colSpan={2} className="py-2 px-3 font-bold text-[11px] uppercase text-red-800">
                          Liabilitas Jangka Panjang
                        </td>
                      </tr>
                      {data.liabilitasJkPanjang.length > 0 ? (
                        <SectionRows items={data.liabilitasJkPanjang} />
                      ) : (
                        <tr className="border-t border-gray-50">
                          <td colSpan={2} className="py-1.5 px-3 pl-6 text-gray-400 italic text-[11px]">
                            Tidak ada
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-gray-200" style={{ background: '#fff1f2' }}>
                        <td className="py-2 px-3 font-bold text-rose-900">Total Liabilitas Jangka Panjang</td>
                        <td className="py-2 px-3 text-right font-bold font-mono text-rose-900">
                          {formatRupiah(data.totalLiabJkPanjang)}
                        </td>
                      </tr>
                    </tbody>

                    {/* TOTAL LIABILITAS footer */}
                    <tfoot>
                      <tr
                        className="border-t-2"
                        style={{ background: '#fee2e2', borderColor: '#dc2626' }}
                      >
                        <td className="py-2.5 px-3 font-extrabold text-[13px] text-rose-900">TOTAL LIABILITAS</td>
                        <td className="py-2.5 px-3 text-right font-extrabold text-[13px] font-mono text-rose-900">
                          {formatRupiah(data.totalLiabilitas)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* EKUITAS sub-card */}
                <div className="rounded-sm border border-[#c4b5fd] overflow-hidden">
                  <div className="py-2.5 px-4" style={{ background: '#e9d5ff' }}>
                    <span className="font-extrabold text-[13px] text-violet-900 uppercase">EKUITAS</span>
                  </div>

                  <table className="w-full text-[12px]">
                    <tbody>
                      {data.ekuitas.map(item => (
                        <tr key={item.code} className="border-t border-gray-50">
                          <td className="py-1.5 px-3 pl-6 text-gray-700">
                            {item.name}{' '}
                            <span className="text-[10px] text-gray-400">({item.code})</span>
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-gray-800">
                            {formatRupiah(item.amount)}
                          </td>
                        </tr>
                      ))}
                      {data.ekuitas.length === 0 && (
                        <tr>
                          <td colSpan={2} className="py-2 px-3 text-gray-400 italic text-[11px]">
                            Tidak ada data ekuitas
                          </td>
                        </tr>
                      )}
                    </tbody>

                    {/* TOTAL EKUITAS footer */}
                    <tfoot>
                      <tr
                        className="border-t-2"
                        style={{ background: '#e9d5ff', borderColor: '#7c3aed' }}
                      >
                        <td className="py-2.5 px-3 font-extrabold text-[13px] text-violet-900">TOTAL EKUITAS</td>
                        <td className="py-2.5 px-3 text-right font-extrabold text-[13px] font-mono text-violet-900">
                          {formatRupiah(data.totalEkuitas)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Balance confirmation sub-card */}
                <div
                  className="rounded-sm border-2 p-4 text-center"
                  style={{ background: '#d1fae5', borderColor: '#059669' }}
                >
                  <p className="text-[10px] font-bold uppercase text-emerald-900 tracking-wide mb-1">
                    TOTAL LIABILITAS + EKUITAS
                  </p>
                  <p className="text-2xl font-black text-emerald-900 font-mono">
                    {formatRupiahRaw(data.totalLiabilitas + data.totalEkuitas)}
                  </p>
                  {data.balanceCheck.isBalanced ? (
                    <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-emerald-800 font-bold">
                      <CheckCircle className="w-4 h-4" />
                      <span>SEIMBANG dengan Total Aset</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-center gap-1.5 text-[12px] text-red-700 font-bold">
                      <AlertTriangle className="w-4 h-4" />
                      <span>TIDAK SEIMBANG · selisih {formatRupiahRaw(Math.abs(data.balanceCheck.diff))}</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ── Verification banner (full width) ── */}
            <div
              className="mt-6 rounded-sm p-3 flex items-center gap-2 text-[11px] text-amber-900 border"
              style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
            >
              {data.balanceCheck.isBalanced ? (
                <CheckCircle className="w-4 h-4 text-amber-700 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              )}
              {data.balanceCheck.isBalanced ? (
                <span>
                  <strong>Persamaan akuntansi terverifikasi:</strong>{' '}
                  Aset ({formatRupiahRaw(data.totalAset)}) = Liabilitas ({formatRupiahRaw(data.totalLiabilitas)}) + Ekuitas ({formatRupiahRaw(data.totalEkuitas)}) ✓ · SAK EMKM Section 4 (Penyajian Wajar)
                </span>
              ) : (
                <span>
                  <strong>Persamaan akuntansi TIDAK seimbang:</strong>{' '}
                  Aset ({formatRupiahRaw(data.totalAset)}) vs Liabilitas + Ekuitas ({formatRupiahRaw(data.totalLiabilitas + data.totalEkuitas)}) · selisih {formatRupiahRaw(Math.abs(data.balanceCheck.diff))}
                </span>
              )}
            </div>

            {/* ── Export buttons ── */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={handlePdfExport}
                disabled={exporting || !data}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileDown className="w-3.5 h-3.5" />
                {exporting ? 'Menghasilkan...' : 'PDF SAK EMKM'}
              </button>
              <button
                onClick={() => showToast('Export Excel akan hadir segera', 'info')}
                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-full border border-[#c7d7f5] bg-white text-[#1e3d60] hover:bg-[#eff4ff] transition-colors"
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
