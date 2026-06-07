// src/components/rekonsiliasi/MappingDrawer.tsx
import React, { useEffect, useState } from 'react';

export interface DrawerCandidate {
  id: string;
  name: string;
  meta: string;
  amount: number;
  score: number;
  scoreBreakdown: string;
  best?: boolean;
}

export interface DrawerSource {
  type: 'mutasi' | 'order' | 'cash';
  id: string;
  title: string;
  meta: string;
  headerBg: string;
  headerColor: string;
}

interface Props {
  open: boolean;
  source: DrawerSource | null;
  candidates: DrawerCandidate[];
  onPick: (candidateId: string) => void;
  onSplit: () => void;
  onClassify: () => void;
  onSkip: () => void;
  onClose: () => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }

export default function MappingDrawer({ open, source, candidates, onPick, onSplit, onClassify, onSkip, onClose }: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const filtered = query ? candidates.filter(c => c.name.toLowerCase().includes(query.toLowerCase())) : candidates;

  if (!source) return null;
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 ${open ? 'visible opacity-100' : 'invisible opacity-0'} transition-opacity`}
        style={{ background: 'rgba(1,39,73,0.18)', backdropFilter: 'blur(2px)' }}
      />
      <div className={`fixed right-0 top-0 bottom-0 w-[460px] bg-white z-50 shadow-2xl flex flex-col transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-5 border-b border-[#e5eeff]" style={{ background: source.headerBg }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: source.headerColor }}>🔍 Cari pasangan</div>
              <div className="text-base font-black text-[#012749] mt-1">{source.title}</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{source.meta}</div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-extrabold">×</button>
          </div>
        </div>
        <div className="px-5 py-3 border-b border-[#e5eeff]">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama atau ID…" className="w-full text-xs px-3 py-2 rounded-lg border border-[#e5eeff]" />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.map(c => (
            <div key={c.id} className={`p-3 rounded-2xl border mb-2 cursor-pointer ${c.best ? 'border-emerald-400 bg-emerald-50' : 'border-[#e5eeff]'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold text-[#012749]">{c.name}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{c.meta}</div>
                  <div className={`text-[10px] font-bold mt-1 ${c.best ? 'text-emerald-700' : 'text-slate-500'}`}>Skor {c.score.toFixed(2)} · {c.scoreBreakdown}</div>
                  <div className="h-1 mt-1 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: Math.round(c.score * 100) + '%' }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-[#012749]">{fmt(c.amount)}</div>
                  <button onClick={() => onPick(c.id)} className={`mt-2 px-3 py-1 rounded-lg text-[10px] font-extrabold ${c.best ? 'bg-emerald-600 text-white' : 'bg-white border border-[#e5eeff] text-[#012749]'}`}>
                    {c.best ? '✓ Pilih' : 'Pilih'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-6">Tidak ada kandidat.</div>}
        </div>
        <div className="border-t border-[#e5eeff] p-4 space-y-2 bg-slate-50">
          <button onClick={onSplit} className="w-full text-left p-3 rounded-xl bg-white border border-[#e5eeff] text-xs font-bold text-[#012749]">🔀 Split — pecah ke beberapa target</button>
          <button onClick={onClassify} className="w-full text-left p-3 rounded-xl bg-white border border-[#e5eeff] text-xs font-bold text-[#012749]">📝 Klasifikasi lain — topup, biaya, refund</button>
          <button onClick={onSkip} className="w-full text-left p-3 rounded-xl bg-white border border-amber-200 text-xs font-extrabold text-amber-700">⏭️ Lewati dulu</button>
        </div>
      </div>
    </>
  );
}
