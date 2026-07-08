import React, { useEffect, useRef, useState } from 'react';
import { X, Printer } from 'lucide-react';
import { KasirTransaction } from '../../types';
import type { SalesChannel } from '../../types';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { fetchStoreSettings, fetchBankAccounts } from '../../lib/pengaturan/queries';
import type { StoreSettings, BankAccount } from '../../lib/pengaturan/types';
import { formatRp } from '../../lib/format';
import { CHANNEL_VISUAL } from '../../lib/salesChannels';

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
}

export type InvoiceVariant = 'dp' | 'lunas' | 'quotation';
export type InvoicePrintMode = 'normal' | 'dot_matrix';

export interface SalesInvoicePDFProps {
  transaction: KasirTransaction;
  variant: InvoiceVariant;
  adminName?: string;
  autoPrint?: boolean;
  /**
   * 'normal' (default) → 9.5×11in continuous A4-ish layout (existing CSS).
   * 'dot_matrix'       → 9.5×11in letter-fanfold layout with monospace font,
   *                      tighter paddings, no background colors. Targets
   *                      Epson LX-310 / LX-2190 fanfold impact printers.
   *                      Earlier this was set to 80mm (thermal receipt width)
   *                      which mismatched the LX-310 fanfold operators use in
   *                      practice — output was chopped and drivers rejected it.
   */
  printMode?: InvoicePrintMode;
  onClose: () => void;
}

export default function SalesInvoicePDF({ transaction, variant, adminName, autoPrint, printMode = 'normal', onClose }: SalesInvoicePDFProps) {
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    Promise.all([fetchStoreSettings(), fetchBankAccounts(true)])
      .then(([st, accounts]) => { setStore(st); setBank(accounts[0] ?? null); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Override document.title for the duration the modal is open so the browser
  // print header shows the invoice number (e.g. "Invoice GJP-0042") instead of
  // the app's tab title ("Garindo Jaya Panel MSME ERP & Selling Bot").
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `Invoice ${transaction.invoice_number ?? ''}`.trim();
    return () => { document.title = previousTitle; };
  }, [transaction.invoice_number]);

  // Auto-print after data resolves. requestAnimationFrame ensures the DOM
  // (with the new @media print stylesheet swapped in for dot_matrix mode) is
  // painted before window.print() captures it; a bare setTimeout could fire
  // before React committed the update, producing a blank print preview.
  const autoPrintFiredRef = useRef(false);
  useEffect(() => {
    if (!autoPrint || loading || autoPrintFiredRef.current) return;
    autoPrintFiredRef.current = true;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
    return () => cancelAnimationFrame(raf);
  }, [autoPrint, loading]);

  const channelLabel = CHANNEL_VISUAL[(transaction.channel ?? 'walkin') as SalesChannel].label;

  const paymentLabel = (() => {
    if (transaction.payment_method === 'edc') {
      return `EDC ${transaction.payment_subtype === 'qris' ? 'QRIS' : 'Debit'}`;
    }
    if (transaction.payment_method === 'qris') return 'QRIS';
    if (transaction.payment_method === 'transfer') return 'Transfer';
    return 'Cash';
  })();

  // Dot-matrix keeps the same JSX tree and swaps only the print stylesheet + a
  // root class so InvoiceBody can react with Tailwind conditionals (font,
  // paddings) without two parallel render trees. Page size stays 9.5×11in
  // (letter fanfold — LX-310 / LX-2190 native); the difference from 'normal'
  // is: monospace font, no color fills (saves ribbon), no shadows.
  const printCss = printMode === 'dot_matrix'
    ? `
        @media print {
          @page { size: 9.5in 11in; margin: 0.5in 0.4in; }
          body * { visibility: hidden; }
          #sales-invoice-root, #sales-invoice-root * { visibility: visible; }
          #sales-invoice-root { position: fixed; top: 0; left: 0; width: 100%; background: white; box-shadow: none !important; border-radius: 0 !important; }
          #sales-invoice-root, #sales-invoice-root * {
            font-family: 'Courier New', 'Courier', monospace !important;
            color: #000 !important;
            background: #fff !important;
            box-shadow: none !important;
            border-color: #000 !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `
    : `
        @media print {
          @page { size: 9.5in 11in; margin: 0.5in 0.5in; }
          body * { visibility: hidden; }
          #sales-invoice-root, #sales-invoice-root * { visibility: visible; }
          #sales-invoice-root { position: fixed; top: 0; left: 0; width: 100%; background: white; }
          .print\\:hidden { display: none !important; }
        }
      `;

  return (
    <>
      <style>{printCss}</style>

      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="sales-invoice-root"
          className={`bg-white rounded-lg shadow-2xl w-full max-h-[90vh] overflow-auto print-mode-${printMode} max-w-3xl`}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2 bg-[#012749] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-[13px]">
              Invoice {transaction.invoice_number}
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1 bg-[#2d8a4e] rounded text-[12px] font-bold">
                <Printer className="w-3.5 h-3.5" /> Cetak Ulang
              </button>
              <button onClick={onClose}><X className="w-4 h-4" /></button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400">Memuat...</div>
          ) : (
            <InvoiceBody transaction={transaction} variant={variant} adminName={adminName} store={store} bank={bank} channelLabel={channelLabel} paymentLabel={paymentLabel} printMode={printMode} />
          )}
        </div>
      </div>
    </>
  );
}

