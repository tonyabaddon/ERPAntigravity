// src/components/admin/RevenueTopTenants.tsx
// Top-10 tenants by revenue YTD table.
// Columns: Rank | Nama | Paket badge | Total | Coverage badge.
// Rows are clickable → /admin/tenants/{slug}?tab=pembayaran
import React from 'react';
import type { RevenueStats } from '../../lib/paymentsTypes';
import type { AdminTenantRow } from '../../lib/adminTypes';
import type { CoverageStatus } from '../../lib/adminTypes';
import { formatIDR } from '../../lib/formatIDR';
import { CoverageStatusBadge } from './CoverageStatusBadge';
import EmptyState from '../ui/EmptyState';

interface TenantWithRevenue {
  tenant_id: string;
  slug: string;
  name: string;
  plan_code: string | null;
  total: number;
  coverage_status?: CoverageStatus | null;
}

interface RevenueTopTenantsProps {
  /** Revenue stats grouped by tenant (group_by: 'tenant'). */
  tenantStats: RevenueStats;
  /** All tenant rows for name/slug/plan lookup (from listTenantsAdmin). */
  allTenants: AdminTenantRow[];
  /** Optional coverage status map: tenant_id → coverage_status. */
  coverageMap?: Record<string, CoverageStatus>;
}

const PLAN_BADGE_STYLE: Record<string, { bg: string; color: string }> = {
  STARTER: { bg: '#F1F3F6', color: '#5A6472' },
  PRO:     { bg: '#FEF3C7', color: '#92400E' },
  PREMIUM: { bg: '#0B2545', color: '#F9B233' },
};

export function RevenueTopTenants({
  tenantStats,
  allTenants,
  coverageMap = {},
}: RevenueTopTenantsProps) {
  // Build tenant map for quick lookup
  const tenantMap = new Map(allTenants.map((t) => [t.tenant_id, t]));

  // Join revenue breakdown (key = tenant_id or slug) with tenant rows
  const rows: TenantWithRevenue[] = tenantStats.breakdown
    .filter((r) => r.amount > 0)
    .map((r) => {
      // key may be tenant_id (uuid) or slug; try both
      const byId = tenantMap.get(r.key);
      const bySlug = byId
        ? byId
        : allTenants.find((t) => t.slug === r.key) ?? null;
      return {
        tenant_id: bySlug?.tenant_id ?? r.key,
        slug: bySlug?.slug ?? r.key,
        name: bySlug?.name ?? r.key,
        plan_code: bySlug?.plan_code ?? null,
        total: r.amount,
        coverage_status: coverageMap[bySlug?.tenant_id ?? r.key] ?? null,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return (
    <section
      className="bg-white border rounded overflow-hidden"
      style={{ borderColor: '#ECEEF1' }}
      aria-label="Tenant dengan pendapatan tertinggi"
    >
      {/* Header */}
      <div
        className="px-4 py-4 border-b"
        style={{ borderColor: '#ECEEF1' }}
      >
        <h3
          className="text-xs font-bold uppercase tracking-widest"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
        >
          Tenant teratas
        </h3>
      </div>

      {rows.length === 0 ? (
        <div data-testid="top-tenants-empty">
          <EmptyState message="Belum ada data pembayaran." />
        </div>
      ) : (
        <table className="w-full text-caleo-13" aria-label="Top 10 tenant berdasarkan pendapatan">
          <thead>
            <tr style={{ background: '#FAF7F0' }}>
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-caleo-11 font-bold uppercase tracking-widest"
                style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace', width: 40 }}
              >
                #
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left text-caleo-11 font-bold uppercase tracking-widest"
                style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
              >
                Nama
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-left text-caleo-11 font-bold uppercase tracking-widest"
                style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
              >
                Paket
              </th>
              <th
                scope="col"
                className="px-3 py-2.5 text-right text-caleo-11 font-bold uppercase tracking-widest"
                style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
              >
                Total
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-caleo-11 font-bold uppercase tracking-widest"
                style={{ color: '#9DB2CE', fontFamily: 'JetBrains Mono, monospace' }}
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const planStyle = row.plan_code
                ? (PLAN_BADGE_STYLE[row.plan_code] ?? { bg: '#F1F3F6', color: '#5A6472' })
                : { bg: '#F1F3F6', color: '#5A6472' };

              const href = `/admin/tenants/${row.slug}?tab=pembayaran`;

              return (
                <tr
                  key={row.tenant_id}
                  className="border-t transition-colors"
                  style={{
                    borderColor: '#ECEEF1',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    window.location.href = href;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      window.location.href = href;
                    }
                  }}
                  tabIndex={0}
                  role="row"
                  aria-label={`${row.name}: ${formatIDR(row.total)}`}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = '#FAF7F0';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = '';
                  }}
                >
                  <td
                    className="px-4 py-3 text-xs font-bold"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
                  >
                    {idx + 1}
                  </td>
                  <td className="px-3 py-3 font-medium" style={{ color: '#0B2545' }}>
                    {row.name}
                  </td>
                  <td className="px-3 py-3">
                    {row.plan_code ? (
                      <span
                        className="inline-block text-caleo-11 font-bold px-2 py-0.5 rounded-full"
                        style={{ background: planStyle.bg, color: planStyle.color }}
                      >
                        {row.plan_code}
                      </span>
                    ) : (
                      <span style={{ color: '#9DB2CE' }}>—</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-3 text-right font-bold"
                    style={{ fontFamily: 'JetBrains Mono, monospace', color: '#0B2545' }}
                  >
                    {formatIDR(row.total)}
                  </td>
                  <td className="px-4 py-3">
                    <CoverageStatusBadge status={row.coverage_status ?? null} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
