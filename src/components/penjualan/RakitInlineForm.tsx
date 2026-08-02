// src/components/penjualan/RakitInlineForm.tsx
import React, { useState } from 'react';
import type { RakitServiceType } from '../../types';

interface RakitInlineFormProps {
  type: RakitServiceType;
  /** Display name from serviceTypes DB lookup. Falls back to hardcoded labels when omitted. */
  serviceTypeName?: string;
  onAdd: (line: {
    type: RakitServiceType;
    description: string;
    estimatedPrice: number;
    hppEstimate: number;
  }) => void;
  onCancel: () => void;
}

export default function RakitInlineForm({ type, serviceTypeName, onAdd, onCancel }: RakitInlineFormProps) {
  const [description, setDescription] = useState('');
  const [estimatedPrice, setEstimatedPrice] = useState<number>(0);
  const [hppEstimate, setHppEstimate] = useState<number>(0);
  const isCustom = type === 'jasa_custom_panel';
  // Use DB name when provided, fall back to hardcoded labels.
  const displayName = serviceTypeName ?? (isCustom ? 'Jasa Custom Panel' : 'Wiring Panel');

  const canSubmit = description.trim().length > 0 && estimatedPrice > 0;
  const submit = () => {
    if (!canSubmit) return;
    onAdd({ type, description: description.trim(), estimatedPrice, hppEstimate });
    setDescription('');
    setEstimatedPrice(0);
    setHppEstimate(0);
  };

  const placeholder = isCustom
    ? 'Mis. Custom Panel Distribusi 3-fase — PLN 50kVA'
    : 'Mis. Box Wiring untuk PT XYZ — 1 unit';

  return (
    <div className={`bg-white border ${isCustom ? 'border-sky-300' : 'border-orange-300'} rounded-sm p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
            isCustom ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-orange-50 text-orange-700 border border-orange-200'
          }`}>
            {isCustom ? '📦' : '⚡'} {displayName}
          </span>
          <span className="text-[11px] text-slate-500">isi detail di bawah</span>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-rose-500 text-base">✕</button>
      </div>
      <div>
        <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Deskripsi (singkat, tampil di invoice)</div>
        <input
          type="text"
          className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
          placeholder={placeholder}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">Estimasi Harga (quote disepakati)</div>
          <input
            type="number"
            min={0}
            className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
            placeholder="0"
            value={estimatedPrice || ''}
            onChange={e => setEstimatedPrice(Number(e.target.value || 0))}
          />
        </div>
        <div>
          <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-1.5">HPP (modal)</div>
          <input
            type="number"
            min={0}
            className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-emerald-500"
            placeholder="0"
            value={hppEstimate || ''}
            onChange={e => setHppEstimate(Number(e.target.value || 0))}
          />
        </div>
      </div>
      <div className="text-[11px] text-slate-500">
        ℹ Admin bisa adjust ke harga final saat lock kalau scope berubah (untuk cart dengan SKU). Untuk cart pure-jasa, HPP di sini final.
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-sm text-[12px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">
          Batal
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`px-3 py-2 rounded-sm text-[12px] font-extrabold text-white transition ${
            isCustom ? 'bg-sky-500 hover:bg-sky-600' : 'bg-amber-500 hover:bg-amber-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          + Tambah ke Cart
        </button>
      </div>
    </div>
  );
}
