// src/components/rekonsiliasi/CashColumn.tsx
import React from 'react';
import type { CashDepositBatch } from '../../types';

interface Props {
  batches: CashDepositBatch[];
  onFindDeposit: (batchId: string) => void;
  onExplain: (batchId: string) => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }

export default function CashColumn({ batches, onFindDeposit, onExplain }: Props) {
  const matched = batches.filter(b => b.status === 'DEPOSITED' || b.status === 'CARRY_OVER').length;
  const pct = batches.length === 0 ? 0 : Math.round(matched / batches.length * 100);

  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.75rem] border border-[var(--color-caleo-mist)] shadow-sm flex flex-col overflow-hidden">
      <div className="px-4 py-4 border-b border-[var(--color-caleo-mist)]">
        <div className="flex items-center justify-between">
          <div className="text-caleo-11 font-black uppercase tracking-widest text-[var(--color-caleo-primary)]">💵 Kas Tunai</div>
          <span className="text-caleo-10 text-slate-500 font-bold">{matched}/{batches.length} batch</span>
        </div>
        <div className="h-1.5 mt-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: pct + '%' }} />
        </div>
      </div>
      <div className="p-3 overflow-y-auto" style={{ maxHeight: 540 }}>
        {batches.map(b => {
          const isDeposited = b.status === 'DEPOSITED';
          const hasVariance = b.variance !== 0;
          const cardBg = isDeposited && !hasVariance ? 'rgba(236,253,245,0.5)' : hasVariance ? 'rgba(254,242,242,0.55)' : 'rgba(255,251,235,0.55)';
          const cardBorder = isDeposited && !hasVariance ? '#a7f3d0' : hasVariance ? '#fecaca' : '#fde68a';
          return (
            <div key={b.id} className="p-3 rounded border mb-2" style={{ background: cardBg, borderColor: cardBorder }}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-xs font-bold text-[var(--color-caleo-primary)]">
                    {b.deposit_date ? `Setoran ${new Date(b.deposit_date).toLocaleDateString('id-ID')}` : 'Belum disetor'}
                  </div>
                  <div className="text-caleo-10 text-slate-500 font-semibold mt-0.5">
                    Expected {fmt(b.expected_amount)} {hasVariance && `· Selisih ${fmt(b.variance)}`}
                  </div>
                </div>
                <div className={`text-xs font-black ${hasVariance ? 'text-red-600' : 'text-emerald-600'}`}>
                  {fmt(b.deposited_amount ?? b.expected_amount)}
                </div>
              </div>
              <div className="flex gap-1.5 mt-2 items-center">
                <span className={`text-caleo-10 font-extrabold uppercase px-2 py-0.5 rounded-full ${isDeposited ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{b.status}</span>
                {!isDeposited && <button onClick={() => onFindDeposit(b.id)} className="ml-auto text-caleo-10 font-extrabold px-2 py-1 rounded bg-white border border-[var(--color-caleo-mist)] text-[var(--color-caleo-primary)]">Cari setoran →</button>}
                {hasVariance && <button onClick={() => onExplain(b.id)} className="ml-auto text-caleo-10 font-extrabold px-2 py-1 rounded bg-white border border-red-200 text-red-700">Jelaskan</button>}
              </div>
            </div>
          );
        })}
        {batches.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-4">Belum ada batch kas.</div>}
      </div>
    </div>
  );
}
