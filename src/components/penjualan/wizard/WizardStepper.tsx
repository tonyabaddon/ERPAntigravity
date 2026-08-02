import { Fragment } from 'react';

interface Props {
  currentStep: 1 | 2 | 3;
  completedSteps: Set<1 | 2 | 3>;
  onJumpBack: (step: 1 | 2 | 3) => void;
}

const LABELS: Record<1 | 2 | 3, string> = {
  1: 'Channel & Customer',
  2: 'Pesanan',
  3: 'Pembayaran',
};

export default function WizardStepper({ currentStep, completedSteps, onJumpBack }: Props) {
  return (
    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 bg-white">
      {[1, 2, 3].map((step, idx) => {
        const s = step as 1 | 2 | 3;
        const isCompleted = completedSteps.has(s);
        const isCurrent = currentStep === s;
        const canClick = isCompleted && !isCurrent;
        const dotClass = isCurrent
          ? 'bg-[var(--color-caleo-primary)] text-white'
          : isCompleted
            ? 'bg-[#2d8a4e] text-white'
            : 'bg-slate-200 text-slate-500';
        const labelClass = isCurrent
          ? 'text-[var(--color-caleo-primary)] font-semibold'
          : isCompleted
            ? 'text-slate-700 font-semibold'
            : 'text-slate-500';

        return (
          <Fragment key={step}>
            {idx > 0 && (
              <div className={`flex-1 h-[2px] ${isCompleted || isCurrent ? 'bg-[#2d8a4e]' : 'bg-slate-200'}`} />
            )}
            <button
              type="button"
              disabled={!canClick}
              onClick={() => canClick && onJumpBack(s)}
              className={`flex items-center gap-2 text-sm ${canClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'} ${isCurrent || isCompleted ? '' : 'opacity-60'}`}
            >
              <div className={`w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center ${dotClass}`}>
                {isCompleted && !isCurrent ? '✓' : step}
              </div>
              <div className={labelClass}>{LABELS[s]}</div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
