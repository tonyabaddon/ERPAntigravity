// src/components/admin/AdminRevenue.tsx
// Revenue dashboard at /admin/revenue.
// Fetches revenue stats (by plan, by month, by tenant), tenant list, and
// coverage gaps in parallel. Renders KPI cards, plan breakdown chart,
// monthly trend chart, top-10 tenant table, and coverage gaps callout.
import { useEffect, useState, useCallback } from 'react';
import { getRevenueStats } from '../../lib/paymentsApi';
import { listTenantsAdmin } from '../../lib/adminApi';
import { listPlansAdmin } from '../../lib/adminPlansApi';
import { supabase } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';
import { AdminApiError } from '../../lib/adminTypes';
import { handleAdminSPAClick } from '../../lib/urlRoute';
import type { RevenueStats } from '../../lib/paymentsTypes';
import type { AdminTenantRow, CoverageStatus } from '../../lib/adminTypes';
import type { PlanRow } from '../../lib/adminPlansApi';
import { formatIDR } from '../../lib/formatIDR';
import { RevenueKPIRow } from './RevenueKPIRow';
import { RevenuePlanBreakdown } from './RevenuePlanBreakdown';
import { RevenueMonthlyTrend } from './RevenueMonthlyTrend';
import { RevenueTopTenants } from './RevenueTopTenants';
import { RecordPaymentModal } from './RecordPaymentModal';

// ─── Empty/stub stats ─────────────────────────────────────────────────────────

function emptyStats(): RevenueStats {
  return {
    total: 0,
    breakdown: [],
    monthly_trend: Array.from({ length: 12 }, (_, i) => ({
      month: `${new Date().getFullYear()}-${String(i + 1).padStart(2, '0')}`,
      total: 0,
    })),
  };
}

// ─── Coverage gap row shape (from v_tenant_payment_coverage) ──────────────────

interface CoverageGapRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  coverage_status: CoverageStatus;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" data-testid="admin-revenue-loading">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-sm" style={{ background: '#F1F3F6' }} />
        ))}
      </div>
      {/* 2 chart placeholders */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="h-48 rounded-sm" style={{ background: '#F1F3F6' }} />
        <div className="h-48 rounded-sm" style={{ background: '#F1F3F6' }} />
      </div>
      {/* Table placeholder */}
      <div className="h-64 rounded-sm" style={{ background: '#F1F3F6' }} />
    </div>
  );
}

// ─── ARR computation ──────────────────────────────────────────────────────────

/**
 * ARR = SUM of price_annual for each active tenant's plan.
 * Uses the tenant list (active tenants only) joined to plan prices.
 */
function computeARR(tenants: AdminTenantRow[], plans: PlanRow[]): number {
  const priceMap = new Map<string, number>(
    plans.map((p) => [p.code, p.price_annual ?? 0]),
  );
  return tenants
    .filter((t) => t.status === 'ACTIVE')
    .reduce((sum, t) => sum + (t.plan_code ? (priceMap.get(t.plan_code) ?? 0) : 0), 0);
}

// ─── AdminRevenue ─────────────────────────────────────────────────────────────

