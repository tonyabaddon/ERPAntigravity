import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { KasirTransaction, KasirPaymentMethod, KasirPaymentSubtype } from '../../types';
import { kasirService } from '../../lib/supabaseClient';
import { formatRp } from '../../lib/format';
import PaymentMethodSelector from './PaymentMethodSelector';

export interface MarkLunasModalProps {
  transaction: KasirTransaction;
  onClose: () => void;
  onMarked: (updated: KasirTransaction) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function MarkLunasModal({ transaction, onClose, onMarked, showToast }: MarkLunasModalProps) {
  const [method, setMethod] = useState<KasirPaymentMethod>('cash');
  const [subtype, setSubtype] = useState<KasirPaymentSubtype>(null);
  const [ongkirAdjust, setOngkirAdjust] = useState(0);
  const [saving, setSaving] = useState(false);

  const baseTotal = transaction.total_amount ?? transaction.subtotal;
  const newTotal = baseTotal + ongkirAdjust;
  const sisa = newTotal - (transaction.dp_amount ?? 0);

  async function handleConfirm() {
    if (method === 'edc' && !subtype) {
      showToast('Pilih sub-tipe EDC.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const updated = await kasirService.markLunas(transaction.id, {
        method,
        subtype: subtype ?? undefined,
        ongkirAdjust: ongkirAdjust !== 0 ? ongkirAdjust : undefined,
      });
      onMarked(updated);
    } catch (err: any) {
      showToast(`Gagal tandai lunas: ${err.message ?? 'unknown'}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 bg-amber-500 text-white flex justify-between items-center">
          <div className="font-extrabold text-[14px]">💰 Tandai Lunas — {transaction.invoice_number}</div>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="bg-slate-50 rounded-lg p-3 text-[12px]">
            <div className="flex justify-between"><span>Pelanggan</span><strong>{transaction.customer_name}</strong></div>
            <div className="flex justify-between"><span>Total Tagihan</span><span>{formatRp(baseTotal)}</span></div>
            <div className="flex justify-between"><span>DP Diterima</span><span>{formatRp(transaction.dp_amount ?? 0)}</span></div>
            <div className="flex justify-between font-extrabold text-amber-700 text-[14px] mt-1 pt-1 border-t border-slate-300">
              <span>Sisa Pelunasan</span><span>{formatRp(sisa)}</span>
            </div>
          </div>

          <PaymentMethodSelector
            method={method}
            subtype={subtype}
            onMethodChange={setMethod}
            onSubtypeChange={setSubtype}
          />

          <div>
            <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
              Penyesuaian Ongkir (opsional)
            </label>
            <input
              type="number"
              value={ongkirAdjust || ''}
              onChange={e => setOngkirAdjust(Number(e.target.value || 0))}
              placeholder="0"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[13px]"
            />
            <p className="text-[11px] text-slate-400 mt-1">Tambahan biaya kirim saat pelunasan (boleh negatif untuk koreksi).</p>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="w-full py-3 rounded-lg bg-[#2d8a4e] text-white font-extrabold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Check className="w-4 h-4" />
            {saving ? 'Memproses...' : 'Konfirmasi & Cetak Invoice Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}
