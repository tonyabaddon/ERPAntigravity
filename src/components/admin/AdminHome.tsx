// src/components/admin/AdminHome.tsx
// Platform admin home screen — KPI cards, attention queue, recent activity.
// Fetches 3 RPCs in parallel: dashboard stats, tenants list, audit events.
// Uses native <a href> — project has no react-router-dom (custom urlRoute.ts pattern).
import { useEffect, useState } from 'react';
import {
  getPlatformDashboardStats,
  listTenantsAdmin,
  listAuditEvents,
} from '../../lib/adminApi';
import type { DashboardStats, AdminTenantRow, AuditEventRow } from '../../lib/adminTypes';
import { KPICard } from './KPICard';
import { AttentionQueue } from './AttentionQueue';
import { RecentActivityFeed } from './RecentActivityFeed';
import { EmptyHomeState } from './EmptyHomeState';
import { adminToast } from '../../lib/adminToast';
import { handleAdminSPAClick } from '../../lib/urlRoute';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

export function AdminHome() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [tenants, setTenants] = useState<AdminTenantRow[]>([]);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function fetchAll() {
    setLoading(true);
    setError(null);

    let cancelled = false;
    (async () => {
      // Retry the parallel fetch up to 3× with 500ms/1000ms backoff. During a
      // Supabase :5432 pool pinch (2026-07-22 incident) PostgREST intermittently
      // returns 503 PGRST002 "Could not query the database for the schema cache"
      // — one flaky RPC out of three would fail the whole Promise.all and blank
      // the entire dashboard. Retry lets the transient 5xxs pass without
      // user-visible failure. If all 3 retries still fail, surface the toast.
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const [s, t, e] = await Promise.all([
            getPlatformDashboardStats(),
            listTenantsAdmin(),
            listAuditEvents({ limit: 20 }),
          ]);
          if (cancelled) return;
          setStats(s);
          setTenants(t);
          setEvents(e);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }
      if (cancelled) return;
      if (lastErr) {
        const msg = extractErrorMessage(lastErr);
        setError(msg);
        adminToast.error('Gagal memuat dashboard', msg);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    return fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="space-y-4" data-testid="admin-home-loading">
        {/* Skeleton KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border rounded-xl p-4 animate-pulse"
              style={{ background: '#ECEEF1', borderColor: '#ECEEF1', height: '88px' }}
            />
          ))}
        </div>
        {/* Skeleton sections */}
        <div
          className="border rounded-xl p-4 animate-pulse"
          style={{ background: '#ECEEF1', borderColor: '#ECEEF1', height: '56px' }}
        />
        <div
          className="border rounded-xl p-4 animate-pulse"
          style={{ background: '#ECEEF1', borderColor: '#ECEEF1', height: '120px' }}
        />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div
        className="border rounded-xl p-5 text-[13px] flex items-center justify-between"
        style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
        data-testid="admin-home-error"
      >
        <span>Gagal memuat dashboard: {error}</span>
        <button
          onClick={() => fetchAll()}
          className="ml-4 px-3 py-1 rounded-lg border font-medium text-[12px] hover:opacity-80 transition-opacity"
          style={{ borderColor: '#991b1b', color: '#991b1b' }}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (!stats) return null;

  // AttentionQueue now fetches its own data via list_attention_tenants(45)
  // — see Wave 4a Task 8b. AdminHome no longer derives from `tenants`.
  void tenants; // Wave 4a: attention derivation moved server-side; keep var for future use.
  const showEmptyState = stats.tenants_total <= 1;

  return (
    <div className="space-y-5 font-caleo">
      {/* Page title */}
      <div className="flex justify-between items-start">
        <div>
          <h1
            className="text-[16px] font-bold"
            style={{ color: '#0B2545' }}
          >
            Beranda
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#9DB2CE' }}>
            Ringkasan platform — {stats.active_count} tenant aktif
          </p>
        </div>
        <a
          href="/admin/tenants/new"
          onClick={(e) => handleAdminSPAClick(e, '/admin/tenants/new')}
          className="rounded-xl px-4 py-2 font-semibold text-[13px] transition-opacity hover:opacity-90"
          style={{ background: '#F9B233', color: '#0B2545' }}
        >
          + Onboard tenant baru
        </a>
      </div>

      {/* KPI cards — 2 cols mobile, 4 cols desktop */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          title="Tenant aktif"
          value={stats.active_count}
        />
        <KPICard
          title="Total tenant"
          value={stats.tenants_total}
        />
        <KPICard
          title="Kedaluwarsa 45 hari"
          value={stats.expiring_45d}
          alert={stats.expiring_45d > 0}
        />
        <KPICard
          title="Impor tertunda"
          value={stats.pending_imports > 0 ? stats.pending_imports : null}
          alert={stats.pending_imports > 0}
          placeholder="Wave 3"
        />
      </div>

      {/* Secondary KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KPICard
          title="Paket tersedia"
          value={stats.plans_count}
        />
        <KPICard
          title="Suspended"
          value={stats.suspended_count}
          alert={stats.suspended_count > 0}
        />
        <KPICard
          title="MRR (est.)"
          value={null}
          placeholder="Billing Phase C"
        />
      </div>

      {/* Attention queue — shown even in empty state (just displays "Semua tenteram") */}
      <div>
        <div
          className="text-[11px] font-bold uppercase tracking-widest mb-2"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
        >
          Butuh perhatian
        </div>
        <AttentionQueue withinDays={45} />
      </div>

      {/* Recent activity feed */}
      <div>
        <RecentActivityFeed events={events} />
      </div>

      {/* Single-tenant welcome hero — shown below sections when only Garindo exists */}
      {showEmptyState && (
        <EmptyHomeState existingSlug={tenants[0]?.slug ?? 'garindo'} />
      )}
    </div>
  );
}
