// src/components/admin/AttentionQueue.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttentionQueue } from './AttentionQueue';
import type { AdminTenantRow } from '../../lib/adminTypes';

const baseTenant: AdminTenantRow = {
  tenant_id: 't1',
  slug: 'apotek-sehat',
  name: 'Apotek Sehat',
  plan_code: 'PRO',
  status: 'ACTIVE',
  expiry_mode: 'ACTIVE',
  activated_at: '2026-07-01',
  expires_at: '2026-08-15',
  days_until_expiry: 41,
  user_count: 2,
  sku_count: 100,
  industry: 'Apotek/Farmasi',
  employee_range: '4-19 orang (Kecil)',
  onboarded_at: '2026-07-01',
  last_login_at: null,
  txn_7d: 10,
  avg_daily_txn: 1.4,
  usage_status: 'AKTIF',
  total_count: 1,
};

const suspendedTenant: AdminTenantRow = {
  ...baseTenant,
  tenant_id: 't2',
  slug: 'toko-maju',
  name: 'Toko Maju',
  status: 'SUSPENDED',
  days_until_expiry: null,
  expires_at: null,
};

describe('AttentionQueue', () => {
  it('shows "Semua tenteram" when both lists empty', () => {
    render(<AttentionQueue expiringTenants={[]} suspendedTenants={[]} />);
    expect(screen.getByTestId('attention-queue-empty')).toBeInTheDocument();
    expect(screen.getByText(/Semua tenteram/)).toBeInTheDocument();
  });

  it('renders expiring tenant with days and link', () => {
    render(<AttentionQueue expiringTenants={[baseTenant]} suspendedTenants={[]} />);
    expect(screen.getByText('Apotek Sehat')).toBeInTheDocument();
    expect(screen.getByText(/41 hari/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Detail/ });
    expect(link).toHaveAttribute('href', '/admin/tenants/apotek-sehat');
  });

  it('renders suspended tenant with badge', () => {
    render(<AttentionQueue expiringTenants={[]} suspendedTenants={[suspendedTenant]} />);
    expect(screen.getByText('Toko Maju')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('shows count in header when multiple items', () => {
    render(<AttentionQueue expiringTenants={[baseTenant]} suspendedTenants={[suspendedTenant]} />);
    expect(screen.getByText(/Butuh perhatian \(2\)/)).toBeInTheDocument();
  });
});
