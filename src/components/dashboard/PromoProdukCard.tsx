// PromoProdukCard.tsx
// Dashboard summary card for per-SKU promo status.
// Hidden entirely when all 3 metrics = 0.

import { useEffect, useState } from 'react';
import { getPromoSummary } from '../../lib/promoProduk/api';
import type { PromoSummary } from '../../lib/promoProduk/types';
import { captureError } from '../../lib/captureError';

interface Props {
  onNavigateToPengaturan: () => void;
}

export default function PromoProdukCard({ onNavigateToPengaturan }: Props) {
  const [summary, setSummary] = useState<PromoSummary | null>(null);

  useEffect(() => {
    getPromoSummary()
      .then(setSummary)
      .catch((err) => {
        captureError(err, { feature: 'dashboard', action: 'fetch_promo_summary' });
      });
  }, []);

  // Still loading — render nothing (avoid layout shift)
  if (summary === null) return null;

  // Hide when all zeros
  if (summary.total_active === 0 && summary.expiring_7d === 0 && summary.expired_30d === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-extrabold text-[var(--color-caleo-primary)]">🏷 Promo Produk</h3>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-6 text-center">✅</span>
          <span className="text-slate-700">
            <span className="font-bold text-[var(--color-caleo-primary)]">{summary.total_active}</span> SKU sedang promo
          </span>
        </div>

        {summary.expiring_7d > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-6 text-center">⏰</span>
            <span className="text-amber-700">
              <span className="font-bold">{summary.expiring_7d}</span> SKU akan kadaluwarsa dalam 7 hari
            </span>
          </div>
        )}

        {summary.expired_30d > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-6 text-center">📉</span>
            <span className="text-slate-500">
              <span className="font-bold">{summary.expired_30d}</span> SKU sudah kadaluwarsa (30 hari terakhir)
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={onNavigateToPengaturan}
          className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
        >
          Kelola promo →
        </button>
      </div>
    </div>
  );
}
