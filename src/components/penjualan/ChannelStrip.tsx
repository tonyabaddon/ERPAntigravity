import React from 'react';

export interface TokpedStripProps {
  value: string;
  onChange: (v: string) => void;
}

export function TokpedStrip({ value, onChange }: TokpedStripProps) {
  return (
    <div className="bg-gradient-to-r from-amber-100 to-amber-50 border border-amber-300 border-l-4 border-l-amber-600 rounded px-4 py-3 mb-4 flex items-center gap-3">
      <span className="text-2xl leading-none">🛍️</span>
      <div className="flex-1">
        <label className="text-caleo-11 font-extrabold text-amber-700 uppercase tracking-widest block">
          Nomor Order Marketplace <span className="text-caleo-danger">*</span>
        </label>
        <p className="text-caleo-11 text-amber-800 mt-0.5">Copy dari aplikasi Seller marketplace (Tokopedia, Shopee, dll).</p>
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Contoh: SHP-2406-12345 / INV/..."
        className="bg-white border border-amber-300 rounded px-3 py-2 text-caleo-13 font-bold text-amber-900 min-w-[220px]"
      />
    </div>
  );
}

export interface WhatsappStripProps {
  phone: string;
  chatUrl: string;
  onPhoneChange: (v: string) => void;
  onChatUrlChange: (v: string) => void;
}

export function WhatsappStrip({ phone, chatUrl, onPhoneChange, onChatUrlChange }: WhatsappStripProps) {
  return (
    <div className="bg-gradient-to-r from-green-100 to-green-50 border border-green-300 border-l-4 border-l-green-600 rounded px-4 py-3 mb-4 flex items-start gap-3">
      <span className="text-2xl leading-none mt-0.5">💬</span>
      <div className="flex-1">
        <label className="text-caleo-11 font-extrabold text-caleo-success uppercase tracking-widest block">
          Catat Pesanan WhatsApp Manual
        </label>
        <p className="text-caleo-11 text-caleo-success mt-0.5 mb-2">Pesanan WA yang di-input manual oleh admin.</p>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <input
            value={phone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="No. WA pelanggan"
            className="bg-white border border-green-300 rounded px-3 py-2 text-caleo-13 font-bold text-caleo-success"
          />
          <input
            value={chatUrl}
            onChange={e => onChatUrlChange(e.target.value)}
            placeholder="Link chat WA (opsional)"
            className="bg-white border border-green-300 rounded px-3 py-2 text-caleo-13 font-bold text-caleo-success"
          />
        </div>
      </div>
    </div>
  );
}
