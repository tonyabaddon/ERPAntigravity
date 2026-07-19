import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { DbPurchaseOrder } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { wibDateString } from '../../lib/format';
import { useWarehouses } from '../../hooks/useWarehouses';
import WarehousePicker from '../warehouse/WarehousePicker';

interface ReceiveGoodsModalProps {
  po: DbPurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type ItemCondition = { qty_received: number; qty_damaged: number; damage_notes: string };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return wibDateString(d);
}

export default function ReceiveGoodsModal({ po, onClose, onReceived, showToast }: ReceiveGoodsModalProps) {
  const today = wibDateString();
  const supplierTermDays = po.supplier?.payment_term_days ?? 0;
  const defaultDueDate = supplierTermDays > 0 ? addDays(today, supplierTermDays) : today;

  const { warehouses } = useWarehouses({ activeOnly: true });

  const [receivedAt, setReceivedAt] = useState(today);
  const [paymentDueAt, setPaymentDueAt] = useState(defaultDueDate);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [conditions, setConditions] = useState<Record<string, ItemCondition>>(
    Object.fromEntries((po.items ?? []).map(item => [
      item.id,
      { qty_received: item.qty, qty_damaged: 0, damage_notes: '' }
    ]))
  );
  const [saving, setSaving] = useState(false);
  // warehouse_id: null means "not yet selected / waiting for warehouse list to load"
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  // Once warehouses load, default to the first active warehouse (only runs once).
  React.useEffect(() => {
    if (warehouseId === null && warehouses.length > 0) {
      setWarehouseId(warehouses[0].id);
    }
  }, [warehouses, warehouseId]);

  function updateCondition(itemId: string, field: keyof ItemCondition, value: string | number) {
    setConditions(prev => {
      const current = prev[itemId];
      const updated = { ...current, [field]: value };
      return { ...prev, [itemId]: updated };
    });
  }

  function validate(): string | null {
    for (const item of (po.items ?? [])) {
      const cond = conditions[item.id];
      if (!cond) continue;
      if (cond.qty_received + cond.qty_damaged !== item.qty) {
        return `Qty Baik + Qty Rusak harus sama dengan ${item.qty} untuk "${item.product_name}".`;
      }
      if (cond.qty_damaged > 0 && !cond.damage_notes.trim()) {
        return `Catatan kerusakan wajib diisi untuk "${item.product_name}".`;
      }
    }
    return null;
  }

  async function handleConfirm() {
    if (!warehouseId) { showToast('Pilih gudang tujuan terlebih dahulu.', 'warning'); return; }
    const err = validate();
    if (err) { showToast(err, 'warning'); return; }
    setSaving(true);
    try {
      let invoiceUrl: string | undefined;
      if (invoiceFile) {
        invoiceUrl = await purchaseOrderService.uploadDocument(invoiceFile, `invoices/${po.id}`);
      }
      // Build per-line conditions with warehouse_id for the 5-arg receive_purchase_order RPC.
      const conditionsWithWarehouse: Record<string, {
        warehouse_id: string;
        qty_received: number;
        qty_damaged: number;
        damage_notes?: string;
      }> = {};
      for (const [id, c] of Object.entries(conditions)) {
        const cond = c as ItemCondition;
        conditionsWithWarehouse[id] = {
          warehouse_id: warehouseId,
          qty_received: cond.qty_received,
          qty_damaged: cond.qty_damaged,
          damage_notes: cond.damage_notes || undefined,
        };
      }
      await purchaseOrderService.receiveGoods(po.id, {
        received_at: new Date(receivedAt).toISOString(),
        payment_due_at: paymentDueAt,
        invoice_url: invoiceUrl,
        conditions: conditionsWithWarehouse,
      });
      showToast(`${po.po_number} diterima. Stok diperbarui.`, 'success');
      onReceived();
      onClose();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengkonfirmasi penerimaan.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Terima Barang — {po.po_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
            Stok akan bertambah sesuai <strong>Qty Baik</strong> yang diterima. Barang rusak tidak masuk stok dan akan ditrack untuk retur.
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Tanggal Terima <span className="text-rose-500">*</span></label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Jatuh Tempo Pembayaran <span className="text-rose-500">*</span></label>
              <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <p className="text-[10px] text-gray-400 mt-1">
                Pre-filled {supplierTermDays > 0 ? `Net ${supplierTermDays}` : 'Cash'}. Sesuaikan dengan invoice supplier.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Gudang Tujuan <span className="text-rose-500">*</span></label>
              <WarehousePicker
                mode="single"
                warehouses={warehouses}
                value={warehouseId}
                onChange={setWarehouseId}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-2">Kondisi Barang per Item</label>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-4">Produk</span>
                <span className="col-span-1 text-center">Dipesan</span>
                <span className="col-span-2 text-center text-emerald-600">Qty Baik</span>
                <span className="col-span-2 text-center text-rose-500">Qty Rusak</span>
                <span className="col-span-3">Catatan Kerusakan</span>
              </div>
              {(po.items ?? []).map(item => {
                const cond = conditions[item.id] ?? { qty_received: item.qty, qty_damaged: 0, damage_notes: '' };
                const hasDamage = cond.qty_damaged > 0;
                return (
                  <div key={item.id} className={hasDamage ? 'bg-rose-50' : ''}>
                    <div className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-gray-100">
                      <div className="col-span-4">
                        <div className="text-xs font-semibold text-gray-800">{item.product_name}</div>
                        <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                      </div>
                      <span className="col-span-1 text-center text-xs text-gray-500">{item.qty}</span>
                      <div className="col-span-2 flex justify-center">
                        <input
                          type="number" min="0" max={item.qty}
                          value={cond.qty_received}
                          onChange={e => {
                            const qr = parseInt(e.target.value) || 0;
                            const qd = Math.max(0, item.qty - qr);
                            updateCondition(item.id, 'qty_received', qr);
                            updateCondition(item.id, 'qty_damaged', qd);
                          }}
                          className="w-14 text-center text-sm border border-emerald-300 rounded-lg px-2 py-1 bg-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <input
                          type="number" min="0" max={item.qty}
                          value={cond.qty_damaged}
                          onChange={e => {
                            const qd = parseInt(e.target.value) || 0;
                            const qr = Math.max(0, item.qty - qd);
                            updateCondition(item.id, 'qty_damaged', qd);
                            updateCondition(item.id, 'qty_received', qr);
                          }}
                          className={`w-14 text-center text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 ${hasDamage ? 'border-rose-300 text-rose-700 font-bold bg-white focus:ring-rose-400' : 'border-gray-200 focus:ring-indigo-300'}`}
                        />
                      </div>
                      <div className="col-span-3 pl-2">
                        {hasDamage ? (
                          <input
                            value={cond.damage_notes}
                            onChange={e => updateCondition(item.id, 'damage_notes', e.target.value)}
                            className="w-full text-xs border border-rose-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-rose-300 placeholder-rose-300"
                            placeholder="Jelaskan kerusakan..."
                          />
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">—</span>
                        )}
                      </div>
                    </div>
                    {hasDamage && (
                      <p className="px-3 pb-2 text-[10px] text-rose-500">⚠ {cond.qty_damaged} item rusak tidak masuk stok — akan ditrack untuk retur.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Invoice Supplier</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {invoiceFile ? invoiceFile.name : 'Klik atau drag file invoice (PDF / JPG)'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Terima Barang'}
          </button>
        </div>
      </div>
    </div>
  );
}
