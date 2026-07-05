import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevenueKPIRow, computeMonthlyKPIs } from './RevenueKPIRow';
import type { RevenueStats } from '../../lib/paymentsTypes';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTrend(values: number[]): { month: string; total: number }[] {
  return values.map((total, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    total,
  }));
}

const emptyStats: RevenueStats = {
  total: 0,
  breakdown: [],
  monthly_trend: makeTrend(Array(12).fill(0)),
};

const richStats: RevenueStats = {
  total: 12_000_000,
  breakdown: [],
  monthly_trend: makeTrend([
    1_000_000, 800_000, 900_000, 1_000_000, 1_100_000, 1_200_000,
    1_100_000, 1_050_000, 980_000, 1_100_000, 1_200_000, 1_570_000,
  ]),
};

// ─── computeMonthlyKPIs ───────────────────────────────────────────────────────

describe('computeMonthlyKPIs', () => {
  it('returns zeros for empty trend', () => {
    const result = computeMonthlyKPIs([]);
    expect(result).toEqual({ thisMonth: 0, prevMonth: 0, ytd: 0 });
  });

  it('computes correctly from 12-row trend', () => {
    const trend = makeTrend([100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 400, 500]);
    const result = computeMonthlyKPIs(trend);
    expect(result.thisMonth).toBe(500);
    expect(result.prevMonth).toBe(400);
    expect(result.ytd).toBe(1500);
  });

  it('handles single-row trend', () => {
    const trend = makeTrend([1_000_000]);
    const result = computeMonthlyKPIs(trend);
    expect(result.thisMonth).toBe(1_000_000);
    expect(result.prevMonth).toBe(0);
    expect(result.ytd).toBe(1_000_000);
  });
});

// ─── RevenueKPIRow render ─────────────────────────────────────────────────────

describe('RevenueKPIRow', () => {
  it('renders 4 KPI cards', () => {
    render(<RevenueKPIRow monthlyStats={emptyStats} arr={0} />);
    expect(screen.getByText('Bulan ini')).toBeInTheDocument();
    expect(screen.getByText('YTD')).toBeInTheDocument();
    expect(screen.getByText('MRR estimasi')).toBeInTheDocument();
    expect(screen.getByText('ARR estimasi')).toBeInTheDocument();
  });

  it('renders zeros for empty stats', () => {
    render(<RevenueKPIRow monthlyStats={emptyStats} arr={0} />);
    // Each KPI should show Rp 0 — 4 of them
    const rpZeros = screen.getAllByText('Rp 0');
    expect(rpZeros.length).toBe(4);
  });

  it('shows up arrow when this month > prev month', () => {
    render(<RevenueKPIRow monthlyStats={richStats} arr={12_000_000} />);
    // 1.570.000 > 1.200.000 → +30% vs bulan lalu with up arrow
    expect(screen.getByText(/vs bulan lalu/)).toBeInTheDocument();
    // Up arrow svg rendered
    expect(screen.getByTestId('revenue-kpi-row')).toBeInTheDocument();
  });

  it('computes MRR = ARR / 12', () => {
    render(<RevenueKPIRow monthlyStats={emptyStats} arr={12_000_000} />);
    // MRR = 12_000_000 / 12 = 1_000_000 → Rp 1.000.000
    expect(screen.getByText('Rp 1.000.000')).toBeInTheDocument();
    // ARR should be Rp 12.000.000
    expect(screen.getByText('Rp 12.000.000')).toBeInTheDocument();
  });

  it('renders YTD as sum of all monthly totals', () => {
    render(<RevenueKPIRow monthlyStats={richStats} arr={0} />);
    // Sum of richStats trend values: 1M+800k+900k+1M+1.1M+1.2M+1.1M+1.05M+980k+1.1M+1.2M+1.57M = 13M
    const expected = richStats.monthly_trend.reduce((s, r) => s + r.total, 0);
    expect(screen.getByText(`Rp ${expected.toLocaleString('id-ID')}`)).toBeInTheDocument();
  });
});
