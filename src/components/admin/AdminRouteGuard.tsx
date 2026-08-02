// src/components/admin/AdminRouteGuard.tsx
// Platform-admin guard. Non-admins are redirected to /dashboard with a toast.
// Uses urlRoute.ts patterns (no react-router-dom).
import React, { useEffect, useState } from 'react';
import { supabase, tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';

type GuardState = 'checking' | 'allow' | 'deny-not-admin' | 'deny-impersonating';

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

// F-6 companion: even after DB scopes reads to the impersonated tenant, an
// admin who URL-hacks to /admin during impersonation would hit RPC 403s from
// the newly-strict _is_platform_admin_active_from_jwt() gates. Redirect them
// back to the impersonated tenant instead so they can Stop Impersonation
// from the banner.
async function readImpersonationSlug(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
      impersonating?: boolean;
      impersonating_slug?: string;
    };
    if (claims.impersonating && typeof claims.impersonating_slug === 'string') {
      return claims.impersonating_slug;
    }
    return null;
  } catch {
    return null;
  }
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const [state, setState] = useState<GuardState>('checking');
  const [impersonatingSlug, setImpersonatingSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Server heartbeat: force JWT refresh so a deactivated / demoted user
        // doesn't retain admin UI access via a stale cached claim. Backend
        // RPCs re-verify anyway, but the shell + read-only queries were
        // leaking data for the residual JWT lifetime.
        if (supabase) {
          await supabase.auth.refreshSession().catch(() => { /* ignore */ });
        }
        // Retry isPlatformAdmin up to 3× with 500ms backoff. During a Supabase
        // direct-pool pinch (see 2026-07-22 incident) this RPC can transiently
        // return 500/503 and the guard would kick a legit admin out to the
        // login screen. Retrying isolates transient DB errors from real
        // access denials — a genuine non-admin's JWT claim doesn't flip on
        // retry, so they still land at deny-not-admin.
        let ok = false;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            ok = await tenantContextService.isPlatformAdmin();
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        }
        if (cancelled) return;
        if (lastErr) throw lastErr;
        if (!ok) {
          adminToast.error('Halaman khusus admin');
          setState('deny-not-admin');
          return;
        }
        const slug = await readImpersonationSlug();
        if (cancelled) return;
        if (slug) {
          adminToast.error('Stop impersonation dulu sebelum masuk Caleo Admin');
          setImpersonatingSlug(slug);
          setState('deny-impersonating');
          return;
        }
        setState('allow');
      } catch {
        if (!cancelled) {
          adminToast.error('Halaman khusus admin');
          setState('deny-not-admin');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') {
    return <div className="p-6 text-caleo-13 text-slate-500">Memeriksa akses...</div>;
  }

  if (state === 'deny-impersonating') {
    window.location.assign(`/t/${impersonatingSlug}/dashboard?screen=dashboard`);
    return null;
  }

  if (state === 'deny-not-admin') {
    // Redirect to /dashboard — the legacy-redirect in App.tsx will further
    // bounce this to /t/<session-slug>/dashboard for tenant users.
    window.location.assign('/dashboard');
    return null;
  }

  return <>{children}</>;
}
