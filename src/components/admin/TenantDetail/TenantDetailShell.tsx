// src/components/admin/TenantDetail/TenantDetailShell.tsx
// /admin/tenants/:tenantSlug — breadcrumb + tenant header + 3-tab container.
// No react-router-dom: uses custom urlRoute.ts pattern + native <a href>.
// Tab state is URL-based (?tab=…) so back-button + refresh preserve the view.
// Tenant lookup: client-side find from listTenantsAdmin by slug — see Wave 2+ followup note.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { listTenantsAdmin } from '../../../lib/adminApi';
import type { AdminTenantRow } from '../../../lib/adminTypes';
import { adminToast } from '../../../lib/adminToast';
import { isSuperAdmin } from '../../../lib/adminAuth';
import { handleAdminSPAClick } from '../../../lib/urlRoute';
import { OverviewTab } from './OverviewTab';
import { UsersTab } from './UsersTab';
import { AuditTab } from './AuditTab';
import { PembayaranTab } from './PembayaranTab';
import { TenantDangerZone } from './TenantDangerZone';
import { ModuleTogglePanel } from './ModuleTogglePanel';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'ringkasan',     label: 'Ringkasan' },
  { key: 'pengguna',      label: 'Pengguna' },
  { key: 'log-aktivitas', label: 'Log aktivitas' },
  { key: 'pembayaran',    label: 'Pembayaran' },
] as const;

type TabKey = (typeof TABS)[number]['key'];
const DEFAULT_TAB: TabKey = 'ringkasan';
const VALID_TABS = new Set<string>(TABS.map((t) => t.key));

// ─── URL-based tab state (popstate + custom event aware) ──────────────────────
// Mirrors the useSyncExternalStore pattern from urlRoute.ts.

const ROUTE_CHANGE_EVENT = 'urlroute:change';

function subscribeToUrl(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(ROUTE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(ROUTE_CHANGE_EVENT, callback);
  };
}

let _lastSearch: string | null = null;
let _lastTab: TabKey = DEFAULT_TAB;

function getTabSnapshot(): TabKey {
  const search = typeof window !== 'undefined' ? window.location.search : '';
  if (search !== _lastSearch) {
    _lastSearch = search;
    const raw = new URLSearchParams(search).get('tab') ?? '';
    if (VALID_TABS.has(raw)) {
      _lastTab = raw as TabKey;
    } else {
      _lastTab = DEFAULT_TAB;
      // Sync URL to the effective tab so URL and rendered state agree
      // (bookmarked / shared links with typo'd tab now self-correct).
      if (raw !== '' && typeof window !== 'undefined') {
        const params = new URLSearchParams(search);
        params.set('tab', DEFAULT_TAB);
        // Use setTimeout to avoid triggering render mid-snapshot.
        setTimeout(() => {
          window.history.replaceState({}, '', '?' + params.toString());
          window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
        }, 0);
      }
    }
  }
  return _lastTab;
}

function getTabServerSnapshot(): TabKey {
  return DEFAULT_TAB;
}

function useActiveTab(): TabKey {
  return useSyncExternalStore(subscribeToUrl, getTabSnapshot, getTabServerSnapshot);
}

/** Navigate to a tab by updating ?tab= in the URL. */
function setTab(key: TabKey): void {
  const params = new URLSearchParams(window.location.search);
  params.set('tab', key);
  window.history.pushState({}, '', '?' + params.toString());
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AdminTenantRow['status'] }) {
  if (status === 'ACTIVE') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ background: '#dcfce7', color: '#166534' }}
      >
        ● Aktif
      </span>
    );
  }
  if (status === 'SUSPENDED') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ background: '#fee2e2', color: '#991b1b' }}
      >
        ● Suspended
      </span>
    );
  }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: '#f1f5f9', color: '#64748b' }}
    >
      ● {status}
    </span>
  );
}

// ─── TenantDetailShell ────────────────────────────────────────────────────────

interface TenantDetailShellProps {
  tenantSlug: string;
}

