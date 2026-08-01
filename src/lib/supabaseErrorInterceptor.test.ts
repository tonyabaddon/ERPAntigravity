import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchTenantError } from './supabaseErrorInterceptor';

describe('supabaseErrorInterceptor', () => {
  let listener: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    listener = vi.fn();
    window.addEventListener('caleo:tenant-error', listener as EventListener);
  });

  it('recognizes TENANT_NOT_FOUND (P0404)', () => {
    const code = dispatchTenantError({ message: 'TENANT_NOT_FOUND', code: 'P0404' });
    expect(code).toBe('TENANT_NOT_FOUND');
    expect(listener).toHaveBeenCalled();
  });

  it('recognizes SUBSCRIPTION_EXPIRED_READONLY (P0402)', () => {
    const code = dispatchTenantError({ message: 'SUBSCRIPTION_EXPIRED_READONLY', code: 'P0402' });
    expect(code).toBe('SUBSCRIPTION_EXPIRED_READONLY');
  });

  it('returns null for unrelated errors', () => {
    const code = dispatchTenantError({ message: 'row not found', code: 'PGRST116' });
    expect(code).toBeNull();
  });
});
