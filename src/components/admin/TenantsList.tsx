// src/components/admin/TenantsList.tsx
// /admin/tenants — searchable, filterable, sortable, paginated tenant list.
// Integrates impersonation (Phase A RPC preserved from AdminShell).
// No react-router-dom — uses native <a href> (project pattern).
import { useEffect, useRef, useState } from 'react';
import { listTenantsAdmin } from '../../lib/adminApi';
import type { AdminTenantRow, PlanCode, TenantStatus, TenantsListFilters } from '../../lib/adminTypes';
import { tenantContextService } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';
import { TenantsTable } from './TenantsTable';
import type { SortBy } from './TenantsTable';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
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
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      adminToast.error('Gagal memuat daftar tenant', msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, planCode, status, expiryWithinDays, sortBy, sortDir, page]);

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
      const msg = err instanceof Error ? err.message : String(err);
      adminToast.error(`Gagal impersonasi tenant "${slug}"`, msg);
      setImpersonating(null);
    }
  }

  // ─── Pagination helpers ─────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-vosi">
      {/* Page header */}
      <div className="flex justify-between items-center">
        <div>
          <h1
            className="text-[16px] font-bold"
            style={{ color: '#0B2545' }}
          >
            Tenant
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: '#9DB2CE' }}>
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
          className="flex-1 min-w-[200px] border rounded-xl px-3 py-1.5 text-[13px] focus:outline-none"
          style={{ borderColor: '#D3D8E0', color: '#14161B' }}
          aria-label="Cari slug atau nama"
        />

        {/* Plan filter */}
        <select
          value={planCode}
          onChange={(e) => handleFilterChange(setPlanCode)(e.target.value as PlanCode | '')}
          className="border rounded-xl px-3 py-1.5 text-[13px] focus:outline-none"
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
          className="border rounded-xl px-3 py-1.5 text-[13px] focus:outline-none"
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
          className="border rounded-xl px-3 py-1.5 text-[13px] focus:outline-none"
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
          className="border rounded-xl px-4 py-3 text-[13px] flex items-center justify-between"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
          data-testid="tenants-error"
        >
          <span>Gagal memuat tenant: {error}</span>
          <button
            onClick={() => fetchTenants()}
            className="ml-4 px-3 py-1 rounded-lg border font-medium text-[12px] hover:opacity-80"
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
        />
      )}

      {/* Pagination */}
      {!loading && totalCount > PAGE_SIZE && (
        <div
          className="flex justify-between items-center text-[12px]"
          style={{ color: '#9DB2CE' }}
        >
          <span>
            Halaman {clampedPage} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={clampedPage <= 1}
              onClick={() => setPage(clampedPage - 1)}
              className="border rounded-xl px-3 py-1 font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: '#D3D8E0', color: '#0B2545' }}
              aria-label="Halaman sebelumnya"
            >
              ← Sebelumnya
            </button>
            <button
              disabled={clampedPage >= totalPages}
              onClick={() => setPage(clampedPage + 1)}
              className="border rounded-xl px-3 py-1 font-medium transition-opacity disabled:opacity-40"
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
