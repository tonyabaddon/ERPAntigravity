// src/components/rekonsiliasi/CompletionSummary.tsx
import React from 'react';

interface Props {
  orderPct: number;
  mutasiPct: number;
  cashPct: number;
}

export default function CompletionSummary({ orderPct, mutasiPct, cashPct }: Props) {
  const total = Math.round((orderPct + mutasiPct + cashPct) / 3);
  return (
    <div className="bg-white/85 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[var(--color-caleo-mist)] shadow-sm flex items-center justify-between">
      <div>
        <div className="text-[11px] font-black uppercase tracking-widest text-[var(--color-caleo-primary)]">🎯 Target Final · Semua Punya Pasangan</div>
        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Tutup buku diizinkan setelah ketiga kolom 100% atau reason untuk yang tidak match</div>
      </div>
      <div className="flex gap-6 items-center">
        {([['Order', orderPct], ['Mutasi', mutasiPct], ['Kas', cashPct]] as const).map(([label, pct]) => (
          <div key={label} className="text-center">
            <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
            <div className="text-lg font-black text-[var(--color-caleo-primary)]">{pct}%</div>
          </div>
        ))}
        <div className="text-center">
          <div className="text-[10px] font-bold uppercase text-emerald-700">Total</div>
          <div className="text-2xl font-black text-emerald-600">{total}%</div>
        </div>
      </div>
    </div>
  );
}
