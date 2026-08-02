import React, { useEffect, useState } from 'react';
import { X, Download, FileText } from 'lucide-react';
import { KasirTransaction } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchStoreSettings } from '../lib/pengaturan/queries';
import type { StoreSettings } from '../lib/pengaturan/types';
import { CHANNEL_VISUAL } from '../lib/salesChannels';
import { formatIDR } from '../lib/formatIDR';
import { captureError } from '../lib/captureError';

interface KasirInvoiceModalProps {
  transaction: KasirTransaction;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  transfer: 'Transfer Bank',
  qris: 'QRIS',
};

export default function KasirInvoiceModal({ transaction, onClose }: KasirInvoiceModalProps) {
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    fetchStoreSettings()
      .then(setStore)
      .catch(err => captureError(err, { feature: 'kasir_invoice', action: 'fetch_store_settings' }))
      .finally(() => setLoading(false));
  }, []);

  const handlePrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #kasir-invoice-root, #kasir-invoice-root * { visibility: visible; }
          #kasir-invoice-root { position: fixed; top: 0; left: 0; width: 100%; background: white; z-index: 9999; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="kasir-invoice-root"
          className="bg-white rounded-sm overflow-hidden shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#012749] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-sm">
              <FileText className="w-4 h-4" />
              Invoice {transaction.invoice_number}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2d8a4e] text-white text-xs font-bold rounded-sm hover:bg-green-700"
              >
                <Download className="w-3.5 h-3.5" /> Cetak / PDF
              </button>
              <button onClick={onClose} className="opacity-60 hover:opacity-100 text-xl leading-none">×</button>
            </div>
          </div>

          {/* Invoice body */}
          <div className="overflow-y-auto bg-gray-100 p-4 flex-1">
            <div className="bg-white rounded-sm shadow-sm p-7 font-serif text-sm">
              {loading ? (
                <p className="text-center text-gray-400 py-8">Memuat...</p>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex justify-between items-start pb-5 mb-5 border-b-2 border-[#012749]">
                    <div>
                      <div className="text-xl font-black text-[#012749] tracking-tight">
                        {store?.nama_toko ?? 'Toko Anda'}
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans mt-1">
                        {store?.alamat_lengkap ?? 'Alamat belum diisi'}
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans">
                        {store?.telp_wa && `${store.telp_wa} · `}{store?.email ?? ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-[#012749] tracking-widest uppercase">Sales Invoice</div>
                      <div className="text-xs font-mono font-bold text-gray-700 mt-1">
                        {transaction.invoice_number}
                      </div>
                      <div className="text-[10px] text-gray-400 font-sans mt-0.5">
                        Tanggal: {formatDate(transaction.created_at)}
                      </div>
                      <div className="text-[10px] text-gray-500 font-sans mt-0.5">
                        {transaction.channel ? CHANNEL_VISUAL[transaction.channel].label : ''}
                      </div>
                    </div>
                  </div>

                  {/* Bill to */}
                  {(transaction.customer_name || transaction.customer_company) && (
                    <div className="mb-5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">
                        Kepada Yth.
                      </div>
                      {transaction.customer_name && <div className="font-bold text-gray-800">{transaction.customer_name}</div>}
                      {transaction.customer_company && <div className="text-xs text-gray-600">{transaction.customer_company}</div>}
                      {transaction.customer_phone && <div className="text-xs text-gray-500">{transaction.customer_phone}</div>}
                    </div>
                  )}

                  {/* Line items */}
                  <table className="w-full text-xs font-sans border-collapse mb-4">
                    <thead>
                      <tr className="bg-[#012749] text-white">
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">No.</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">Produk / SKU</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Qty</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Harga Satuan</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transaction.items.map((item, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{item.name}</div>
                            {item.sku && <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-500">
                            {formatIDR(item.unit_price)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-gray-800">
                            {formatIDR(item.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totals */}
                  <div className="flex justify-end mb-4">
                    <div className="min-w-[200px] text-xs font-sans">
                      {/* Per-line discounts + order-level discount row — font 11px per feedback_font_sizing.md */}
                      {(() => {
                        const lineDiscount = (transaction.items ?? []).reduce(
                          (s, i) => s + (i.discount_amount_rp ?? 0), 0,
                        );
                        const orderDiscount = transaction.discount_amount_rp ?? 0;
                        const totalDiscount = lineDiscount + orderDiscount;
                        if (totalDiscount <= 0) return null;
                        const label = transaction.discount_type === 'PERCENT'
                          ? `Diskon (order ${transaction.discount_value}%)`
                          : lineDiscount > 0 && orderDiscount > 0
                          ? 'Diskon (baris + order)'
                          : lineDiscount > 0
                          ? 'Diskon baris'
                          : 'Diskon Order';
                        return (
                          <div className="flex justify-between py-1" style={{ fontSize: '11px', color: '#b45309' }}>
                            <span>{label}</span>
                            <span className="font-mono">− {formatIDR(totalDiscount)}</span>
                          </div>
                        );
                      })()}
                      <div className="flex justify-between py-2 font-black text-[#012749] text-sm border-t-2 border-[#012749]">
                        <span>TOTAL</span>
                        <span>{formatIDR((transaction.total_amount ?? transaction.subtotal))}</span>
                      </div>
                      {transaction.payment_method && (
                        <div className="flex justify-between py-1 text-gray-500 text-[10px]">
                          <span>Metode Bayar</span>
                          <span className="font-bold">{PAYMENT_LABEL[transaction.payment_method]}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="text-center text-[10px] text-gray-400 font-sans border-t border-gray-100 pt-3 mt-2">
                    Terima kasih atas kepercayaan Anda · {store?.nama_toko ?? 'Toko Anda'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
