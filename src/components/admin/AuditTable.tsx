// src/components/admin/AuditTable.tsx
// Shared table primitive for audit events — used by both AuditLogViewer (global)
// and AuditTab (per-tenant). Follows TenantsTable visual shape: navy header,
// cream zebra rows, cream hover. VOSI Design System inline styles.
import { useState } from 'react';
import type { AuditEventRow } from '../../lib/adminTypes';

// ─── VOSI color constants ─────────────────────────────────────────────────────

const C = {
  navy:    '#0B2545',
  gold:    '#F9B233',
  cream:   '#FAF7F0',
  slate:   '#5A6472',
  muted:   '#9DB2CE',
  surface: '#ECEEF1',
  ink:     '#14161B',
} as const;

// ─── Action code badge ────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; color: string }> = {
  IMPERSONATE_START:   { bg: '#fef9c3', color: '#854d0e' },
  IMPERSONATE_END:     { bg: '#fef9c3', color: '#854d0e' },
  CREATE_TENANT:       { bg: '#dbeafe', color: '#1e40af' },
  CHANGE_PLAN:         { bg: '#dcfce7', color: '#166534' },
  CHANGE_FEATURES:     { bg: '#dcfce7', color: '#166534' },
  RENEW_SUBSCRIPTION:  { bg: '#dcfce7', color: '#166534' },
  SEND_OWNER_INVITE:   { bg: '#dbeafe', color: '#1e40af' },
  IMPORT_COMMIT:       { bg: '#dbeafe', color: '#1e40af' },
  SUSPEND:             { bg: '#fee2e2', color: '#991b1b' },
  ACTIVATE:            { bg: '#dcfce7', color: '#166534' },
};

const DEFAULT_ACTION_STYLE = { bg: '#f1f5f9', color: '#64748b' };

function ActionBadge({ code }: { code: string }) {
  const s = ACTION_STYLES[code] ?? DEFAULT_ACTION_STYLE;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {code}
    </span>
  );
}

// ─── Detail cell — collapsed JSONB, click to expand inline ───────────────────

function DetailCell({ detail }: { detail: Record<string, unknown> | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!detail || Object.keys(detail).length === 0) {
    return <span style={{ color: C.muted }}>—</span>;
  }

  const summary = JSON.stringify(detail);
  const truncated = summary.length > 60 ? summary.slice(0, 57) + '…' : summary;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-left font-mono truncate max-w-[220px] block hover:underline"
        style={{ color: C.slate, fontSize: '11px' }}
        title="Klik untuk melihat detail"
        aria-label="Tampilkan detail JSON"
      >
        {truncated}
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <pre
        className="text-[11px] rounded p-2 overflow-auto max-w-[340px] max-h-[160px] whitespace-pre-wrap break-words"
        style={{ background: '#f8f9fa', color: C.ink, border: `1px solid ${C.surface}` }}
      >
        {JSON.stringify(detail, null, 2)}
      </pre>
      <button
        onClick={() => setExpanded(false)}
        className="text-[11px] hover:underline"
        style={{ color: C.muted }}
      >
        Tutup
      </button>
    </div>
  );
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

export function AuditTableSkeleton() {
  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: C.surface }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-10 animate-pulse"
          style={{
            background: i % 2 === 0 ? C.surface : '#f8f9fa',
            borderBottom: `1px solid ${C.surface}`,
          }}
        />
      ))}
    </div>
  );
}

// ─── AuditTable ───────────────────────────────────────────────────────────────

interface AuditTableProps {
  events: AuditEventRow[];
  /** When true, hide the Tenant column (used inside AuditTab where tenant is fixed) */
  hideTenant?: boolean;
}

export function AuditTable({ events, hideTenant = false }: AuditTableProps) {
  if (events.length === 0) {
    return (
      <div
        className="border rounded-xl p-8 text-center"
        style={{ borderColor: C.surface, color: C.muted }}
        data-testid="audit-table-empty"
      >
        <p className="text-[13px] font-medium" style={{ color: C.slate }}>
          Belum ada aktivitas
        </p>
        <p className="mt-1 text-[12px]">
          Riwayat audit akan muncul di sini setelah ada aksi admin.
        </p>
      </div>
    );
  }

  return (
    <div
      className="border rounded-xl overflow-hidden"
      style={{ borderColor: C.surface }}
      data-testid="audit-table"
    >
      <table
        className="w-full"
        style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: '12px' }}
      >
        <thead>
          <tr style={{ background: C.navy }}>
            <th
              className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
            >
              Waktu
            </th>
            <th
              className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
            >
              Pelaku
            </th>
            {!hideTenant && (
              <th
                className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
                style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
              >
                Tenant
              </th>
            )}
            <th
              className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap"
              style={{ color: C.gold, fontFamily: 'JetBrains Mono, monospace' }}
            >
              Aksi
            </th>
            <th
              className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
            >
              Detail
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, idx) => (
            <tr
              key={e.id}
              style={{
                background: idx % 2 === 0 ? '#ffffff' : C.cream,
                borderTop: `1px solid ${C.surface}`,
              }}
              onMouseEnter={(ev) => {
                (ev.currentTarget as HTMLTableRowElement).style.background =
                  'rgba(250,247,240,0.8)';
              }}
              onMouseLeave={(ev) => {
                (ev.currentTarget as HTMLTableRowElement).style.background =
                  idx % 2 === 0 ? '#ffffff' : C.cream;
              }}
            >
              {/* Waktu */}
              <td
                className="px-3 py-2 whitespace-nowrap"
                style={{ color: C.slate, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}
              >
                {fmtDateTime(e.ts)}
              </td>

              {/* Pelaku */}
              <td
                className="px-3 py-2"
                style={{ color: C.slate, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}
              >
                {e.admin_email || <span style={{ color: C.muted }}>—</span>}
              </td>

              {/* Tenant (hidden in per-tenant view) */}
              {!hideTenant && (
                <td
                  className="px-3 py-2 font-mono"
                  style={{ color: C.slate, fontSize: '11px' }}
                >
                  {e.tenant_slug ?? <span style={{ color: C.muted }}>—</span>}
                </td>
              )}

              {/* Aksi */}
              <td className="px-3 py-2">
                <ActionBadge code={e.action_code} />
              </td>

              {/* Detail */}
              <td className="px-3 py-2" style={{ maxWidth: '280px' }}>
                <DetailCell detail={e.detail} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
