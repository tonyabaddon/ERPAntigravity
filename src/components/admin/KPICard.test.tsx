// src/components/admin/KPICard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPICard } from './KPICard';

describe('KPICard', () => {
  it('renders title and value', () => {
    render(<KPICard title="Tenant aktif" value={5} />);
    expect(screen.getByText('Tenant aktif')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders alert style when alert=true', () => {
    const { container } = render(<KPICard title="Kedaluwarsa" value={2} alert />);
    expect(container.firstChild).toHaveClass('bg-amber-50');
  });

  it('renders placeholder when value is null', () => {
    render(<KPICard title="MRR" value={null} placeholder="Billing Phase C" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Billing Phase C')).toBeInTheDocument();
  });

  it('renders subtitle when provided', () => {
    render(<KPICard title="Tenant aktif" value={3} subtitle="dari 5 total" />);
    expect(screen.getByText('dari 5 total')).toBeInTheDocument();
  });

  it('renders non-alert card with white background', () => {
    const { container } = render(<KPICard title="Tenant aktif" value={3} />);
    expect(container.firstChild).toHaveClass('bg-white');
  });
});
