// src/components/admin/AdminRouteGuard.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AdminRouteGuard } from './AdminRouteGuard';

const mockIsPlatformAdmin = vi.fn();
const mockAdminToastError = vi.fn();
const mockGetSession = vi.fn(() =>
  Promise.resolve({ data: { session: null }, error: null })
);

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      // Guard now performs a server heartbeat via refreshSession() before
      // trusting the JWT claim; mock so tests don't blow up on undefined.
      refreshSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      getSession: () => mockGetSession(),
    },
  },
  tenantContextService: {
    isPlatformAdmin: () => mockIsPlatformAdmin() as Promise<boolean>,
  },
}));

// Build a signed-looking JWT with the given claims (base64url-encoded).
// The guard decodes the middle segment only; signature is not verified.
function buildFakeJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.fake-signature`;
}

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
  // Default: no active session → readImpersonationSlug returns null
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
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

  it('redirects impersonating admin back to /t/<slug>/dashboard with toast', async () => {
    // F-6 companion: admin with active impersonation URL-hacks to /admin.
    // We bounce them to the impersonated tenant's dashboard so they can Stop
    // Impersonation from the banner instead of hitting RPC 403s.
    mockIsPlatformAdmin.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: buildFakeJwt({
            sub: '00000000-0000-0000-0000-000000000001',
            is_platform_admin: true,
            impersonating: true,
            impersonating_slug: 'garindo',
          }),
        },
      },
      error: null,
    });
    render(
      <AdminRouteGuard>
        <div>Tidak boleh terlihat</div>
      </AdminRouteGuard>
    );
    await waitFor(() =>
      expect(mockAssign).toHaveBeenCalledWith('/t/garindo/dashboard?screen=dashboard')
    );
    expect(mockAdminToastError).toHaveBeenCalledWith(
      'Stop impersonation dulu sebelum masuk Caleo Admin'
    );
    expect(screen.queryByText('Tidak boleh terlihat')).not.toBeInTheDocument();
  });
});
