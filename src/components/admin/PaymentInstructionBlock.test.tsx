// src/components/admin/PaymentInstructionBlock.test.tsx
// Wave 6 Task 10
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PaymentInstructionBlock } from './PaymentInstructionBlock';
import type { PlatformSettings } from '../../lib/platformSettingsApi';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGet = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/platformSettingsApi', () => ({
  platformSettingsApi: {
    get: () => mockGet(),
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccessMock(msg),
    error: (title: string, msg: string) => toastErrorMock(title, msg),
  },
}));

// Mock supabase .from().select().eq().single() for plans
// Use vi.hoisted so these mocks are available when vi.mock factory runs
const { singleMock, fromMock } = vi.hoisted(() => {
  const singleMock = vi.fn();
  const eqMock = vi.fn(() => ({ single: singleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { singleMock, fromMock };
});

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: fromMock,
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockSettings: PlatformSettings = {
  id: 1,
  bank_name: 'BCA',
  bank_account_no: '1234567890',
  bank_account_name: 'PT VOSI',
  admin_wa_number: '628123456789',
  updated_at: '2026-07-10T00:00:00Z',
  updated_by: null,
};

const mockPlan = { code: 'STARTER', price_annual: 1200000 };

const mockTenant = { slug: 'warung-test', name: 'Warung Test', plan_code: 'STARTER' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentInstructionBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    // Never resolve — stays loading
    mockGet.mockReturnValue(new Promise(() => {}));
    singleMock.mockReturnValue(new Promise(() => {}));

    render(<PaymentInstructionBlock tenant={mockTenant} />);

    expect(screen.getByTestId('payment-instruction-loading')).toBeInTheDocument();
    expect(screen.getByText('Memuat instruksi pembayaran…')).toBeInTheDocument();
  });

  it('renders payment message after settings and plan load', async () => {
    mockGet.mockResolvedValue(mockSettings);
    singleMock.mockResolvedValue({ data: mockPlan, error: null });

    render(<PaymentInstructionBlock tenant={mockTenant} />);

    await waitFor(() => {
      expect(screen.getByTestId('payment-instruction-block')).toBeInTheDocument();
    });

    const msg = screen.getByTestId('payment-instruction-message').textContent ?? '';
    expect(msg).toContain('Warung Test');
    expect(msg).toContain('STARTER');
    expect(msg).toContain('BCA 1234567890');
    expect(msg).toContain('warung-test');
    expect(msg).toContain('628123456789');
    expect(msg).toContain('1.200.000'); // formatIDR

    expect(screen.getByTestId('payment-instruction-copy')).toBeInTheDocument();
    expect(screen.getByTestId('payment-instruction-wa')).toBeInTheDocument();
  });

  it('calls navigator.clipboard.writeText when Copy button clicked', async () => {
    mockGet.mockResolvedValue(mockSettings);
    singleMock.mockResolvedValue({ data: mockPlan, error: null });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    render(<PaymentInstructionBlock tenant={mockTenant} />);

    await waitFor(() => {
      expect(screen.getByTestId('payment-instruction-copy')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('payment-instruction-copy'));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledOnce();
    });

    const clipboardArg: string = writeTextMock.mock.calls[0][0];
    expect(clipboardArg).toContain('warung-test');
    expect(clipboardArg).toContain('Warung Test');
  });

  it('shows error state when platform settings fail to load', async () => {
    mockGet.mockRejectedValue(new Error('Koneksi gagal'));
    singleMock.mockResolvedValue({ data: mockPlan, error: null });

    render(<PaymentInstructionBlock tenant={mockTenant} />);

    await waitFor(() => {
      expect(screen.getByTestId('payment-instruction-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Koneksi gagal')).toBeInTheDocument();
  });
});
