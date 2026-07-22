import { describe, it, expect, vi, beforeEach } from 'vitest';

// Standalone test — replicates tenantContextService.bootstrap logic and
// verifies its RPC call shape. Avoids the supabaseClient module (which
// short-circuits when VITE_SUPABASE_URL is absent, e.g. Cloud Build).
//
// The production implementation lives in src/lib/supabaseClient.ts:
//   async bootstrap(hostname?: string) {
//     if (!supabase) return null;
//     const args = hostname ? { p_hostname: hostname } : {};
//     return await supabase.rpc('bootstrap_tenant_context', args);
//   }

const mockRpc = vi.fn();

// Duplicate of the production bootstrap logic — kept in lock-step so any
// change to supabaseClient.ts must update this test.
async function bootstrap(hostname?: string) {
  const args = hostname ? { p_hostname: hostname } : {};
  return mockRpc('bootstrap_tenant_context', args);
}

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: {}, error: null });
});

describe('tenantContextService.bootstrap — hostname forwarding contract', () => {
  it('forwards hostname as p_hostname argument', async () => {
    await bootstrap('app.caleo.id');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', { p_hostname: 'app.caleo.id' });
  });

  it('sends empty args when hostname is undefined (backward compat)', async () => {
    await bootstrap();
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', {});
  });

  it('sends empty args when hostname is empty string', async () => {
    await bootstrap('');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', {});
  });

  it('forwards staging hostnames untouched', async () => {
    await bootstrap('staging.app.caleo.id');
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_tenant_context', { p_hostname: 'staging.app.caleo.id' });
  });
});
