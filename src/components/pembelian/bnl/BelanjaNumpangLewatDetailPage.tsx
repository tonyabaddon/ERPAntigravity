// BNL Detail page — full-page view with info cards, attachments, items, profit
// summary, action buttons. Mirrors the existing PembelianDetailPage pattern.
import React, { useEffect, useState } from 'react';
import { ChevronRight, Printer, CheckCircle, XOctagon, Link as LinkIcon, Store, CalendarClock, ArrowLeft } from 'lucide-react';
import { purchaseInvoiceService, shortOrderRef } from '../../../lib/purchaseInvoiceService';
import type { DbPurchaseInvoice } from '../../../types';
import PiStatusBadge from './PiStatusBadge';
import MarkPaidModal from './MarkPaidModal';
import VoidConfirmModal from './VoidConfirmModal';
import { StorageLink } from '../../ui/StorageLink';
import { StorageImage } from '../../ui/StorageImage';

interface Props {
  piNumber: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onEdit: (pi: DbPurchaseInvoice) => void;
  onOrderClick: (orderId: string) => void;
}

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function BelanjaNumpangLewatDetailPage({ piNumber, showToast, onBack, onEdit, onOrderClick }: Props) {
  const [pi, setPi] = useState<DbPurchaseInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPi(await purchaseInvoiceService.fetchByNumber(piNumber)); }
    catch (e: any) { showToast(e?.message ?? 'Gagal load PI', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, [piNumber]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>;
  if (!pi) return <div className="p-8 text-center text-sm text-gray-500">PI tidak ditemukan.</div>;

  const totalRev = (pi.items ?? []).reduce((a, i) => a + i.qty * i.sell_price, 0);
  const profit = totalRev - pi.total;
  const margin = totalRev > 0 ? (profit / totalRev * 100) : 0;

  async function handlePrintPdf() {
    const mod = await import('../../../lib/pdf/belanjaNumpangLewatPdf');
    const blob = mod.generateBelanjaNumpangLewatPdf({ pi: pi! });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-gray-800"><ArrowLeft className="w-3 h-3" /> Pembelian</button>
        <ChevronRight className="w-3 h-3" /><span>Belanja Numpang Lewat</span>
        <ChevronRight className="w-3 h-3" /><span className="text-gray-800 font-semibold">{pi.pi_number}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-extrabold" style={{ color: '#012749' }}>{pi.pi_number}</h1>
            <PiStatusBadge pi={pi} />
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">⚡ Pass-through</span>
          </div>
          <div className="text-xs text-gray-500">Dibuat {fmtDate(pi.purchase_date)} • {pi.supplier?.name}</div>
        </div>
        <div className="flex gap-2">
          {pi.status === 'BELUM_LUNAS' && !pi.voided_at && (
            <>
              <button onClick={() => setShowPay(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700">
                <CheckCircle className="w-4 h-4" /> Tandai Lunas
              </button>
              <button onClick={() => onEdit(pi)} className="text-sm font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Edit</button>
            </>
          )}
          {pi.status === 'LUNAS' && !pi.voided_at && (
            <button onClick={() => setShowVoid(true)} className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50">
              <XOctagon className="w-4 h-4" /> Void
            </button>
          )}
          <button onClick={handlePrintPdf} className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <LinkIcon className="w-3.5 h-3.5 text-indigo-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Order Terkait</div>
          </div>
          <div className="text-sm font-bold text-indigo-700">{shortOrderRef(pi.order_id)}</div>
          <div className="text-xs text-gray-600 mt-1">{pi.order?.customer_name ?? ''}</div>
          {pi.order_id && (
            <button onClick={() => onOrderClick(pi.order_id!)} className="text-[11px] text-indigo-600 font-semibold hover:underline mt-2">Lihat Order →</button>
          )}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Store className="w-3.5 h-3.5 text-violet-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Supplier</div>
          </div>
          <div className="font-bold text-gray-800">{pi.supplier?.name}</div>
          <div className="text-xs text-gray-500 mt-1">Net {pi.supplier?.payment_term_days ?? 0} hari</div>
          {pi.supplier_invoice_number && <div className="text-[11px] text-gray-600 mt-1">Faktur: <strong>{pi.supplier_invoice_number}</strong></div>}
        </div>
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
            <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Jatuh Tempo</div>
          </div>
          <div className="font-bold text-amber-700">{fmtDate(pi.payment_due_at)}</div>
          <div className="text-xs text-gray-500 mt-1">{pi.payment_method}</div>
        </div>
      </div>

      {(pi.supplier_invoice_photo_url || pi.payment_proof_url) && (
        <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Lampiran</div>
          <div className="flex gap-4 flex-wrap">
            {pi.supplier_invoice_photo_url && (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold text-gray-600">Faktur Supplier</div>
                <StorageImage
                  bucket="purchase-documents"
                  path={pi.supplier_invoice_photo_url}
                  alt="Faktur Supplier"
                  className="w-24 h-28 border border-gray-200"
                  aspectRatio="3/4"
                />
                <StorageLink bucket="purchase-documents" storageRef={pi.supplier_invoice_photo_url} className="text-xs text-indigo-600 hover:underline">Lihat Penuh ↗</StorageLink>
              </div>
            )}
            {pi.payment_proof_url && (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold text-gray-600">Bukti Bayar</div>
                <StorageImage
                  bucket="purchase-documents"
                  path={pi.payment_proof_url}
                  alt="Bukti Bayar"
                  className="w-24 h-28 border border-gray-200"
                  aspectRatio="3/4"
                />
                <StorageLink bucket="purchase-documents" storageRef={pi.payment_proof_url} className="text-xs text-indigo-600 hover:underline">Lihat Penuh ↗</StorageLink>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Barang yang Dibeli</div>
        <table className="w-full">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase">SKU / Nama</th>
              <th className="text-center py-2 w-20 text-[11px] font-semibold text-gray-500 uppercase">Qty</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Beli</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Harga Jual</th>
              <th className="text-right py-2 w-32 text-[11px] font-semibold text-gray-500 uppercase">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {(pi.items ?? []).map(it => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded">{it.sku}</span>
                    <span className="text-sm">{it.product_name}</span>
                  </div>
                </td>
                <td className="py-3 text-center font-semibold">{it.qty}</td>
                <td className="py-3 text-right">{fmtRp(it.unit_cost)}</td>
                <td className="py-3 text-right text-indigo-700">{fmtRp(it.sell_price)}</td>
                <td className="py-3 text-right font-bold" style={{ color: '#012749' }}>{fmtRp(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 text-right text-xs font-semibold text-gray-500">TOTAL BELI</td>
              <td className="py-3 text-right text-xl font-extrabold" style={{ color: '#012749' }}>{fmtRp(pi.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-3xl border border-gray-200 p-4">
          <div className="text-[11px] text-gray-500 uppercase font-semibold">Total Dibayar Ke Grosir</div>
          <div className="text-xl font-extrabold mt-1" style={{ color: '#012749' }}>{fmtRp(pi.total)}</div>
        </div>
        <div className="bg-indigo-50 rounded-3xl border border-indigo-200 p-4">
          <div className="text-[11px] text-indigo-600 uppercase font-semibold">Pendapatan dari Order</div>
          <div className="text-xl font-extrabold mt-1 text-indigo-700">{fmtRp(totalRev)}</div>
        </div>
        <div className="bg-green-50 rounded-3xl border border-green-200 p-4">
          <div className="text-[11px] text-green-700 uppercase font-semibold">Profit ({margin.toFixed(1)}%)</div>
          <div className="text-xl font-extrabold mt-1 text-green-700">{fmtRp(profit)}</div>
        </div>
      </div>

      {showPay && <MarkPaidModal pi={pi} onClose={() => setShowPay(false)} onPaid={reload} showToast={showToast} />}
      {showVoid && <VoidConfirmModal pi={pi} onClose={() => setShowVoid(false)} onVoided={reload} showToast={showToast} />}
    </div>
  );
}
