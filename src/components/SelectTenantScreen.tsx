import React, { useEffect, useState } from 'react';
import { supabase, tenantContextService } from '../lib/supabaseClient';
import { Building2 } from 'lucide-react';

interface TenantRow { tenant_id: string; slug: string; name: string; }

export const SelectTenantScreen: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // Use bootstrap_tenant_context (SECDEF) — direct SELECT on tenant_users
    // hits 42P17 RLS recursion for non-admin users. For MVP (every user is
    // single-tenant) this returns exactly the JWT-scoped tenant.
    // Multi-tenant expansion needs a dedicated RPC to list all memberships.
    tenantContextService.bootstrap()
      .then((ctx) => {
        if (ctx?.slug && ctx?.tenant_id && ctx?.name) {
          setTenants([{ tenant_id: ctx.tenant_id, slug: ctx.slug, name: ctx.name }]);
        } else {
          setTenants([]);
        }
      })
      .catch(() => setTenants([]));
  }, []);

  useEffect(() => {
    if (tenants?.length === 1) {
      window.location.href = `/t/${tenants[0].slug}/dashboard`;
    }
  }, [tenants]);

  if (!tenants) return <div className="p-6 text-slate-500">Loading…</div>;
  if (tenants.length === 0) return <div className="p-6 text-rose-600">Tidak ada tenant terdaftar untuk akun Anda.</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full space-y-3">
        <h1 className="text-lg font-semibold text-slate-900 mb-4">Pilih tenant</h1>
        {tenants.map(t => (
          <button key={t.tenant_id} onClick={() => window.location.href = `/t/${t.slug}/dashboard`}
            className="w-full flex items-center gap-3 p-4 bg-white rounded shadow hover:shadow-md text-left">
            <Building2 size={20} className="text-slate-500" />
            <div>
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-slate-500">/t/{t.slug}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
