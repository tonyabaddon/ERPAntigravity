// src/components/rekonsiliasi/ClassificationModal.tsx
import React, { useState } from 'react';
import type { BankLineKind } from '../../types';

interface Props {
  open: boolean;
  bankLineSummary: string;
  onApply: (kind: BankLineKind, notes: string) => void;
  onClose: () => void;
}

const OPTIONS: { kind: BankLineKind; label: string; desc: string }[] = [
  { kind: 'CUSTOMER_TOPUP', label: 'Customer Topup (advance)', desc: 'Customer transfer duluan, order belum dibuat. Masuk ke saldo deposit.' },
  { kind: 'OWNER_TOPUP',    label: 'Owner Topup',              desc: 'Pemilik kirim modal kerja ke ops.' },
  { kind: 'OWNER_DRAWING',  label: 'Owner Drawing',            desc: 'Pemilik tarik uang untuk pribadi.' },
  { kind: 'OTHER_INCOME',   label: 'Pendapatan Lain',          desc: 'Bunga, cashback, dll.' },
  { kind: 'LEGACY_PERIOD',  label: 'Pelunasan Order Lama',     desc: 'Pelunasan order dari periode sebelum cutoff.' },
  { kind: 'REFUND',         label: 'Refund Customer',          desc: 'Transfer keluar ke customer karena cancel.' },
];

export default function ClassificationModal({ open, bankLineSummary, onApply, onClose }: Props) {
  const [picked, setPicked] = useState<BankLineKind | null>(null);
  const [notes, setNotes] = useState('');

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(1,39,73,0.4)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-sm p-6 w-full max-w-md">
        <h3 className="text-base font-black text-[#012749] mb-1">Klasifikasi Bank Line</h3>
        <p className="text-[11px] text-slate-500 font-semibold mb-4">{bankLineSummary}</p>
        <div className="space-y-2 mb-4">
          {OPTIONS.map(o => (
            <div
              key={o.kind}
              onClick={() => setPicked(o.kind)}
              className={`p-3 rounded-sm border cursor-pointer ${picked === o.kind ? 'border-[#012749] bg-blue-50' : 'border-[#e5eeff]'}`}
            >
              <div className="flex items-center gap-2">
                <input type="radio" checked={picked === o.kind} readOnly />
                <div>
                  <div className="text-xs font-bold text-[#012749]">{o.label}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">{o.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (opsional)"
          className="w-full mb-4 px-3 py-2 border border-[#e5eeff] rounded-sm text-xs"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-full text-xs font-bold bg-slate-100">Batal</button>
          <button
            onClick={() => picked && onApply(picked, notes)}
            disabled={!picked}
            className="px-4 py-2 rounded-full text-xs font-bold bg-[#012749] text-white disabled:opacity-50"
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  );
}
