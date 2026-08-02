import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, X, Loader2 } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { previewYearEndClose, postYearEndClose } from '../../../lib/saldoAwal/api';
import type { YearEndClosePreview } from '../../../lib/saldoAwal/types';
import { formatIDR } from '../../../lib/formatIDR';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';
import { captureError } from '../../../lib/captureError';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface YearEndCloseButtonProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine which fiscal year the button targets.
 *
 * Logic:
 *   - Default = current_year - 1 (close the previous year)
 *   - Exception: if today >= Dec 15 of the current year, allow closing current year early
 */
function targetFiscalYear(): number {
  const now = new Date();
  const wibNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const year = wibNow.getFullYear();
  const month = wibNow.getMonth() + 1; // 1-indexed
  const day = wibNow.getDate();
  if (month === 12 && day >= 15) {
    return year;
  }
  return year - 1;
}

/**
 * Check if a year_end_close_events row with status='posted' exists for the tenant+year.
 * Returns true when the year is already closed (button should be disabled).
 */
async function checkAlreadyClosed(fiscalYear: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('year_end_close_events')
    .select('id')
    .eq('fiscal_year', fiscalYear)
    .eq('status', 'posted')
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Tutup Buku Tahun [YEAR]" button placed in the Laporan Akuntansi header row.
 *
 * Disabled when:
 * - fiscal_year > current year (sanity guard, should not happen given targetFiscalYear())
 * - year_end_close_events already has a posted event for this year
 *
 * On click → fetch preview → show confirmation modal with checkbox → post on confirm.
 */
export default function YearEndCloseButton({ showToast }: YearEndCloseButtonProps): React.ReactElement {
  const fiscalYear = targetFiscalYear();

  const [alreadyClosed, setAlreadyClosed] = useState<boolean | null>(null); // null = loading
  const [checkError, setCheckError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [preview, setPreview] = useState<YearEndClosePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Check if year already closed on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    checkAlreadyClosed(fiscalYear)
      .then(closed => { if (!cancelled) setAlreadyClosed(closed); })
      .catch(err => {
        if (!cancelled) {
          captureError(err, { feature: 'laporan_year_end', action: 'check_already_closed' });
          setCheckError(extractErrorMessage(err));
          setAlreadyClosed(false); // fail-open: show button, modal will surface error
        }
      });
    return () => { cancelled = true; };
  }, [fiscalYear]);

  // ── Open modal: fetch preview ─────────────────────────────────────────────
  const handleOpenModal = useCallback(async () => {
    setModalOpen(true);
    setPreview(null);
    setPreviewError(null);
    setConfirmed(false);
    setPreviewLoading(true);
    try {
      const data = await previewYearEndClose(fiscalYear);
      setPreview(data);
    } catch (err) {
      const msg = extractErrorMessage(err);
      captureError(err, { feature: 'laporan_year_end', action: 'preview_year_end_close' });
      setPreviewError(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [fiscalYear]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await postYearEndClose(fiscalYear);
      showToast(`Tutup buku tahun ${fiscalYear} berhasil. Laporan Laba Rugi ${fiscalYear + 1} mulai dari 0.`, 'success');
      setModalOpen(false);
      setAlreadyClosed(true);
      // Reload the page so all report data reflects the new closing JE
      window.location.reload();
    } catch (err) {
      const msg = extractErrorMessage(err);
      captureError(err, { feature: 'laporan_year_end', action: 'post_year_end_close' });
      showToast(`Gagal tutup buku: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  }, [fiscalYear, showToast]);

  // ── Derive disabled state ─────────────────────────────────────────────────
  const isDisabled = alreadyClosed === true || checkError !== null;
  const isLoading = alreadyClosed === null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Trigger button */}
      <button
        onClick={handleOpenModal}
        disabled={isDisabled || isLoading}
        title={
          alreadyClosed
            ? `Tahun ${fiscalYear} sudah ditutup`
            : checkError
            ? `Error: ${checkError}`
            : `Tutup Buku Tahun ${fiscalYear}`
        }
        className="inline-flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: isDisabled ? '#f3f4f6' : '#fef3c7',
          borderWidth: 1,
          borderColor: isDisabled ? '#e5e7eb' : '#fcd34d',
          color: isDisabled ? '#9ca3af' : '#78350f',
        }}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <BookOpen className="w-3.5 h-3.5" />
        )}
        {alreadyClosed ? `Tahun ${fiscalYear} Ditutup` : `Tutup Buku Tahun ${fiscalYear}`}
      </button>

      {/* Confirmation modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => { if (!submitting) setModalOpen(false); }}
        >
          <div
            className="bg-white rounded-sm shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-700" />
                <h2 className="text-[15px] font-bold text-gray-900">
                  Tutup Buku Tahun {fiscalYear}?
                </h2>
              </div>
              {!submitting && (
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                  aria-label="Tutup modal"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>

            {/* Modal body */}
            <div className="px-6 py-5 space-y-4">
              {previewLoading && (
                <div className="flex items-center justify-center py-8 text-[13px] text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Memuat preview...
                </div>
              )}

              {previewError && (
                <div className="rounded-sm px-4 py-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200">
                  Gagal memuat preview: {previewError}
                </div>
              )}

              {preview && !previewLoading && (
                <>
                  {/* Preview block */}
                  <div className="rounded-sm border border-amber-200 bg-amber-50 overflow-hidden">
                    <div className="px-4 py-2 border-b border-amber-200">
                      <p className="text-[12px] font-bold uppercase tracking-wide text-amber-900">
                        Preview Tahun {fiscalYear}
                      </p>
                    </div>
                    <div className="px-4 py-3 space-y-2 text-[13px]">
                      <div className="flex justify-between">
                        <span className="text-gray-700">Total Pendapatan {fiscalYear}</span>
                        <span className="font-mono font-bold text-emerald-800">
                          {formatIDR(preview.total_revenue)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-700">Total Beban {fiscalYear}</span>
                        <span className="font-mono font-bold text-rose-800">
                          ({formatIDR(preview.total_expense)})
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-amber-200 pt-2 mt-1">
                        <span className="font-bold text-gray-900">Net Income</span>
                        <span className={`font-mono font-bold text-[14px] ${
                          preview.net_income >= 0 ? 'text-emerald-800' : 'text-rose-800'
                        }`}>
                          {preview.net_income < 0
                            ? `(${formatIDR(Math.abs(preview.net_income))})`
                            : formatIDR(preview.net_income)
                          }
                        </span>
                      </div>
                      <div className="text-[11px] text-amber-800 italic pt-1">
                        &rarr; Transfer ke Laba Ditahan
                      </div>
                    </div>
                  </div>

                  {/* Explanation */}
                  <div className="text-[12px] text-gray-600 space-y-1">
                    <p>Sistem akan membuat Jurnal Umum yang me-nol-kan semua akun
                    Pendapatan &amp; Beban {fiscalYear} dan mentransfer selisihnya ke
                    <strong> Laba Ditahan</strong>. Laporan Laba Rugi {fiscalYear + 1}
                    akan mulai dari 0.</p>
                    <p className="text-amber-800 text-[11px]">
                      Reverse via menu <strong>Mutasi</strong> jika perlu koreksi.
                    </p>
                  </div>

                  {/* Confirmation checkbox */}
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-amber-700 cursor-pointer"
                    />
                    <span className="text-[13px] text-gray-800">
                      Saya sudah verify semua transaksi <strong>{fiscalYear}</strong> sudah lengkap dan benar
                    </span>
                  </label>
                </>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="px-4 py-2 rounded-full text-[13px] font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleSubmit}
                disabled={!confirmed || !preview || submitting || previewLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: '#92400e',
                  color: '#fff',
                }}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {submitting ? 'Memproses...' : `Tutup Buku ${fiscalYear}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
