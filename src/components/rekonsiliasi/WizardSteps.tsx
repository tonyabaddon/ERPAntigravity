// src/components/rekonsiliasi/WizardSteps.tsx
import React from 'react';

interface Counts {
  setup: { done: number; total: number };
  review: number;
  piutang: number;
}

interface Props {
  currentStep: 1 | 2 | 3 | 4 | 5 | 6;
  counts: Counts;
  onJump: (n: number) => void;
}

const STEPS = [
  { n: 1, label: 'Setup',      sub: 'Rekening + PDF' },
  { n: 2, label: 'Auto-Cocok', sub: 'AI Match' },
  { n: 3, label: 'Review',     sub: 'Manual Review' },
  { n: 4, label: 'Kas',        sub: 'Verifikasi Kas' },
  { n: 5, label: 'Piutang',    sub: 'Cek Belum Bayar' },
  { n: 6, label: 'Tutup',      sub: 'Sign-off + PDF' },
];

export default function WizardSteps({ currentStep, counts, onJump }: Props) {
  return (
    <div className="bg-white/78 backdrop-blur-xl rounded-[1.5rem] p-5 border border-[var(--color-caleo-mist)] shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-[var(--color-caleo-primary)]">🧭 Langkah Rekonsiliasi</div>
        <div className="text-[10px] text-slate-500 font-bold">Step {currentStep} dari 6</div>
      </div>
      <div className="flex rounded-sm overflow-hidden border border-[var(--color-caleo-mist)]">
        {STEPS.map(s => {
          const cls = s.n < currentStep
            ? 'bg-emerald-50'
            : s.n === currentStep
              ? 'bg-[var(--color-caleo-primary)] text-white'
              : 'bg-white text-slate-400';
          let count = '';
          if (s.n === 1) count = `${counts.setup.done}/${counts.setup.total}`;
          else if (s.n === 3) count = `${counts.review} sisa`;
          else if (s.n === 5) count = `${counts.piutang} piutang`;
          const marker = s.n < currentStep ? '✓ ' : s.n === currentStep ? '▶ ' : '';
          return (
            <div key={s.n} onClick={() => onJump(s.n)} className={`flex-1 p-3 cursor-pointer transition ${cls}`}>
              <div className="text-[10px] font-black">{marker}{s.label}</div>
              <div className="text-[11px] font-bold mt-0.5">{s.sub}</div>
              <div className="text-[10px] mt-0.5 opacity-70">{count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
