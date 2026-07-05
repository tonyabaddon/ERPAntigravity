// src/components/admin/AttentionQueue.tsx
// Attention queue: expiring <45d + suspended tenants shown as actionable items.
// When queue is empty, renders "Semua tenteram" empty state.
// Uses native <a href> — project has no react-router-dom (custom urlRoute.ts pattern).
import type { AdminTenantRow } from '../../lib/adminTypes';

interface Props {
  expiringTenants: AdminTenantRow[];
  suspendedTenants: AdminTenantRow[];
}

export function AttentionQueue({ expiringTenants, suspendedTenants }: Props) {
  const total = expiringTenants.length + suspendedTenants.length;

  if (total === 0) {
    return (
      <div
        className="border rounded-xl px-4 py-3 text-[13px]"
        style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}
        data-testid="attention-queue-empty"
      >
        Semua tenteram — tidak ada tenant yang butuh perhatian sekarang.
      </div>
    );
  }

  return (
    <div className="border rounded-xl overflow-hidden" style={{ borderColor: '#fcd34d' }}>
      {/* Header */}
      <div
        className="px-4 py-2 text-[12px] font-bold uppercase tracking-widest"
        style={{
          background: '#fffbeb',
          color: '#92400e',
          fontFamily: 'JetBrains Mono, monospace',
          borderBottom: '1px solid #fcd34d',
        }}
      >
        Butuh perhatian ({total})
      </div>

      {/* Expiring tenants */}
      {expiringTenants.map((t) => (
        <div
          key={`exp-${t.tenant_id}`}
          className="px-4 py-3 flex justify-between items-center text-[13px]"
          style={{ borderBottom: '1px solid #fef3c7' }}
        >
          <div>
            <span className="font-semibold" style={{ color: '#0B2545' }}>{t.name}</span>
            <span style={{ color: '#9DB2CE' }}> — kedaluwarsa dalam </span>
            <span className="font-mono font-bold" style={{ color: '#92400e' }}>
              {t.days_until_expiry} hari
            </span>
            {t.expires_at && (
              <span style={{ color: '#9DB2CE' }}> ({t.expires_at})</span>
            )}
          </div>
          <a
            href={`/admin/tenants/${t.slug}`}
            className="text-[12px] px-3 py-1 rounded-lg border font-medium hover:opacity-80 transition-opacity"
            style={{ borderColor: '#0B2545', color: '#0B2545' }}
          >
            Detail →
          </a>
        </div>
      ))}

      {/* Suspended tenants */}
      {suspendedTenants.map((t) => (
        <div
          key={`susp-${t.tenant_id}`}
          className="px-4 py-3 flex justify-between items-center text-[13px]"
          style={{ borderBottom: '1px solid #fef3c7' }}
        >
          <div>
            <span className="font-semibold" style={{ color: '#0B2545' }}>{t.name}</span>
            <span
              className="ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold uppercase"
              style={{ background: '#fee2e2', color: '#991b1b' }}
            >
              Suspended
            </span>
          </div>
          <a
            href={`/admin/tenants/${t.slug}`}
            className="text-[12px] px-3 py-1 rounded-lg border font-medium hover:opacity-80 transition-opacity"
            style={{ borderColor: '#0B2545', color: '#0B2545' }}
          >
            Detail →
          </a>
        </div>
      ))}
    </div>
  );
}
