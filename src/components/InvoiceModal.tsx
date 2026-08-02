import React, { useEffect, useState } from 'react';
import { X, Download, FileText } from 'lucide-react';
import { DbOrder } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import { fetchStoreSettings, fetchBankAccounts } from '../lib/pengaturan/queries';
import type { StoreSettings, BankAccount } from '../lib/pengaturan/types';
import { formatIDR } from '../lib/formatIDR';
import { captureError } from '../lib/captureError';

interface InvoiceModalProps {
  order: DbOrder;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function InvoiceModal({ order, onClose }: InvoiceModalProps) {
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [bank, setBank]   = useState<BankAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    Promise.all([fetchStoreSettings(), fetchBankAccounts(true)])
      .then(([st, accounts]) => { setStore(st); setBank(accounts[0] ?? null); })
      .catch(err => captureError(err, { feature: 'invoice', action: 'fetch_store_settings' }))
      .finally(() => setLoading(false));
  }, []);

  const handlePrint = () => window.print();

  const orderId = order.gjp_order_id ?? order.id.slice(0, 8).toUpperCase();

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-root, #invoice-print-root * { visibility: visible; }
          #invoice-print-root { position: fixed; top: 0; left: 0; width: 100%; background: white; z-index: 9999; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="invoice-print-root"
          className="bg-white rounded-sm overflow-hidden shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-caleo-primary)] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-sm">
              <FileText className="w-4 h-4" />
              Invoice {orderId}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2d8a4e] text-white text-xs font-bold rounded-sm hover:bg-green-700"
              >
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
              <button onClick={onClose} className="opacity-60 hover:opacity-100 text-xl leading-none">×</button>
            </div>
          </div>

          {/* Scrollable invoice body */}
          <div className="overflow-y-auto bg-gray-100 p-4 flex-1">
            <div className="bg-white rounded-sm shadow-sm p-7 font-serif text-sm">
              {loading ? (
                <p className="text-center text-gray-400 py-8">Memuat...</p>
              ) : (
                <>
                  {/* Invoice header */}
                  <div className="flex justify-between items-start pb-5 mb-5 border-b-2 border-[var(--color-caleo-primary)]">
                    <div>
                      <div className="text-xl font-black text-[var(--color-caleo-primary)] tracking-tight">{store?.nama_toko ?? 'Toko Anda'}</div>
                      <div className="text-[11px] text-gray-500 font-sans mt-1 flex items-center gap-1.5 flex-wrap">
                        {store?.alamat_lengkap || 'Alamat belum diisi'}
                        <span className="print:hidden text-[9px] bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 font-bold">⚙ config</span>
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans">
                        {store?.telp_wa && `${store.telp_wa} · `}{store?.email ?? ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-[var(--color-caleo-primary)] tracking-widest uppercase">Invoice</div>
                      <div className="text-xs font-mono font-bold text-gray-700 mt-1">{orderId}</div>
                      <div className="text-[10px] text-gray-400 font-sans mt-0.5">Tanggal: {formatDate(order.created_at)}</div>
                    </div>
                  </div>

                  {/* Bill To */}
                  <div className="grid grid-cols-2 gap-5 mb-5">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">Kepada Yth.</div>
                      <div className="font-bold text-gray-800">{order.customer_name}</div>
                      {order.customer_address && <div className="text-xs text-gray-500 font-sans">{order.customer_address}</div>}
                      <div className="text-xs text-gray-500 font-sans">WA: {order.customer_phone}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">Pengiriman</div>
                      <div className="text-xs text-gray-600 font-sans mb-3">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div>
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1 font-sans">Status Pembayaran</div>
                      <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded font-sans">✓ LUNAS</span>
                    </div>
                  </div>

                  {/* Line items */}
                  <table className="w-full text-xs font-sans border-collapse mb-4">
                    <thead>
                      <tr className="bg-[var(--color-caleo-primary)] text-white">
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">No.</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">Produk / SKU</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Qty</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Harga Satuan</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{item.name}</div>
                            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{formatIDR(item.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-800">{formatIDR(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totals */}
                  <div className="flex justify-end mb-4">
                    <div className="min-w-[200px] text-xs font-sans">
                      <div className="flex justify-between py-1 text-gray-500 border-b border-gray-100">
                        <span>Subtotal</span><span>{formatIDR(order.subtotal)}</span>
                      </div>
                      <div className="flex justify-between py-1 text-gray-500 border-b border-gray-100">
                        <span>Ongkos Kirim</span><span>{formatIDR((order.shipping_fee ?? 0))}</span>
                      </div>
                      <div className="flex justify-between py-2 font-black text-[var(--color-caleo-primary)] text-sm border-t-2 border-[var(--color-caleo-primary)] mt-1">
                        <span>TOTAL</span><span>{formatIDR(order.total)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bank info */}
                  <div className="bg-blue-50 border border-blue-100 rounded-sm px-4 py-3 mb-3 font-sans">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Informasi Pembayaran</div>
                      <span className="print:hidden text-[9px] bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 font-bold">⚙ config</span>
                    </div>
                    <div className="text-xs text-gray-700">
                      {bank ? (
                        <>Bank {bank.bank_name} · No. Rek: <strong>{bank.account_number}</strong> · a/n <strong>{bank.account_holder}</strong></>
                      ) : (
                        <span className="text-gray-400">Rekening belum dikonfigurasi di Pengaturan.</span>
                      )}
                    </div>
                    {order.payment_verified_at && (
                      <div className="text-xs text-green-700 font-semibold mt-1">
                        ✓ Pembayaran diverifikasi oleh {order.verified_by ?? '—'} pada {formatDateTime(order.payment_verified_at)}
                      </div>
                    )}
                  </div>

                  {/* No-refund notice */}
                  <div className="bg-orange-50 border border-orange-200 rounded-sm px-4 py-2.5 mb-4 font-sans text-xs text-orange-800">
                    <strong>Catatan Penting:</strong> Barang yang telah dibeli tidak dapat dikembalikan atau direfund dalam kondisi apapun. Pastikan pesanan sudah sesuai sebelum melakukan pembayaran.
                  </div>

                  {/* Footer */}
                  <div className="text-center text-[10px] text-gray-400 font-sans border-t border-gray-100 pt-3">
                    Terima kasih atas kepercayaan Anda kepada {store?.nama_toko ?? 'Toko Anda'} 🙏<br />
                    Dokumen ini diterbitkan secara otomatis oleh sistem ERP {store?.nama_toko ?? 'Toko Anda'}.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Modal footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 print:hidden">
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-bold rounded-sm hover:bg-gray-200">Tutup</button>
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-4 py-2 bg-[#2d8a4e] text-white text-xs font-bold rounded-sm hover:bg-green-700">
              <Download className="w-3.5 h-3.5" /> Download PDF
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
