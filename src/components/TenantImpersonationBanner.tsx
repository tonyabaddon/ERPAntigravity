// src/components/TenantImpersonationBanner.tsx
//
// Thin amber strip rendered at the top of the tenant shell whenever the
// active JWT carries an `impersonating` claim. Purpose is safety awareness:
// the tenant shell header ("Garindo Jaya Panel") shows the tenant's identity
// but not the viewer's — a platform admin looking at a Garindo dashboard
// via impersonation and Garindo's own owner see the same header. The banner
// closes that gap without adding a confirm gate.
//
// The equivalent banner in `AdminLayout.tsx` only shows on `/admin/*`, so
// this is its `/t/<slug>/*` counterpart. Style is intentionally softer than
// AdminLayout's — you'll live in the tenant shell for long stretches, so
// the banner needs to be legible without being loud.
import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { supabase, tenantContextService } from '../lib/supabaseClient';
import { decodeJwt } from '../lib/jwt';

interface State {
  active: boolean;
  slug: string | null;
}

export const TenantImpersonationBanner: React.FC = () => {
  const [state, setState] = useState<State>({ active: false, slug: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token;
      if (!token) return;
      const claims = decodeJwt(token);
      if (claims?.impersonating === true) {
        setState({
          active: true,
          slug: typeof claims.impersonating_slug === 'string' ? claims.impersonating_slug : null,
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function handleExit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await tenantContextService.stopImpersonation();
      // Full-page nav so the refreshed JWT (no impersonation claim) is picked
      // up cleanly, and admin lands back at their VOSI admin home.
      window.location.href = '/admin';
    } catch {
      // Ignore — if stopImpersonation fails the banner stays visible and
      // the user can retry. Toast infra isn't wired inside the tenant shell.
      setSubmitting(false);
    }
  }

  if (!state.active) return null;

  return (
    <div
      className="w-full flex items-center justify-between px-6 h-7 text-[12px] border-b"
      style={{ background: '#FFFBEB', borderBottomColor: '#FDE68A', color: '#78350F' }}
      data-testid="tenant-impersonation-banner"
    >
      <div className="flex items-center gap-2">
        <Eye size={13} strokeWidth={1.8} />
        <span>
          Impersonating tenant:&nbsp;<strong style={{ color: '#7C2D12' }}>{state.slug ?? 'unknown'}</strong>
        </span>
      </div>
      <button
        type="button"
        onClick={handleExit}
        disabled={submitting}
        className="font-semibold underline hover:no-underline disabled:opacity-50"
        style={{ color: '#78350F' }}
      >
        {submitting ? 'Mengeluarkan…' : 'Keluar ▸'}
      </button>
    </div>
  );
};
