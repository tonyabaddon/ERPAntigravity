// src/components/admin/AuditLogViewer.tsx
// Global audit log viewer at /admin/audit.
// Filters: action_code, actor (email), date range (from_ts/to_ts), free-text search.
// Debounced search (300ms), pagination, expandable JSONB detail rows.
// VOSI Design System: navy header, cream zebra rows, gold focal on Aksi column.
// Bahasa Indonesia labels throughout.
import { useEffect, useMemo, useRef, useState } from 'react';
import { listAuditEvents } from '../../lib/adminApi';
import type { AuditEventRow, AuditListFilters } from '../../lib/adminTypes';
import { adminToast } from '../../lib/adminToast';
import { AuditTable, AuditTableSkeleton } from './AuditTable';
import { wibDateString } from '../../lib/format';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

const ACTION_OPTIONS = [
  '',
  'IMPERSONATE_START',
  'IMPERSONATE_END',
  'CREATE_TENANT',
  'CHANGE_PLAN',
  'CHANGE_FEATURES',
  'RENEW_SUBSCRIPTION',
  'SEND_OWNER_INVITE',
  'IMPORT_COMMIT',
  'SUSPEND',
  'ACTIVATE',
] as const;

// ─── VOSI colors ──────────────────────────────────────────────────────────────

const C = {
  navy:    '#0B2545',
  gold:    '#F9B233',
  cream:   '#FAF7F0',
  slate:   '#5A6472',
  muted:   '#9DB2CE',
  surface: '#ECEEF1',
  ink:     '#14161B',
  danger:  '#C0392B',
} as const;

// ─── CSV export helper ────────────────────────────────────────────────────────

function buildCsv(events: AuditEventRow[]): string {
  const header = 'timestamp,admin,tenant,action_code,detail\n';
  const body = events
    .map((e) =>
      [
        e.ts,
        `"${(e.admin_email ?? '').replaceAll('"', '""')}"`,
        `"${(e.tenant_slug ?? '').replaceAll('"', '""')}"`,
        e.action_code,
        `"${JSON.stringify(e.detail ?? {}).replaceAll('"', '""')}"`,
      ].join(',')
    )
    .join('\n');
  return header + body;
}

