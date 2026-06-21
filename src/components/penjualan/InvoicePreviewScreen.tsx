// InvoicePreviewScreen.tsx
//
// Post-save destination for the Catat Penjualan wizard. Loads a saved
// kasir_transactions row by id and renders the existing SalesInvoicePDF, plus
// 4 action buttons (Cetak Printer Biasa, Cetak Dot Matrix, Bagikan WA,
// Download PDF) and 2 nav buttons (+ Catat Lagi, Lihat Daftar Pesanan).
//
// Scope (per T17 brief): handles non-TEMPO transactions only. TEMPO orders
// live in the `orders` table (not `kasir_transactions`) and the wizard
// orchestrator routes them to `piutang` directly. If a TEMPO id is somehow
// passed here, the fetch will surface a clear "not found" state.
//
// T18 adds a `printMode` prop to SalesInvoicePDF for the A4 vs dot-matrix
// stylesheet split; for now both cetak buttons fall through to window.print()
// and the existing @media print rules in SalesInvoicePDF render the modal.

import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { KasirTransaction } from '../../types';
import { supabase } from '../../lib/supabaseClient';
import SalesInvoicePDF, { type InvoiceVariant } from './SalesInvoicePDF';

interface Props {
  orderId: string;
  adminName?: string;
  onCatatLagi: () => void;
  onLihatDaftar: () => void;
  onBack: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function InvoicePreviewScreen({
  orderId,
  adminName,
  onCatatLagi,
  onLihatDaftar,
  onBack,
  showToast,
}: Props) {
  const [transaction, setTransaction] = useState<KasirTransaction | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPdfModal, setShowPdfModal] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoadError('Supabase belum dikonfigurasi.');
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('kasir_transactions')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message ?? 'Gagal memuat invoice.');
        return;
      }
      if (!data) {
        setLoadError(
          'Transaksi tidak ditemukan di kasir_transactions. ' +
          'Jika ini faktur TEMPO, buka halaman Piutang.',
        );
        return;
      }
      setTransaction(data as KasirTransaction);
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  // Cetak buttons: T18 will introduce printMode prop for A4 vs dot-matrix
  // stylesheet split. Today both share the same SalesInvoicePDF print CSS.
  const onCetak = (_mode: 'normal' | 'dot_matrix') => {
    if (!transaction) {
      showToast('Invoice belum termuat, coba sebentar lagi.', 'warning');
      return;
    }
    // Open the SalesInvoicePDF modal which has @media print rules that
    // isolate #sales-invoice-root for printing. The modal also exposes a
    // Cetak Ulang button; opening it via state is the minimal hook today.
    setShowPdfModal(true);
    setTimeout(() => window.print(), 200);
  };

  const onBagikanWA = () => {
    if (!transaction) {
      showToast('Invoice belum termuat.', 'warning');
      return;
    }
    const raw = transaction.customer_phone ?? '';
    const phone = raw.replace(/\D/g, '').replace(/^0/, '62');
    if (!phone) {
      showToast('Customer tidak punya nomor WhatsApp.', 'warning');
      return;
    }
    const total = transaction.total_amount ?? transaction.subtotal;
    const summary =
      `Halo ${transaction.customer_name ?? ''}, berikut invoice ${transaction.invoice_number ?? ''} ` +
      `dengan total Rp ${Math.round(total).toLocaleString('id-ID')}. Terima kasih atas pesanannya.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(summary)}`, '_blank');
  };

  const onDownloadPdf = () => {
    if (!transaction) {
      showToast('Invoice belum termuat.', 'warning');
      return;
    }
    // SalesInvoicePDF doesn't expose a programmatic download — the print
    // dialog ("Save as PDF") is the existing UX. Surface the modal so the
    // user can either Cetak Ulang or use the browser's Save as PDF.
    setShowPdfModal(true);
    showToast('Pilih "Save as PDF" pada dialog cetak browser.', 'info');
  };

  // Derive SalesInvoicePDF variant from payment_type. Only 'dp' | 'lunas'
  // exist today; FULL & TEMPO both map to 'lunas' (TEMPO shouldn't reach
  // this screen per scope note above).
  const variant: InvoiceVariant = transaction?.payment_type === 'DP' ? 'dp' : 'lunas';

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="bg-[#012749] text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/80 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="font-extrabold text-sm flex items-center gap-2">
              <span className="text-emerald-300">✓</span> Penjualan Tersimpan
            </div>
            <div className="text-[11px] opacity-65">
              {transaction?.invoice_number ? `Invoice ${transaction.invoice_number}` : 'Memuat invoice…'}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onLihatDaftar}
            className="px-3 py-1.5 text-[11px] font-bold rounded-full bg-white/15 hover:bg-white/25"
          >
            📋 Daftar Pesanan
          </button>
          <button
            onClick={onCatatLagi}
            className="px-3 py-1.5 text-[11px] font-bold rounded-full bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            + Catat Lagi
          </button>
        </div>
      </div>

      <div className="bg-white rounded-b-2xl p-5 md:p-6 shadow-sm">
        {loadError ? (
          <div className="text-center py-12">
            <div className="text-amber-700 font-bold mb-2">⚠️ Tidak dapat memuat invoice</div>
            <div className="text-xs text-slate-500 max-w-md mx-auto">{loadError}</div>
            <button
              onClick={onLihatDaftar}
              className="mt-4 px-4 py-2 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
            >
              Buka Daftar Pesanan
            </button>
          </div>
        ) : !transaction ? (
          <p className="text-center text-slate-400 py-12 text-sm">Memuat invoice…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
            <div>
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Ringkasan Invoice
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="text-slate-500">Invoice</div>
                  <div className="font-semibold text-right">{transaction.invoice_number ?? '—'}</div>
                  <div className="text-slate-500">Customer</div>
                  <div className="font-semibold text-right">{transaction.customer_name ?? '—'}</div>
                  <div className="text-slate-500">Total</div>
                  <div className="font-extrabold text-right text-[#012749]">
                    Rp {Math.round(transaction.total_amount ?? transaction.subtotal).toLocaleString('id-ID')}
                  </div>
                  <div className="text-slate-500">Jenis Bayar</div>
                  <div className="font-semibold text-right">{transaction.payment_type ?? 'FULL'}</div>
                </div>
                <button
                  onClick={() => setShowPdfModal(true)}
                  className="mt-3 w-full px-3 py-2 text-xs font-bold rounded-lg bg-white text-[#012749] border border-slate-300 hover:bg-slate-50"
                >
                  👁️ Lihat Preview Invoice
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Cetak</div>
              <button
                onClick={() => onCetak('normal')}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
              >
                🖨️ Cetak Printer Biasa (A4 / A5)
              </button>
              <button
                onClick={() => onCetak('dot_matrix')}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800"
              >
                🖨️ Cetak Dot Matrix
              </button>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1 mt-4">
                File &amp; Share
              </div>
              <button
                onClick={onBagikanWA}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
              >
                📱 Bagikan via WhatsApp
              </button>
              <button
                onClick={onDownloadPdf}
                className="w-full px-4 py-3 text-sm font-semibold rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
              >
                ⬇️ Download PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {showPdfModal && transaction && (
        <SalesInvoicePDF
          transaction={transaction}
          variant={variant}
          adminName={adminName}
          onClose={() => setShowPdfModal(false)}
        />
      )}
    </div>
  );
}
