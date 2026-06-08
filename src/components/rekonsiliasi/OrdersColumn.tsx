// src/components/rekonsiliasi/OrdersColumn.tsx
import React, { useState } from 'react';
import type { PayableSlot, SalesChannel } from '../../types';

type Filter = 'all' | 'transfer' | 'edc' | 'cash' | 'piutang' | SalesChannel;

interface OrderRow {
  id: string;
  customer_name: string;
  total: number;
  payment_type: 'FULL' | 'DP';
  dp_amount: number;
  channel: SalesChannel;
  created_at: string;
  booking_expires_at: string;
  slots: PayableSlot[];
}

interface Props {
  orders: OrderRow[];
  onFindPayment: (orderId: string, slotId: string) => void;
  onExtend: (slotId: string) => void;
  onWriteOff: (slotId: string) => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }
function fmtDate(s: string) { return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }); }

const CHANNEL_PILL: Record<SalesChannel, { emoji: string; bg: string; color: string }> = {
  whatsapp:  { emoji: '📱', bg: '#dcfce7', color: '#15803d' },
  tokopedia: { emoji: '🛍️', bg: '#fef3c7', color: '#a16207' },
  walkin:    { emoji: '🏪', bg: '#dbeafe', color: '#1e40af' },
  grosir:    { emoji: '🏭', bg: '#ede9fe', color: '#5b21b6' },
};

export default function OrdersColumn({ orders, onFindPayment, onExtend, onWriteOff }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = orders.filter(o => {
    if (filter === 'all') return true;
    if (['whatsapp', 'tokopedia', 'walkin', 'grosir'].includes(filter)) return o.channel === filter;
    if (filter === 'piutang') return o.slots.some(s => s.status === 'OPEN');
    return true;
  });

  const paired = orders.filter(o => o.slots.length > 0 && o.slots.every(s => s.status !== 'OPEN')).length;
  const pct = orders.length === 0 ? 0 : Math.round((paired / orders.length) * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[#e5eeff] shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e5eeff]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black uppercase tracking-widest text-[#012749]">📋 Order Penjualan</div>
          <span className="text-[10px] text-slate-500 font-bold">{paired}/{orders.length} · {pct}%</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: pct + '%' }} />
        </div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {(['all', 'whatsapp', 'tokopedia', 'walkin', 'grosir', 'piutang'] as const).map(f => (
            <span
              key={f}
              onClick={() => setFilter(f as Filter)}
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full cursor-pointer ${filter === f ? 'bg-[#012749] text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              {f === 'all' ? 'Semua' : f === 'piutang' ? '⏳ Piutang' : `${CHANNEL_PILL[f as SalesChannel]?.emoji ?? ''} ${f}`}
            </span>
          ))}
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {filtered.map(o => {
          const isPiutang = o.slots.some(s => s.status === 'OPEN');
          const allMatched = o.slots.length > 0 && o.slots.every(s => s.status === 'MATCHED');
          const cardBg = allMatched ? 'rgba(236,253,245,0.5)' : isPiutang ? 'rgba(255,251,235,0.55)' : 'rgba(248,250,252,0.6)';
          const cardBorder = allMatched ? '#a7f3d0' : isPiutang ? '#fde68a' : '#f1f5f9';
          const ch = CHANNEL_PILL[o.channel];
          return (
            <div key={o.id} className="p-3 rounded-2xl border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-[#012749]">#{o.id.slice(0, 6)} · {o.customer_name}</span>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: ch.bg, color: ch.color }}>{ch.emoji} {o.channel}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{fmtDate(o.created_at)}</div>
                </div>
                <div className="text-xs font-black text-[#012749]">{fmt(o.total)}</div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center flex-wrap">
                {o.slots.map(s => (
                  <span
                    key={s.id}
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${s.status === 'MATCHED' ? 'bg-emerald-100 text-emerald-700' : s.status === 'EXTENDED' ? 'bg-blue-100 text-blue-700' : s.status === 'WRITTEN_OFF' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'}`}
                  >
                    {s.status === 'MATCHED' ? '✓' : s.status === 'OPEN' ? '⏳' : s.status === 'EXTENDED' ? '📅' : '✗'} {s.slot_type} {fmt(s.expected_amount)}
                  </span>
                ))}
                {isPiutang && (
                  <>
                    <button onClick={() => onFindPayment(o.id, o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-amber-200 text-amber-700">Cari pasangan →</button>
                    <button onClick={() => onExtend(o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-blue-200 text-blue-700">📅 Geser</button>
                    <button onClick={() => onWriteOff(o.slots.find(s => s.status === 'OPEN')!.id)} className="text-[10px] font-extrabold px-2 py-1 rounded bg-white border border-red-200 text-red-700">✗ Write-off</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Tidak ada order untuk filter ini.</div>}
      </div>
    </div>
  );
}