export function AdminRevenue() {
  const currentYear = new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [planStats,   setPlanStats]   = useState<RevenueStats>(emptyStats());
  const [monthStats,  setMonthStats]  = useState<RevenueStats>(emptyStats());
  const [tenantStats, setTenantStats] = useState<RevenueStats>(emptyStats());
  const [allTenants,  setAllTenants]  = useState<AdminTenantRow[]>([]);
  const [plans,       setPlans]       = useState<PlanRow[]>([]);
  const [gapTenants,  setGapTenants]  = useState<CoverageGapRow[]>([]);

  // RecordPaymentModal state
  const [modalTenant, setModalTenant] = useState<AdminTenantRow | null>(null);

  // Coverage map: tenant_id → coverage_status
  const [coverageMap, setCoverageMap] = useState<Record<string, CoverageStatus>>({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [pStats, mStats, tStats, tenants, plansData] = await Promise.all([
        getRevenueStats({ group_by: 'plan' }),
        getRevenueStats({ group_by: 'month' }),
        getRevenueStats({ group_by: 'tenant' }),
        listTenantsAdmin({ page_size: 50 }),
        listPlansAdmin(),
      ]);

      setPlanStats(pStats);
      setMonthStats(mStats);
      setTenantStats(tStats);
      setAllTenants(tenants);
      setPlans(plansData);

      // Fetch coverage gaps (OVERDUE only)
      if (supabase) {
        const { data: gapData, error: gapErr } = await supabase
          .from('v_tenant_payment_coverage')
          .select('tenant_id, tenant_slug, tenant_name, coverage_status')
          .eq('coverage_status', 'OVERDUE');

        if (!gapErr && gapData) {
          setGapTenants(gapData as CoverageGapRow[]);
          // Build coverage map for all coverage data
          const cMap: Record<string, CoverageStatus> = {};
          for (const row of gapData) {
            cMap[(row as CoverageGapRow).tenant_id] = (row as CoverageGapRow).coverage_status;
          }
          setCoverageMap(cMap);
        }
        // If view access fails, silently continue (document as concern)
      }
    } catch (err) {
      const msg =
        err instanceof AdminApiError
          ? err.userMessage
          : 'Gagal memuat data pendapatan.';
      setError(msg);
      adminToast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const arr = computeARR(allTenants, plans);
  const ytd = monthStats.total > 0 ? monthStats.total : monthStats.monthly_trend.reduce((s, r) => s + r.total, 0);

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="px-6 py-6 max-w-5xl mx-auto font-caleo">
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: '#0B2545' }}>
            Pendapatan
          </h1>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        className="px-6 py-6 max-w-5xl mx-auto font-caleo"
        data-testid="admin-revenue-error"
      >
        <div className="mb-6">
          <h1 className="text-xl font-bold" style={{ color: '#0B2545' }}>
            Pendapatan
          </h1>
        </div>
        <div
          className="rounded-sm border p-6 flex flex-col items-center gap-3"
          style={{ borderColor: '#FCA5A5', background: '#FEF2F2' }}
        >
          <p className="text-[14px] font-medium" style={{ color: '#991B1B' }}>
            {error}
          </p>
          <button
            onClick={fetchAll}
            className="px-4 py-2 rounded-full text-[13px] font-semibold bg-caleo-navy text-white hover:opacity-90 transition-opacity"
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  // ─── Happy path ────────────────────────────────────────────────────────────

  return (
    <div
      className="px-6 py-6 max-w-5xl mx-auto font-caleo"
      data-testid="admin-revenue-page"
    >
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: '#0B2545' }}>
          Pendapatan
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#5A6472' }}>
          Tahun {currentYear} sejauh ini · {formatIDR(ytd)} YTD
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {/* KPI Row */}
        <RevenueKPIRow monthlyStats={monthStats} arr={arr} />

        {/* Charts — 2-col on lg, 1-col on mobile */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenuePlanBreakdown planStats={planStats} />
          <RevenueMonthlyTrend monthlyStats={monthStats} />
        </div>

        {/* Top tenants */}
        <RevenueTopTenants
          tenantStats={tenantStats}
          allTenants={allTenants}
          coverageMap={coverageMap}
        />

        {/* Coverage gaps callout */}
        {gapTenants.length > 0 && (
          <section
            className="rounded-sm border p-5"
            style={{ borderColor: '#FCA5A5', background: '#FEF2F2' }}
            aria-label="Kesenjangan pembayaran"
            data-testid="coverage-gaps-callout"
          >
            <h3
              className="text-[12px] font-bold uppercase tracking-widest mb-3"
              style={{ fontFamily: 'JetBrains Mono, monospace', color: '#991B1B' }}
            >
              Kesenjangan pembayaran
            </h3>
            <p className="text-[13px] mb-4" style={{ color: '#7F1D1D' }}>
              {gapTenants.length} tenant dengan status{' '}
              <strong>OVERDUE</strong> — belum ada pembayaran yang menutup periode berjalan.
            </p>
            <div className="flex flex-col gap-2">
              {gapTenants.map((gap) => {
                const tenantRow = allTenants.find(
                  (t) => t.tenant_id === gap.tenant_id,
                );
                return (
                  <div
                    key={gap.tenant_id}
                    className="flex items-center justify-between bg-white rounded-sm px-4 py-3"
                    style={{ borderColor: '#FCA5A5', border: '1px solid #FCA5A5' }}
                  >
                    <div>
                      <span
                        className="text-[13px] font-semibold"
                        style={{ color: '#0B2545' }}
                      >
                        {gap.tenant_name}
                      </span>
                      {tenantRow?.plan_code && (
                        <span
                          className="ml-2 text-[11px] font-medium"
                          style={{ color: '#9DB2CE' }}
                        >
                          {tenantRow.plan_code}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/admin/tenants/${gap.tenant_slug}?tab=pembayaran`}
                        className="text-[12px] font-semibold underline"
                        style={{ color: '#DC2626' }}
                        onClick={(e) => {
                          if (tenantRow) {
                            e.preventDefault();
                            setModalTenant(tenantRow);
                            return;
                          }
                          handleAdminSPAClick(e, `/admin/tenants/${gap.tenant_slug}?tab=pembayaran`);
                        }}
                      >
                        Catat pembayaran
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* RecordPaymentModal — opened from coverage gap callout */}
      {modalTenant && (
        <RecordPaymentModal
          open={true}
          tenant={modalTenant}
          mode="record"
          onClose={() => setModalTenant(null)}
          onSuccess={() => {
            setModalTenant(null);
            void fetchAll();
          }}
        />
      )}
    </div>
  );
}
