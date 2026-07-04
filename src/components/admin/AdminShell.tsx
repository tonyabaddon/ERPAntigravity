// src/components/admin/AdminShell.tsx
import React, { useEffect, useState } from 'react';
import { tenantContextService } from '../../lib/supabaseClient';
import { supabase } from '../../lib/supabaseClient';
import { ShieldCheck, ArrowRight } from 'lucide-react';

interface ImpersonationState {
  active: boolean;
  slug: string | null;
}

export const AdminShell: React.FC = () => {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [impersonateInput, setImpersonateInput] = useState('');
  const [impersonation, setImpersonation] = useState<ImpersonationState>({ active: false, slug: null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    tenantContextService.isPlatformAdmin().then(setIsAdmin);
    // Read current impersonation state from JWT
    supabase?.auth.getSession().then(({ data }) => {
      const claims: any = data.session?.access_token ? decodeJwt(data.session.access_token) : {};
      if (claims?.impersonating) {
        setImpersonation({ active: true, slug: claims.impersonating_slug ?? null });
      }
    });
  }, []);

  if (isAdmin === null) return <div className="p-6 text-slate-500">Loading…</div>;
  if (!isAdmin) {
    window.location.href = '/login';
    return null;
  }

  const handleImpersonate = async () => {
    const slug = impersonateInput.trim().toLowerCase();
    if (!slug || submitting) return;
    setSubmitting(true);
    try {
      await tenantContextService.impersonateTenant(slug);
      // JWT is refreshed inside impersonateTenant; new claims are live.
      window.location.href = `/t/${slug}/dashboard`;
    } catch (err) {
      console.error(err);
      alert(`Gagal impersonate: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExitImpersonation = async () => {
    setSubmitting(true);
    try {
      await tenantContextService.stopImpersonation();
      setImpersonation({ active: false, slug: null });
      window.location.href = '/admin';
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center gap-3">
        <ShieldCheck size={20} />
        <span className="font-semibold">VOSI Admin Panel</span>
        {impersonation.active && (
          <button onClick={handleExitImpersonation} disabled={submitting}
            className="ml-auto px-3 py-1 bg-amber-500 text-amber-950 text-xs rounded font-semibold disabled:opacity-50">
            Impersonating: {impersonation.slug} — Exit
          </button>
        )}
      </header>
      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <section className="bg-white p-6 rounded shadow">
          <h2 className="font-semibold text-slate-900">Impersonate Tenant</h2>
          <p className="text-sm text-slate-500 mt-1">
            Enter slug to enter tenant view. Session is audit-logged. JWT refreshes with new tenant claim.
          </p>
          <div className="flex gap-2 mt-4">
            <input value={impersonateInput} onChange={e => setImpersonateInput(e.target.value)}
              placeholder="e.g. garindo" disabled={submitting}
              className="flex-1 px-3 py-2 border border-slate-300 rounded disabled:bg-slate-100" />
            <button onClick={handleImpersonate} disabled={submitting}
              className="px-4 py-2 bg-slate-900 text-white rounded flex items-center gap-1 disabled:opacity-50">
              Enter <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <section className="bg-white p-6 rounded shadow">
          <h2 className="font-semibold text-slate-900">Tenant management</h2>
          <p className="text-sm text-slate-500 mt-1">Coming in Phase B (list, create, edit, plan, audit viewer).</p>
        </section>
      </main>
    </div>
  );
};

// Minimal JWT decoder (no signature verification needed for reading claims)
function decodeJwt(token: string): Record<string, any> {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}
