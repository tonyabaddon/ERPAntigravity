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
import SalesInvoicePDF, { type InvoiceVariant, type InvoicePrintMode } from './SalesInvoicePDF';
import TambahLayananModal from './TambahLayananModal';
import { formatIDR } from '../../lib/formatIDR';

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
  // When true, the SalesInvoicePDF modal opens with `autoPrint` so its own
  // internal "wait until store/bank fetched, then print" gate fires the dialog
  // instead of our racey 200ms setTimeout. Reset to false on next manual open.
  const [autoPrintOnOpen, setAutoPrintOnOpen] = useState(false);
  // Drives the SalesInvoicePDF printMode prop. The two Cetak buttons set this
  // before opening the modal so @page size + monospace stylesheet match the
  // operator's chosen printer family.
  const [pdfPrintMode, setPdfPrintMode] = useState<InvoicePrintMode>('normal');
  const [layananModalOpen, setLayananModalOpen] = useState(false);

  useEffect(() => {
    // Reset error state when orderId changes; without this, stale error from
    // a prior invoice sticks even after user navigates to a valid one.
    setLoadError(null);
    let cancelled = false;
    void (async () => {
      // Re-check supabase at fetch time (not at effect-mount time) so that a
      // post-impersonation JWT swap doesn't leave the screen stuck on
      // "belum dikonfigurasi" until manual nav away and back.
      if (!supabase) {
        setLoadError('Supabase belum dikonfigurasi.');
        return;
      }
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

  // Cetak buttons: T18 wired the printMode prop on SalesInvoicePDF — selecting
  // a mode here drives both the modal's @page size and the monospace fallback.
  const onCetak = (mode: InvoicePrintMode) => {
    if (!transaction) {
      showToast('Invoice belum termuat, coba sebentar lagi.', 'warning');
      return;
    }
    // Open SalesInvoicePDF with autoPrint=true so its internal gate fires
    // window.print() AFTER fetchStoreSettings + fetchBankAccounts resolve.
    // A raw setTimeout here would race the modal's own data load on cold
    // cache and print before the store header renders.
    setPdfPrintMode(mode);
    setAutoPrintOnOpen(true);
    setShowPdfModal(true);
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
      `dengan total ${formatIDR(Math.round(total))}. Terima kasih atas pesanannya.`;
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
    setPdfPrintMode('normal');
    setAutoPrintOnOpen(false);
    setShowPdfModal(true);
    showToast('Pilih "Save as PDF" pada dialog cetak browser.', 'info');
  };

  // Derive SalesInvoicePDF variant from payment_type. Only 'dp' | 'lunas'
  // exist today; FULL & TEMPO both map to 'lunas' (TEMPO shouldn't reach
  // this screen per scope note above).
  const variant: InvoiceVariant = transaction?.payment_type === 'DP' ? 'dp' : 'lunas';

  // Status workflow stepper definition per payment type. Mirrors the mockup
  // right-rail status list (LUNAS/DP have a 3-step lifecycle; the WIP/TEMPO
  // paths reroute earlier and shouldn't land here, but the fall-through case
  // still produces a sane status list).
  const isDp = transaction?.payment_type === 'DP';
  const status: Array<{ state: 'done' | 'wait' | 'pending'; label: string }> = isDp
    ? [
        { state: 'done',    label: 'Pesanan tercatat' },
        { state: 'wait',    label: 'DP diterima · menunggu pelunasan' },
        { state: 'pending', label: 'Lunas' },
      ]
    : [
        { state: 'done',    label: 'Pesanan tercatat' },
        { state: 'done',    label: 'Pembayaran lunas' },
        { state: 'done',    label: 'Invoice siap diserahkan ke customer' },
      ];

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      {/* Header — white bg with navy text per mockup */}
      <div className="bg-white border border-slate-200 rounded-t-lg px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 hover:text-slate-700">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-600">✓</span>
              <h1 className="text-lg font-extrabold text-[#012749]">Penjualan Tersimpan</h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {transaction?.invoice_number
                ? <>Invoice <strong>{transaction.invoice_number}</strong> · {transaction.payment_type ?? 'FULL'}</>
                : 'Memuat invoice…'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setLayananModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-emerald-700 border border-emerald-300 hover:bg-emerald-50"
            title="Tambah layanan (Wiring / Jasa) dari katalog"
          >
            🛠 Tambah Layanan
          </button>
          <button
            onClick={onLihatDaftar}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 border border-slate-300 hover:bg-slate-100"
          >
            📋 Lihat di Daftar Pesanan
          </button>
          <button
            onClick={onCatatLagi}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
          >
            + Catat Penjualan Lagi
          </button>
        </div>
      </div>

      {layananModalOpen && (
        <TambahLayananModal
          orderId={orderId}
          onDone={() => {
            setLayananModalOpen(false);
            showToast('Layanan berhasil ditambahkan ke pesanan', 'success');
          }}
          onCancel={() => setLayananModalOpen(false)}
          showToast={showToast}
        />
      )}

      <div className="bg-white border-x border-b border-slate-200 rounded-b-lg p-5 md:p-6 shadow-sm">
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT col-span-8: invoice preview card */}
            <div className="lg:col-span-8">
              <div className="bg-slate-100 rounded-lg p-6 min-h-[500px] flex items-center justify-center">
                <div className="bg-white shadow-lg rounded p-8 max-w-2xl w-full">
                  <div className="text-center mb-4">
                    <div className="text-5xl opacity-30">📄</div>
                  </div>
                  <div className="border-b border-slate-200 pb-3 mb-3 text-center">
                    <div className="text-base font-extrabold text-[#012749]">Invoice {transaction.invoice_number ?? '—'}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{transaction.payment_type ?? 'FULL'} · {new Date(transaction.date ?? Date.now()).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                  </div>
                  {/* I-1 fix: gross subtotal + totalDiscount so customer sees transparent math */}
                  {(() => {
                    const items = (transaction.items ?? []) as any[];
                    const grossSubtotal = items.reduce(
                      (sum, item) => sum + ((item.master_price_at_sale ?? item.unit_price) * item.qty), 0,
                    );
                    const lineDiscount = items.reduce((sum, i) => sum + (i.discount_amount_rp ?? 0), 0);
                    const orderDiscount = transaction.discount_amount_rp ?? 0;
                    const totalDiscount = lineDiscount + orderDiscount;
                    const discountLabel = transaction.discount_type === 'PERCENT' && transaction.discount_value
                      ? `Diskon (order ${transaction.discount_value}%)`
                      : lineDiscount > 0 && orderDiscount > 0
                      ? 'Diskon (baris + order)'
                      : lineDiscount > 0
                      ? 'Diskon baris'
                      : 'Diskon Order';
                    return (
                      <div className="grid grid-cols-2 gap-2 text-[12px] mb-3">
                        <div className="text-slate-500">Customer</div>
                        <div className="font-semibold text-right">{transaction.customer_name ?? '—'}</div>
                        {transaction.customer_phone && (
                          <>
                            <div className="text-slate-500">HP</div>
                            <div className="font-semibold text-right">{transaction.customer_phone}</div>
                          </>
                        )}
                        <div className="text-slate-500">Subtotal</div>
                        <div className="font-semibold text-right">{formatIDR(Math.round(grossSubtotal))}</div>
                        {(transaction.ongkir_amount ?? 0) > 0 && (
                          <>
                            <div className="text-slate-500">Ongkir</div>
                            <div className="font-semibold text-right">{formatIDR(Math.round(transaction.ongkir_amount ?? 0))}</div>
                          </>
                        )}
                        {totalDiscount > 0 && (
                          <>
                            <div className="text-slate-500">{discountLabel}</div>
                            <div className="font-semibold text-right text-rose-600">
                              − {formatIDR(Math.round(totalDiscount))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                    <div className="text-sm font-bold text-slate-700">TOTAL</div>
                    <div className="text-xl font-extrabold text-[#012749]">
                      {formatIDR(Math.round(transaction.total_amount ?? transaction.subtotal))}
                    </div>
                  </div>
                  <button
                    onClick={() => { setPdfPrintMode('normal'); setAutoPrintOnOpen(false); setShowPdfModal(true); }}
                    className="mt-4 w-full px-3 py-2 text-xs font-bold rounded-lg bg-white text-[#012749] border border-slate-300 hover:bg-slate-50"
                  >
                    👁️ Buka Preview Invoice Lengkap (Modal)
                  </button>
                </div>
              </div>
            </div>

            {/* RIGHT col-span-4: actions + workflow stepper */}
            <div className="lg:col-span-4 space-y-2">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Cetak</div>
              <button
                onClick={() => onCetak('normal')}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 flex items-center justify-center gap-2"
              >
                🖨️ Printer Biasa (A4 / A5)
              </button>
              <button
                onClick={() => onCetak('dot_matrix')}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800 flex items-center justify-center gap-2"
              >
                🖨️ Dot Matrix (struk panjang)
              </button>
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 mt-4">File &amp; Share</div>
              <button
                onClick={onBagikanWA}
                className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-2"
              >
                📱 Bagikan via WhatsApp
              </button>
              <button
                onClick={onDownloadPdf}
                className="w-full px-4 py-3 text-sm font-semibold rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 flex items-center justify-center gap-2"
              >
                ⬇️ Download PDF
              </button>

              {/* Workflow stepper */}
              <div className="mt-6 pt-4 border-t border-slate-200">
                <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Status Workflow</div>
                <div className="space-y-2 text-xs">
                  {status.map((s, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-2 ${
                        s.state === 'done' ? 'text-emerald-700'
                        : s.state === 'wait' ? 'text-amber-700'
                        : 'text-slate-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                        s.state === 'done' ? 'bg-emerald-600'
                        : s.state === 'wait' ? 'bg-amber-500'
                        : 'bg-slate-300'
                      }`}>
                        {s.state === 'done' ? '✓' : s.state === 'wait' ? '⌛' : idx + 1}
                      </div>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showPdfModal && transaction && (
        <SalesInvoicePDF
          transaction={transaction}
          variant={variant}
          adminName={adminName}
          autoPrint={autoPrintOnOpen}
          printMode={pdfPrintMode}
          onClose={() => { setShowPdfModal(false); setAutoPrintOnOpen(false); }}
        />
      )}
    </div>
  );
}
