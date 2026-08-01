// src/components/admin/AdminRoutes.tsx
// Dispatches /admin/* pathnames to the correct sub-screen inside AdminLayout.
// This is the replacement for AdminShell as the entry-point from App.tsx.
// Sub-route pattern matching is done via simple pathname regex since urlRoute.ts
// has no nested-route or param-extraction primitives (workaround noted in report).
import React, { useEffect, useState } from 'react';
import { useAdminPath, handleAdminSPAClick } from '../../lib/urlRoute';
import { AdminLayout } from './AdminLayout';
import { AdminRouteGuard } from './AdminRouteGuard';
import { AdminHome } from './AdminHome';
import { TenantsList } from './TenantsList';
import { TenantDetailShell } from './TenantDetail/TenantDetailShell';
import { AuditLogViewer } from './AuditLogViewer';
import { PlansManagement } from './PlansManagement';
import { AdminRevenue } from './AdminRevenue';
import { TenantWizard } from './TenantWizard';
import { SalesRepsList } from './SalesRepsList';
import { PlatformSettings } from './PlatformSettings';
import { PendingPaymentsQueue } from './PendingPaymentsQueue';
import { CostDashboard } from './CostDashboard';
import { CaleoBotDashboard } from './CaleoBotDashboard';
import { isSuperAdmin } from '../../lib/adminAuth';

// Sub-paths that require super_admin (not just any platform_admin). Backend
// RPCs already gate these via _is_super_admin_from_jwt(); frontend gate is UX
// polish — sidebar hides links, but URL-bar navigation could still reach them.
const SUPER_ADMIN_ONLY_PATHS = new Set([
  '/admin/sales-reps',
  '/admin/sales-reps/',
  '/admin/payments/pending',
  '/admin/payments/pending/',
  '/admin/settings/payment',
  '/admin/settings/payment/',
  '/admin/revenue',
  '/admin/revenue/',
  '/admin/billing',
  '/admin/billing/',
  '/admin/caleo-bot',
  '/admin/caleo-bot/',
]);

function SuperAdminGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'checking' | 'allow' | 'deny'>('checking');
  useEffect(() => {
    let cancelled = false;
    isSuperAdmin()
      .then((ok) => { if (!cancelled) setState(ok ? 'allow' : 'deny'); })
      .catch(() => { if (!cancelled) setState('deny'); });
    return () => { cancelled = true; };
  }, []);
  if (state === 'checking') {
    return <div className="p-6 text-[13px] text-slate-500 font-caleo">Memeriksa akses super_admin…</div>;
  }
  if (state === 'deny') {
    return (
      <div className="p-8 max-w-md">
        <h1 className="text-lg font-semibold text-slate-800">Butuh super admin</h1>
        <p className="text-[13px] text-slate-600 mt-2">
          Halaman ini hanya dapat diakses oleh super_admin. Sales_rep tidak berwenang di sub-modul ini.
        </p>
        <a href="/admin" onClick={(e) => handleAdminSPAClick(e, '/admin')} className="mt-4 inline-block text-[13px] text-slate-700 underline">← Kembali ke Beranda</a>
      </div>
    );
  }
  return <>{children}</>;
}

// Pattern for /admin/tenants/<slug>
const TENANT_DETAIL_RE = /^\/admin\/tenants\/([^/]+)\/?$/;

function resolveAdminContent(pathname: string): React.ReactNode {
  if (pathname === '/admin' || pathname === '/admin/') {
    return <AdminHome />;
  }
  // /admin/tenants/new MUST match before TENANT_DETAIL_RE below — otherwise
  // 'new' would be interpreted as a slug and drop into TenantDetailShell.
  if (pathname === '/admin/tenants/new' || pathname === '/admin/tenants/new/') {
    return <TenantWizard />;
  }
  const tenantDetailMatch = pathname.match(TENANT_DETAIL_RE);
  if (tenantDetailMatch) {
    const tenantSlug = tenantDetailMatch[1];
    return <TenantDetailShell tenantSlug={tenantSlug} />;
  }
  if (pathname === '/admin/tenants' || pathname === '/admin/tenants/') {
    return <TenantsList />;
  }
  if (pathname === '/admin/audit' || pathname === '/admin/audit/') {
    return <AuditLogViewer />;
  }
  if (pathname === '/admin/plans' || pathname === '/admin/plans/') {
    return <PlansManagement />;
  }
  if (pathname === '/admin/revenue' || pathname === '/admin/revenue/') {
    return <AdminRevenue />;
  }
  if (pathname === '/admin/sales-reps' || pathname === '/admin/sales-reps/') {
    return <SalesRepsList />;
  }
  if (pathname === '/admin/payments/pending' || pathname === '/admin/payments/pending/') {
    return <PendingPaymentsQueue />;
  }
  if (pathname === '/admin/settings/payment' || pathname === '/admin/settings/payment/') {
    return <PlatformSettings />;
  }
  if (pathname === '/admin/billing' || pathname === '/admin/billing/') {
    return <CostDashboard />;
  }
  if (pathname === '/admin/caleo-bot' || pathname === '/admin/caleo-bot/') {
    return <CaleoBotDashboard />;
  }
  // Unknown sub-path — fallback to home
  return <AdminHome />;
}

export function AdminRoutes() {
  // Reactive pathname so sidebar SPA-nav doesn't remount AdminRouteGuard
  // on every click. Full page reloads (or first-load) update this via the
  // popstate/ROUTE_CHANGE_EVENT subscription in useAdminPath().
  const pathname = useAdminPath();
  const needsSuperAdmin = SUPER_ADMIN_ONLY_PATHS.has(pathname);
  const content = resolveAdminContent(pathname);
  const wrapped = needsSuperAdmin ? <SuperAdminGate>{content}</SuperAdminGate> : content;
  return (
    <AdminRouteGuard>
      <AdminLayout activePath={pathname}>
        {wrapped}
      </AdminLayout>
    </AdminRouteGuard>
  );
}
