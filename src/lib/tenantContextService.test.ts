import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs BEFORE any imports, so supabaseClient module sees
// the stubbed env at load time (Cloud Build has no VITE_SUPABASE_URL / KEY).
const { mockRpc } = vi.hoisted(() => {
  // Stub env pre-import so isSupabaseConfigured evaluates truthy.
  // Direct assignment on import.meta.env is the pre-Vitest-4 pattern and
  // still works — vi.stubEnv is not available inside hoisted().
  (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
  return { mockRpc: vi.fn() };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
    from: () => ({}),
    channel: () => ({ subscribe: () => ({}) }),
    storage: { from: () => ({}) },
  }),
}));

import { tenantContextService } from './supabaseClient';

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { slug: 'garindo', tenant_id: 'x', name: 'Garindo', environment: 'production' }, error: null });
});

describe('tenantContextService.bootstrap — hostname forwarding', () => {
  it('forwards hostname as p_hostname argument', async () => {
    await tenantContextService.bootstrap('app.caleo.id');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', { p_hostname: 'app.caleo.id' });
  });

  it('sends empty args when hostname is undefined (backward compat)', async () => {
    await tenantContextService.bootstrap();
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', {});
  });

  it('sends empty args when hostname is empty string', async () => {
    await tenantContextService.bootstrap('');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', {});
  });

  it('forwards staging hostnames untouched', async () => {
    await tenantContextService.bootstrap('staging.app.caleo.id');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', { p_hostname: 'staging.app.caleo.id' });
  });
});
