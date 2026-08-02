/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LaporanScreen — FE state coverage tests (2J partial)
 *
 * Covers: loading state, empty state, error state for the Performa tab.
 * The Akuntansi tab delegates to AkuntansiLaporanTab (tested separately).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LaporanScreen from './LaporanScreen';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock heavy sub-components that have their own tests or deep dependency trees.
vi.mock('./laporan/akuntansi/AkuntansiLaporanTab', () => ({
  default: () => <div data-testid="akuntansi-tab" />,
}));
vi.mock('./laporan/SlowMoverTable', () => ({
  default: () => <div data-testid="slow-mover-table" />,
}));
vi.mock('./laporan/TopCustomerTable', () => ({
  default: () => <div data-testid="top-customer-table" />,
}));
vi.mock('./laporan/LayananSection', () => ({
  default: () => <div data-testid="layanan-section" />,
}));

// Mock recharts to avoid SVG rendering issues in jsdom.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// Central mock for dashboardReports API
const mockGetPerformaSummaryWithDelta = vi.fn();
const mockGetProfitPerChannel = vi.fn();
vi.mock('../lib/dashboardReports/api', () => ({
  getPerformaSummaryWithDelta: (...args: unknown[]) => mockGetPerformaSummaryWithDelta(...args),
  getProfitPerChannel: (...args: unknown[]) => mockGetProfitPerChannel(...args),
}));

// Mock reportsService
const mockFetchDailyRevenueByChannel = vi.fn();
const mockFetchTopProducts = vi.fn();
vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  reportsService: {
    fetchDailyRevenueByChannel: (...args: unknown[]) => mockFetchDailyRevenueByChannel(...args),
    fetchTopProducts: (...args: unknown[]) => mockFetchTopProducts(...args),
  },
}));

vi.mock('../lib/salesChannels', () => ({
  CHANNEL_VISUAL: {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PERF_SUMMARY = {
  revenue: 10_000_000,
  prev_revenue: 8_000_000,
  gross_profit: 3_000_000,
  prev_gross_profit: 2_500_000,
  order_count: 42,
  prev_order_count: 35,
  avg_order_value: 238095,
  prev_avg_order_value: 228571,
};

const PROFIT_PER_CHANNEL = [
  { channel: 'Walk-in', revenue: 6_000_000, gross_profit: 2_000_000, margin_pct: 33.3 },
];

const DAILY_REVENUE = [
  { Day: '2026-07-14', 'Walk-in': 1_000_000, Tokopedia: 0, Grosir: 0, 'WA AI': 0 },
];

const BASE_PROPS = {
  showToast: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LaporanScreen — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Never resolve — keeps component in loading state indefinitely
    mockGetPerformaSummaryWithDelta.mockReturnValue(new Promise(() => {}));
    mockGetProfitPerChannel.mockReturnValue(new Promise(() => {}));
    mockFetchDailyRevenueByChannel.mockReturnValue(new Promise(() => {}));
    mockFetchTopProducts.mockReturnValue(new Promise(() => {}));
  });

  it('shows "Memuat..." placeholder in KPI cards while data loads', () => {
    render(<LaporanScreen {...BASE_PROPS} />);
    // All KPI sub-text shows loading state while perfSummary = null
    const loadingTexts = screen.getAllByText('Memuat...');
    expect(loadingTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows "..." as KPI value placeholders while loading', () => {
    render(<LaporanScreen {...BASE_PROPS} />);
    const ellipses = screen.getAllByText('...');
    expect(ellipses.length).toBeGreaterThanOrEqual(4); // 4 KPI cards
  });
});

describe('LaporanScreen — success / empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPerformaSummaryWithDelta.mockResolvedValue(PERF_SUMMARY);
    mockGetProfitPerChannel.mockResolvedValue(PROFIT_PER_CHANNEL);
    mockFetchDailyRevenueByChannel.mockResolvedValue(DAILY_REVENUE);
    mockFetchTopProducts.mockResolvedValue([]);
  });

  it('renders KPI values after successful fetch', async () => {
    render(<LaporanScreen {...BASE_PROPS} />);
    // formatRupiah(10_000_000) in id-ID locale
    await waitFor(() => {
      expect(screen.getByText(/10\.000\.000/)).toBeInTheDocument();
    });
  });

  it('shows empty state for Produk Terlaris when topProducts returns []', async () => {
    render(<LaporanScreen {...BASE_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText(/Belum ada data produk untuk periode ini/i)).toBeInTheDocument();
    });
  });

  it('shows "Belum ada data" when profitPerChannel returns empty array', async () => {
    mockGetProfitPerChannel.mockResolvedValue([]);
    render(<LaporanScreen {...BASE_PROPS} />);
    await waitFor(() => {
      expect(screen.getByText('Belum ada data')).toBeInTheDocument();
    });
  });
});

describe('LaporanScreen — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Toast spy already cleared
  });

  it('shows KPI error alert when getPerformaSummaryWithDelta rejects', async () => {
    mockGetPerformaSummaryWithDelta.mockRejectedValue(new Error('network error'));
    mockGetProfitPerChannel.mockResolvedValue([]);
    mockFetchDailyRevenueByChannel.mockResolvedValue([]);
    mockFetchTopProducts.mockResolvedValue([]);

    render(<LaporanScreen {...BASE_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat ringkasan performa/i)).toBeInTheDocument();
    });
  });

  it('shows chart error when fetchDailyRevenueByChannel rejects', async () => {
    mockGetPerformaSummaryWithDelta.mockResolvedValue(PERF_SUMMARY);
    mockGetProfitPerChannel.mockResolvedValue([]);
    mockFetchDailyRevenueByChannel.mockRejectedValue(new Error('network error'));
    mockFetchTopProducts.mockResolvedValue([]);

    render(<LaporanScreen {...BASE_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat grafik revenue/i)).toBeInTheDocument();
    });
  });

  it('shows channel error when getProfitPerChannel rejects', async () => {
    mockGetPerformaSummaryWithDelta.mockResolvedValue(PERF_SUMMARY);
    mockGetProfitPerChannel.mockRejectedValue(new Error('network error'));
    mockFetchDailyRevenueByChannel.mockResolvedValue([]);
    mockFetchTopProducts.mockResolvedValue([]);

    render(<LaporanScreen {...BASE_PROPS} />);

    await waitFor(() => {
      expect(screen.getByText(/Gagal memuat data channel/i)).toBeInTheDocument();
    });
  });

  it('calls showToast when any fetch fails', async () => {
    mockGetPerformaSummaryWithDelta.mockRejectedValue(new Error('fail'));
    mockGetProfitPerChannel.mockResolvedValue([]);
    mockFetchDailyRevenueByChannel.mockResolvedValue([]);
    mockFetchTopProducts.mockResolvedValue([]);

    render(<LaporanScreen {...BASE_PROPS} />);

    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Sebagian data laporan gagal dimuat'),
        'warning',
      );
    });
  });
});
