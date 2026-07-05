// src/components/admin/AttentionQueue.test.tsx
// Wave 4a: AttentionQueue now fetches via listAttentionTenants(45).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AttentionQueue } from './AttentionQueue';
import type { AttentionTenantRow } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';

const listAttentionTenants = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  listAttentionTenants: (...args: unknown[]) => listAttentionTenants(...args),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const expiringRow: AttentionTenantRow = {
  tenant_id: 't1',
  slug: 'apotek-sehat',
  name: 'Apotek Sehat',
  plan_code: 'PRO',
  status: 'ACTIVE',
  expires_at: '2026-08-15',
  days_until_expiry: 41,
  attention_reason: 'EXPIRING',
};

const suspendedRow: AttentionTenantRow = {
  tenant_id: 't2',
  slug: 'toko-maju',
  name: 'Toko Maju',
  plan_code: 'STARTER',
  status: 'SUSPENDED',
  expires_at: '2027-06-01',
  days_until_expiry: 360,
  attention_reason: 'SUSPENDED',
};

const expiredSuspendedRow: AttentionTenantRow = {
  tenant_id: 't3',
  slug: 'warung-lama',
  name: 'Warung Lama',
  plan_code: 'PREMIUM',
  status: 'SUSPENDED',
  expires_at: '2025-01-01',
  days_until_expiry: -180,
  attention_reason: 'EXPIRED_AND_SUSPENDED',
};

class InternalError extends AdminApiError {
  readonly userMessage = 'Kesalahan internal.';
}

beforeEach(() => {
  listAttentionTenants.mockReset();
});

describe('AttentionQueue', () => {
  it('renders skeleton while loading', async () => {
    let resolvePromise: (v: AttentionTenantRow[]) => void;
    listAttentionTenants.mockReturnValue(new Promise<AttentionTenantRow[]>((r) => { resolvePromise = r; }));
    render(<AttentionQueue />);
    expect(screen.getByTestId('attention-queue-loading')).toBeInTheDocument();
    resolvePromise!([]);
    await waitFor(() => expect(screen.queryByTestId('attention-queue-loading')).not.toBeInTheDocument());
  });

  it('shows Semua tenteram when server returns 0 rows', async () => {
    listAttentionTenants.mockResolvedValue([]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-empty')).toBeInTheDocument());
    expect(screen.getByText(/Semua tenteram/)).toBeInTheDocument();
  });

  it('renders EXPIRING row with correct chip + days', async () => {
    listAttentionTenants.mockResolvedValue([expiringRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(screen.getByText('Apotek Sehat')).toBeInTheDocument();
    expect(screen.getByTestId('attention-reason-apotek-sehat')).toHaveTextContent('Kedaluwarsa');
    expect(screen.getByTestId('attention-plan-apotek-sehat')).toHaveTextContent('PRO');
    expect(screen.getByText(/41 hari/)).toBeInTheDocument();
    expect(screen.getByTestId('attention-link-apotek-sehat')).toHaveAttribute(
      'href', '/admin/tenants/apotek-sehat?tab=ringkasan'
    );
  });

  it('renders SUSPENDED row with danger chip', async () => {
    listAttentionTenants.mockResolvedValue([suspendedRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(screen.getByTestId('attention-reason-toko-maju')).toHaveTextContent('Ditangguhkan');
  });

  it('renders EXPIRED_AND_SUSPENDED with negative-day label', async () => {
    listAttentionTenants.mockResolvedValue([expiredSuspendedRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(screen.getByTestId('attention-reason-warung-lama')).toHaveTextContent('Kedaluwarsa & ditangguhkan');
    expect(screen.getByText(/180 hari lalu/)).toBeInTheDocument();
  });

  it('shows total in header when multiple rows', async () => {
    listAttentionTenants.mockResolvedValue([expiringRow, suspendedRow, expiredSuspendedRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByText(/Butuh perhatian \(3\)/)).toBeInTheDocument());
  });

  it('shows error state with Bahasa message and retry button', async () => {
    listAttentionTenants.mockRejectedValue(new InternalError());
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-error')).toBeInTheDocument());
    expect(screen.getByText('Kesalahan internal.')).toBeInTheDocument();
    expect(screen.getByTestId('attention-queue-retry')).toBeInTheDocument();
  });

  it('retry button re-triggers fetch', async () => {
    listAttentionTenants.mockRejectedValueOnce(new InternalError())
      .mockResolvedValueOnce([expiringRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-error')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('attention-queue-retry'));
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(listAttentionTenants).toHaveBeenCalledTimes(2);
  });

  it('passes withinDays prop through to the RPC', async () => {
    listAttentionTenants.mockResolvedValue([]);
    render(<AttentionQueue withinDays={90} />);
    await waitFor(() => expect(listAttentionTenants).toHaveBeenCalledWith(90));
  });

  it('defaults withinDays to 45', async () => {
    listAttentionTenants.mockResolvedValue([]);
    render(<AttentionQueue />);
    await waitFor(() => expect(listAttentionTenants).toHaveBeenCalledWith(45));
  });
});
