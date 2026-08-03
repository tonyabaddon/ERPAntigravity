import React from 'react';
import { ArrowRight } from 'lucide-react';

interface Props {
  icon: React.ReactNode;
  title: string;
  count: number;
  detail: string;
  ctaLabel: string;
  onCta: () => void;
  badgeVariant?: 'amber' | 'rose' | 'emerald' | 'slate';
}

const BADGE_CLASSES: Record<NonNullable<Props['badgeVariant']>, string> = {
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  rose:    'bg-rose-50 text-caleo-danger border-rose-200',
  emerald: 'bg-emerald-50 text-caleo-success border-emerald-200',
  slate:   'bg-slate-100 text-slate-600 border-slate-200',
};

export default function MaintenanceCard({
  icon, title, count, detail, ctaLabel, onCta, badgeVariant = 'slate',
}: Props) {
  if (count <= 0) return null;
  return (
    <div className="bg-white rounded p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded flex items-center justify-center border ${BADGE_CLASSES[badgeVariant]}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-caleo-11 font-bold text-slate-500 uppercase tracking-wider">{title}</div>
          <div className="text-2xl font-extrabold text-slate-800 mt-0.5">{count}</div>
          <div className="text-xs text-slate-600 mt-0.5 truncate">{detail}</div>
        </div>
      </div>
      <button
        onClick={onCta}
        className="w-full flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 rounded transition-colors"
      >
        {ctaLabel}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
