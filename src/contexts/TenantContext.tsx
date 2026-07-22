import React, { createContext, useContext, useEffect, useState } from 'react';
import { tenantContextService } from '../lib/supabaseClient';

export interface TenantContextValue {
  tenant_id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan_code: string;
  effective_features: Record<string, boolean>;
  expiry_mode: 'ACTIVE' | 'GRACE' | 'READONLY';
  expires_at: string;
  grace_expires_at: string;
  is_platform_admin: boolean;
  impersonating: boolean;
}

const Ctx = createContext<TenantContextValue | null>(null);

interface Props {
  slug: string;
  impersonating?: boolean;
  onError?: (code: string) => void;
  children: React.ReactNode;
}

export const TenantProvider: React.FC<Props> = ({ slug, impersonating = false, onError, children }) => {
  const [state, setState] = useState<TenantContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    tenantContextService.bootstrap(typeof window !== 'undefined' ? window.location.hostname : undefined)
      .then(v => { if (!cancelled && v) setState({ ...v, impersonating } as TenantContextValue); })
      .catch(err => {
        const code = err?.message ?? err?.code ?? 'BOOTSTRAP_FAILED';
        if (!cancelled) { setError(code); onError?.(code); }
      });
    return () => { cancelled = true; };
  }, [slug, impersonating, onError]);

  if (error) return <div role="alert" data-testid="tenant-bootstrap-error">{error}</div>;
  if (!state) return <div data-testid="tenant-bootstrap-loading">Loading…</div>;

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
};

export function useTenant(): TenantContextValue | null {
  return useContext(Ctx);
}

export function useFeature(key: string): boolean {
  const t = useTenant();
  return !!(t?.effective_features?.[key]);
}
