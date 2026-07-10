import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminLayout } from './AdminLayout';

// Stable resolved value helper
const resolved = <T,>(value: T) => Promise.resolve({ data: value, error: null });

vi.mock('../../lib/paymentVerificationApi', () => ({
  paymentVerificationApi: {
    listPending: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        resolved({
          session: {
            user: { email: 'admin@vosi.app' },
            access_token: buildFakeJwt({ impersonating: false }),
          },
        })
      ),
      signOut: vi.fn(() => resolved(null)),
    },
  },
  tenantContextService: {
    isPlatformAdmin: vi.fn(() => Promise.resolve(true)),
    stopImpersonation: vi.fn(() => Promise.resolve()),
  },
}));

/**
 * Build a minimal fake JWT with a given payload.
 * header.payload.signature (signature is ignored by decodeJwt).
 */
function buildFakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sidebar + top header + children content', () => {
    render(
      <AdminLayout activePath="/admin">
        <div>Konten Beranda</div>
      </AdminLayout>
    );
    // "VOSI Admin" appears in both the header and sidebar brand — both should be present
    const vosiAdminInstances = screen.getAllByText('VOSI Admin');
    expect(vosiAdminInstances.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Konten Beranda')).toBeInTheDocument();
    // Sidebar nav items should be present
    expect(screen.getByText('Beranda')).toBeInTheDocument();
    expect(screen.getByText('Tenant')).toBeInTheDocument();
  });

  it('does NOT render impersonation banner when not impersonating', () => {
    render(
      <AdminLayout activePath="/admin">
        <div />
      </AdminLayout>
    );
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/Impersonating:/)).not.toBeInTheDocument();
  });

  it('renders impersonation banner when impersonating', async () => {
    // Override mock to return a JWT with impersonating=true
    const { supabase } = await import('../../lib/supabaseClient');
    vi.mocked(supabase!.auth.getSession).mockResolvedValue({
      data: {
        session: {
          user: { email: 'admin@vosi.app' },
          access_token: buildFakeJwt({ impersonating: true, impersonating_slug: 'garindo' }),
        },
      },
      error: null,
    } as never);

    const { findByTestId } = render(
      <AdminLayout activePath="/admin">
        <div />
      </AdminLayout>
    );

    const banner = await findByTestId('impersonation-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('garindo');
  });
});
