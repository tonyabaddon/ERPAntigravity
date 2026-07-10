// src/components/admin/PlatformSettings.test.tsx
// Tests for PlatformSettings form component.
// Mocks platformSettingsApi + adminToast; no network calls.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PlatformSettings } from './PlatformSettings';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const getMock = vi.fn();
const updateMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/platformSettingsApi', () => ({
  platformSettingsApi: {
    get: () => getMock(),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccessMock(msg),
    error: (msg: string, desc?: string) => toastErrorMock(msg, desc),
    info: vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleSettings = {
  id: 1,
  bank_name: 'BCA',
  bank_account_no: '1234567890',
  bank_account_name: 'PT VOSI Digital',
  admin_wa_number: '+62812-3456-7890',
  updated_at: '2026-07-10T08:00:00Z',
  updated_by: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PlatformSettings', () => {
  it('renders heading and populates form fields after fetch', async () => {
    getMock.mockResolvedValue(sampleSettings);
    render(<PlatformSettings />);

    // Heading visible immediately
    expect(screen.getByText('Pengaturan Pembayaran')).toBeInTheDocument();

    // After async fetch, inputs are populated
    await waitFor(() =>
      expect((screen.getByLabelText('Nama Bank') as HTMLInputElement).value).toBe('BCA')
    );
    expect((screen.getByLabelText('Nomor Rekening') as HTMLInputElement).value).toBe('1234567890');
    expect((screen.getByLabelText('Atas Nama') as HTMLInputElement).value).toBe('PT VOSI Digital');
    expect((screen.getByLabelText('Nomor WhatsApp Admin') as HTMLInputElement).value).toBe('+62812-3456-7890');
  });

  it('calls update and shows success toast on Simpan', async () => {
    getMock.mockResolvedValue(sampleSettings);
    updateMock.mockResolvedValue({ ...sampleSettings, bank_name: 'Mandiri' });
    render(<PlatformSettings />);

    // Wait for form to populate
    await waitFor(() =>
      expect((screen.getByLabelText('Nama Bank') as HTMLInputElement).value).toBe('BCA')
    );

    // Edit bank name
    fireEvent.change(screen.getByLabelText('Nama Bank'), {
      target: { value: 'Mandiri' },
    });

    // Submit
    fireEvent.click(screen.getByText('Simpan'));

    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('Pengaturan pembayaran tersimpan.')
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bank_name: 'Mandiri' })
    );
  });

  it('shows error toast when update fails', async () => {
    getMock.mockResolvedValue(sampleSettings);
    updateMock.mockRejectedValue(new Error('SUPER_ADMIN_REQUIRED'));
    render(<PlatformSettings />);

    await waitFor(() =>
      expect((screen.getByLabelText('Nama Bank') as HTMLInputElement).value).toBe('BCA')
    );

    fireEvent.click(screen.getByText('Simpan'));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Gagal menyimpan pengaturan',
        'SUPER_ADMIN_REQUIRED'
      )
    );
  });
});
