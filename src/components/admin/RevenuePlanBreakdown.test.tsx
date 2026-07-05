import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevenuePlanBreakdown } from './RevenuePlanBreakdown';
import type { RevenueStats } from '../../lib/paymentsTypes';

function makeTrend() {
  return Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    total: 0,
  }));
}

const emptyStats: RevenueStats = {
  total: 0,
  breakdown: [],
  monthly_trend: makeTrend(),
};

const richStats: RevenueStats = {
  total: 15_000_000,
  breakdown: [
    { key: 'STARTER', amount: 3_000_000, count: 5 },
    { key: 'PRO',     amount: 5_000_000, count: 4 },
    { key: 'PREMIUM', amount: 7_000_000, count: 2 },
  ],
  monthly_trend: makeTrend(),
};

describe('RevenuePlanBreakdown', () => {
  it('renders section title', () => {
    render(<RevenuePlanBreakdown planStats={richStats} />);
    expect(screen.getByText('Rincian per paket')).toBeInTheDocument();
  });

  it('renders all three plan labels', () => {
    render(<RevenuePlanBreakdown planStats={richStats} />);
    // Labels are in list items and sr-only table — use getAllByText
    expect(screen.getAllByText('Premium').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);
  });

  it('renders formatted revenue amounts', () => {
    render(<RevenuePlanBreakdown planStats={richStats} />);
    // Amounts appear in the visible bars and sr-only table
    expect(screen.getAllByText('Rp 7.000.000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rp 5.000.000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rp 3.000.000').length).toBeGreaterThan(0);
  });

  it('renders tenant counts', () => {
    render(<RevenuePlanBreakdown planStats={richStats} />);
    // Counts are split "2" + " tenant" inside spans; use regex
    expect(screen.getByText(/2 tenant/)).toBeInTheDocument();
    expect(screen.getByText(/4 tenant/)).toBeInTheDocument();
    expect(screen.getByText(/5 tenant/)).toBeInTheDocument();
  });

  it('renders empty state when no breakdown data', () => {
    render(<RevenuePlanBreakdown planStats={emptyStats} />);
    expect(screen.getByTestId('plan-breakdown-empty')).toBeInTheDocument();
    expect(screen.getByText(/Belum ada data/)).toBeInTheDocument();
  });

  it('renders accessible fallback table', () => {
    render(<RevenuePlanBreakdown planStats={richStats} />);
    expect(screen.getByRole('table', { hidden: true })).toBeInTheDocument();
  });
});
