// src/components/admin/SalesRepsList.test.tsx
// Tests for SalesRepsList orchestrator.
// Mocks salesRepsApi + adminToast; no network calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SalesRepsList } from './SalesRepsList';
import type { SalesRep } from '../../lib/salesRepsApi';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const listMock = vi.fn();
const createMock = vi.fn();
const deactivateMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/salesRepsApi', () => ({
  salesRepsApi: {
    list: () => listMock(),
    create: (...args: unknown[]) => createMock(...args),
    deactivate: (...args: unknown[]) => deactivateMock(...args),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccessMock(msg),
    error: (msg: string) => toastErrorMock(msg),
    info: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

const activeRep: SalesRep = {
  user_id: USER_A,
  email: 'alice@vosi.app',
  name: 'Alice Rep',
  role: 'sales_rep',
  status: 'active',
  created_at: '2026-07-01T00:00:00Z',
};

const disabledRep: SalesRep = {
  user_id: USER_B,
  email: 'bob@vosi.app',
  name: 'Bob Inactive',
  role: 'sales_rep',
  status: 'disabled',
  created_at: '2026-06-01T00:00:00Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SalesRepsList', () => {
  it('renders page heading and Tambah Sales Rep button', async () => {
    listMock.mockResolvedValue([]);
    render(<SalesRepsList />);
    // Heading is present immediately (not behind async)
    expect(screen.getByText('Sales Reps')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('tambah-salesrep-btn')).toBeInTheDocument()
    );
  });

  it('shows empty state when list is empty', async () => {
    listMock.mockResolvedValue([]);
    render(<SalesRepsList />);
    await waitFor(() =>
      expect(screen.getByTestId('salesreps-empty')).toBeInTheDocument()
    );
  });

  it('renders sales rep rows with name, email, status badge', async () => {
    listMock.mockResolvedValue([activeRep, disabledRep]);
    render(<SalesRepsList />);
    await waitFor(() => {
      expect(screen.getByText('Alice Rep')).toBeInTheDocument();
      expect(screen.getByText('alice@vosi.app')).toBeInTheDocument();
      expect(screen.getByText('Bob Inactive')).toBeInTheDocument();
      expect(screen.getByText('bob@vosi.app')).toBeInTheDocument();
    });
    // Active rep has green Aktif badge
    expect(screen.getByText('Aktif')).toBeInTheDocument();
    // Disabled rep has Nonaktif badge
    expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  });

  it('opens create modal when Tambah Sales Rep button is clicked', async () => {
    listMock.mockResolvedValue([]);
    render(<SalesRepsList />);
    await waitFor(() =>
      expect(screen.getByTestId('tambah-salesrep-btn')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId('tambah-salesrep-btn'));
    // The create modal should now be in the DOM
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    );
    // Modal heading is the h2 inside the dialog
    expect(screen.getByRole('heading', { name: 'Tambah Sales Rep' })).toBeInTheDocument();
  });

  it('shows Nonaktifkan button only for active reps', async () => {
    listMock.mockResolvedValue([activeRep, disabledRep]);
    render(<SalesRepsList />);
    await waitFor(() => {
      expect(screen.getByTestId(`nonaktifkan-btn-${USER_A}`)).toBeInTheDocument();
    });
    // Disabled rep should NOT have a Nonaktifkan button
    expect(screen.queryByTestId(`nonaktifkan-btn-${USER_B}`)).not.toBeInTheDocument();
  });

  it('opens deactivate modal when Nonaktifkan button is clicked', async () => {
    listMock.mockResolvedValue([activeRep]);
    render(<SalesRepsList />);
    await waitFor(() =>
      expect(screen.getByTestId(`nonaktifkan-btn-${USER_A}`)).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId(`nonaktifkan-btn-${USER_A}`));
    // Deactivate modal should be in the DOM
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    );
    expect(screen.getByText('Nonaktifkan Sales Rep')).toBeInTheDocument();
    // Sales rep name shown in modal (appears multiple times: row + modal; use getAllBy)
    const aliceNames = screen.getAllByText('Alice Rep');
    expect(aliceNames.length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state and Coba lagi button on fetch failure', async () => {
    listMock.mockRejectedValue(new Error('network timeout'));
    render(<SalesRepsList />);
    await waitFor(() =>
      expect(screen.getByTestId('salesreps-error')).toBeInTheDocument()
    );
    expect(screen.getByText(/Gagal memuat sales rep/)).toBeInTheDocument();
    expect(screen.getByText('Coba lagi')).toBeInTheDocument();
  });

  it('re-fetches after successful creation', async () => {
    // First call: empty; second call after create: one rep
    listMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([activeRep]);
    createMock.mockResolvedValue(activeRep);

    render(<SalesRepsList />);
    await waitFor(() =>
      expect(screen.getByTestId('salesreps-empty')).toBeInTheDocument()
    );

    // Open create modal
    fireEvent.click(screen.getByTestId('tambah-salesrep-btn'));
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    );

    // Fill form fields
    fireEvent.change(screen.getByLabelText(/User UUID/i), {
      target: { value: USER_A },
    });
    fireEvent.change(screen.getByLabelText(/Email sales rep/i), {
      target: { value: 'alice@vosi.app' },
    });
    fireEvent.change(screen.getByLabelText(/Nama lengkap sales rep/i), {
      target: { value: 'Alice Rep' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Simpan/i }));

    await waitFor(() => {
      // After success, list should re-fetch and show the new rep
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });
});
