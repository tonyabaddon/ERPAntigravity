// src/components/admin/CostDashboard.tsx
// P2-A: Per-tenant cost signals dashboard at /admin/billing.
// Shows cost aggregates (storage + Gemini estimates) per tenant, with outlier detection.
// Founder-only: requires platform_admin JWT (enforced server-side).
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, DollarSign } from 'lucide-react';
import {
  listTenantCosts,
  backfillTenantCostDaily,
  type TenantCostRow,
} from '../../lib/costDashboardApi';
import { adminToast } from '../../lib/adminToast';
import { wibDateString } from '../../lib/format';
import { captureError } from '../../lib/captureError';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// ─── Helpers ────────────���─────────────────────────────────────────────────────

function todayISO(): string {
  return wibDateString();
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtUSD(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.001) return '<$0.001';
  return `$${n.toFixed(4)}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

/** Compute median of an array (returns 0 for empty). */
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Outlier threshold: > 3× median total cost
const OUTLIER_MULTIPLIER = 3;

// ─── Loading skeleton ──────────────────────────────────────��──────────────────

function Skeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" data-testid="cost-dashboard-loading">
      <div className="h-10 rounded w-72" style={{ background: '#F1F3F6' }} />
      <div className="h-8 rounded w-full" style={{ background: '#F1F3F6' }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded w-full" style={{ background: '#F1F3F6' }} />
      ))}
    </div>
  );
}

// ─── Outlier banner ────────────��────────────────────────────��─────────────────

function OutlierBanner({ outliers }: { outliers: TenantCostRow[] }) {
  if (outliers.length === 0) return null;
  return (
    <div
      className="flex items-start gap-3 rounded p-4 text-caleo-13"
      style={{ background: '#FEF3C7', border: '1px solid #F59E0B' }}
      data-testid="cost-outlier-banner"
      role="alert"
    >
      <AlertTriangle size={16} strokeWidth={1.8} style={{ color: '#B45309', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="font-semibold" style={{ color: '#92400E' }}>
          {outliers.length} tenant{outliers.length > 1 ? 's' : ''} dengan biaya di atas 3× median
        </p>
        <ul className="mt-1 list-disc list-inside" style={{ color: '#78350F' }}>
          {outliers.map((t) => (
            <li key={t.tenant_id}>
              <strong>{t.name}</strong> ({t.slug}) — {fmtUSD(t.est_total_usd)} hari ini
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs" style={{ color: '#92400E' }}>
          Estimasi kasar — angka aktual ada di tagihan GCP / Supabase.
        </p>
      </div>
    </div>
  );
}

// ─── Cost table ─────────────���────────────────────────────���────────────────────

function CostTable({
  rows,
  outlierIds,
}: {
  rows: TenantCostRow[];
  outlierIds: Set<string>;
}) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded p-8 text-center text-caleo-13"
        style={{ background: '#F8FAFC', border: '1px solid #ECEEF1', color: '#64748B' }}
        data-testid="cost-empty"
      >
        Tidak ada data tenant aktif.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded" style={{ border: '1px solid #ECEEF1' }}>
      <table className="w-full text-caleo-13 font-caleo" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #ECEEF1' }}>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: '#64748B', width: '30%' }}>Tenant</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Storage</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Gemini Calls</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Input Tokens</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Output Tokens</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Est. Gemini</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#64748B' }}>Est. Storage</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: '#0B2545' }}>Est. Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isOutlier = outlierIds.has(row.tenant_id);
            const isEven = idx % 2 === 0;
            return (
              <tr
                key={row.tenant_id}
                data-testid={`cost-row-${row.slug}`}
                style={{
                  background: isOutlier ? '#FFFBEB' : isEven ? '#FFFFFF' : '#FAFAFA',
                  borderBottom: '1px solid #F1F3F6',
                }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {isOutlier && (
                      <AlertTriangle size={13} strokeWidth={2} style={{ color: '#B45309', flexShrink: 0 }} />
                    )}
                    <div>
                      <span className="font-medium" style={{ color: '#0B2545' }}>{row.name}</span>
                      <span className="ml-1.5 text-caleo-11" style={{ color: '#94A3B8' }}>{row.slug}</span>
                    </div>
                  </div>
                  {!row.usage_date && (
                    <div className="text-caleo-11 mt-0.5" style={{ color: '#94A3B8' }}>
                      belum ada data — klik Refresh
                    </div>
                  )}
                </td>
                <td className="text-right px-4 py-3" style={{ color: '#334155' }}>
                  {fmtBytes(row.storage_bytes)}
                </td>
                <td className="text-right px-4 py-3" style={{ color: '#334155' }}>
                  {fmtNum(row.gemini_calls)}
                </td>
                <td className="text-right px-4 py-3" style={{ color: '#334155' }}>
                  {fmtNum(row.gemini_input_tokens)}
                </td>
                <td className="text-right px-4 py-3" style={{ color: '#334155' }}>
                  {fmtNum(row.gemini_output_tokens)}
                </td>
                <td className="text-right px-4 py-3 font-mono text-xs" style={{ color: '#334155' }}>
                  {fmtUSD(row.est_gemini_usd)}
                </td>
                <td className="text-right px-4 py-3 font-mono text-xs" style={{ color: '#334155' }}>
                  {fmtUSD(row.est_storage_usd)}
                </td>
                <td
                  className="text-right px-4 py-3 font-mono text-xs font-semibold"
                  style={{ color: isOutlier ? '#B45309' : '#0B2545' }}
                >
                  {fmtUSD(row.est_total_usd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CostDashboard() {
  const [date, setDate] = useState<string>(todayISO);
  const [rows, setRows] = useState<TenantCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTenantCosts(d);
      // Sort by total cost desc
      data.sort((a, b) => b.est_total_usd - a.est_total_usd);
      setRows(data);
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
      captureError(msg, { feature: 'admin_cost_dashboard', action: 'load_costs' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  async function handleBackfill() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const result = await backfillTenantCostDaily(date);
      adminToast.success(`Backfill selesai — ${result.rows_upserted} tenant diperbarui`);
      await load(date);
    } catch (err) {
      const msg = extractErrorMessage(err);
      adminToast.error('Backfill gagal', msg);
      captureError(msg, { feature: 'admin_cost_dashboard', action: 'backfill_cost' });
    } finally {
      setRefreshing(false);
    }
  }

  // Compute outliers: tenants with total cost > 3× median (excluding zeros)
  const costs = rows.map((r) => r.est_total_usd);
  const med = median(costs.filter((c) => c > 0));
  const outlierIds = new Set<string>(
    rows
      .filter((r) => med > 0 && r.est_total_usd > OUTLIER_MULTIPLIER * med)
      .map((r) => r.tenant_id),
  );
  const outlierRows = rows.filter((r) => outlierIds.has(r.tenant_id));

  return (
    <div className="flex flex-col gap-6 font-caleo" data-testid="cost-dashboard">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign size={18} strokeWidth={1.8} style={{ color: '#F9B233' }} />
            <h1 className="text-lg font-bold" style={{ color: '#0B2545' }}>
              Biaya Per Tenant
            </h1>
          </div>
          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
            Estimasi sinyal biaya harian — bukan tagihan resmi GCP/Supabase.
            {' '}Klik <strong>Refresh</strong> untuk agregasi terbaru dari Storage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
            className="text-caleo-13 px-3 py-1.5 rounded"
            style={{
              border: '1px solid #D1D5DB',
              color: '#0B2545',
              background: '#FFFFFF',
              outline: 'none',
            }}
            data-testid="cost-date-picker"
          />
          <button
            onClick={handleBackfill}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-caleo-13 font-medium transition-colors disabled:opacity-50"
            style={{ background: '#0B2545', color: '#FFFFFF' }}
            data-testid="cost-backfill-button"
          >
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className={refreshing ? 'animate-spin' : ''}
            />
            {refreshing ? 'Menyinkronkan…' : 'Refresh Storage'}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="rounded p-4 text-caleo-13"
          style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B' }}
          data-testid="cost-error"
        >
          Gagal memuat data: {error}
        </div>
      )}

      {/* Loading */}
      {loading && <Skeleton />}

      {/* Data */}
      {!loading && !error && (
        <>
          <OutlierBanner outliers={outlierRows} />
          <CostTable rows={rows} outlierIds={outlierIds} />

          {/* Footnote */}
          <div className="text-caleo-11" style={{ color: '#94A3B8' }}>
            <strong>Catatan:</strong> Estimasi Gemini berdasarkan tarif Gemini 2.5 Flash Lite
            (input $0.075/1M token, output $0.30/1M token).
            Storage gratis sampai 1 GB, lalu ~$0.021/GB/bulan.
            Gemini call count akan tersedia setelah instrumentasi backend (Phase 2 follow-up).
            Data storage hanya dari bucket <code>tenants/&lt;uuid&gt;/</code> prefix.
          </div>
        </>
      )}
    </div>
  );
}
