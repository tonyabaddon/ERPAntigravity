// src/components/errors/TenantImpersonateGate.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantImpersonateGate } from './TenantImpersonateGate';

describe('TenantImpersonateGate', () => {
  it('renders slug prominently', () => {
    render(
      <TenantImpersonateGate
        slug="garindo"
        onConfirm={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('garindo')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-impersonate-gate')).toBeInTheDocument();
  });

  it('calls onConfirm when Impersonasi button is clicked', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    render(
      <TenantImpersonateGate
        slug="garindo"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /Impersonasi & Lanjutkan/i });
    fireEvent.click(btn);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('shows loading label while onConfirm is pending', async () => {
    let resolveConfirm: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(
      <TenantImpersonateGate
        slug="garindo"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Impersonasi & Lanjutkan/i }));
    await waitFor(() => expect(screen.getByText(/Mengimpersonasi/i)).toBeInTheDocument());
    resolveConfirm();
  });

  it('surfaces error message when onConfirm rejects', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('RPC failed: boom')));
    render(
      <TenantImpersonateGate
        slug="garindo"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Impersonasi & Lanjutkan/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/RPC failed: boom/i),
    );
    // Buttons re-enabled after error so user can retry.
    expect(
      screen.getByRole('button', { name: /Impersonasi & Lanjutkan/i }),
    ).not.toBeDisabled();
  });

  it('calls onCancel when Kembali button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <TenantImpersonateGate
        slug="garindo"
        onConfirm={() => Promise.resolve()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Kembali ke VOSI Admin/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
