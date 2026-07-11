// src/components/TenantImpersonationBanner.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// Build a fake JWT so decodeJwt returns the claims we want.
function buildFakeJwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims));
  return `header.${payload}.sig`;
}

const stopImpersonationMock = vi.fn(() => Promise.resolve());
const getSessionMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
    },
  },
  tenantContextService: {
    stopImpersonation: () => stopImpersonationMock(),
  },
}));

// Re-import after mocks are installed.
import { TenantImpersonationBanner } from './TenantImpersonationBanner';

describe('TenantImpersonationBanner', () => {
  beforeEach(() => {
    stopImpersonationMock.mockReset().mockResolvedValue(undefined);
    getSessionMock.mockReset();
  });

  it('renders nothing when JWT has no impersonating claim', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: { access_token: buildFakeJwt({ impersonating: false }) },
      },
    });
    render(<TenantImpersonationBanner />);
    // Give the effect a tick to run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('tenant-impersonation-banner')).not.toBeInTheDocument();
  });

  it('renders slug when JWT has impersonating claim', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: buildFakeJwt({ impersonating: true, impersonating_slug: 'garindo' }),
        },
      },
    });
    render(<TenantImpersonationBanner />);
    await waitFor(() =>
      expect(screen.getByTestId('tenant-impersonation-banner')).toBeInTheDocument(),
    );
    expect(screen.getByText('garindo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Keluar/i })).toBeInTheDocument();
  });

  it('renders "unknown" placeholder when impersonating_slug is missing', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: buildFakeJwt({ impersonating: true }),
        },
      },
    });
    render(<TenantImpersonationBanner />);
    await waitFor(() =>
      expect(screen.getByTestId('tenant-impersonation-banner')).toBeInTheDocument(),
    );
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('calls stopImpersonation and redirects on Keluar click', async () => {
    const originalLocation = window.location;
    // @ts-expect-error — assign minimal shape to a mutable copy
    window.location = { href: '/t/garindo/dashboard' };
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: buildFakeJwt({ impersonating: true, impersonating_slug: 'garindo' }),
        },
      },
    });
    render(<TenantImpersonationBanner />);
    const btn = await screen.findByRole('button', { name: /Keluar/i });
    fireEvent.click(btn);
    await waitFor(() => expect(stopImpersonationMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.href).toBe('/admin'));
    // Restore
    // @ts-expect-error — restore original
    window.location = originalLocation;
  });
});
