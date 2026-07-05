// src/components/admin/TenantsTable.tsx
// Primitive table for the /admin/tenants list.
// Uses VOSI Design System colors (inline style matching existing admin components).
// No react-router-dom — uses native <a href> (project pattern).
import type { AdminTenantRow, UsageStatus } from '../../lib/adminTypes';

// ─── Usage status badge ───────────────────────────────────────────────────────

const USAGE_BADGE: Record<UsageStatus, { label: string; bg: string; color: string }> = {
  SANGAT_AKTIF: { label: 'Sangat Aktif', bg: '#dcfce7', color: '#166534' },
  AKTIF:        { label: 'Aktif',         bg: '#dbeafe', color: '#1e40af' },
  IDLE:         { label: 'Idle',          bg: '#f1f5f9', color: '#64748b' },
  VAKUM:        { label: 'Vakum',         bg: '#fee2e2', color: '#991b1b' },
};

function UsageBadge({ status }: { status: UsageStatus }) {
  const b = USAGE_BADGE[status] ?? USAGE_BADGE.IDLE;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: b.bg, color: b.color }}
    >
      {b.label}
    </span>
  );
}

// ─── Plan badge ───────────────────────────────────────────────────────────────

function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <span style={{ color: '#9DB2CE' }}>—</span>;
  const color =
    plan === 'PREMIUM' ? '#7C5CBF'
    : plan === 'PRO'    ? '#2A6FDB'
    :                     '#5A6472';
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: `${color}18`, color }}
    >
      {plan}
    </span>
  );
}

// ─── Sort indicator ───────────────────────────────────────────────────────────

interface SortableHeaderProps {
  label: string;
  colKey: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
}

function SortableHeader({ label, colKey, sortBy, sortDir, onSort }: SortableHeaderProps) {
  const active = sortBy === colKey;
  return (
    <th
      className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap"
      style={{
        color: active ? '#F9B233' : '#9DB2CE',
        fontFamily: 'JetBrains Mono, monospace',
      }}
      onClick={() => onSort(colKey)}
    >
      {label}
      {active && (
        <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
      )}
      {!active && <span className="ml-1 opacity-30">↕</span>}
    </th>
  );
}

// ─── Impersonate action ───────────────────────────────────────────────────────

interface ImpersonateButtonProps {
  slug: string;
  name: string;
  onImpersonate: (slug: string) => void;
  impersonating: string | null;
}

function ImpersonateButton({ slug, name, onImpersonate, impersonating }: ImpersonateButtonProps) {
  const busy = impersonating === slug;
  return (
    <button
      onClick={() => onImpersonate(slug)}
      disabled={impersonating !== null}
      title={`Impersonasi ${name}`}
      className="rounded px-2 py-0.5 text-[11px] font-semibold border transition-opacity disabled:opacity-40"
      style={{
        borderColor: '#F9B233',
        color: busy ? '#F9B233' : '#0B2545',
        background: busy ? '#fffbeb' : 'transparent',
      }}
    >
      {busy ? 'Masuk…' : 'Impersonasi'}
    </button>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────

export type SortBy = 'name' | 'created_at' | 'plan_code' | 'expires_at' | 'last_login_at';

interface TenantsTableProps {
  rows: AdminTenantRow[];
  sortBy: SortBy;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  onImpersonate: (slug: string) => void;
  impersonating: string | null;
}

export function TenantsTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  onImpersonate,
  impersonating,
}: TenantsTableProps) {
  if (rows.length === 0) {
    return (
      <div
        className="border rounded-xl p-8 text-center text-[13px]"
        style={{ borderColor: '#ECEEF1', color: '#9DB2CE' }}
        data-testid="tenants-empty"
      >
        Tidak ada tenant ditemukan.
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#ECEEF1' }}>
      <table className="w-full text-[12px]" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        <thead>
          <tr style={{ background: '#0B2545' }}>
            <SortableHeader label="Nama"       colKey="name"          sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Slug</th>
            <SortableHeader label="Paket"      colKey="plan_code"     sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Status</th>
            <SortableHeader label="Kedaluwarsa" colKey="expires_at"   sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label="Login terakhir" colKey="last_login_at" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Pengguna</th>
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>SKU</th>
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Transaksi 7h</th>
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Aktifitas</th>
            <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, idx) => (
            <tr
              key={t.tenant_id}
              style={{
                background: idx % 2 === 0 ? '#ffffff' : '#FAF7F0',
                borderTop: '1px solid #ECEEF1',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(250,247,240,0.6)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLTableRowElement).style.background = idx % 2 === 0 ? '#ffffff' : '#FAF7F0';
              }}
            >
              {/* Nama — clickable link to detail */}
              <td className="px-3 py-2">
                <a
                  href={`/admin/tenants/${t.slug}`}
                  className="font-semibold hover:underline"
                  style={{ color: '#0B2545' }}
                >
                  {t.name}
                </a>
              </td>
              {/* Slug */}
              <td className="px-3 py-2 font-mono" style={{ color: '#5A6472' }}>
                {t.slug}
              </td>
              {/* Paket */}
              <td className="px-3 py-2">
                <PlanBadge plan={t.plan_code} />
              </td>
              {/* Status */}
              <td className="px-3 py-2">
                {t.status === 'ACTIVE' ? (
                  <span className="text-[12px] font-medium" style={{ color: '#1F8A5B' }}>● Aktif</span>
                ) : t.status === 'SUSPENDED' ? (
                  <span className="text-[12px] font-medium" style={{ color: '#C0392B' }}>● Suspended</span>
                ) : (
                  <span className="text-[12px] font-medium" style={{ color: '#9DB2CE' }}>● {t.status}</span>
                )}
              </td>
              {/* Kedaluwarsa */}
              <td className="px-3 py-2" style={{ color: '#5A6472' }}>
                {t.expires_at ?? <span style={{ color: '#9DB2CE' }}>—</span>}
                {t.days_until_expiry !== null && t.days_until_expiry <= 45 && (
                  <span className="ml-1 text-[11px] font-semibold" style={{ color: '#C0392B' }}>
                    ({t.days_until_expiry}h)
                  </span>
                )}
              </td>
              {/* Login terakhir */}
              <td className="px-3 py-2 text-[11px]" style={{ color: '#5A6472' }}>
                {t.last_login_at
                  ? new Date(t.last_login_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })
                  : <span style={{ color: '#9DB2CE' }}>—</span>
                }
              </td>
              {/* Pengguna */}
              <td className="px-3 py-2 font-mono text-right" style={{ color: '#0B2545' }}>
                {t.user_count}
              </td>
              {/* SKU */}
              <td className="px-3 py-2 font-mono text-right" style={{ color: '#0B2545' }}>
                {t.sku_count}
              </td>
              {/* Transaksi 7h */}
              <td className="px-3 py-2 font-mono text-right" style={{ color: '#0B2545' }}>
                {t.txn_7d}
              </td>
              {/* Aktifitas badge */}
              <td className="px-3 py-2">
                <UsageBadge status={t.usage_status} />
              </td>
              {/* Aksi */}
              <td className="px-3 py-2">
                <ImpersonateButton
                  slug={t.slug}
                  name={t.name}
                  onImpersonate={onImpersonate}
                  impersonating={impersonating}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
