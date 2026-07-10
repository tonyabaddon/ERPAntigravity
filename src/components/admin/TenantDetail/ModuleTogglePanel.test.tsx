// src/components/admin/TenantDetail/ModuleTogglePanel.test.tsx
// Tests:
//   1. Renders module list from v_tenant_effective_features
//   2. Toggle calls update_tenant_feature_override RPC + success toast
//   3. RPC error rolls back optimistic update + shows error toast
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ModuleTogglePanel } from './ModuleTogglePanel';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const supabaseFromMock  = vi.fn();
const supabaseSelectMock = vi.fn();
const supabaseEqMock    = vi.fn();
const supabaseSingleMock = vi.fn();
const supabaseRpcMock   = vi.fn();

vi.mock('../../../lib/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
    rpc:  (...args: unknown[]) => supabaseRpcMock(...args),
  },
}));

const toastSuccessMock = vi.fn();
const toastErrorMock   = vi.fn();

vi.mock('../../../lib/adminToast', () => ({
  adminToast: {
    success: (msg: string, desc?: string) => toastSuccessMock(msg, desc),
    error:   (msg: string, desc?: string) => toastErrorMock(msg, desc),
    info:    vi.fn(),
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeFeatures: Record<string, boolean> = {
  modul_kasir:    true,
  modul_tempo:    false,
  modul_akuntansi: true,
};

function setupFromChain(result: { data: unknown; error: unknown }) {
  supabaseSingleMock.mockResolvedValue(result);
  supabaseEqMock.mockReturnValue({ single: supabaseSingleMock });
  supabaseSelectMock.mockReturnValue({ eq: supabaseEqMock });
  supabaseFromMock.mockReturnValue({ select: supabaseSelectMock });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ModuleTogglePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders module list from v_tenant_effective_features', async () => {
    setupFromChain({ data: { effective_features: fakeFeatures }, error: null });

    render(<ModuleTogglePanel tenantId="tid-001" />);

    // Loading state appears first
    expect(screen.getByTestId('module-toggle-loading')).toBeInTheDocument();

    // Then modules load
    await waitFor(() =>
      expect(screen.getByTestId('module-toggle-list')).toBeInTheDocument()
    );

    // Module rows visible with Bahasa labels
    expect(screen.getByTestId('module-row-modul_kasir')).toBeInTheDocument();
    expect(screen.getByText('Kasir (POS)')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-modul_tempo')).toBeInTheDocument();
    expect(screen.getByText('Piutang Tempo')).toBeInTheDocument();
    expect(screen.getByTestId('module-row-modul_akuntansi')).toBeInTheDocument();
    expect(screen.getByText('Akuntansi')).toBeInTheDocument();

    // Heading + description
    expect(screen.getByText('Pengaturan Modul')).toBeInTheDocument();
    expect(screen.getByText(/Override paket default/)).toBeInTheDocument();

    // Toggle switches reflect enabled state
    const kasirSwitch = screen.getByRole('switch', { name: /Toggle Kasir/i });
    expect(kasirSwitch).toHaveAttribute('aria-checked', 'true');
    const tempoSwitch = screen.getByRole('switch', { name: /Toggle Piutang Tempo/i });
    expect(tempoSwitch).toHaveAttribute('aria-checked', 'false');

    // Verify supabase.from called with correct view
    expect(supabaseFromMock).toHaveBeenCalledWith('v_tenant_effective_features');
    expect(supabaseEqMock).toHaveBeenCalledWith('tenant_id', 'tid-001');
  });

  it('toggle calls RPC, optimistically updates, shows success toast', async () => {
    setupFromChain({ data: { effective_features: fakeFeatures }, error: null });
    supabaseRpcMock.mockResolvedValue({ error: null });

    render(<ModuleTogglePanel tenantId="tid-001" />);
    await waitFor(() => screen.getByTestId('module-toggle-list'));

    // modul_tempo is currently false → click to enable
    const tempoSwitch = screen.getByRole('switch', { name: /Toggle Piutang Tempo/i });
    fireEvent.click(tempoSwitch);

    // Optimistic update: aria-checked should flip immediately
    expect(tempoSwitch).toHaveAttribute('aria-checked', 'true');

    // Wait for RPC to resolve
    await waitFor(() =>
      expect(supabaseRpcMock).toHaveBeenCalledWith('update_tenant_feature_override', {
        p_tenant_id:  'tid-001',
        p_module_key: 'modul_tempo',
        p_enabled:    true,
        p_reason:     null,
      })
    );

    // Success toast
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith('Modul diaktifkan', undefined)
    );
  });

  it('RPC error rolls back optimistic update and shows error toast', async () => {
    setupFromChain({ data: { effective_features: fakeFeatures }, error: null });
    supabaseRpcMock.mockResolvedValue({ error: { message: 'PLATFORM_ADMIN_REQUIRED' } });

    render(<ModuleTogglePanel tenantId="tid-001" />);
    await waitFor(() => screen.getByTestId('module-toggle-list'));

    // modul_kasir is currently true → click to disable
    const kasirSwitch = screen.getByRole('switch', { name: /Toggle Kasir/i });
    expect(kasirSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(kasirSwitch);

    // Wait for rollback: should revert to true
    await waitFor(() =>
      expect(kasirSwitch).toHaveAttribute('aria-checked', 'true')
    );

    // Error toast
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Gagal update modul',
      'PLATFORM_ADMIN_REQUIRED'
    );
  });
});
