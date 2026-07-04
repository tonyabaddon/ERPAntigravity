import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { navigate } from '../lib/urlRoute';
import { Building2 } from 'lucide-react';

interface TenantRow { tenant_id: string; slug: string; name: string; }

export const SelectTenantScreen: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // Reads tenant_users JOIN tenants; RLS gives current user their own memberships
    supabase.from('tenant_users')
      .select('tenant_id, tenants!inner(slug, name)')
      .eq('status', 'ACTIVE')
      .then(({ data }) => {
        setTenants((data ?? []).map((r: any) => ({
          tenant_id: r.tenant_id, slug: r.tenants.slug, name: r.tenants.name
        })));
      });
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
