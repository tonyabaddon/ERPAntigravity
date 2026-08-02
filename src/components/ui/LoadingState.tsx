// Shared loading-state component. Use for "waiting for network / query"
// scenarios. Consistent visual + Bahasa copy across app.
//
// MSME rule: default label is "Memuat…" — never "Loading" (English). Custom
// labels use Bahasa Indonesia: "Memuat data produk…", "Menyimpan…", etc.
//
// Variants:
//   - default: centered spinner + label (use in main content area)
//   - inline:  small spinner + label side-by-side (use in button, header)
//   - overlay: full-panel overlay (use during mutation on complex forms)

import React from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  label?: string;
  inline?: boolean;
  overlay?: boolean;
  className?: string;
}

export default function LoadingState({
  label = 'Memuat…',
  inline = false,
  overlay = false,
  className = '',
}: Props) {
  if (inline) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        {label}
      </span>
    );
  }
  if (overlay) {
    return (
      <div className={`absolute inset-0 flex items-center justify-center bg-white/70 z-10 ${className}`}>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 text-[var(--color-caleo-primary)] animate-spin" />
          <div className="text-xs text-slate-600 font-semibold">{label}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center py-12 gap-2 ${className}`}>
      <Loader2 className="w-8 h-8 text-[var(--color-caleo-primary)] animate-spin" />
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
