import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AdminRevenue } from './AdminRevenue';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const getRevenueMock = vi.fn();
const listTenantsMock = vi.fn();
const listPlansMock = vi.fn();

vi.mock('../../lib/paymentsApi', () => ({
  getRevenueStats: (...args: unknown[]) => getRevenueMock(...args),
}));

vi.mock('../../lib/adminApi', () => ({
  listTenantsAdmin: (...args: unknown[]) => listTenantsMock(...args),
}));

vi.mock('../../lib/adminPlansApi', () => ({
  listPlansAdmin: () => listPlansMock(),
}));

vi.mock('../../lib/adminToast', () => ({
  adminToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock supabaseClient with an object that has .from() returning empty results
const supabaseFromMock = vi.fn();
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTrend(values: number[]) {
  return values.map((total, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    total,
  }));
}

const emptyPlanStats = { total: 0, breakdown: [], monthly_trend: makeTrend(Array(12).fill(0)) };
const emptyMonthStats = { total: 0, breakdown: [], monthly_trend: makeTrend(Array(12).fill(0)) };
const emptyTenantStats = { total: 0, breakdown: [], monthly_trend: makeTrend(Array(12).fill(0)) };

const richPlanStats = {
  total: 15_000_000,
  breakdown: [
    { key: 'STARTER', amount: 3_000_000, count: 3 },
    { key: 'PRO',     amount: 5_000_000, count: 2 },
    { key: 'PREMIUM', amount: 7_000_000, count: 1 },
  ],
  monthly_trend: makeTrend(Array(12).fill(0)),
};

const richMonthStats = {
  total: 12_000_000,
  breakdown: [],
  monthly_trend: makeTrend([
    800_000, 900_000, 1_000_000, 1_100_000, 1_200_000, 1_000_000,
    900_000, 950_000, 1_050_000, 1_100_000, 1_000_000, 1_000_000,
  ]),
};

const richTenantStats = {
  total: 15_000_000,
  breakdown: [
    { key: 't1', amount: 10_000_000, count: 10 },
    { key: 't2', amount: 5_000_000,  count: 5 },
  ],
  monthly_trend: makeTrend(Array(12).fill(0)),
};

const tenants = [
  {
    tenant_id: 't1',
    slug: 'garindo',
    name: 'Garindo',
    plan_code: 'PREMIUM' as const,
    status: 'ACTIVE' as const,
    expiry_mode: 'ACTIVE' as const,
    activated_at: '2024-01-01',
    expires_at: '2099-12-31',
    days_until_expiry: 26000,
    user_count: 3,
    sku_count: 100,
    industry: null,
    employee_range: null,
    onboarded_at: '2024-01-01',
    last_login_at: null,
    txn_7d: 10,
    avg_daily_txn: 1,
    usage_status: 'AKTIF' as const,
    total_count: 2,
  },
  {
    tenant_id: 't2',
    slug: 'apotek',
    name: 'Apotek Sehat',
    plan_code: 'PRO' as const,
    status: 'ACTIVE' as const,
    expiry_mode: 'ACTIVE' as const,
    activated_at: '2024-01-01',
    expires_at: '2099-12-31',
    days_until_expiry: 26000,
    user_count: 1,
    sku_count: 50,
    industry: null,
    employee_range: null,
    onboarded_at: '2024-01-01',
    last_login_at: null,
    txn_7d: 5,
    avg_daily_txn: 0.7,
    usage_status: 'AKTIF' as const,
    total_count: 2,
  },
];

const plans = [
  { code: 'STARTER' as const, name: 'Starter', description: null, target_segment: null, is_recommended: false, feature_bundle: {}, sort_order: 0, tenant_count: 3, price_annual: 3_600_000 },
  { code: 'PRO'     as const, name: 'Pro',     description: null, target_segment: null, is_recommended: true,  feature_bundle: {}, sort_order: 1, tenant_count: 2, price_annual: 7_200_000 },
  { code: 'PREMIUM' as const, name: 'Premium', description: null, target_segment: null, is_recommended: false, feature_bundle: {}, sort_order: 2, tenant_count: 1, price_annual: 12_000_000 },
];

// Helper: supabase .from() returns empty coverage gaps by default
function mockSupabase(rows: unknown[] = []) {
  supabaseFromMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminRevenue', () => {
  beforeEach(() => {
    getRevenueMock.mockReset();
    listTenantsMock.mockReset();
    listPlansMock.mockReset();
    supabaseFromMock.mockReset();
    mockSupabase([]);
  });

  // ── Loading state ─────────────────────────────────────────────────────────

  it('shows loading skeleton while fetching', () => {
    getRevenueMock.mockReturnValue(new Promise(() => {}));
    listTenantsMock.mockReturnValue(new Promise(() => {}));
    listPlansMock.mockReturnValue(new Promise(() => {}));

    render(<AdminRevenue />);

    expect(screen.getByTestId('admin-revenue-loading')).toBeInTheDocument();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('renders 4 KPI cards after loading', async () => {
    getRevenueMock
      .mockResolvedValueOnce(richPlanStats)
      .mockResolvedValueOnce(richMonthStats)
      .mockResolvedValueOnce(richTenantStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-page')).toBeInTheDocument();
    });

    expect(screen.getByText('Bulan ini')).toBeInTheDocument();
    expect(screen.getByText('YTD')).toBeInTheDocument();
    expect(screen.getByText('MRR estimasi')).toBeInTheDocument();
    expect(screen.getByText('ARR estimasi')).toBeInTheDocument();
  });

  it('renders plan breakdown section', async () => {
    getRevenueMock
      .mockResolvedValueOnce(richPlanStats)
      .mockResolvedValueOnce(richMonthStats)
      .mockResolvedValueOnce(richTenantStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByText('Rincian per paket')).toBeInTheDocument();
    });
  });

  it('renders monthly trend section', async () => {
    getRevenueMock
      .mockResolvedValueOnce(richPlanStats)
      .mockResolvedValueOnce(richMonthStats)
      .mockResolvedValueOnce(richTenantStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByText('Tren 12 bulan')).toBeInTheDocument();
    });
  });

  it('renders top tenants section', async () => {
    getRevenueMock
      .mockResolvedValueOnce(richPlanStats)
      .mockResolvedValueOnce(richMonthStats)
      .mockResolvedValueOnce(richTenantStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByText('Tenant teratas')).toBeInTheDocument();
    });
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  it('renders sensible zeros for empty state (0 payments, 0 tenants)', async () => {
    getRevenueMock.mockResolvedValue(emptyPlanStats);
    listTenantsMock.mockResolvedValue([]);
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-page')).toBeInTheDocument();
    });

    // All KPI values should be Rp 0
    const rpZeros = screen.getAllByText('Rp 0');
    expect(rpZeros.length).toBeGreaterThanOrEqual(4);
  });

  // ── Error state ────────────────────────────────────────────────────────────

  it('shows error state when fetch fails', async () => {
    getRevenueMock.mockRejectedValue(new Error('network error'));
    listTenantsMock.mockResolvedValue([]);
    listPlansMock.mockResolvedValue([]);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-error')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Coba lagi/ })).toBeInTheDocument();
  });

  it('retry button re-fetches data', async () => {
    getRevenueMock.mockRejectedValueOnce(new Error('fail'));
    listTenantsMock.mockResolvedValue([]);
    listPlansMock.mockResolvedValue([]);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-error')).toBeInTheDocument();
    });

    // Set up success for retry
    getRevenueMock.mockResolvedValue(emptyPlanStats);

    fireEvent.click(screen.getByRole('button', { name: /Coba lagi/ }));

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-page')).toBeInTheDocument();
    });
  });

  // ── Coverage gaps ─────────────────────────────────────────────────────────

  it('renders coverage gaps callout when OVERDUE tenants exist', async () => {
    getRevenueMock.mockResolvedValue(emptyMonthStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);

    mockSupabase([
      {
        tenant_id: 't1',
        tenant_slug: 'garindo',
        tenant_name: 'Garindo',
        coverage_status: 'OVERDUE',
      },
    ]);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('coverage-gaps-callout')).toBeInTheDocument();
    });

    expect(screen.getByText(/Kesenjangan pembayaran/)).toBeInTheDocument();
    expect(screen.getByText('Garindo')).toBeInTheDocument();
  });

  it('does not render coverage gaps callout when no OVERDUE tenants', async () => {
    getRevenueMock.mockResolvedValue(emptyMonthStats);
    listTenantsMock.mockResolvedValue(tenants);
    listPlansMock.mockResolvedValue(plans);
    mockSupabase([]); // No OVERDUE tenants

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-page')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('coverage-gaps-callout')).not.toBeInTheDocument();
  });

  // ── ARR / MRR computation ─────────────────────────────────────────────────

  it('computes ARR from active tenants and plan prices', async () => {
    getRevenueMock.mockResolvedValue(emptyMonthStats);
    listTenantsMock.mockResolvedValue(tenants); // t1=PREMIUM(12M) + t2=PRO(7.2M)
    listPlansMock.mockResolvedValue(plans);

    render(<AdminRevenue />);

    await waitFor(() => {
      expect(screen.getByTestId('admin-revenue-page')).toBeInTheDocument();
    });

    // ARR = 12_000_000 + 7_200_000 = 19_200_000
    expect(screen.getByText('Rp 19.200.000')).toBeInTheDocument();
    // MRR = 19_200_000 / 12 = 1_600_000
    expect(screen.getByText('Rp 1.600.000')).toBeInTheDocument();
  });

  // ── Page title ────────────────────────────────────────────────────────────

  it('renders page title "Pendapatan"', async () => {
    getRevenueMock.mockResolvedValue(emptyMonthStats);
    listTenantsMock.mockResolvedValue([]);
    listPlansMock.mockResolvedValue([]);

    render(<AdminRevenue />);

    // Title visible during loading too
    expect(screen.getByText('Pendapatan')).toBeInTheDocument();
  });
});
