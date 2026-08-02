// Shared error-state component. Use for "network/query/render failed" scenarios.
// Provides consistent copy + retry affordance across app.
//
// MSME rule: message must be Bahasa Indonesia + actionable. Never surface raw
// error strings (e.g. "TypeError: ...") — use extractErrorMessage() + this
// component's default "Gagal memuat data" fallback.
//
// Variants:
//   - default: centered icon + message + optional retry button
//   - inline:  compact single-line for tight surfaces (dropdown, cell)

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  message?: string;
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  inline?: boolean;
  className?: string;
}

export default function ErrorState({
  message = 'Gagal memuat data.',
  hint,
  onRetry,
  retryLabel = 'Coba lagi',
  inline = false,
  className = '',
}: Props) {
  if (inline) {
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
        <span className="text-red-600">{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-bold text-[var(--color-caleo-primary)] underline hover:opacity-80"
          >
            {retryLabel}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}>
      <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
      <div className="text-sm font-semibold text-red-700">{message}</div>
      {hint && (
        <div className="text-xs text-slate-500 mt-1 max-w-sm">{hint}</div>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 px-4 py-2 rounded-sm bg-[var(--color-caleo-primary)] text-white text-xs font-bold hover:opacity-90"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
