// src/components/admin/TenantsList.tsx
// /admin/tenants — searchable, filterable, sortable, paginated tenant list.
// Integrates impersonation (Phase A RPC preserved from AdminShell).
// No react-router-dom — uses native <a href> (project pattern).
import { useEffect, useRef, useState } from 'react';
import { listTenantsAdmin } from '../../lib/adminApi';
import type { AdminTenantRow, PlanCode, TenantStatus, TenantsListFilters } from '../../lib/adminTypes';
import { supabase, tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';
import { isSuperAdmin } from '../../lib/adminAuth';
import { TenantsTable } from './TenantsTable';
import type { SortBy, ImpersonationAccessStatus } from './TenantsTable';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="border rounded overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-10 animate-pulse"
          style={{ background: i % 2 === 0 ? '#ECEEF1' : '#f8f9fa', borderBottom: '1px solid #ECEEF1' }}
        />
      ))}
    </div>
  );
}

// ─── TenantsList ──────────────────────────────────────────────────────────────

export function TenantsList() {
  // Filter state
  const [searchInput, setSearchInput] = useState('');
  const [planCode, setPlanCode] = useState<PlanCode | ''>('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [expiryWithinDays, setExpiryWithinDays] = useState<'' | '30' | '90'>('');

  // Sort state
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [page, setPage] = useState(1);

  // Data state
  const [rows, setRows] = useState<AdminTenantRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Impersonation state
  const [impersonating, setImpersonating] = useState<string | null>(null);
  // Super-admin-only gate for the "Impersonasi" button. Backend `impersonate_tenant`
  // RPC is narrowed to super_admin (20261115000034); frontend needs to match so
  // sales_reps don't see a UI action that always errors.
  const [canImpersonate, setCanImpersonate] = useState(false);
  useEffect(() => {
    let cancelled = false;
    isSuperAdmin().then((v) => { if (!cancelled) setCanImpersonate(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Per-tenant impersonation access status (F-10 Phase 2c). Fetched after
  // the tenant list loads. Slugs with 'native' or 'grant' status allow the
  // Impersonate button; 'blocked' disables it with tooltip.
  const [accessStatus, setAccessStatus] = useState<Map<string, ImpersonationAccessStatus>>(
    new Map()
  );

  // Refresh key — bumped after suspend/activate to re-fetch current page
  const [refreshKey, setRefreshKey] = useState(0);

  // Debounced search — separate from immediate filter changes
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, DEBOUNCE_MS);
  }

  function handleFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  function handleSort(col: string) {
    const isValidSort = (c: string): c is SortBy =>
      ['name', 'created_at', 'plan_code', 'expires_at', 'last_login_at'].includes(c);
    if (!isValidSort(col)) return;
    if (sortBy === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  }

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  function buildFilters(): TenantsListFilters {
    const f: TenantsListFilters = {};
    if (debouncedSearch) f.search = debouncedSearch;
    if (planCode) f.plan_code = planCode;
    if (status) f.status = status;
    if (expiryWithinDays) f.expiry_within_days = Number(expiryWithinDays);
    f.sort_by = sortBy;
    f.sort_dir = sortDir;
    f.page = page;
    f.page_size = PAGE_SIZE;
    return f;
  }

  async function fetchTenants() {
    setLoading(true);
    setError(null);
    try {
      const filters = buildFilters();
      const data = await listTenantsAdmin(filters);
      setRows(data);
      setTotalCount(data[0]?.total_count ?? 0);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      adminToast.error('Gagal memuat daftar tenant', msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, planCode, status, expiryWithinDays, sortBy, sortDir, page, refreshKey]);

  // ─── Access status fetch (F-10 Phase 2c) ────────────────────────────────────
  // After the tenant list resolves, look up the caller's impersonation
  // access status for each visible slug. Batched RPC returns
  // (slug, status, expires_at). Un-mapped slugs default to 'blocked'.
  useEffect(() => {
    if (!canImpersonate || rows.length === 0 || !supabase) {
      setAccessStatus(new Map());
      return;
    }
    let cancelled = false;
    const slugs = rows.map((r) => r.slug);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('admin_impersonation_access_status', {
          p_slugs: slugs,
        });
        if (cancelled) return;
        if (error) {
          captureError(error, { feature: 'admin_tenants', action: 'check_impersonation_access_status' });
          return;
        }
        // The RPC returns OUT columns prefixed `out_` to avoid a Postgres
        // 42702 ambiguity between the RETURNS TABLE variable and the
        // `status` / `slug` columns on platform_admins / tenants / tenant_users.
        // Remap to the shape our type expects.
        const map = new Map<string, ImpersonationAccessStatus>();
        for (const row of (data ?? []) as Array<{
          out_slug: string;
          out_status: 'native' | 'grant' | 'blocked';
          out_expires_at: string | null;
        }>) {
          map.set(row.out_slug, {
            status: row.out_status,
            expires_at: row.out_expires_at,
          });
        }
        setAccessStatus(map);
      } catch (err) {
        captureError(err, { feature: 'admin_tenants', action: 'fetch_access_status' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, canImpersonate]);

  // ─── Impersonation ──────────────────────────────────────────────────────────

  async function handleImpersonate(slug: string) {
    const confirmed = window.confirm(`Impersonasi tenant "${slug}"?`);
    if (!confirmed) return;
    setImpersonating(slug);
    try {
      await tenantContextService.impersonateTenant(slug);
      // Full-page reload so JWT refresh picks up impersonation claims (Phase A pattern)
      window.location.href = `/t/${slug}/dashboard`;
    } catch (err) {
      const msg = extractErrorMessage(err);
      // F-10: humanize the grant-related errors so admins know what to do.
      let userMsg = msg;
      if (msg.includes('IMPERSONATION_NOT_GRANTED')) {
        userMsg =
          'Belum ada grant aktif dari tenant. Minta owner untuk kasih akses lewat Pengaturan → Support Access.';
      } else if (msg.includes('NOT_PLATFORM_ADMIN')) {
        userMsg = 'Akun tidak terdaftar sebagai platform admin aktif.';
      } else if (msg.includes('TENANT_NOT_FOUND')) {
        userMsg = 'Tenant tidak ditemukan atau sedang tidak aktif.';
      }
      adminToast.error(`Gagal impersonasi "${slug}"`, userMsg);
      setImpersonating(null);
    }
  }

  // ─── Pagination helpers ─────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-caleo">
      {/* Page header */}
      <div className="flex justify-between items-center">
        <div>
          <h1
            className="text-base font-bold"
            style={{ color: '#0B2545' }}
          >
            Tenant
          </h1>
          <p className="text-caleo-13 mt-0.5" style={{ color: '#9DB2CE' }}>
            {loading ? 'Memuat…' : `${totalCount} tenant ditemukan`}
          </p>
        </div>
      </div>

      {/* Search + filters bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <input
          type="text"
          placeholder="Cari slug / nama tenant…"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 min-w-[200px] border rounded px-3 py-1.5 text-caleo-13 focus-visible:outline-none"
          style={{ borderColor: '#D3D8E0', color: '#14161B' }}
          aria-label="Cari slug atau nama"
        />

        {/* Plan filter */}
        <select
          value={planCode}
          onChange={(e) => handleFilterChange(setPlanCode)(e.target.value as PlanCode | '')}
          className="border rounded px-3 py-1.5 text-caleo-13 focus-visible:outline-none"
          style={{ borderColor: '#D3D8E0', color: '#14161B' }}
          aria-label="Filter paket"
        >
          <option value="">Semua paket</option>
          <option value="STARTER">STARTER</option>
          <option value="PRO">PRO</option>
          <option value="PREMIUM">PREMIUM</option>
        </select>

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => handleFilterChange(setStatus)(e.target.value as TenantStatus | '')}
          className="border rounded px-3 py-1.5 text-caleo-13 focus-visible:outline-none"
          style={{ borderColor: '#D3D8E0', color: '#14161B' }}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        {/* Expiry filter */}
        <select
          value={expiryWithinDays}
          onChange={(e) => handleFilterChange(setExpiryWithinDays)(e.target.value as '' | '30' | '90')}
          className="border rounded px-3 py-1.5 text-caleo-13 focus-visible:outline-none"
          style={{ borderColor: '#D3D8E0', color: '#14161B' }}
          aria-label="Filter kedaluwarsa"
        >
          <option value="">Semua kedaluwarsa</option>
          <option value="30">Kedaluwarsa &lt;30 hari</option>
          <option value="90">Kedaluwarsa &lt;90 hari</option>
        </select>
      </div>

      {/* Error inline retry */}
      {error && !loading && (
        <div
          className="border rounded px-4 py-3 text-caleo-13 flex items-center justify-between"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
          data-testid="tenants-error"
        >
          <span>Gagal memuat tenant: {error}</span>
          <button
            onClick={() => fetchTenants()}
            className="ml-4 px-3 py-1 rounded border font-medium text-xs hover:opacity-80"
            style={{ borderColor: '#991b1b', color: '#991b1b' }}
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <SkeletonRows />
      ) : (
        <TenantsTable
          rows={rows}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          onImpersonate={handleImpersonate}
          impersonating={impersonating}
          canImpersonate={canImpersonate}
          accessStatus={accessStatus}
          onRowActionSuccess={() => setRefreshKey((k) => k + 1)}
        />
      )}

      {/* Pagination */}
      {!loading && totalCount > PAGE_SIZE && (
        <div
          className="flex justify-between items-center text-xs"
          style={{ color: '#9DB2CE' }}
        >
          <span>
            Halaman {clampedPage} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={clampedPage <= 1}
              onClick={() => setPage(clampedPage - 1)}
              className="border rounded px-3 py-1 font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Halaman sebelumnya"
            >
              ← Sebelumnya
            </button>
            <button
              disabled={clampedPage >= totalPages}
              onClick={() => setPage(clampedPage + 1)}
              className="border rounded px-3 py-1 font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Halaman selanjutnya"
            >
              Selanjutnya →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
