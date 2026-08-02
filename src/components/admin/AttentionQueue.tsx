// src/components/admin/AttentionQueue.tsx
// Wave 4a: fetches directly via list_attention_tenants(45) instead of
// receiving props from AdminHome. Server-side sort by urgency, includes
// EXPIRED_AND_SUSPENDED reason.
// Wave 5 Task 10b: also merges OVERDUE tenants from v_tenant_payment_coverage.
// Priority order: SUSPENDED > EXPIRED_AND_SUSPENDED > OVERDUE > EXPIRING.
import { useEffect, useState, useCallback } from 'react';
import { listAttentionTenants } from '../../lib/adminApi';
import { supabase } from '../../lib/supabaseClient';
import type { AttentionTenantRow, AttentionReason } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';
import { adminToast } from '../../lib/adminToast';

// ─── Priority map (lower = higher priority in sort) ───────────────────────────

const REASON_PRIORITY: Record<AttentionReason, number> = {
  SUSPENDED:              1,
  EXPIRED_AND_SUSPENDED:  2,
  OVERDUE:                3,
  EXPIRING:               4,
};

const REASON_LABEL: Record<AttentionReason, string> = {
  EXPIRING:               'Kedaluwarsa',
  SUSPENDED:              'Ditangguhkan',
  EXPIRED_AND_SUSPENDED:  'Kedaluwarsa & ditangguhkan',
  OVERDUE:                'Pembayaran terlambat',
};

function daysColor(days: number): string {
  if (days <= 0) return 'text-caleo-danger';
  if (days <= 14) return 'text-caleo-gold';
  return 'text-caleo-slate';
}

function reasonChipClass(reason: AttentionReason): string {
  if (reason === 'SUSPENDED' || reason === 'EXPIRED_AND_SUSPENDED' || reason === 'OVERDUE') {
    return 'bg-caleo-danger/10 text-caleo-danger';
  }
  return 'bg-caleo-gold/15 text-caleo-navy';
}

/** Shape of a row in v_tenant_payment_coverage. */
interface CoverageViewRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  plan_code: string | null;
  coverage_status: string;
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
      // Retry the parallel fetch up to 3× with 500ms/1000ms backoff — same
      // resilience pattern as AdminHome + AdminRouteGuard. During Supabase
      // pool pinches PostgREST intermittently 503s with PGRST002; retry
      // absorbs the transient without user-visible failure.
      let lastErr: unknown = null;
      let attentionRows: AttentionTenantRow[] = [];
      let coverageResult: { data: unknown[] | null; error: unknown } = { data: null, error: null };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const results = await Promise.all([
            listAttentionTenants(withinDays),
            supabase
              ? supabase
                  .from('v_tenant_payment_coverage')
                  .select('tenant_id, tenant_slug, tenant_name, plan_code, coverage_status')
                  .eq('coverage_status', 'OVERDUE')
              : Promise.resolve({ data: null, error: null }),
          ]);
          attentionRows = results[0];
          coverageResult = results[1] as { data: unknown[] | null; error: unknown };
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
        const msg = lastErr instanceof AdminApiError
          ? lastErr.userMessage
          : 'Gagal memuat antrian perhatian.';
        setError(msg);
        adminToast.error(msg);
        setLoading(false);
        return;
      }

      try {
        // Build merged set: start from subscription attention rows.
        // Track by tenant_id; higher-priority reason wins on collision.
        const rowMap = new Map<string, AttentionTenantRow>();
        for (const r of attentionRows) {
          rowMap.set(r.tenant_id, r);
        }

        // Inject OVERDUE rows (best-effort: silently skip on view error).
        if (!coverageResult.error && coverageResult.data) {
          for (const cv of coverageResult.data as CoverageViewRow[]) {
            const existing = rowMap.get(cv.tenant_id);
            if (!existing) {
              // New row — add as OVERDUE.
              rowMap.set(cv.tenant_id, {
                tenant_id:      cv.tenant_id,
                slug:           cv.tenant_slug,
                name:           cv.tenant_name,
                plan_code:      (cv.plan_code ?? 'STARTER') as AttentionTenantRow['plan_code'],
                status:         'ACTIVE',
                expires_at:     '',
                days_until_expiry: 0,
                attention_reason: 'OVERDUE',
              });
            } else {
              // Already present — only upgrade to OVERDUE if it has LOWER priority
              // than the current reason (i.e., keep SUSPENDED/EXPIRED_AND_SUSPENDED).
              const currentPriority = REASON_PRIORITY[existing.attention_reason];
              const overduePriority = REASON_PRIORITY['OVERDUE'];
              if (overduePriority < currentPriority) {
                rowMap.set(cv.tenant_id, { ...existing, attention_reason: 'OVERDUE' });
              }
              // Otherwise current reason (SUSPENDED etc.) already has higher priority — keep it.
            }
          }
        }

        // Sort merged rows by priority, then by name as tiebreaker.
        const sorted = Array.from(rowMap.values()).sort((a, b) => {
          const pa = REASON_PRIORITY[a.attention_reason] ?? 99;
          const pb = REASON_PRIORITY[b.attention_reason] ?? 99;
          if (pa !== pb) return pa - pb;
          return a.name.localeCompare(b.name, 'id');
        });

        if (!cancelled) setRows(sorted);
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
        className="border rounded overflow-hidden bg-white"
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
        className="border rounded px-4 py-3 text-[13px] flex justify-between items-center"
        style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
        data-testid="attention-queue-error"
      >
        <span>{error}</span>
        <button
          type="button"
          onClick={refetch}
          className="text-[12px] font-semibold px-3 py-1 rounded-full bg-white text-caleo-danger border border-caleo-danger hover:bg-caleo-danger hover:text-white transition"
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
        className="border rounded px-4 py-3 text-[13px]"
        style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}
        data-testid="attention-queue-empty"
      >
        Semua tenteram — tidak ada tenant yang butuh perhatian sekarang.
      </div>
    );
  }

  return (
    <div className="border rounded overflow-hidden bg-white" style={{ borderColor: '#fcd34d' }} data-testid="attention-queue-live">
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
            <div className="text-[12px] text-caleo-slate">
              {t.expires_at && (
                <>
                  <span className={`font-mono font-bold ${daysColor(t.days_until_expiry)}`}>
                    {t.days_until_expiry >= 0
                      ? `${t.days_until_expiry} hari`
                      : `${Math.abs(t.days_until_expiry)} hari lalu`}
                  </span>
                  <span className="text-caleo-muted"> · exp {t.expires_at}</span>
                </>
              )}
            </div>
          </div>
          <a
            href={
              t.attention_reason === 'OVERDUE'
                ? `/admin/tenants/${t.slug}?tab=pembayaran`
                : `/admin/tenants/${t.slug}?tab=ringkasan`
            }
            className="text-[12px] px-3 py-1 rounded border font-medium hover:bg-caleo-navy hover:text-white transition shrink-0"
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
