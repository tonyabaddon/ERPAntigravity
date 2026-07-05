import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevenueMonthlyTrend } from './RevenueMonthlyTrend';
import type { RevenueStats } from '../../lib/paymentsTypes';

function makeTrend(values: number[]) {
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
  total: 10_000_000,
  breakdown: [],
  monthly_trend: makeTrend([
    500_000, 600_000, 700_000, 800_000, 900_000, 1_000_000,
    1_100_000, 1_050_000, 900_000, 800_000, 750_000, 900_000,
  ]),
};

describe('RevenueMonthlyTrend', () => {
  it('renders section title', () => {
    render(<RevenueMonthlyTrend monthlyStats={richStats} />);
    expect(screen.getByText('Tren 12 bulan')).toBeInTheDocument();
  });

  it('renders SVG chart when data exists', () => {
    render(<RevenueMonthlyTrend monthlyStats={richStats} />);
    expect(screen.getByRole('img', { name: /Grafik tren/ })).toBeInTheDocument();
  });

  it('renders empty state when all zeros', () => {
    render(<RevenueMonthlyTrend monthlyStats={emptyStats} />);
    expect(screen.getByTestId('trend-empty')).toBeInTheDocument();
    expect(screen.getByText(/Belum ada data/)).toBeInTheDocument();
  });

  it('renders accessible fallback table', () => {
    render(<RevenueMonthlyTrend monthlyStats={richStats} />);
    // sr-only table present
    const tables = document.querySelectorAll('table');
    expect(tables.length).toBeGreaterThan(0);
  });

  it('renders 12 month labels in the accessible table', () => {
    render(<RevenueMonthlyTrend monthlyStats={richStats} />);
    // Month labels in the fallback table: Jan through Des
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    for (const label of monthLabels) {
      // the sr-only table has the labels; getAllByText in hidden elements
      const els = document.querySelectorAll('td');
      const hasLabel = Array.from(els).some((el) => el.textContent === label);
      expect(hasLabel).toBe(true);
    }
  });
});
