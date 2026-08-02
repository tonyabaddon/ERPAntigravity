// Shared empty-state component. Use for "no data yet" scenarios (empty list,
// empty search results, empty filter). Consistent visual + Bahasa copy across
// tenant app + admin panel.
//
// MSME rule (per docs/caleo-design-system.md): every "belum ada" or "tidak ada"
// message must render via <EmptyState /> — never inline text. Guardrail via
// audit:hardcoded-empty-state.
//
// Variants:
//   - default:  centered text + optional CTA button
//   - inline:   compact single-line for tight surfaces (table row, dropdown)
//
// Props:
//   message:  required — Bahasa Indonesia, no english. "Belum ada X." style.
//   hint:     optional — sub-line, italic slate-500, gives next-step guidance.
//   action:   optional — CTA button props (label + onClick).
//   inline:   optional — compact single-line variant.
//   icon:     optional — lucide icon component (Inbox default).

import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface Props {
  message: string;
  hint?: string;
  action?: EmptyStateAction;
  inline?: boolean;
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  className?: string;
}

export default function EmptyState({
  message,
  hint,
  action,
  inline = false,
  icon: Icon = Inbox,
  className = '',
}: Props) {
  if (inline) {
    return (
      <div className={`text-xs text-slate-500 py-2 ${className}`}>
        {message}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <Icon className="w-10 h-10 text-slate-300 mb-3" />
      <div className="text-sm font-semibold text-slate-600">{message}</div>
      {hint && (
        <div className="text-xs text-slate-400 italic mt-1 max-w-sm">{hint}</div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-sm bg-[#012749] text-white text-xs font-bold hover:opacity-90"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
