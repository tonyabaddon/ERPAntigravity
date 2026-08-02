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
  /** Only populated when source.type === 'journal' */
  accountCode?: string;
}

export interface DrawerSource {
  type: 'mutasi' | 'order' | 'cash' | 'journal';
  id: string;
  title: string;
  meta: string;
  headerBg: string;
  headerColor: string;
  /** Target amount for multi-allocation balance display */
  amount?: number;
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
  /** When true: render checkboxes + running total; use onPickMulti callback */
  multiAllocation?: boolean;
  onPickMulti?: (candidateIds: string[], totalAmount: number) => void;
}

function fmt(n: number) { return 'Rp ' + (n / 1_000_000).toFixed(1).replace('.', ',') + 'jt'; }

export default function MappingDrawer({
  open,
  source,
  candidates,
  onPick,
  onSplit,
  onClassify,
  onSkip,
  onClose,
  multiAllocation = false,
  onPickMulti,
}: Props) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(new Set());
    }
  }, [open]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  const filtered = query
    ? candidates.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : candidates;

  // Multi-allocation derived state
  const target = source?.amount ?? 0;
  const selectedCandidates = candidates.filter(c => selected.has(c.id));
  const selectedTotal = selectedCandidates.reduce((sum, c) => sum + c.amount, 0);
  const overTarget = selectedTotal > target;
  const isEmpty = selected.size === 0;
  const submitDisabled = isEmpty || overTarget;

  function toggleCandidate(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleMultiSubmit() {
    if (!submitDisabled && onPickMulti) {
      onPickMulti(Array.from(selected), selectedTotal);
    }
  }

  if (!source) return null;

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 ${open ? 'visible opacity-100' : 'invisible opacity-0'} transition-opacity`}
        style={{ background: 'rgba(1,39,73,0.18)', backdropFilter: 'blur(2px)' }}
      />
      <div className={`fixed right-0 top-0 bottom-0 w-[460px] bg-white z-50 shadow-2xl flex flex-col transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="p-5 border-b border-[#e5eeff]" style={{ background: source.headerBg }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: source.headerColor }}>🔍 Cari pasangan</div>
              <div className="text-base font-black text-[var(--color-caleo-primary)] mt-1">{source.title}</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{source.meta}</div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-extrabold">×</button>
          </div>
        </div>

        {/* Multi-allocation balance bar */}
        {multiAllocation && (
          <div className={`px-4 py-2 border-b border-[#e5eeff] flex items-center justify-between text-[11px] font-bold ${overTarget ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            <span>Dipilih: {fmt(selectedTotal)}</span>
            <span className="text-slate-500 font-semibold">Target: {fmt(target)}</span>
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-3 border-b border-[#e5eeff]">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cari nama atau ID…"
            className="w-full text-xs px-3 py-2 rounded-sm border border-[#e5eeff]"
          />
        </div>

        {/* Candidate list */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.map(c => {
            const isChecked = selected.has(c.id);

            if (multiAllocation) {
              return (
                <div
                  key={c.id}
                  onClick={() => toggleCandidate(c.id)}
                  className={`p-3 rounded-sm border mb-2 cursor-pointer select-none ${
                    isChecked
                      ? 'border-emerald-400 bg-emerald-50'
                      : c.best
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-[#e5eeff]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCandidate(c.id)}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 accent-emerald-600 w-4 h-4 flex-shrink-0"
                    />
                    <div className="flex-1 flex items-start justify-between">
                      <div>
                        <div className="text-xs font-bold text-[var(--color-caleo-primary)]">{c.name}</div>
                        <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{c.meta}</div>
                        <div className={`text-[10px] font-bold mt-1 ${c.best ? 'text-emerald-700' : 'text-slate-500'}`}>
                          Skor {c.score.toFixed(2)} · {c.scoreBreakdown}
                        </div>
                        <div className="h-1 mt-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: Math.round(c.score * 100) + '%' }} />
                        </div>
                      </div>
                      <div className="text-right ml-3 flex-shrink-0">
                        <div className="text-xs font-black text-[var(--color-caleo-primary)]">{fmt(c.amount)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            // Single-select mode (default) — unchanged behavior
            return (
              <div key={c.id} className={`p-3 rounded-sm border mb-2 cursor-pointer ${c.best ? 'border-emerald-400 bg-emerald-50' : 'border-[#e5eeff]'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-bold text-[var(--color-caleo-primary)]">{c.name}</div>
                    <div className="text-[10px] text-slate-500 font-semibold mt-0.5">{c.meta}</div>
                    <div className={`text-[10px] font-bold mt-1 ${c.best ? 'text-emerald-700' : 'text-slate-500'}`}>Skor {c.score.toFixed(2)} · {c.scoreBreakdown}</div>
                    <div className="h-1 mt-1 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600" style={{ width: Math.round(c.score * 100) + '%' }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-[var(--color-caleo-primary)]">{fmt(c.amount)}</div>
                    <button onClick={() => onPick(c.id)} className={`mt-2 px-3 py-1 rounded-sm text-[10px] font-extrabold ${c.best ? 'bg-emerald-600 text-white' : 'bg-white border border-[#e5eeff] text-[var(--color-caleo-primary)]'}`}>
                      {c.best ? '✓ Pilih' : 'Pilih'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center text-xs text-slate-400 font-semibold py-6">Tidak ada kandidat.</div>}
        </div>

        {/* Footer */}
        {multiAllocation ? (
          <div className="border-t border-[#e5eeff] p-4 space-y-2 bg-slate-50">
            <button
              onClick={handleMultiSubmit}
              disabled={submitDisabled}
              className={`w-full p-3 rounded-sm text-xs font-extrabold transition-colors ${
                submitDisabled
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : overTarget
                  ? 'bg-rose-600 text-white'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {overTarget
                ? '⚠️ Melebihi target — hapus pilihan'
                : `✓ Match selected (${selected.size} line${selected.size !== 1 ? 's' : ''})`}
            </button>
            <button onClick={onSkip} className="w-full text-left p-3 rounded-sm bg-white border border-amber-200 text-xs font-extrabold text-amber-700">⏭️ Lewati dulu</button>
          </div>
        ) : (
          <div className="border-t border-[#e5eeff] p-4 space-y-2 bg-slate-50">
            <button onClick={onSplit} className="w-full text-left p-3 rounded-sm bg-white border border-[#e5eeff] text-xs font-bold text-[var(--color-caleo-primary)]">🔀 Split — pecah ke beberapa target</button>
            <button onClick={onClassify} className="w-full text-left p-3 rounded-sm bg-white border border-[#e5eeff] text-xs font-bold text-[var(--color-caleo-primary)]">📝 Klasifikasi lain — topup, biaya, refund</button>
            <button onClick={onSkip} className="w-full text-left p-3 rounded-sm bg-white border border-amber-200 text-xs font-extrabold text-amber-700">⏭️ Lewati dulu</button>
          </div>
        )}
      </div>
    </>
  );
}