function downloadCsv(events: AuditEventRow[]): void {
  const blob = new Blob([buildCsv(events)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${wibDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── AuditLogViewer ───────────────────────────────────────────────────────────

export function AuditLogViewer() {
  // Filter state
  const [actionCode, setActionCode]   = useState('');
  const [actorInput, setActorInput]   = useState('');
  const [debouncedActor, setDebouncedActor] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fromDate, setFromDate]       = useState('');
  const [toDate, setToDate]           = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  // Data state
  const [events, setEvents]   = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Debounce refs
  const actorTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleActorChange(val: string) {
    setActorInput(val);
    if (actorTimer.current) clearTimeout(actorTimer.current);
    actorTimer.current = setTimeout(() => {
      setDebouncedActor(val);
      setPage(1);
    }, DEBOUNCE_MS);
  }

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, DEBOUNCE_MS);
  }

  function handleFilterChange<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  // ── Build filter object ─────────────────────────────────────────────────────

  const filters: AuditListFilters = useMemo(() => {
    const f: AuditListFilters = {
      page,
      page_size: PAGE_SIZE,
    };
    if (actionCode)      f.action_code = actionCode;
    if (debouncedActor)  f.actor       = debouncedActor;
    if (debouncedSearch) f.search      = debouncedSearch;
    if (fromDate)        f.from_ts     = `${fromDate}T00:00:00Z`;
    if (toDate)          f.to_ts       = `${toDate}T23:59:59Z`;
    return f;
  }, [actionCode, debouncedActor, debouncedSearch, fromDate, toDate, page]);

  // ── Fetch ───────────────────────────────────────────────────────────────────

  async function fetchEvents(f: AuditListFilters): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await listAuditEvents(f);
      setEvents(data);
    } catch (err) {
      const msg = String(err);
      setError(msg);
      adminToast.error('Gagal memuat log aktivitas', msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEvents(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionCode, debouncedActor, debouncedSearch, fromDate, toDate, page]);

  // ── Pagination helpers ──────────────────────────────────────────────────────
  // We don't have a total_count on audit rows, so pagination is "has more"
  // based on whether we got a full page.
  const hasMore = events.length === PAGE_SIZE;
  const totalPages = hasMore ? page + 1 : page;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 font-caleo">
      {/* Page header */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-[16px] font-bold" style={{ color: C.navy }}>
            Log Aktivitas
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>
            {loading ? 'Memuat…' : `${events.length} entri`}
            {page > 1 && ` (halaman ${page})`}
          </p>
        </div>
        <button
          onClick={() => downloadCsv(events)}
          disabled={events.length === 0 || loading}
          className="border rounded px-3 py-1.5 text-[12px] font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ borderColor: C.surface, color: C.navy, background: '#ffffff' }}
          aria-label="Ekspor CSV"
        >
          Ekspor CSV
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap gap-2 items-end">
        {/* Action code filter */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium" style={{ color: C.slate }}>Aksi</span>
          <select
            value={actionCode}
            onChange={(e) => handleFilterChange(setActionCode)(e.target.value)}
            className="border rounded px-3 py-1.5 text-[12px] focus:outline-none"
            style={{ borderColor: C.surface, color: C.ink, minWidth: '170px' }}
            aria-label="Filter aksi"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt || 'Semua aksi'}
              </option>
            ))}
          </select>
        </label>

        {/* Actor (email) filter */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium" style={{ color: C.slate }}>Pelaku</span>
          <input
            type="text"
            placeholder="Cari email admin…"
            value={actorInput}
            onChange={(e) => handleActorChange(e.target.value)}
            className="border rounded px-3 py-1.5 text-[12px] focus:outline-none"
            style={{ borderColor: C.surface, color: C.ink, minWidth: '180px' }}
            aria-label="Filter pelaku"
          />
        </label>

        {/* Date range: Dari */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium" style={{ color: C.slate }}>Rentang tanggal</span>
          <div className="flex gap-1 items-center">
            <input
              type="date"
              placeholder="Dari"
              value={fromDate}
              onChange={(e) => {
                handleFilterChange(setFromDate)(e.target.value);
              }}
              className="border rounded px-2 py-1.5 text-[12px] focus:outline-none"
              style={{ borderColor: C.surface, color: C.ink }}
              aria-label="Dari tanggal"
            />
            <span className="text-[12px]" style={{ color: C.muted }}>–</span>
            <input
              type="date"
              placeholder="Sampai"
              value={toDate}
              onChange={(e) => {
                handleFilterChange(setToDate)(e.target.value);
              }}
              className="border rounded px-2 py-1.5 text-[12px] focus:outline-none"
              style={{ borderColor: C.surface, color: C.ink }}
              aria-label="Sampai tanggal"
            />
          </div>
        </label>

        {/* Free-text search */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium" style={{ color: C.slate }}>Cari</span>
          <input
            type="text"
            placeholder="Cari aksi / email…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="border rounded px-3 py-1.5 text-[12px] focus:outline-none"
            style={{ borderColor: C.surface, color: C.ink, minWidth: '180px' }}
            aria-label="Cari log"
          />
        </label>
      </div>

      {/* Error inline retry */}
      {error && !loading && (
        <div
          className="border rounded px-4 py-3 text-[13px] flex items-center justify-between"
          style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
          data-testid="audit-viewer-error"
        >
          <span>Gagal memuat log: {error}</span>
          <button
            onClick={() => fetchEvents(filters)}
            className="ml-4 px-3 py-1 rounded border font-medium text-[12px] hover:opacity-80"
            style={{ borderColor: C.danger, color: C.danger }}
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Table / skeleton */}
      {loading ? (
        <AuditTableSkeleton />
      ) : (
        <AuditTable events={events} />
      )}

      {/* Pagination — only shown when not loading and there's more than 1 page */}
      {!loading && (page > 1 || hasMore) && (
        <div
          className="flex justify-between items-center text-[12px]"
          style={{ color: C.muted }}
        >
          <span>
            Halaman {page} dari {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="border rounded px-3 py-1 font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: C.surface, color: C.navy }}
              aria-label="Halaman sebelumnya"
            >
              ← Sebelumnya
            </button>
            <button
              disabled={!hasMore}
              onClick={() => setPage(page + 1)}
              className="border rounded px-3 py-1 font-medium transition-opacity disabled:opacity-40"
              style={{ borderColor: C.surface, color: C.navy }}
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