interface InvoiceBodyProps {
  transaction: KasirTransaction;
  variant: InvoiceVariant;
  adminName?: string;
  store: StoreSettings | null;
  bank: BankAccount | null;
  channelLabel: string;
  paymentLabel: string;
  printMode: InvoicePrintMode;
}

// Body extracted to its own function for clarity (still in the same file).
function InvoiceBody({
  transaction: t, variant, adminName, store, bank, channelLabel, paymentLabel, printMode,
}: InvoiceBodyProps) {
  const isQuotation = variant === 'quotation';
  const subtotal = t.subtotal;
  // Gross subtotal: sum of master_price_at_sale × qty (fallback to unit_price for pre-Task-14 rows)
  const grossSubtotal = (t.items as any[]).reduce(
    (sum, item) => sum + ((item.master_price_at_sale ?? item.unit_price) * item.qty), 0,
  );
  const ongkir = t.ongkir_amount ?? 0;
  const total = t.total_amount ?? t.subtotal + ongkir;
  const dp = t.dp_amount ?? 0;
  // I-1 fix: total discount = per-line + order-level (mirrors KasirInvoiceModal lines 155-175).
  const lineDiscount = (t.items as any[]).reduce((sum, i) => sum + (i.discount_amount_rp ?? 0), 0);
  const orderDiscount = t.discount_amount_rp ?? 0;
  const totalDiscount = lineDiscount + orderDiscount;
  // Smart label: match KasirInvoiceModal pattern
  const discountLabel = t.discount_type === 'PERCENT' && t.discount_value
    ? `Diskon (order ${t.discount_value}%)`
    : lineDiscount > 0 && orderDiscount > 0
    ? 'Diskon (baris + order)'
    : lineDiscount > 0
    ? 'Diskon baris'
    : 'Diskon Order';
  const sisa = variant === 'dp' ? total - dp : 0;
  const sudahDibayar = variant === 'lunas' ? total : dp;

  // Dot-matrix: trim padding so the layout fits a narrow 80mm fanfold and
  // strip the rotated DP/LUNAS watermark (it doesn't render meaningfully in
  // monochrome impact print and would only chew ribbon).
  const containerCls = printMode === 'dot_matrix'
    ? 'bg-white p-3 font-mono text-[11px] leading-[1.35] text-slate-900 relative'
    : 'bg-white p-8 font-mono text-[12px] leading-[1.45] text-slate-800 relative';

  return (
    <div className={containerCls}>
      {/* Stamp — only render for LUNAS/DP invoices. Quotation drops the stamp
          because the "SALES ORDER" doc title already conveys the state; a
          PENAWARAN watermark on top of it just duplicates the label. */}
      {!isQuotation && (
        <div className={`absolute right-8 top-32 rotate-[-8deg] border-[3px] px-3 py-1.5 font-extrabold text-[18px] tracking-widest font-sans opacity-85 ${
          variant === 'lunas' ? 'border-emerald-700 text-emerald-700' : 'border-amber-700 text-amber-700'
        }`}>
          {variant === 'lunas' ? 'LUNAS' : 'DP'}
        </div>
      )}

      {/* Header */}
      <div className="grid grid-cols-[auto_1fr] gap-4 pb-3 border-b-2 border-slate-900 mb-3">
        <div className="w-16 h-16 bg-slate-900 text-white flex items-center justify-center font-sans font-extrabold text-[10px] text-center">
          {store?.logo_url
            ? <img src={store.logo_url} alt="Logo" className="w-full h-full object-contain" />
            : (store?.nama_toko ?? 'GARINDO').split(' ').slice(0,3).join(' ')}
        </div>
        <div>
          <div className="font-extrabold font-sans text-[15px]">{store?.nama_toko ?? 'TOKO ANDA'}</div>
          <div className="text-[11px] mt-0.5">{store?.alamat_lengkap ?? '—'}</div>
          <div className="text-[11px]">{store?.telp_wa && `Telp ${store.telp_wa}`} {store?.email && `· ${store.email}`}</div>
          {store?.npwp && <div className="text-[11px]">NPWP {store.npwp}</div>}
        </div>
      </div>

      {/* Title */}
      <div className="grid grid-cols-[1fr_auto] gap-3 mb-3">
        <div>
          <div className="font-sans font-extrabold text-[17px] tracking-wider">
            {isQuotation ? 'SALES ORDER' : 'SALES INVOICE'}
          </div>
          {!isQuotation && (
            <div className={`text-[11px] font-bold uppercase tracking-wide mt-0.5 ${variant === 'lunas' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {variant === 'lunas' ? 'Pelunasan / Lunas' : 'Tanda Terima Uang Muka (DP)'}
            </div>
          )}
        </div>
        <div className="text-right text-[11px]">
          <div className="font-extrabold text-[13px]">{t.invoice_number}</div>
          <div>{formatDateTime(!isQuotation && variant === 'lunas' && t.lunas_at ? t.lunas_at : t.created_at)}</div>
          <div>Channel: {channelLabel.toUpperCase()}</div>
        </div>
      </div>

      {/* Bill-to */}
      <div className={`grid ${isQuotation ? 'grid-cols-1' : 'grid-cols-2'} gap-4 py-2 border-b border-dashed border-slate-400 mb-2 text-[11px]`}>
        <div>
          <div className="font-extrabold text-[10px] uppercase tracking-widest text-slate-600 mb-1">Pelanggan</div>
          <div><strong>{t.customer_name ?? '—'}</strong></div>
          {t.customer_company && <div>{t.customer_company}</div>}
          <div>{t.customer_phone ?? '—'}</div>
          {!isQuotation && t.delivery_address && (
            <div className="mt-1">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">📍 Kirim ke: </span>
              <span className="whitespace-pre-wrap">{t.delivery_address}</span>
            </div>
          )}
          {isQuotation && (
            <div className="mt-1 italic text-slate-500" style={{ fontSize: 10 }}>
              Alamat pengiriman ditentukan saat Sales Invoice diterbitkan.
            </div>
          )}
        </div>
        {!isQuotation && (
          <div>
            <div className="font-extrabold text-[10px] uppercase tracking-widest text-slate-600 mb-1">Metode Bayar</div>
            <div><strong>{paymentLabel}</strong></div>
            {adminName && (
              <div className="mt-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">Admin: </span>
                <span>{adminName}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items table */}
      <table className="w-full text-[11px] my-2 border-collapse">
        <thead>
          <tr>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-center font-extrabold text-[10px] uppercase tracking-wide">No</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-left font-extrabold text-[10px] uppercase tracking-wide">Deskripsi Barang</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-center font-extrabold text-[10px] uppercase tracking-wide">Qty</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-right font-extrabold text-[10px] uppercase tracking-wide">Harga</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-right font-extrabold text-[10px] uppercase tracking-wide">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {(t.items as any[]).map((item, idx) => (
            <tr key={idx} className="align-top">
              <td className="px-1 py-1 text-center border-b border-dotted border-slate-300">{idx + 1}</td>
              <td className="px-1 py-1 border-b border-dotted border-slate-300">
                <div className="font-bold">{item.name}</div>
                {item.sku && <div className="text-[10px] text-slate-500">{item.sku}</div>}
                {/*
                 * Pre-order footnote — surfaces when the wizard tagged a row
                 * during save (qty > stock at the picked warehouse). Today the
                 * wizard's stockByWarehouseSku map is empty (warehouse↔legacy-
                 * column lookup is follow-up work), so no row will be tagged
                 * in practice. Forward-compatible: once T25 fulfillments card
                 * lands, the wizard will populate is_pre_order during save and
                 * this footnote will start rendering automatically.
                 */}
                {item.is_pre_order && (
                  <div className="text-[10px] italic text-slate-500">*Pre-order, akan dikirim setelah barang tiba</div>
                )}
              </td>
              <td className="px-1 py-1 text-center border-b border-dotted border-slate-300">{item.qty}</td>
              <td className="px-1 py-1 text-right border-b border-dotted border-slate-300">{formatRp(item.unit_price).replace('Rp', '').trim()}</td>
              <td className="px-1 py-1 text-right border-b border-dotted border-slate-300">{formatRp(item.subtotal).replace('Rp', '').trim()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Notes */}
      {t.notes && (
        <div className="border border-dashed border-slate-400 px-2 py-1.5 my-2 text-[11px]">
          <div className="font-extrabold text-[10px] uppercase tracking-widest mb-1">📝 Catatan</div>
          <div className="whitespace-pre-wrap">{t.notes}</div>
        </div>
      )}

      {/* Totals */}
      <div className="ml-auto w-3/5 text-[12px] mt-2">
        {/* I-1 fix: show gross subtotal so Gross − Diskon = Total is transparent to customer */}
        <div className="flex justify-between py-0.5 border-t border-slate-900 mt-1 pt-1"><span>Subtotal</span><span>{formatRp(grossSubtotal)}</span></div>
        {!isQuotation && ongkir > 0 && <div className="flex justify-between py-0.5"><span>Biaya Ongkir</span><span>{formatRp(ongkir)}</span></div>}
        {totalDiscount > 0 && (
          <div className="flex justify-between py-0.5 text-[11px] text-slate-700">
            <span>{discountLabel}</span><span>− {formatRp(totalDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between py-1 border-t border-slate-900 border-b-[3px] border-double border-b-slate-900 font-extrabold text-[13px]">
          <span>{isQuotation ? 'TOTAL PENAWARAN' : 'TOTAL TAGIHAN'}</span>
          <span>{formatRp(isQuotation ? subtotal : total)}</span>
        </div>
        {isQuotation && (
          <div className="py-0.5 text-[10px] italic text-slate-500">
            * Belum termasuk ongkir. Final total saat Sales Invoice.
          </div>
        )}
        {!isQuotation && (
          <>
            <div className="flex justify-between py-0.5 font-bold"><span>{variant === 'lunas' ? 'Sudah Dibayar' : 'Uang Muka (DP) Diterima'}</span><span>{formatRp(sudahDibayar)}</span></div>
            <div className="flex justify-between py-0.5 font-extrabold">
              <span>{variant === 'lunas' ? 'SISA' : 'SISA PELUNASAN'}</span><span>{formatRp(sisa)}</span>
            </div>
          </>
        )}
      </div>

      {/* Payment block */}
      {!isQuotation && (
        <div className="mt-4 pt-2 border-t border-dashed border-slate-400 text-[11px]">
          <div className="font-extrabold text-[10px] uppercase tracking-widest mb-1">Rekening Pembayaran</div>
          <div>
            <strong>{bank?.bank_name ?? '—'}</strong> · {bank?.account_number ?? '—'} a/n <strong>{bank?.account_holder ?? '—'}</strong>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {variant === 'lunas' ? 'Terima kasih atas pembayaran Anda.' : 'Sisa pelunasan ditransfer sebelum pengambilan/pengiriman barang.'}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      {!isQuotation && (
        <div className="mt-3 border border-slate-900 px-2 py-1.5 text-center text-[10px] font-extrabold tracking-wide">
          ⚠ BARANG YANG SUDAH DIBELI TIDAK DAPAT DIKEMBALIKAN
        </div>
      )}

      {/* Quotation footer disclaimer */}
      {isQuotation && (
        <div className="mt-4 pt-3 border-t border-slate-300 text-[10px] text-slate-500 italic">
          Dokumen ini bukan invoice resmi. Untuk pemesanan, konfirmasi ke admin untuk diteruskan menjadi Sales Invoice.
        </div>
      )}

      {/* Footer signatures */}
      <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-dashed border-slate-400 text-[11px]">
        <div className="text-center">
          <div className="border-b border-slate-900 h-10 mx-4 mb-1"></div>
          <div className="font-bold text-[10px]">Penerima Barang</div>
          <div className="text-[9px] text-slate-500 italic mt-0.5">(tanda tangan + nama jelas)</div>
        </div>
        <div className="text-center">
          <div className="relative h-10 mx-4 mb-1 border-b border-slate-900">
            {adminName && (
              <div className="absolute inset-0 flex items-end justify-center pb-0.5 text-[11px] font-sans">
                {adminName}
              </div>
            )}
          </div>
          <div className="font-bold text-[10px]">Hormat Kami</div>
          <div className="text-[9px] text-slate-500 italic mt-0.5">{store?.nama_toko ?? 'Toko Anda'}</div>
        </div>
      </div>
    </div>
  );
}
