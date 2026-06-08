// src/components/rekonsiliasi/TallyBar.tsx
import React from 'react';

interface Props {
  totalSales: number;
  transferAmount: number;
  edcAmount: number;
  cashAmount: number;
  piutangAmount: number;
  perChannel: { whatsapp: number; tokopedia: number; walkin: number; grosir: number };
  perChannelCount: { whatsapp: number; tokopedia: number; walkin: number; grosir: number };
}

function fmt(n: number) {
  return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt';
}

export default function TallyBar({ totalSales, transferAmount, edcAmount, cashAmount, piutangAmount, perChannel, perChannelCount }: Props) {
  const sum = transferAmount + edcAmount + cashAmount + piutangAmount;
  const tallyOK = Math.abs(sum - totalSales) < 50_000;

  const pct = (a: number) => totalSales === 0 ? 0 : Math.max(0, (a / totalSales) * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[#e5eeff] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">⚖️ Tally Penjualan</div>
          <div className="text-[10px] text-slate-500 font-semibold mt-0.5">Total = Transfer + EDC + Tunai + Piutang</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] text-slate-500 font-bold uppercase">Total Sales</div>
            <div className="text-xl font-black text-[#012749]">{fmt(totalSales)}</div>
          </div>
          <span className={`text-[11px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full ${tallyOK ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {tallyOK ? '✓ TALLY' : `❌ Selisih ${fmt(Math.abs(sum - totalSales))}`}
          </span>
        </div>
      </div>
      <div className="flex rounded-xl overflow-hidden border border-[#e5eeff] mb-3" style={{ height: 22 }}>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(transferAmount) + '%', background: '#10b981' }}>🏦 {fmt(transferAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(edcAmount) + '%', background: '#3b82f6' }}>💳 {fmt(edcAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(cashAmount) + '%', background: '#8b5cf6' }}>💵 {fmt(cashAmount)}</div>
        <div className="text-[9px] font-extrabold text-white flex items-center justify-center" style={{ width: pct(piutangAmount) + '%', background: '#f59e0b' }}>⏳ {fmt(piutangAmount)}</div>
      </div>
      <div className="grid grid-cols-4 gap-3 pt-3 border-t border-[#e5eeff]">
        {([
          ['📱 WhatsApp', perChannel.whatsapp, perChannelCount.whatsapp, '#2d8a4e'],
          ['🛍️ Tokopedia', perChannel.tokopedia, perChannelCount.tokopedia, '#a16207'],
          ['🏪 Walk-in', perChannel.walkin, perChannelCount.walkin, '#1e40af'],
          ['🏭 Grosir', perChannel.grosir, perChannelCount.grosir, '#5b21b6'],
        ] as const).map(([label, amt, cnt, color]) => (
          <div key={label as string} className="text-center">
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color }}>{label}</div>
            <div className="text-sm font-black text-[#012749]">{fmt(amt as number)}</div>
            <div className="text-[10px] font-bold text-slate-500">{cnt} order</div>
          </div>
        ))}
      </div>
    </div>
  );
}
