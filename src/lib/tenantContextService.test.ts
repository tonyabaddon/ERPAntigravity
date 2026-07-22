import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

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
