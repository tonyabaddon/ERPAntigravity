// src/components/admin/EmptyHomeState.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyHomeState } from './EmptyHomeState';

describe('EmptyHomeState', () => {
  it('renders the onboard CTA heading', () => {
    render(<EmptyHomeState existingSlug="garindo" />);
    expect(screen.getByText(/Ayo onboard tenant kedua/)).toBeInTheDocument();
  });

  it('displays the existing slug name', () => {
    render(<EmptyHomeState existingSlug="garindo" />);
    expect(screen.getByText(/garindo/)).toBeInTheDocument();
  });

  it('links to /admin/tenants/new for new onboarding', () => {
    render(<EmptyHomeState existingSlug="garindo" />);
    const link = screen.getByRole('link', { name: /Onboard tenant baru/ });
    expect(link).toHaveAttribute('href', '/admin/tenants/new');
  });

  it('links to /admin/tenants for tenant list', () => {
    render(<EmptyHomeState existingSlug="garindo" />);
    const link = screen.getByRole('link', { name: /Lihat daftar tenant/ });
    expect(link).toHaveAttribute('href', '/admin/tenants');
  });

  it('shows empty home state test id', () => {
    render(<EmptyHomeState existingSlug="garindo" />);
    expect(screen.getByTestId('empty-home-state')).toBeInTheDocument();
  });
});
