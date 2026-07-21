// src/components/errors/ImpersonateFailureScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock Sentry so we can assert on setTag without a real DSN.
const setTagMock = vi.fn();
vi.mock('@sentry/react', () => ({
  setTag: (...args: unknown[]) => setTagMock(...args),
}));

import { ImpersonateFailureScreen } from './ImpersonateFailureScreen';

describe('ImpersonateFailureScreen', () => {
  const onRetry = vi.fn();
  const onLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders AccessDenied when isPlatformAdmin=true', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={true}
        error="RPC failed"
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );

    // AccessDenied shows "Akses ditolak" heading
    expect(screen.getByRole('heading', { name: /Akses ditolak/i })).toBeInTheDocument();
    // TenantBootstrapError heading should NOT appear
    expect(screen.queryByText(/Gagal memuat tenant/i)).not.toBeInTheDocument();
  });

  it('emits Sentry error_class=impersonate tag when isPlatformAdmin=true', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={true}
        error="RPC failed"
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );
    expect(setTagMock).toHaveBeenCalledWith('error_class', 'impersonate');
  });

  it('renders TenantBootstrapError when isPlatformAdmin=false', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={false}
        error="connection timeout"
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );

    // TenantBootstrapError shows "Gagal memuat tenant" heading
    expect(screen.getByRole('heading', { name: /Gagal memuat tenant/i })).toBeInTheDocument();
    // AccessDenied heading should NOT appear
    expect(screen.queryByText(/Akses ditolak/i)).not.toBeInTheDocument();
    // Error code should appear in the UI
    expect(screen.getByText(/IMPERSONATE_FAILED/)).toBeInTheDocument();
  });

  it('emits Sentry error_class=tenant_bootstrap tag when isPlatformAdmin=false', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={false}
        error="connection timeout"
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );
    expect(setTagMock).toHaveBeenCalledWith('error_class', 'tenant_bootstrap');
  });

  it('includes error message in code when isPlatformAdmin=false', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={false}
        error="tenant not found"
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText(/tenant not found/)).toBeInTheDocument();
  });

  it('falls back to "unknown" when error is empty and isPlatformAdmin=false', () => {
    render(
      <ImpersonateFailureScreen
        isPlatformAdmin={false}
        error=""
        onRetry={onRetry}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText(/IMPERSONATE_FAILED: unknown/)).toBeInTheDocument();
  });
});
