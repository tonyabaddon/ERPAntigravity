// src/components/admin/AdminRouteGuard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminRouteGuard } from './AdminRouteGuard';

const mockIsPlatformAdmin = vi.fn();
const mockAdminToastError = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  tenantContextService: {
    isPlatformAdmin: () => mockIsPlatformAdmin() as Promise<boolean>,
  },
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: (...args: unknown[]) => mockAdminToastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// jsdom locks window.location by default; replace the whole object.
// We capture calls to assign() to verify redirect behaviour.
const mockAssign = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  mockAssign.mockClear();
  // Replace window.location with a writable mock
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, assign: mockAssign },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: originalLocation,
  });
});

describe('AdminRouteGuard', () => {
  it('renders children for platform admin', async () => {
    mockIsPlatformAdmin.mockResolvedValue(true);
    render(
      <AdminRouteGuard>
        <div>Konten Admin</div>
      </AdminRouteGuard>
    );
    await waitFor(() => expect(screen.getByText('Konten Admin')).toBeInTheDocument());
    expect(mockAdminToastError).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it('shows loading state while checking', () => {
    // Never resolves during this test
    mockIsPlatformAdmin.mockReturnValue(new Promise<boolean>(() => {}));
    render(
      <AdminRouteGuard>
        <div>Konten Admin</div>
      </AdminRouteGuard>
    );
    expect(screen.getByText('Memeriksa akses...')).toBeInTheDocument();
    expect(screen.queryByText('Konten Admin')).not.toBeInTheDocument();
  });

  it('redirects non-admin to /dashboard with Bahasa toast', async () => {
    mockIsPlatformAdmin.mockResolvedValue(false);
    render(
      <AdminRouteGuard>
        <div>Tidak boleh terlihat</div>
      </AdminRouteGuard>
    );
    await waitFor(() => expect(mockAssign).toHaveBeenCalledWith('/dashboard'));
    expect(mockAdminToastError).toHaveBeenCalledWith('Halaman khusus admin');
    expect(screen.queryByText('Tidak boleh terlihat')).not.toBeInTheDocument();
  });

  it('redirects and toasts when isPlatformAdmin throws', async () => {
    mockIsPlatformAdmin.mockRejectedValue(new Error('network error'));
    render(
      <AdminRouteGuard>
        <div>Tidak boleh terlihat</div>
      </AdminRouteGuard>
    );
    await waitFor(() => expect(mockAssign).toHaveBeenCalledWith('/dashboard'));
    expect(mockAdminToastError).toHaveBeenCalledWith('Halaman khusus admin');
  });
});
