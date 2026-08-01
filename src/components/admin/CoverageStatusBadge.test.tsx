// src/components/admin/CoverageStatusBadge.test.tsx
// Unit tests for the reusable CoverageStatusBadge component.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoverageStatusBadge } from './CoverageStatusBadge';
import type { CoverageStatus } from '../../lib/adminTypes';

describe('CoverageStatusBadge', () => {
  it('renders em-dash for null status', () => {
    render(<CoverageStatusBadge status={null} />);
    expect(screen.getByTestId('coverage-badge-null')).toBeInTheDocument();
    expect(screen.getByTestId('coverage-badge-null')).toHaveTextContent('—');
  });

  it('renders em-dash for undefined status', () => {
    render(<CoverageStatusBadge status={undefined} />);
    expect(screen.getByTestId('coverage-badge-null')).toBeInTheDocument();
  });

  const cases: Array<{ status: CoverageStatus; label: string }> = [
    { status: 'LUNAS',   label: 'Lunas' },
    { status: 'DP_60',   label: 'DP 60%' },
    { status: 'DP_30',   label: 'DP 30%' },
    { status: 'OVERDUE', label: 'Terlambat' },
    { status: 'UNPAID',  label: 'Belum bayar' },
  ];

  for (const { status, label } of cases) {
    it(`renders "${label}" badge for status=${status}`, () => {
      render(<CoverageStatusBadge status={status} />);
      const badge = screen.getByTestId(`coverage-badge-${status}`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(label);
    });
  }

  it('LUNAS badge applies success color classes', () => {
    render(<CoverageStatusBadge status="LUNAS" />);
    const badge = screen.getByTestId('coverage-badge-LUNAS');
    expect(badge.className).toContain('bg-caleo-success');
    expect(badge.className).toContain('text-caleo-success');
  });

  it('OVERDUE badge applies danger color classes', () => {
    render(<CoverageStatusBadge status="OVERDUE" />);
    const badge = screen.getByTestId('coverage-badge-OVERDUE');
    expect(badge.className).toContain('bg-caleo-danger');
    expect(badge.className).toContain('text-caleo-danger');
  });

  it('DP_60 badge applies gold/navy color classes', () => {
    render(<CoverageStatusBadge status="DP_60" />);
    const badge = screen.getByTestId('coverage-badge-DP_60');
    expect(badge.className).toContain('bg-caleo-gold');
    expect(badge.className).toContain('text-caleo-navy');
  });

  it('DP_30 badge applies gold/navy color classes', () => {
    render(<CoverageStatusBadge status="DP_30" />);
    const badge = screen.getByTestId('coverage-badge-DP_30');
    expect(badge.className).toContain('bg-caleo-gold');
    expect(badge.className).toContain('text-caleo-navy');
  });

  it('UNPAID badge applies slate color classes', () => {
    render(<CoverageStatusBadge status="UNPAID" />);
    const badge = screen.getByTestId('coverage-badge-UNPAID');
    expect(badge.className).toContain('bg-caleo-slate');
    expect(badge.className).toContain('text-caleo-slate');
  });

  it('all status badges have font-bold and rounded-full', () => {
    const statuses: CoverageStatus[] = ['LUNAS', 'DP_60', 'DP_30', 'OVERDUE', 'UNPAID'];
    const { unmount } = render(
      <div>
        {statuses.map((s) => <CoverageStatusBadge key={s} status={s} />)}
      </div>
    );
    for (const s of statuses) {
      const badge = screen.getByTestId(`coverage-badge-${s}`);
      expect(badge.className).toContain('font-bold');
      expect(badge.className).toContain('rounded-full');
    }
    unmount();
  });
});
