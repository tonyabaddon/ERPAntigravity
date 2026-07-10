import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSuperAdmin, isSalesRep } from './adminAuth';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
  // tenantContextService not used by the new adminAuth — stub to avoid import errors
  tenantContextService: {
    isPlatformAdmin: vi.fn(),
  },
}));

function mockClaim(role: string | null): void {
  const payload = role ? { platform_admin_role: role } : {};
  // Build a base64url-encoded payload (use standard base64 for simplicity in tests)
  const encoded = btoa(JSON.stringify(payload));
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: `hdr.${encoded}.sig` } as Parameters<typeof vi.mocked>[0] },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSuperAdmin', () => {
  it('returns true when JWT platform_admin_role=super_admin', async () => {
    mockClaim('super_admin');
    expect(await isSuperAdmin()).toBe(true);
  });

  it('returns false when platform_admin_role=sales_rep', async () => {
    mockClaim('sales_rep');
    expect(await isSuperAdmin()).toBe(false);
  });

  it('returns false when claim is missing', async () => {
    mockClaim(null);
    expect(await isSuperAdmin()).toBe(false);
  });
});

describe('isSalesRep', () => {
  it('returns true when JWT platform_admin_role=sales_rep', async () => {
    mockClaim('sales_rep');
    expect(await isSalesRep()).toBe(true);
  });

  it('returns false when platform_admin_role=super_admin', async () => {
    mockClaim('super_admin');
    expect(await isSalesRep()).toBe(false);
  });

  it('returns false when claim is missing', async () => {
    mockClaim(null);
    expect(await isSalesRep()).toBe(false);
  });
});
