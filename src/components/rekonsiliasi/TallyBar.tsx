// src/components/rekonsiliasi/TallyBar.tsx
import React from 'react';
import type { SalesChannel } from '../../types';
import { getChannelDef } from '../../lib/salesChannels';
import { useSalesChannels } from '../../contexts/SalesChannelsContext';
import ChannelIcon from '../icons/ChannelIcon';
import { formatIDR } from '../../lib/formatIDR';

interface TallyBarProps {
  tally: Map<SalesChannel, { amount: number; count: number }>;
  totalAmount: number;
  totalCount: number;
}

export default function TallyBar({ tally, totalAmount, totalCount }: TallyBarProps) {
  const { settings } = useSalesChannels();
  // Hide-zero, sort by amount DESC
  const rows = Array.from(tally.entries())
    .filter(([, v]) => v.amount > 0)
    .sort(([, a], [, b]) => b.amount - a.amount);

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded p-8 text-center text-sm text-slate-400">
        Belum ada transaksi di periode ini.
      </div>
    );
  }

  return (
    <div className="bg-white rounded border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-caleo-11 font-bold text-slate-500 uppercase tracking-wide">
        <div className="col-span-1">#</div>
        <div className="col-span-5">Kanal</div>
        <div className="col-span-3 text-right">Total</div>
        <div className="col-span-2 text-right">Trx</div>
        <div className="col-span-1 text-right">%</div>
      </div>
      {rows.map(([code, v], idx) => {
        const def = getChannelDef(code);
        const isHidden = !settings[code]?.isVisible;
        const pct = totalAmount > 0 ? Math.round((v.amount / totalAmount) * 100) : 0;
        return (
          <div key={code} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-100 items-center hover:bg-slate-50">
            <div className="col-span-1 text-sm font-bold text-slate-400">{idx + 1}</div>
            <div className="col-span-5 flex items-center gap-2">
              <div
                className="w-8 h-8 rounded flex items-center justify-center text-white"
                style={{ background: def.brandColor }}
              >
                <ChannelIcon code={code} size={16} />
              </div>
              <div>
                <div className="font-semibold text-sm text-slate-800 flex items-center gap-1.5">
                  {def.label}
                  {isHidden && (
                    <span className="text-caleo-9 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold">DINONAKTIFKAN</span>
                  )}
                </div>
              </div>
            </div>
            <div className="col-span-3 text-right font-mono font-bold text-slate-800">{formatIDR(v.amount)}</div>
            <div className="col-span-2 text-right text-sm text-slate-600">{v.count}</div>
            <div className="col-span-1 text-right text-xs font-semibold text-slate-500">{pct}%</div>
          </div>
        );
      })}
      <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-slate-50 border-t-2 border-slate-300 items-center">
        <div className="col-span-1"></div>
        <div className="col-span-5 text-sm font-extrabold text-slate-800">TOTAL</div>
        <div className="col-span-3 text-right font-mono font-extrabold text-slate-900">{formatIDR(totalAmount)}</div>
        <div className="col-span-2 text-right text-sm font-bold text-slate-700">{totalCount}</div>
        <div className="col-span-1 text-right text-xs font-bold text-slate-500">100%</div>
      </div>
    </div>
  );
}
