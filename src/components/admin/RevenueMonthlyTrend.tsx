// src/components/admin/RevenueMonthlyTrend.tsx
// 12-month trend line chart rendered as hand-rolled SVG polyline.
// X-axis: month labels (Jan, Feb, ...). Y-axis: auto-scaled to max value.
// No recharts dependency — VOSI palette.
import type { RevenueStats } from '../../lib/paymentsTypes';
import { formatIDR } from '../../lib/formatIDR';

interface RevenueMonthlyTrendProps {
  /** Revenue stats grouped by month (group_by: 'month'). Always 12 rows. */
  monthlyStats: RevenueStats;
}

// SVG viewport constants
const SVG_W = 600;
const SVG_H = 160;
const PAD_LEFT = 0;
const PAD_RIGHT = 0;
const PAD_TOP = 16;
const PAD_BOTTOM = 28; // room for x-axis labels
const CHART_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const CHART_H = SVG_H - PAD_TOP - PAD_BOTTOM;

// Indonesian month abbreviations
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseMonthIndex(month: string): number {
  // month is "YYYY-MM"
  const parts = month.split('-');
  return parseInt(parts[1] ?? '1', 10) - 1; // 0-indexed
}

export function RevenueMonthlyTrend({ monthlyStats }: RevenueMonthlyTrendProps) {
  const trend = monthlyStats.monthly_trend;

  const maxVal = Math.max(...trend.map((r) => r.total), 1);
  const n = trend.length;

  // Compute (x, y) for each data point
  const points = trend.map((row, i) => {
    const x = PAD_LEFT + (i / Math.max(n - 1, 1)) * CHART_W;
    const y = PAD_TOP + CHART_H - (row.total / maxVal) * CHART_H;
    return { x, y, total: row.total, month: row.month };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Area fill path: go along points then back down to baseline
  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const baselineY = PAD_TOP + CHART_H;
  const areaPath =
    `M ${firstPt?.x ?? 0},${baselineY} ` +
    points.map((p) => `L ${p.x},${p.y}`).join(' ') +
    ` L ${lastPt?.x ?? CHART_W},${baselineY} Z`;

  const allZero = trend.every((r) => r.total === 0);

  return (
    <section
      className="bg-white border rounded p-5"
      style={{ borderColor: '#ECEEF1' }}
      aria-label="Tren pendapatan 12 bulan"
    >
      <h3
        className="text-[12px] font-bold uppercase tracking-widest mb-4"
        style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
      >
        Tren 12 bulan
      </h3>

      {allZero ? (
        <p
          className="text-[13px] py-4 text-center"
          style={{ color: '#9DB2CE' }}
          data-testid="trend-empty"
        >
          Belum ada data pembayaran.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            width="100%"
            height={SVG_H}
            aria-label="Grafik tren pendapatan 12 bulan"
            role="img"
            style={{ display: 'block' }}
          >
            {/* Area fill */}
            <path
              d={areaPath}
              fill="#F9B23320"
              stroke="none"
            />

            {/* Polyline */}
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#F9B233"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Data point dots + tooltips */}
            {points.map((p, i) => (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.total > 0 ? 4 : 2}
                  fill={p.total > 0 ? '#F9B233' : '#ECEEF1'}
                  stroke="white"
                  strokeWidth="1.5"
                />
                <title>{`${MONTH_SHORT[parseMonthIndex(p.month)] ?? p.month}: ${formatIDR(p.total)}`}</title>
              </g>
            ))}

            {/* X-axis month labels */}
            {points.map((p, i) => {
              const monthIdx = parseMonthIndex(p.month);
              const label = MONTH_SHORT[monthIdx] ?? String(monthIdx + 1);
              return (
                <text
                  key={i}
                  x={p.x}
                  y={SVG_H - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#9DB2CE"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {label}
                </text>
              );
            })}

            {/* Y-axis baseline */}
            <line
              x1={PAD_LEFT}
              y1={PAD_TOP + CHART_H}
              x2={PAD_LEFT + CHART_W}
              y2={PAD_TOP + CHART_H}
              stroke="#ECEEF1"
              strokeWidth="1"
            />
          </svg>
        </div>
      )}

      {/* Accessible fallback table (screen-reader only) */}
      <table className="sr-only" aria-label="Tabel tren bulanan">
        <thead>
          <tr>
            <th scope="col">Bulan</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((row) => {
            const monthIdx = parseMonthIndex(row.month);
            const label = MONTH_SHORT[monthIdx] ?? row.month;
            return (
              <tr key={row.month}>
                <td>{label}</td>
                <td>{formatIDR(row.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
