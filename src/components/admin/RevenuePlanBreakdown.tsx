// src/components/admin/RevenuePlanBreakdown.tsx
// Horizontal bar chart for revenue breakdown per plan (STARTER/PRO/PREMIUM).
// Hand-rolled SVG — no recharts dependency.
import type { RevenueStats } from '../../lib/paymentsTypes';
import { formatIDR } from '../../lib/formatIDR';

interface RevenuePlanBreakdownProps {
  /** Revenue stats grouped by plan (group_by: 'plan'). */
  planStats: RevenueStats;
}

const PLAN_COLORS: Record<string, string> = {
  STARTER: '#9DB2CE',
  PRO:     '#F9B233',
  PREMIUM: '#0B2545',
};

const PLAN_LABEL: Record<string, string> = {
  STARTER: 'Starter',
  PRO:     'Pro',
  PREMIUM: 'Premium',
};

export function RevenuePlanBreakdown({ planStats }: RevenuePlanBreakdownProps) {
  const breakdown = planStats.breakdown;
  const total = breakdown.reduce((s, r) => s + r.amount, 0);

  // Sort: PREMIUM → PRO → STARTER
  const sorted = [...breakdown].sort((a, b) => {
    const order: Record<string, number> = { PREMIUM: 0, PRO: 1, STARTER: 2 };
    return (order[a.key] ?? 9) - (order[b.key] ?? 9);
  });

  return (
    <section
      className="bg-white border rounded-sm p-5"
      style={{ borderColor: '#ECEEF1' }}
      aria-label="Rincian pendapatan per paket"
    >
      <h3
        className="text-[12px] font-bold uppercase tracking-widest mb-4"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
      >
        Rincian per paket
      </h3>

      {sorted.length === 0 ? (
        <p
          className="text-[13px] py-4 text-center"
          style={{ color: '#9DB2CE' }}
          data-testid="plan-breakdown-empty"
        >
          Belum ada data pembayaran.
        </p>
      ) : (
        <div className="flex flex-col gap-4" role="list">
          {sorted.map((row) => {
            const pct = total > 0 ? (row.amount / total) * 100 : 0;
            const color = PLAN_COLORS[row.key] ?? '#9DB2CE';
            const label = PLAN_LABEL[row.key] ?? row.key;

            return (
              <div
                key={row.key}
                role="listitem"
                aria-label={`${label}: ${formatIDR(row.amount)}`}
              >
                {/* Row header */}
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="text-[12px] font-semibold"
                    style={{ color: '#0B2545' }}
                  >
                    {label}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="text-[12px] font-bold"
                      style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
                    >
                      {formatIDR(row.amount)}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{ color: '#9DB2CE' }}
                    >
                      {row.count} tenant
                    </span>
                  </span>
                </div>

                {/* Bar */}
                <div
                  className="w-full rounded-full overflow-hidden"
                  style={{ height: 8, background: '#F1F3F6' }}
                  role="presentation"
                >
                  <svg
                    width="100%"
                    height="8"
                    aria-hidden="true"
                    style={{ display: 'block' }}
                  >
                    <rect
                      x="0"
                      y="0"
                      width={`${pct}%`}
                      height="8"
                      rx="4"
                      fill={color}
                    />
                  </svg>
                </div>

                {/* Percentage text */}
                <div className="mt-1 text-right">
                  <span
                    className="text-[11px]"
                    style={{ color: '#9DB2CE' }}
                  >
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Accessible fallback table */}
      <table className="sr-only" aria-label="Tabel rincian per paket">
        <thead>
          <tr>
            <th scope="col">Paket</th>
            <th scope="col">Total</th>
            <th scope="col">Tenant</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.key}>
              <td>{PLAN_LABEL[row.key] ?? row.key}</td>
              <td>{formatIDR(row.amount)}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
