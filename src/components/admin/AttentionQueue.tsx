// src/components/admin/AttentionQueue.tsx
// Wave 4a: fetches directly via list_attention_tenants(45) instead of
// receiving props from AdminHome. Server-side sort by urgency, includes
// EXPIRED_AND_SUSPENDED reason.
import { useEffect, useState, useCallback } from 'react';
import { listAttentionTenants } from '../../lib/adminApi';
import type { AttentionTenantRow, AttentionReason } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';
import { adminToast } from '../../lib/adminToast';

const REASON_LABEL: Record<AttentionReason, string> = {
  EXPIRING: 'Kedaluwarsa',
  SUSPENDED: 'Ditangguhkan',
  EXPIRED_AND_SUSPENDED: 'Kedaluwarsa & ditangguhkan',
};

function daysColor(days: number): string {
  if (days <= 0) return 'text-vosi-danger';
  if (days <= 14) return 'text-vosi-gold';
  return 'text-vosi-slate';
}

function reasonChipClass(reason: AttentionReason): string {
  if (reason === 'SUSPENDED' || reason === 'EXPIRED_AND_SUSPENDED') {
    return 'bg-vosi-danger/10 text-vosi-danger';
  }
  return 'bg-vosi-gold/15 text-vosi-navy';
}

interface Props {
  withinDays?: number;
}

export function AttentionQueue({ withinDays = 45 }: Props) {
  const [rows, setRows] = useState<AttentionTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await listAttentionTenants(withinDays);
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof AdminApiError
            ? err.userMessage
            : 'Gagal memuat antrian perhatian.';
          setError(msg);
          adminToast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [withinDays, refreshKey]);

  if (loading) {
    return (
      <div
        className="border rounded-xl overflow-hidden bg-white"
        style={{ borderColor: '#E2E8F0' }}
        data-testid="attention-queue-loading"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="px-4 py-3 border-b animate-pulse"
            style={{ borderColor: '#F1F5F9' }}
          >
            <div className="h-3 rounded w-2/3" style={{ background: '#E2E8F0' }} />
            <div className="h-2 mt-2 rounded w-1/3" style={{ background: '#F1F5F9' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="border rounded-xl px-4 py-3 text-[13px] flex justify-between items-center"
        style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
        data-testid="attention-queue-error"
      >
        <span>{error}</span>
        <button
          type="button"
          onClick={refetch}
          className="text-[12px] font-semibold px-3 py-1 rounded-full bg-white text-vosi-danger border border-vosi-danger hover:bg-vosi-danger hover:text-white transition"
          data-testid="attention-queue-retry"
        >
          Coba lagi
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
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
    <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: '#fcd34d' }} data-testid="attention-queue-live">
      <div
        className="px-4 py-2 text-[12px] font-bold uppercase tracking-widest"
        style={{
          background: '#fffbeb',
          color: '#92400e',
          fontFamily: 'JetBrains Mono, monospace',
          borderBottom: '1px solid #fcd34d',
        }}
      >
        Butuh perhatian ({rows.length})
      </div>

      {rows.map((t) => (
        <div
          key={t.tenant_id}
          className="px-4 py-3 flex justify-between items-center text-[13px]"
          style={{ borderBottom: '1px solid #fef3c7' }}
          data-testid={`attention-row-${t.slug}`}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold" style={{ color: '#0B2545' }}>{t.name}</span>
              <span
                className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ background: '#E2E8F0', color: '#0B2545' }}
                data-testid={`attention-plan-${t.slug}`}
              >
                {t.plan_code}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${reasonChipClass(t.attention_reason)}`}
                data-testid={`attention-reason-${t.slug}`}
              >
                {REASON_LABEL[t.attention_reason]}
              </span>
            </div>
            <div className="text-[12px] text-vosi-slate">
              {t.expires_at && (
                <>
                  <span className={`font-mono font-bold ${daysColor(t.days_until_expiry)}`}>
                    {t.days_until_expiry >= 0
                      ? `${t.days_until_expiry} hari`
                      : `${Math.abs(t.days_until_expiry)} hari lalu`}
                  </span>
                  <span className="text-vosi-muted"> · exp {t.expires_at}</span>
                </>
              )}
            </div>
          </div>
          <a
            href={`/admin/tenants/${t.slug}?tab=ringkasan`}
            className="text-[12px] px-3 py-1 rounded-lg border font-medium hover:bg-vosi-navy hover:text-white transition shrink-0"
            style={{ borderColor: '#0B2545', color: '#0B2545' }}
            data-testid={`attention-link-${t.slug}`}
          >
            Detail →
          </a>
        </div>
      ))}
    </div>
  );
}
