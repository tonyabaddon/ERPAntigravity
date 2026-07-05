// src/components/admin/AuditLogViewer.test.tsx
// Covers: renders rows, empty state, filter chips, error handling,
// expand-detail interaction, AuditTab loading/error/empty states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { AuditLogViewer } from './AuditLogViewer';
import { AuditTab } from './TenantDetail/AuditTab';
import type { AuditEventRow } from '../../lib/adminTypes';

// ─── Mock adminApi ────────────────────────────────────────────────────────────

const listMock = vi.fn();

vi.mock('../../lib/adminApi', () => ({
  listAuditEvents: (f: unknown) => listMock(f),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error:   vi.fn(),
    success: vi.fn(),
    info:    vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeEvent: AuditEventRow = {
  id:          1,
  ts:          '2026-07-04T09:15:00Z',
  admin_email: 'tonywei@example.com',
  tenant_slug: 'apotek-sehat',
  action_code: 'CREATE_TENANT',
  detail:      { plan: 'PRO' },
};

const impersonateEvent: AuditEventRow = {
  id:          2,
  ts:          '2026-07-04T10:00:00Z',
  admin_email: 'tonywei@example.com',
  tenant_slug: 'garindo',
  action_code: 'IMPERSONATE_START',
  detail:      null,
};

// ─── AuditLogViewer ───────────────────────────────────────────────────────────

describe('AuditLogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders events after load', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());
    expect(screen.getByText('tonywei@example.com')).toBeInTheDocument();
    expect(screen.getByText('apotek-sehat')).toBeInTheDocument();
  });

  it('calls listAuditEvents with page_size on mount', async () => {
    listMock.mockResolvedValue([]);
    render(<AuditLogViewer />);
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ page_size: 50 })
      )
    );
  });

  it('applies action_code filter on select change', async () => {
    listMock.mockResolvedValue([]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const actionSelect = screen.getByLabelText('Filter aksi');
    fireEvent.change(actionSelect, { target: { value: 'IMPERSONATE_START' } });

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ action_code: 'IMPERSONATE_START' })
      )
    );
  });

  it('shows empty state "Belum ada aktivitas" when list is empty', async () => {
    listMock.mockResolvedValue([]);
    render(<AuditLogViewer />);
    await waitFor(() =>
      expect(screen.getByText(/Belum ada aktivitas/)).toBeInTheDocument()
    );
  });

  it('shows loading skeleton initially', () => {
    // Never resolves — stays in loading state
    listMock.mockReturnValue(new Promise(() => undefined));
    render(<AuditLogViewer />);
    // Skeleton is a set of animated divs — assert no table yet
    expect(screen.queryByTestId('audit-table')).not.toBeInTheDocument();
  });

  it('shows error banner with retry on fetch failure', async () => {
    listMock.mockRejectedValue(new Error('RPC boom'));
    render(<AuditLogViewer />);
    await waitFor(() =>
      expect(screen.getByTestId('audit-viewer-error')).toBeInTheDocument()
    );
    expect(screen.getByText(/Gagal memuat log/)).toBeInTheDocument();
  });

  it('retry button re-fetches events', async () => {
    listMock
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue([fakeEvent]);

    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByTestId('audit-viewer-error')).toBeInTheDocument());

    const retryBtn = screen.getByText('Coba lagi');
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());
  });

  it('expands detail JSON on row click', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());

    // fakeEvent.detail = { plan: 'PRO' } → truncated shows partial JSON
    const detailBtn = screen.getByLabelText('Tampilkan detail JSON');
    fireEvent.click(detailBtn);

    // After expansion, formatted JSON appears
    await waitFor(() =>
      expect(screen.getByText(/"plan"/)).toBeInTheDocument()
    );
  });

  it('collapses detail after Tutup click', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());

    // Expand detail
    const detailBtn = screen.getByLabelText('Tampilkan detail JSON');
    fireEvent.click(detailBtn);

    // Tutup button now visible
    const tutupBtn = await screen.findByText('Tutup');
    expect(tutupBtn).toBeInTheDocument();

    // Collapse
    fireEvent.click(tutupBtn);

    // After collapse, Tutup is gone and the collapsed trigger button is back
    await waitFor(() =>
      expect(screen.queryByText('Tutup')).not.toBeInTheDocument()
    );
    expect(screen.getByLabelText('Tampilkan detail JSON')).toBeInTheDocument();
  });

  it('renders "—" for null detail', async () => {
    listMock.mockResolvedValue([impersonateEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('IMPERSONATE_START')).toBeInTheDocument());
    // null detail renders em-dash
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows column headers in Bahasa Indonesia', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());

    // Headers appear at least once (some labels also appear in filter bar, use getAllByText)
    expect(screen.getAllByText('Waktu').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pelaku').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tenant').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Aksi').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Detail').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── AuditTab ─────────────────────────────────────────────────────────────────

describe('AuditTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches events filtered by tenant_id', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditTab tenantId="tenant-abc" />);

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: 'tenant-abc' })
      )
    );
  });

  it('renders rows after load', async () => {
    listMock.mockResolvedValue([fakeEvent]);
    render(<AuditTab tenantId="tenant-abc" />);

    await waitFor(() => expect(screen.getByText('CREATE_TENANT')).toBeInTheDocument());
    // hideTenant=true so Tenant column should NOT appear
    expect(screen.queryByText('apotek-sehat')).not.toBeInTheDocument();
  });

  it('shows empty state when no events', async () => {
    listMock.mockResolvedValue([]);
    render(<AuditTab tenantId="tenant-xyz" />);

    await waitFor(() =>
      expect(screen.getByText(/Belum ada aktivitas/)).toBeInTheDocument()
    );
  });

  it('shows loading state initially', () => {
    listMock.mockReturnValue(new Promise(() => undefined));
    render(<AuditTab tenantId="tenant-xyz" />);
    expect(screen.getByTestId('audit-tab-loading')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    listMock.mockRejectedValue(new Error('RPC failed'));
    render(<AuditTab tenantId="tenant-xyz" />);

    await waitFor(() =>
      expect(screen.getByTestId('audit-tab-error')).toBeInTheDocument()
    );
  });

  it('calls adminToast.error on fetch failure', async () => {
    const { adminToast } = await import('../../lib/adminToast');
    listMock.mockRejectedValue(new Error('connection error'));
    render(<AuditTab tenantId="tenant-xyz" />);

    await waitFor(() =>
      expect(adminToast.error).toHaveBeenCalledWith(
        expect.stringContaining('Gagal'),
        expect.any(String)
      )
    );
  });
});
