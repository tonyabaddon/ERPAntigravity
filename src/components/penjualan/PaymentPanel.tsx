import React from 'react';
import { KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType, KasirDpInputType } from '../../types';
import { formatRp } from '../../lib/format';
import PaymentMethodSelector from './PaymentMethodSelector';

export interface PaymentPanelProps {
  // payment method
  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;

  // payment type
  paymentType: KasirPaymentType;
  onPaymentTypeChange: (t: KasirPaymentType) => void;
  dpAmount: number;
  dpInputType: KasirDpInputType;
  onDpAmountChange: (n: number) => void;
  onDpInputTypeChange: (t: KasirDpInputType) => void;

  // ongkir
  ongkirOn: boolean;
  ongkirAmount: number;
  onOngkirToggle: (on: boolean) => void;
  onOngkirAmountChange: (n: number) => void;

  // delivery address (optional, used when goods are shipped)
  deliveryAddress: string;
  onDeliveryAddressChange: (v: string) => void;

  // notes
  notes: string;
  onNotesChange: (v: string) => void;

  // computed totals (sisaPelunasan and effectiveDp computed from raw dpAmount + dpInputType)
  subtotal: number;
  totalInvoice: number;
  effectiveDp: number;
  sisaPelunasan: number;

  // actions
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export default function PaymentPanel(props: PaymentPanelProps) {
  const {
    method, subtype, onMethodChange, onSubtypeChange,
    paymentType, onPaymentTypeChange, dpAmount, dpInputType,
    onDpAmountChange, onDpInputTypeChange,
    ongkirOn, ongkirAmount, onOngkirToggle, onOngkirAmountChange,
    deliveryAddress, onDeliveryAddressChange,
    notes, onNotesChange,
    subtotal, totalInvoice, effectiveDp, sisaPelunasan,
    saving, onSave, onCancel,
  } = props;

  return (
    <div className="space-y-4">
      <PaymentMethodSelector
        method={method}
        subtype={subtype}
        onMethodChange={onMethodChange}
        onSubtypeChange={onSubtypeChange}
      />

      {/* Payment type toggle */}
      <div>
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Tipe Pembayaran
        </label>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['FULL','DP'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onPaymentTypeChange(t)}
              className={`flex-1 text-center py-2 px-3 rounded-lg text-[12px] font-bold ${
                paymentType === t ? 'bg-white text-[#012749] shadow-sm' : 'text-slate-500'
              }`}
            >
              {t === 'FULL' ? 'Full Payment' : 'DP / Tanda Jadi'}
            </button>
          ))}
        </div>
        {paymentType === 'DP' && (
          <>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input
                type="number"
                value={dpAmount || ''}
                onChange={e => onDpAmountChange(Number(e.target.value || 0))}
                placeholder={dpInputType === 'PERCENT' ? 'Persen DP (mis. 30)' : 'Jumlah DP (Rp)'}
                min={0}
                max={dpInputType === 'PERCENT' ? 100 : undefined}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[13px]"
              />
              <select
                value={dpInputType ?? 'AMOUNT'}
                onChange={e => onDpInputTypeChange(e.target.value as KasirDpInputType)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[13px]"
              >
                <option value="AMOUNT">Nominal (Rp)</option>
                <option value="PERCENT">Persen (%)</option>
              </select>
            </div>
            {dpInputType === 'PERCENT' && dpAmount > 0 && (
              <p className="text-[11px] mt-1 pl-1 font-semibold text-emerald-700">
                💡 Customer bayar DP: <strong>{formatRp(effectiveDp)}</strong>
                {dpAmount > 0 && dpAmount <= 100 && ` (${dpAmount}% dari ${formatRp(totalInvoice)})`}
                {dpAmount > 100 && <span className="text-rose-600"> · ⚠️ Persen tidak boleh &gt; 100</span>}
              </p>
            )}
          </>
        )}
      </div>

      {/* Ongkir */}
      <div>
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Tambahan
        </label>
        <button
          type="button"
          onClick={() => onOngkirToggle(!ongkirOn)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] border ${
            ongkirOn ? 'bg-orange-50 border-orange-500' : 'bg-slate-50 border-dashed border-slate-300'
          }`}
        >
          <span className={`font-extrabold flex items-center gap-1.5 ${ongkirOn ? 'text-orange-700' : 'text-slate-700'}`}>
            🚚 Biaya Ongkir <span className="text-[11px] text-slate-400 font-semibold">(opsional)</span>
          </span>
          <span className={`w-8 h-4 rounded-full relative ${ongkirOn ? 'bg-orange-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${ongkirOn ? 'left-4' : 'left-0.5'}`}></span>
          </span>
        </button>
        {ongkirOn && (
          <input
            type="number"
            value={ongkirAmount || ''}
            onChange={e => onOngkirAmountChange(Number(e.target.value || 0))}
            placeholder="Rp 0"
            className="mt-2 w-full bg-white border border-orange-500 rounded-lg px-3 py-2 text-[13px] font-bold text-orange-700"
          />
        )}
      </div>

      {/* Delivery address */}
      <div>
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2.5">
          <div className="flex justify-between items-center mb-1">
            <span className="font-extrabold text-violet-700 text-[13px] flex items-center gap-1">📍 Alamat Pengiriman</span>
            <span className="text-[10px] text-violet-700 font-extrabold uppercase tracking-widest">opsional · tampil di invoice</span>
          </div>
          <textarea
            value={deliveryAddress}
            onChange={e => onDeliveryAddressChange(e.target.value)}
            placeholder="Isi jika barang dikirim. Mis. Jl. Merdeka No. 12, Jakarta Utara."
            className="w-full min-h-[48px] bg-white border border-violet-200 rounded-lg px-3 py-2 text-[13px] text-violet-900 resize-y outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
          <div className="flex justify-between items-center mb-1">
            <span className="font-extrabold text-sky-700 text-[13px] flex items-center gap-1">📝 Catatan</span>
            <span className="text-[10px] text-sky-700 font-extrabold uppercase tracking-widest">opsional · tampil di invoice</span>
          </div>
          <textarea
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="Mis. Garansi 1 bulan. Bawakan kunci pas."
            className="w-full min-h-[56px] bg-white border border-sky-200 rounded-lg px-3 py-2 text-[13px] text-sky-900 resize-y outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Totals */}
      <div className="bg-slate-50 rounded-xl px-3 py-3">
        <div className="flex justify-between py-1 text-[13px] text-slate-600">
          <span>Subtotal barang</span><span>{formatRp(subtotal)}</span>
        </div>
        {ongkirOn && ongkirAmount > 0 && (
          <div className="flex justify-between py-1 text-[13px] text-orange-700 font-bold">
            <span>↳ Biaya ongkir</span><span>{formatRp(ongkirAmount)}</span>
          </div>
        )}
        {paymentType === 'DP' && (
          <>
            <div className="flex justify-between py-1 text-[13px] text-emerald-700 font-bold">
              <span>↳ DP diterima</span><span>{formatRp(effectiveDp)}</span>
            </div>
            <div className="flex justify-between py-1 text-[13px] text-amber-700 font-extrabold">
              <span>↳ Sisa pelunasan</span><span>{formatRp(sisaPelunasan)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between py-2 mt-1 border-t-2 border-[#012749] text-[15px] font-extrabold text-[#012749]">
          <span>Total Invoice</span><span>{formatRp(totalInvoice)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`w-full py-3.5 rounded-xl text-white text-[14px] font-extrabold disabled:opacity-60 ${
            paymentType === 'DP' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-[#2d8a4e] hover:bg-green-700'
          }`}
        >
          {saving ? 'Menyimpan...' : `💾 Simpan & Cetak Invoice ${paymentType === 'DP' ? 'DP' : 'Lunas'}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-3.5 rounded-xl bg-white border border-slate-300 text-slate-600 text-[13px] font-bold hover:bg-slate-50"
        >
          Batal
        </button>
        <p className="text-[11px] text-slate-500 text-center">🖨️ Invoice otomatis dikirim ke printer dotmatrix</p>
      </div>
    </div>
  );
}
