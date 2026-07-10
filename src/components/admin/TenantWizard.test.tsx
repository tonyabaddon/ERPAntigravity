// src/components/admin/TenantWizard.test.tsx
// Wave 6 Task 10 — TenantWizard: Edge Function submit + PaymentInstructionBlock
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TenantWizard } from './TenantWizard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string) => toastSuccessMock(msg),
    error: (title: string, msg?: string) => toastErrorMock(title, msg),
    info: vi.fn(),
  },
}));

// Mock supabase.auth.getSession
const getSessionMock = vi.fn();
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { code: 'STARTER', price_annual: 1200000 }, error: null }),
        })),
      })),
    })),
  },
}));

// Mock PaymentInstructionBlock to avoid deep fetch chain in wizard tests
vi.mock('./PaymentInstructionBlock', () => ({
  PaymentInstructionBlock: ({ tenant }: { tenant: { slug: string; name: string; plan_code: string } }) => (
    <div data-testid="payment-instruction-block-mock">
      instruksi-{tenant.slug}
    </div>
  ),
}));

// Mock platform settings for PaymentInstructionBlock (unused due to mock above, but safe)
vi.mock('../../lib/platformSettingsApi', () => ({
  platformSettingsApi: {
    get: vi.fn().mockResolvedValue({
      id: 1,
      bank_name: 'BCA',
      bank_account_no: '1234567890',
      bank_account_name: 'PT VOSI',
      admin_wa_number: '628123456789',
      updated_at: '2026-07-10T00:00:00Z',
      updated_by: null,
    }),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_SESSION = { access_token: 'mock-token-xyz' };

/** Fill tenant step with valid data and advance to owner step */
function fillTenantStep() {
  fireEvent.change(screen.getByPlaceholderText('warung-sinar-rezeki'), {
    target: { value: 'toko-baru' },
  });
  fireEvent.change(screen.getByPlaceholderText('Warung Sinar Rezeki'), {
    target: { value: 'Toko Baru' },
  });
  fireEvent.click(screen.getByText('Lanjut →'));
}

/** Fill owner step with valid data and advance to review step */
function fillOwnerStep() {
  fireEvent.change(screen.getByPlaceholderText('Budi Santoso'), {
    target: { value: 'Andi Wijaya' },
  });
  fireEvent.change(screen.getByPlaceholderText('budi@warungsinar.com'), {
    target: { value: 'andi@tokobaru.com' },
  });
  fireEvent.click(screen.getByText('Lanjut →'));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid session
    getSessionMock.mockResolvedValue({ data: { session: VALID_SESSION } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders wizard with step 1 visible', () => {
    render(<TenantWizard />);
    expect(screen.getByTestId('tenant-wizard')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('warung-sinar-rezeki')).toBeInTheDocument();
  });

  it('owner step no longer has UUID input field', async () => {
    render(<TenantWizard />);
    fillTenantStep();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Budi Santoso')).toBeInTheDocument();
    });

    // UUID field should not be present
    expect(screen.queryByPlaceholderText('33333333-aaaa-bbbb-cccc-000000000001')).not.toBeInTheDocument();
    // Owner name + email should be present
    expect(screen.getByPlaceholderText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('budi@warungsinar.com')).toBeInTheDocument();
  });

  it('happy path: submit calls Edge Function and shows ResultStep + PaymentInstructionBlock', async () => {
    const edgeResponse = {
      tenant_id: 'tid-abc',
      slug: 'toko-baru',
      owner_user_id: 'uid-xyz',
      expires_at: '2027-07-10T00:00:00Z',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => edgeResponse,
    }));

    render(<TenantWizard />);
    fillTenantStep();

    await waitFor(() => screen.getByPlaceholderText('Budi Santoso'));
    fillOwnerStep();

    await waitFor(() => screen.getByRole('button', { name: 'Onboard tenant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onboard tenant' }));

    await waitFor(() => {
      expect(screen.getByText('Tenant berhasil di-onboard')).toBeInTheDocument();
    });

    // PaymentInstructionBlock should be rendered (mocked)
    expect(screen.getByTestId('payment-instruction-block-mock')).toBeInTheDocument();
    expect(screen.getByText('instruksi-toko-baru')).toBeInTheDocument();

    // Toast success
    expect(toastSuccessMock).toHaveBeenCalledWith('Tenant Toko Baru berhasil di-onboard.');

    vi.unstubAllGlobals();
  });

  it('E5 error: shows Bahasa error for duplicate slug', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: 'E5', message: 'Slug already taken' }),
    }));

    render(<TenantWizard />);
    fillTenantStep();
    await waitFor(() => screen.getByPlaceholderText('Budi Santoso'));
    fillOwnerStep();
    await waitFor(() => screen.getByRole('button', { name: 'Onboard tenant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onboard tenant' }));

    await waitFor(() => {
      expect(screen.getByText('Slug sudah dipakai — pilih yang lain')).toBeInTheDocument();
    });

    expect(toastErrorMock).toHaveBeenCalledWith('Gagal onboarding', 'Slug sudah dipakai — pilih yang lain');

    vi.unstubAllGlobals();
  });

  it('no session: shows E1 error without calling fetch', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    render(<TenantWizard />);
    fillTenantStep();
    await waitFor(() => screen.getByPlaceholderText('Budi Santoso'));
    fillOwnerStep();
    await waitFor(() => screen.getByRole('button', { name: 'Onboard tenant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onboard tenant' }));

    await waitFor(() => {
      expect(screen.getByText('Sesi expired — silakan login ulang')).toBeInTheDocument();
    });
  });
});
