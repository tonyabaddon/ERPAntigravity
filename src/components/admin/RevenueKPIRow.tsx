// src/components/admin/RevenueKPIRow.tsx
// 4 KPI cards for the AdminRevenue dashboard.
// Cards: Bulan ini, YTD, MRR estimasi, ARR estimasi.
// "Bulan ini" shows an up/down arrow vs. previous month.
import React from 'react';
import { formatIDR } from '../../lib/formatIDR';
import type { RevenueStats } from '../../lib/paymentsTypes';

interface RevenueKPIRowProps {
  /** Revenue stats grouped by month (12 rows always). */
  monthlyStats: RevenueStats;
  /** ARR = SUM of active tenants' plan price_annual values. Computed upstream. */
  arr: number;
}

function ArrowUp() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }}
    >
      <path d="M6 10V2M6 2L2 6M6 2l4 4" stroke="#1F8A5B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }}
    >
      <path d="M6 2v8M6 10l4-4M6 10L2 6" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: React.ReactNode;
}

function RevenueKPICard({ title, value, subtitle }: KPICardProps) {
  return (
    <div
      className="bg-white border rounded-sm p-4"
      style={{ borderColor: '#ECEEF1' }}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
      >
        {title}
      </div>
      <div
        className="text-[22px] font-bold leading-none truncate"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
      >
        {value}
      </div>
      {subtitle && (
        <div className="text-[11px] mt-1.5" style={{ color: '#5A6472' }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

/**
 * Derives month totals from monthly_trend.
 * monthly_trend rows are ordered oldest→newest (12 rows). The last row is the
 * current month; the second-to-last is the previous month.
 */
function computeMonthlyKPIs(trend: { month: string; total: number }[]): {
  thisMonth: number;
  prevMonth: number;
  ytd: number;
} {
  if (trend.length === 0) return { thisMonth: 0, prevMonth: 0, ytd: 0 };

  // YTD: sum of all rows
  const ytd = trend.reduce((acc, r) => acc + r.total, 0);
  const thisMonth = trend[trend.length - 1]?.total ?? 0;
  const prevMonth = trend[trend.length - 2]?.total ?? 0;

  return { thisMonth, prevMonth, ytd };
}

export function RevenueKPIRow({ monthlyStats, arr }: RevenueKPIRowProps) {
  const { thisMonth, prevMonth, ytd } = computeMonthlyKPIs(
    monthlyStats.monthly_trend,
  );

  const mrr = arr > 0 ? Math.round(arr / 12) : 0;

  // Delta vs previous month
  const delta = thisMonth - prevMonth;
  const deltaPercent =
    prevMonth > 0 ? Math.round((delta / prevMonth) * 100) : null;

  let thisMonthSubtitle: React.ReactNode = null;
  if (prevMonth > 0 && deltaPercent !== null) {
    if (delta > 0) {
      thisMonthSubtitle = (
        <span style={{ color: '#1F8A5B' }}>
          +{deltaPercent}% vs bulan lalu <ArrowUp />
        </span>
      );
    } else if (delta < 0) {
      thisMonthSubtitle = (
        <span style={{ color: '#DC2626' }}>
          {deltaPercent}% vs bulan lalu <ArrowDown />
        </span>
      );
    } else {
      thisMonthSubtitle = (
        <span style={{ color: '#9DB2CE' }}>Sama dengan bulan lalu</span>
      );
    }
  } else if (prevMonth === 0 && thisMonth > 0) {
    thisMonthSubtitle = (
      <span style={{ color: '#1F8A5B' }}>Bulan pertama ada pembayaran</span>
    );
  }

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      data-testid="revenue-kpi-row"
    >
      <RevenueKPICard
        title="Bulan ini"
        value={formatIDR(thisMonth)}
        subtitle={thisMonthSubtitle}
      />
      <RevenueKPICard
        title="YTD"
        value={formatIDR(ytd)}
        subtitle="Tahun berjalan"
      />
      <RevenueKPICard
        title="MRR estimasi"
        value={formatIDR(mrr)}
        subtitle="ARR ÷ 12"
      />
      <RevenueKPICard
        title="ARR estimasi"
        value={formatIDR(arr)}
        subtitle="Berdasarkan paket aktif"
      />
    </div>
  );
}

// Re-export for tests
export { computeMonthlyKPIs };
