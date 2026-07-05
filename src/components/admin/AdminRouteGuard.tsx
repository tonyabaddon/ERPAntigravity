// src/components/admin/AdminRouteGuard.tsx
// Platform-admin guard. Non-admins are redirected to /dashboard with a toast.
// Uses urlRoute.ts patterns (no react-router-dom).
import React, { useEffect, useState } from 'react';
import { tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';

type GuardState = 'checking' | 'allow' | 'deny';

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const [state, setState] = useState<GuardState>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await tenantContextService.isPlatformAdmin();
        if (cancelled) return;
        if (!ok) {
          adminToast.error('Halaman khusus admin');
          setState('deny');
        } else {
          setState('allow');
        }
      } catch {
        if (!cancelled) {
          adminToast.error('Halaman khusus admin');
          setState('deny');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'checking') {
    return <div className="p-6 text-[13px] text-slate-500">Memeriksa akses...</div>;
  }

  if (state === 'deny') {
    // Redirect to /dashboard — the Garindo legacy-redirect in App.tsx
    // will further bounce this to /t/garindo/dashboard for tenant users.
    window.location.assign('/dashboard');
    return null;
  }

  return <>{children}</>;
}
