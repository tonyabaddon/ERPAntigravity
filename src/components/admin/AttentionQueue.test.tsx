// src/components/admin/AttentionQueue.test.tsx
// Wave 4a: AttentionQueue now fetches via listAttentionTenants(45).
// Wave 5 Task 10b: also merges OVERDUE tenants from v_tenant_payment_coverage.
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

// Mock supabaseClient: .from('v_tenant_payment_coverage') returns empty by default.
// Individual tests can override supabaseFromMock for OVERDUE scenarios.
const supabaseSelectMock = vi.fn();
const supabaseEqMock = vi.fn();
const supabaseFromMock = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}));

// Default: coverage view returns empty (no OVERDUE)
function setupEmptyCoverage() {
  supabaseEqMock.mockResolvedValue({ data: [], error: null });
  supabaseSelectMock.mockReturnValue({ eq: supabaseEqMock });
  supabaseFromMock.mockReturnValue({ select: supabaseSelectMock });
}

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
  supabaseFromMock.mockReset();
  supabaseSelectMock.mockReset();
  supabaseEqMock.mockReset();
  setupEmptyCoverage();
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
    // AttentionQueue retries fetch 3× with 500ms/1000ms backoff before surfacing
    // the error. Bump waitFor timeout past cumulative 1500ms of backoff.
    listAttentionTenants.mockRejectedValue(new InternalError());
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-error')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('Kesalahan internal.')).toBeInTheDocument();
    expect(screen.getByTestId('attention-queue-retry')).toBeInTheDocument();
  });

  it('retry button re-triggers fetch', async () => {
    // 3× reject for initial fetchAll retries, then success on manual Coba lagi.
    listAttentionTenants.mockRejectedValueOnce(new InternalError())
      .mockRejectedValueOnce(new InternalError())
      .mockRejectedValueOnce(new InternalError())
      .mockResolvedValueOnce([expiringRow]);
    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-error')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId('attention-queue-retry'));
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(listAttentionTenants).toHaveBeenCalledTimes(4);
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

  // ─── Task 10b: OVERDUE integration ──────────────────────────────────────────

  it('renders OVERDUE row with "Pembayaran terlambat" chip', async () => {
    listAttentionTenants.mockResolvedValue([]);
    supabaseEqMock.mockResolvedValue({
      data: [{
        tenant_id: 't99',
        tenant_slug: 'toko-overdue',
        tenant_name: 'Toko Overdue',
        plan_code: 'PRO',
        coverage_status: 'OVERDUE',
      }],
      error: null,
    });

    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(screen.getByText('Toko Overdue')).toBeInTheDocument();
    expect(screen.getByTestId('attention-reason-toko-overdue')).toHaveTextContent('Pembayaran terlambat');
  });

  it('OVERDUE row links to ?tab=pembayaran', async () => {
    listAttentionTenants.mockResolvedValue([]);
    supabaseEqMock.mockResolvedValue({
      data: [{
        tenant_id: 't99',
        tenant_slug: 'toko-overdue',
        tenant_name: 'Toko Overdue',
        plan_code: 'PRO',
        coverage_status: 'OVERDUE',
      }],
      error: null,
    });

    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-link-toko-overdue')).toBeInTheDocument());
    expect(screen.getByTestId('attention-link-toko-overdue')).toHaveAttribute(
      'href', '/admin/tenants/toko-overdue?tab=pembayaran'
    );
  });

  it('SUSPENDED + OVERDUE same tenant: SUSPENDED wins (higher priority)', async () => {
    // suspendedRow already in attention list
    listAttentionTenants.mockResolvedValue([suspendedRow]);
    supabaseEqMock.mockResolvedValue({
      data: [{
        tenant_id: 't2',          // same id as suspendedRow
        tenant_slug: 'toko-maju',
        tenant_name: 'Toko Maju',
        plan_code: 'STARTER',
        coverage_status: 'OVERDUE',
      }],
      error: null,
    });

    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    // Should be deduplicated to 1 row
    expect(screen.getAllByText('Toko Maju')).toHaveLength(1);
    // Reason chip should be SUSPENDED (higher priority)
    expect(screen.getByTestId('attention-reason-toko-maju')).toHaveTextContent('Ditangguhkan');
  });

  it('counts OVERDUE rows in total header', async () => {
    listAttentionTenants.mockResolvedValue([expiringRow]);
    supabaseEqMock.mockResolvedValue({
      data: [{
        tenant_id: 't99',
        tenant_slug: 'toko-overdue',
        tenant_name: 'Toko Overdue',
        plan_code: 'PRO',
        coverage_status: 'OVERDUE',
      }],
      error: null,
    });

    render(<AttentionQueue />);
    await waitFor(() => expect(screen.getByText(/Butuh perhatian \(2\)/)).toBeInTheDocument());
  });

  it('silently continues when coverage view errors', async () => {
    listAttentionTenants.mockResolvedValue([expiringRow]);
    supabaseEqMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    render(<AttentionQueue />);
    // Should still show the expiring row; coverage error is silent
    await waitFor(() => expect(screen.getByTestId('attention-queue-live')).toBeInTheDocument());
    expect(screen.getByText('Apotek Sehat')).toBeInTheDocument();
  });
});
