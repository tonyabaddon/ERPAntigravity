import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantProvider, useTenant, useFeature } from './TenantContext';

vi.mock('../lib/supabaseClient', () => ({
  tenantContextService: {
    bootstrap: vi.fn(async () => ({
      tenant_id: 't1', slug: 'garindo', name: 'Garindo Jaya', status: 'ACTIVE',
      plan_code: 'PREMIUM',
      effective_features: { modul_kasir: true, modul_tempo: true },
      expiry_mode: 'ACTIVE', expires_at: '2099-12-31', grace_expires_at: '2100-01-07',
      is_platform_admin: false
    }))
  }
}));

function Probe() {
  const t = useTenant();
  const kasir = useFeature('modul_kasir');
  const tempo = useFeature('modul_tempo');
  const nope = useFeature('modul_ai');
  return <div>
    <span data-testid="name">{t?.name}</span>
    <span data-testid="kasir">{String(kasir)}</span>
    <span data-testid="tempo">{String(tempo)}</span>
    <span data-testid="nope">{String(nope)}</span>
  </div>;
}

describe('TenantContext', () => {
  it('bootstraps and exposes tenant + features', async () => {
    render(<TenantProvider slug="garindo"><Probe /></TenantProvider>);
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Garindo Jaya'));
    expect(screen.getByTestId('kasir')).toHaveTextContent('true');
    expect(screen.getByTestId('tempo')).toHaveTextContent('true');
    expect(screen.getByTestId('nope')).toHaveTextContent('false');
  });
});
