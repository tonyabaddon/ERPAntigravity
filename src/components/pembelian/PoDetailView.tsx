import React, { useState } from 'react';
import { X, Printer } from 'lucide-react';
import { DbPurchaseOrder, DbPurchaseOrderItem, StockItem } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';

interface PoDetailViewProps {
  po: DbPurchaseOrder;
  stockList: StockItem[];
  onClose: () => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onReceiveReplacement: (item: DbPurchaseOrderItem) => void;
}

const DAMAGE_STATUS_OPTIONS = [
  { value: 'PENDING_RETURN', label: 'Pending Return' },
  { value: 'RETURNED',       label: 'Returned' },
  { value: 'REPLACED',       label: 'Replaced' },
];

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ORDERED: 'Dipesan', RECEIVED: 'Diterima', PAID: 'Lunas',
};

export default function PoDetailView({ po, stockList, onClose, onRefresh, showToast, onReceiveReplacement }: PoDetailViewProps) {
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  async function handleDamageStatusChange(item: DbPurchaseOrderItem, newStatus: string) {
    setUpdatingItemId(item.id);
    try {
      await purchaseOrderService.updateDamageStatus(item.id, newStatus);
      showToast('Status kerusakan diperbarui.', 'success');
      onRefresh();
    } catch {
      showToast('Gagal memperbarui status.', 'warning');
    } finally {
      setUpdatingItemId(null);
    }
  }

  const damagedItems = (po.items ?? []).filter(i => i.qty_damaged > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto print:shadow-none print:border-none print:max-h-none print:overflow-visible" id="po-print-area">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 print:hidden">
          <div>
            <h2 className="text-sm font-bold text-gray-900">{po.po_number}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{po.supplier?.name} · {STATUS_LABEL[po.status]}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="text-xs text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Print header */}
        <div className="hidden print:block px-5 py-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Purchase Order</h1>
          <p className="text-sm text-gray-600">{po.po_number} · {formatDate(po.ordered_at ?? po.created_at)}</p>
          <p className="text-sm text-gray-600">Supplier: {po.supplier?.name}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* PO meta */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-gray-400">Tanggal Pesan</p>
              <p className="font-semibold text-gray-800">{formatDate(po.ordered_at)}</p>
            </div>
            <div>
              <p className="text-gray-400">Tanggal Terima</p>
              <p className="font-semibold text-gray-800">{formatDate(po.received_at)}</p>
            </div>
            <div>
              <p className="text-gray-400">Jatuh Tempo</p>
              <p className={`font-semibold ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>{formatDate(po.payment_due_at)}</p>
            </div>
          </div>

          {/* Line items with margin */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">Item Pembelian</p>
            <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
              <div className="grid grid-cols-6 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-2">Produk</span>
                <span className="text-center">Diterima</span>
                <span className="text-right">Harga Beli</span>
                <span className="text-right">Harga Jual</span>
                <span className="text-right">Margin</span>
              </div>
              {(po.items ?? []).map(item => {
                const stockItem = stockList.find(s => s.sku === item.sku);
                const sellingPrice = stockItem?.price ?? 0;
                const margin = sellingPrice > 0 ? ((sellingPrice - item.unit_cost) / sellingPrice * 100) : 0;
                return (
                  <div key={item.id} className="grid grid-cols-6 px-3 py-2.5 border-b border-gray-100 items-center">
                    <div className="col-span-2">
                      <div className="font-semibold text-gray-800">{item.product_name}</div>
                      <div className="font-mono text-[9px] text-gray-400">
                        {item.sku}{item.qty_damaged > 0 && <span className="text-rose-500"> · {item.qty_damaged} rusak</span>}
                      </div>
                    </div>
                    <span className="text-center text-gray-600">{item.qty_received}</span>
                    <span className="text-right text-gray-600">{formatRupiah(item.unit_cost)}</span>
                    <span className="text-right text-gray-600">{sellingPrice > 0 ? formatRupiah(sellingPrice) : '—'}</span>
                    <span className={`text-right font-bold ${margin > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {sellingPrice > 0 ? `+${margin.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                );
              })}
              {/* Totals */}
              <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
                <div className="text-right text-gray-400 leading-relaxed">
                  Subtotal<br />
                  {po.tax_rate > 0 && <>PPN ({(po.tax_rate * 100).toFixed(0)}%)<br /></>}
                  <strong className="text-gray-700">Total</strong>
                </div>
                <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
                  {formatRupiah(po.subtotal)}<br />
                  {po.tax_rate > 0 && <>{formatRupiah(po.tax_amount)}<br /></>}
                  <strong className="text-gray-800">{formatRupiah(po.total)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Barang Rusak section */}
          {damagedItems.length > 0 && (
            <div className="print:hidden">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-500">Barang Rusak</p>
                <span className="bg-rose-100 text-rose-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{damagedItems.reduce((s, i) => s + i.qty_damaged, 0)} item</span>
              </div>
              <div className="border border-rose-200 rounded-xl overflow-hidden text-xs">
                <div className="grid grid-cols-12 px-3 py-2 bg-rose-50 border-b border-rose-200 text-[10px] font-bold uppercase tracking-wide text-rose-400">
                  <span className="col-span-3">Produk</span>
                  <span className="col-span-1 text-center">Qty</span>
                  <span className="col-span-4">Catatan</span>
                  <span className="col-span-4 text-center">Status Retur</span>
                </div>
                {damagedItems.map(item => (
                  <div key={item.id} className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-rose-100 bg-white last:border-b-0">
                    <div className="col-span-3">
                      <div className="font-semibold text-gray-800">{item.product_name}</div>
                      <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                    </div>
                    <span className="col-span-1 text-center font-bold text-rose-600">{item.qty_damaged}</span>
                    <span className="col-span-4 text-gray-500 text-[11px]">{item.damage_notes ?? '—'}</span>
                    <div className="col-span-4 flex justify-center items-center gap-2">
                      {item.damage_status === 'REPLACED' ? (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">Replaced</span>
                      ) : (
                        <>
                          <select
                            value={item.damage_status}
                            disabled={updatingItemId === item.id}
                            onChange={e => handleDamageStatusChange(item, e.target.value)}
                            className="text-[11px] border border-amber-200 rounded-lg px-2 py-1 bg-amber-50 text-amber-700 font-semibold focus:outline-none disabled:opacity-50"
                          >
                            {DAMAGE_STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {item.damage_status === 'RETURNED' && (
                            <button
                              onClick={() => onReceiveReplacement(item)}
                              className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg whitespace-nowrap"
                            >
                              Terima Pengganti
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          {(po.invoice_url || po.payment_proof_url) && (
            <div className="print:hidden space-y-1">
              {po.invoice_url && (
                <a href={po.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline block">Lihat Invoice Supplier</a>
              )}
              {po.payment_proof_url && (
                <a href={po.payment_proof_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline block">Lihat Bukti Pembayaran</a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
