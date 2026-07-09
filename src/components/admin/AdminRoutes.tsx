// src/components/admin/AdminRoutes.tsx
// Dispatches /admin/* pathnames to the correct sub-screen inside AdminLayout.
// This is the replacement for AdminShell as the entry-point from App.tsx.
// Sub-route pattern matching is done via simple pathname regex since urlRoute.ts
// has no nested-route or param-extraction primitives (workaround noted in report).
import React from 'react';
import { AdminLayout } from './AdminLayout';
import { AdminRouteGuard } from './AdminRouteGuard';
import { AdminHome } from './AdminHome';
import { TenantsList } from './TenantsList';
import { TenantDetailShell } from './TenantDetail/TenantDetailShell';
import { AuditLogViewer } from './AuditLogViewer';
import { PlansManagement } from './PlansManagement';
import { AdminRevenue } from './AdminRevenue';
import { TenantWizard } from './TenantWizard';

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
  // Unknown sub-path — fallback to home
  return <AdminHome />;
}

export function AdminRoutes() {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '/admin';

  return (
    <AdminRouteGuard>
      <AdminLayout activePath={pathname}>
        {resolveAdminContent(pathname)}
      </AdminLayout>
    </AdminRouteGuard>
  );
}