export function TenantDetailShell({ tenantSlug }: TenantDetailShellProps) {
  const activeTab = useActiveTab();

  const [tenant, setTenant] = useState<AdminTenantRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [superAdmin, setSuperAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    isSuperAdmin().then(setSuperAdmin);
  }, []);

  // Cancel in-flight requests when tenantSlug changes or component unmounts.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    setTenant(null);
    setNotFound(false);

    (async () => {
      try {
        // Fetch all tenants (client-side find by slug).
        // Wave 2+ TODO: add server-side slug filter to list_tenants_admin RPC
        // to avoid fetching all rows. Currently safe: only 1 tenant in prod.
        const rows = await listTenantsAdmin({ page_size: 200 });
        if (cancelledRef.current) return;
        const match = rows.find((r) => r.slug === tenantSlug) ?? null;
        setTenant(match);
        setNotFound(match === null);
      } catch (err) {
        if (cancelledRef.current) return;
        adminToast.error('Gagal memuat detail tenant', String(err));
        setNotFound(true);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [tenantSlug, refreshKey]);

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="text-[13px] animate-pulse py-4"
        style={{ color: '#9DB2CE' }}
        data-testid="tenant-detail-loading"
      >
        Memuat tenant…
      </div>
    );
  }

  // ─── Not-found state ───────────────────────────────────────────────────────

  if (notFound || !tenant) {
    return (
      <div
        className="border rounded-sm p-8 text-center"
        style={{ background: '#ffffff', borderColor: '#ECEEF1' }}
        data-testid="tenant-not-found"
      >
        <p
          className="text-[14px] font-semibold mb-2"
          style={{ color: '#0B2545' }}
        >
          Tenant tidak ditemukan
        </p>
        <p className="text-[13px] mb-4" style={{ color: '#5A6472' }}>
          Slug{' '}
          <code
            className="font-mono px-1.5 py-0.5 rounded text-[12px]"
            style={{ background: '#f1f5f9', color: '#14161B' }}
          >
            {tenantSlug}
          </code>{' '}
          tidak ditemukan dalam sistem.
        </p>
        <a
          href="/admin/tenants"
          onClick={(e) => handleAdminSPAClick(e, '/admin/tenants')}
          className="inline-block rounded-sm px-5 py-2 text-[13px] font-semibold transition-opacity hover:opacity-80"
          style={{ background: '#0B2545', color: '#ffffff' }}
        >
          ← Kembali ke daftar tenant
        </a>
      </div>
    );
  }

  // ─── Tenant found ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-caleo" data-testid="tenant-detail-shell">
      {/* Breadcrumb */}
      <nav className="text-[12px]" style={{ color: '#9DB2CE' }} aria-label="Breadcrumb">
        <a
          href="/admin/tenants"
          onClick={(e) => handleAdminSPAClick(e, '/admin/tenants')}
          className="hover:underline"
          style={{ color: '#9DB2CE' }}
        >
          Tenant
        </a>
        <span className="mx-1.5">›</span>
        <span
          className="font-mono"
          style={{ color: '#0B2545', fontFamily: 'JetBrains Mono, monospace' }}
        >
          {tenant.slug}
        </span>
      </nav>

      {/* Tenant header */}
      <div
        className="border rounded-sm px-5 py-4 flex flex-wrap justify-between items-start gap-3"
        style={{ background: '#ffffff', borderColor: '#ECEEF1' }}
      >
        <div>
          <h1
            className="text-[16px] font-bold flex flex-wrap items-center gap-2"
            style={{ color: '#0B2545' }}
          >
            {tenant.name}
            {tenant.plan_code && (
              <span
                className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: '#e0effe', color: '#2A6FDB' }}
              >
                {tenant.plan_code}
              </span>
            )}
            <StatusBadge status={tenant.status} />
          </h1>
          <p
            className="text-[12px] mt-1"
            style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
          >
            app.caleo.id/t/{tenant.slug}
            {tenant.expires_at && (
              <span style={{ color: '#5A6472' }}>
                {' '}· exp {tenant.expires_at}
                {tenant.days_until_expiry !== null && tenant.days_until_expiry <= 45 && (
                  <span
                    className="ml-1 font-semibold"
                    style={{ color: '#C0392B' }}
                  >
                    ({tenant.days_until_expiry}h) ⚠
                  </span>
                )}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Tab strip */}
      <div
        className="flex gap-0 border-b text-[13px]"
        style={{ borderColor: '#ECEEF1' }}
        role="tablist"
        aria-label="Tab navigasi tenant"
      >
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.key}`}
              onClick={() => setTab(t.key)}
              className="px-4 pb-2.5 pt-2 -mb-px border-b-2 font-medium transition-colors"
              style={{
                borderBottomColor: isActive ? '#0B2545' : 'transparent',
                color: isActive ? '#0B2545' : '#9DB2CE',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab panels */}
      <div
        id={`tabpanel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={activeTab}
      >
        {activeTab === 'ringkasan' && (
          <OverviewTab
            tenant={tenant}
            onDataChange={() => setRefreshKey((k) => k + 1)}
          />
        )}
        {activeTab === 'pengguna' && <UsersTab tenantId={tenant.tenant_id} />}
        {activeTab === 'log-aktivitas' && <AuditTab tenantId={tenant.tenant_id} />}
        {activeTab === 'pembayaran' && (
          <PembayaranTab
            tenantId={tenant.tenant_id}
            tenantSlug={tenant.slug}
            row={tenant}
          />
        )}
      </div>

      {/* Pengaturan Modul — visible to both roles */}
      <ModuleTogglePanel tenantId={tenant.tenant_id} />

      {/* Zona Bahaya — super_admin only */}
      {superAdmin && (
        <TenantDangerZone
          tenant={tenant}
          onDeleted={() => {
            // Tenant no longer exists — redirect to list.
            window.location.href = '/admin/tenants';
          }}
        />
      )}
    </div>
  );
}
