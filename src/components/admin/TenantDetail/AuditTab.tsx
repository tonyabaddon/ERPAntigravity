// src/components/admin/TenantDetail/AuditTab.tsx
// Per-tenant audit timeline — pinned to tenant_id from TenantDetailShell.
// Uses shared AuditTable primitive. hideTenant=true since context is clear.
import { useEffect, useState } from 'react';
import { listAuditEvents } from '../../../lib/adminApi';
import type { AuditEventRow } from '../../../lib/adminTypes';
import { adminToast } from '../../../lib/adminToast';
import { AuditTable, AuditTableSkeleton } from '../AuditTable';

const C = {
  navy:  '#0B2545',
  muted: '#9DB2CE',
  slate: '#5A6472',
  danger: '#C0392B',
  surface: '#ECEEF1',
} as const;

interface Props {
  tenantId: string;
}

export function AuditTab({ tenantId }: Props) {
  const [events, setEvents]   = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await listAuditEvents({
          tenant_id: tenantId,
          page_size:  100,
          page:       1,
        });
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) {
          const msg = String(err);
          setError(msg);
          adminToast.error('Gagal memuat log aktivitas', msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3" data-testid="audit-tab-loading">
        <div
          className="text-[12px] animate-pulse"
          style={{ color: C.muted }}
        >
          Memuat log aktivitas…
        </div>
        <AuditTableSkeleton />
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  if (error !== null) {
    return (
      <div
        className="border rounded-xl p-6 text-center"
        style={{ background: '#fff5f5', borderColor: '#fecaca' }}
        data-testid="audit-tab-error"
      >
        <p className="text-[13px] font-semibold mb-1" style={{ color: C.danger }}>
          Gagal memuat log aktivitas
        </p>
        <p className="text-[12px] mb-3" style={{ color: C.slate }}>
          {error}
        </p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            listAuditEvents({ tenant_id: tenantId, page_size: 100, page: 1 })
              .then((data) => setEvents(data))
              .catch((err) => {
                const msg = String(err);
                setError(msg);
                adminToast.error('Gagal memuat log aktivitas', msg);
              })
              .finally(() => setLoading(false));
          }}
          className="rounded-xl px-4 py-1.5 text-[12px] font-semibold border transition-opacity hover:opacity-80"
          style={{ borderColor: C.danger, color: C.danger }}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  // ── Table ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3" data-testid="audit-tab">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold" style={{ color: C.navy }}>
          Log aktivitas ({events.length})
        </span>
        <span className="text-[11px]" style={{ color: C.muted }}>
          100 entri terbaru
        </span>
      </div>
      <AuditTable events={events} hideTenant />
    </div>
  );
}
