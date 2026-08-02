// src/components/admin/TenantDetail/UsersTab.tsx
// Read-only staff list for a single tenant (Phase B Wave 1 Task 12).
// Table follows TenantsTable primitive: navy header, cream zebra rows, cream hover.
// Bahasa Indonesia labels. No add/remove/edit actions — Wave 1 is read-only.

import { useEffect, useState } from 'react';
import { listTenantUsersAdmin } from '../../../lib/adminApi';
import type { TenantUserRow } from '../../../lib/adminTypes';
import { adminToast } from '../../../lib/adminToast';

// ─── VOSI color constants (matches OverviewTab + TenantsTable) ────────────────

const C = {
  navy:    '#0B2545',
  gold:    '#F9B233',
  cream:   '#FAF7F0',
  slate:   '#5A6472',
  muted:   '#9DB2CE',
  surface: '#ECEEF1',
  ink:     '#14161B',
  success: '#1F8A5B',
  danger:  '#C0392B',
  info:    '#2A6FDB',
} as const;

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: TenantUserRow['role'] }) {
  const cfg: Record<TenantUserRow['role'], { bg: string; color: string }> = {
    owner:  { bg: '#dcfce7', color: '#166534' },
    admin:  { bg: '#dbeafe', color: '#1e40af' },
    staff:  { bg: '#f1f5f9', color: '#64748b' },
    kasir:  { bg: '#fef9c3', color: '#854d0e' },
  };
  const s = cfg[role] ?? cfg.staff;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-caleo-11 font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {role}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TenantUserRow['status'] }) {
  if (status === 'ACTIVE') {
    return (
      <span
        className="inline-block px-2 py-0.5 rounded-full text-caleo-11 font-semibold"
        style={{ background: '#dcfce7', color: '#166534' }}
      >
        aktif
      </span>
    );
  }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-caleo-11 font-semibold"
      style={{ background: '#fee2e2', color: '#991b1b' }}
    >
      disabled
    </span>
  );
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return '–';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day:   '2-digit',
      month: 'short',
      year:  'numeric',
      hour:  '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day:   '2-digit',
      month: 'short',
      year:  'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── UsersTab ─────────────────────────────────────────────────────────────────

interface Props {
  tenantId: string;
}

export function UsersTab({ tenantId }: Props) {
  const [users, setUsers]     = useState<TenantUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const rows = await listTenantUsersAdmin(tenantId);
        if (!cancelled) setUsers(rows);
      } catch (err) {
        if (!cancelled) {
          const msg = String(err);
          setError(msg);
          adminToast.error('Gagal memuat daftar pengguna', msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId]);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="text-caleo-13 animate-pulse py-4"
        style={{ color: C.muted }}
        data-testid="users-tab-loading"
      >
        Memuat pengguna…
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <div
        className="border rounded p-6 text-center"
        style={{ background: '#fff5f5', borderColor: '#fecaca' }}
        data-testid="users-tab-error"
      >
        <p className="text-caleo-13 font-semibold mb-1" style={{ color: C.danger }}>
          Gagal memuat daftar pengguna
        </p>
        <p className="text-xs" style={{ color: C.slate }}>
          {error}
        </p>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────

  if (users.length === 0) {
    return (
      <div
        className="border rounded p-8 text-center text-caleo-13"
        style={{ borderColor: C.surface, color: C.muted }}
        data-testid="users-tab-empty"
      >
        <p className="font-medium" style={{ color: C.slate }}>
          Belum ada pengguna terdaftar
        </p>
        <p className="mt-1 text-xs">
          Tenant ini belum memiliki staf yang terdaftar di sistem.
        </p>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="users-tab">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: C.navy }}>
          Pengguna ({users.length})
        </span>
        <span className="text-caleo-11" style={{ color: C.muted }}>
          Read-only — tambah/hapus/edit tersedia di Wave 4
        </span>
      </div>

      {/* Table */}
      <div
        className="border rounded overflow-hidden"
        style={{ borderColor: C.surface }}
      >
        <table
          className="w-full text-xs"
          style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
        >
          <thead>
            <tr style={{ background: C.navy }}>
              {(
                [
                  'Nama',
                  'Email',
                  'Peran',
                  'Status',
                  'Login terakhir',
                  'Bergabung sejak',
                ] as const
              ).map((label) => (
                <th
                  key={label}
                  className="text-left px-3 py-2 text-caleo-11 font-bold uppercase tracking-widest whitespace-nowrap"
                  style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr
                key={u.user_id}
                style={{
                  background: idx % 2 === 0 ? '#ffffff' : C.cream,
                  borderTop: `1px solid ${C.surface}`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    'rgba(250,247,240,0.8)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    idx % 2 === 0 ? '#ffffff' : C.cream;
                }}
              >
                {/* Nama */}
                <td className="px-3 py-2 font-semibold" style={{ color: C.navy }}>
                  {u.full_name}
                </td>

                {/* Email */}
                <td
                  className="px-3 py-2"
                  style={{ color: C.slate, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}
                >
                  {u.email}
                </td>

                {/* Peran */}
                <td className="px-3 py-2">
                  <RoleBadge role={u.role} />
                </td>

                {/* Status */}
                <td className="px-3 py-2">
                  <StatusBadge status={u.status} />
                </td>

                {/* Login terakhir */}
                <td
                  className="px-3 py-2 text-caleo-11"
                  style={{ color: u.last_sign_in_at ? C.slate : C.muted }}
                >
                  {fmtDateTime(u.last_sign_in_at)}
                </td>

                {/* Bergabung sejak */}
                <td className="px-3 py-2 text-caleo-11" style={{ color: C.slate }}>
                  {fmtDate(u.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
