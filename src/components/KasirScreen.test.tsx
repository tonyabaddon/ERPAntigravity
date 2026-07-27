/**
 * KasirScreen — ExpenseModal dropdown tests (Task 11)
 *
 * Covers the refactored ExpenseModal that reads categories from
 * useKasirExpenseCategories instead of the hardcoded EXPENSE_CATEGORIES array.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KasirScreen from './KasirScreen';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: false,
  supabase: null,
  kasirService: {
    fetchTransactions: vi.fn().mockResolvedValue([]),
    fetchWaOrdersForDate: vi.fn().mockResolvedValue([]),
    computeDailySummary: vi.fn().mockReturnValue(null),
    insertExpense: vi.fn().mockResolvedValue(undefined),
  },
  stockService: {
    fetchAll: vi.fn().mockResolvedValue([]),
  },
  customersService: {
    fetchAll: vi.fn().mockResolvedValue([]),
  },
  orderService: {},
}));

vi.mock('../lib/salesChannels', () => ({
  CHANNEL_GROUPS: { marketplace: [], walkin: [], wa: [] },
  CHANNEL_VISUAL: {},
}));

vi.mock('./KasirInvoiceModal', () => ({
  default: () => null,
}));

vi.mock('./penjualan/MarkLunasModal', () => ({
  default: () => null,
}));

vi.mock('./penjualan/SalesInvoicePDF', () => ({
  default: () => null,
}));

vi.mock('./kasir/CariByFotoModal', () => ({
  default: () => null,
}));

vi.mock('./kasir/HasilCariFotoModal', () => ({
  default: () => null,
}));

vi.mock('../lib/hooks/useKasirExpenseCategories', () => ({
  useKasirExpenseCategories: vi.fn(),
  kasirExpenseCategoriesQueryKey: (t: string) => ['kasir-expense-categories', t],
}));

vi.mock('../contexts/TenantContext', () => ({
  useTenant: () => ({ tenant_id: 'test-tenant' }),
}));

// ── Hook reference ─────────────────────────────────────────────────────────────

import { useKasirExpenseCategories } from '../lib/hooks/useKasirExpenseCategories';
const mockCatHook = useKasirExpenseCategories as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────────────

const ALL_PERMS = new Proxy({} as Record<string, boolean>, { get: () => true });

const mockUser = {
  name: 'Owner Test',
  role: 'Owner',
  permissions: ALL_PERMS as never,
};

function withQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function renderKasir() {
  return render(
    withQuery(
      <KasirScreen
        currentUser={mockUser}
        showToast={vi.fn()}
        onOpenPenjualanBaru={vi.fn()}
      />
    )
  );
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('KasirScreen ExpenseModal dropdown (post-config)', () => {
  const activeCats = [
    { id: 'a', tenant_id: 't', label: 'Gaji',      sort_order: 10, active: true,  is_system: false, deleted_at: null, created_at: '', updated_at: '' },
    { id: 'b', tenant_id: 't', label: 'Sewa',      sort_order: 20, active: true,  is_system: false, deleted_at: null, created_at: '', updated_at: '' },
    { id: 'c', tenant_id: 't', label: 'Marketing', sort_order: 30, active: false, is_system: false, deleted_at: null, created_at: '', updated_at: '' },
  ];

  beforeEach(() => {
    mockCatHook.mockReset();
  });

  function openExpenseModal() {
    // Multiple "Pengeluaran" texts exist (filter tab + action button).
    // The action button wraps the text in a <span>; the filter button has text directly.
    // Find the button whose accessible name comes from a child span (the action button).
    const allButtons = screen.getAllByRole('button');
    const expenseActionBtn = allButtons.find(btn => {
      const span = btn.querySelector('span.font-black');
      return span && span.textContent === 'Pengeluaran';
    });
    if (!expenseActionBtn) throw new Error('Could not find Pengeluaran action button');
    fireEvent.click(expenseActionBtn);
  }

  it('dropdown shows only active categories from hook', () => {
    mockCatHook.mockReturnValue({ data: activeCats, isLoading: false, isError: false });
    renderKasir();
    openExpenseModal();

    const select = screen.getByLabelText(/Kategori/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map(o => o.value);
    expect(optionValues).toContain('Gaji');
    expect(optionValues).toContain('Sewa');
    expect(optionValues).not.toContain('Marketing');
  });

  it('dropdown disabled while loading', () => {
    mockCatHook.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderKasir();
    openExpenseModal();

    const select = screen.getByLabelText(/Kategori/i) as HTMLSelectElement;
    expect(select).toBeDisabled();
  });

  it('save button disabled on error state', () => {
    mockCatHook.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    renderKasir();
    openExpenseModal();

    expect(screen.getByRole('button', { name: /Simpan/i })).toBeDisabled();
  });
});
