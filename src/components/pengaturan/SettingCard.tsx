import React from 'react';
import type { ImpactSummary } from '../../lib/pengaturan/cascadeMap';

interface SettingCardProps {
  icon: string;
  title: string;
  description: string;
  currentStat?: string;
  impactSummary?: ImpactSummary;
  children: React.ReactNode;  // toggle / dropdown / inputs di kanan
  highlight?: boolean;
}

export default function SettingCard({ icon, title, description, currentStat, impactSummary, children, highlight }: SettingCardProps) {
  const borderClass = highlight ? 'border-2 border-emerald-200 bg-emerald-50/40' : 'border border-slate-200';
  return (
    <div className={`rounded-sm p-4 flex items-start justify-between gap-4 hover:border-slate-300 ${borderClass}`}>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{icon}</span>
          <div className="font-bold text-sm text-[var(--color-caleo-primary)]">{title}</div>
          {highlight && <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-bold">AKTIF</span>}
        </div>
        <div className="text-xs text-slate-600">{description}</div>
        {currentStat && (
          <div className="text-[11px] text-slate-500 mt-2">📊 Saat ini: {currentStat}</div>
        )}
        {impactSummary && impactSummary.level === 'warn' && (
          <div className="bg-amber-50 border border-amber-200 rounded-sm px-2 py-1.5 mt-2 text-[11px] text-amber-800">
            ⚠️ Kalau dimatikan: {impactSummary.message}
          </div>
        )}
        {impactSummary && impactSummary.level === 'info' && (
          <div className="text-[11px] text-slate-500 mt-2">{impactSummary.message}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
