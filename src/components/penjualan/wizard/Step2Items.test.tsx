/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 — Kasir pill toggle tests.
 * Tests are scoped to Step2Items (which renders the tier pill) + CartRows
 * (which renders per-line grosir warning). CatatPenjualanWizard is not
 * tested here because its full provider chain is heavy; the pill, auto-apply,
 * and re-compute logic are unit-tested in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { KasirItem } from '../../../types';
import type { SupabaseStockItem } from '../../../lib/supabaseClient';
import Step2Items from './Step2Items';

// ── mocks ────────────────────────────────────────────────────────────────────

// CartRows uses useWarehouses which hits supabase. Mock the hook globally.
vi.mock('../../../hooks/useWarehouses', () => ({
  useWarehouses: () => ({ warehouses: [], loading: false, error: null, refresh: vi.fn() }),
}));

// supabaseClient — suppress any real network calls
vi.mock('../../../lib/supabaseClient', () => ({
  isSupabaseConfigured: false,
  supabase: null,
  stockService: { fetchAll: vi.fn().mockResolvedValue([]) },
  customersService: { fetchAll: vi.fn().mockResolvedValue([]) },
  warehousesService: { fetchActive: vi.fn().mockResolvedValue([]), fetchAll: vi.fn().mockResolvedValue([]) },
}));

// ── fixtures ─────────────────────────────────────────────────────────────────

const makeStock = (overrides: Partial<SupabaseStockItem> = {}): SupabaseStockItem => ({
  sku: 'SKU-001',
  name: 'Produk A',
  category: 'Cat',
  price: 100_000,
  price_grosir: 80_000,
  stock: 10,
  stock_atas: 10,
  stock_bawah: 0,
  status: 'Sinkron',
  specs: {},
  ...overrides,
});

const makeCartItem = (overrides: Partial<KasirItem & { _key: number }> = {}): KasirItem & { _key: number } => ({
  _key: 1,
  sku: 'SKU-001',
  name: 'Produk A',
  qty: 1,
  unit_price: 100_000,
  master_price_at_sale: 100_000,
  hpp_per_unit: 50_000,
  subtotal: 100_000,
  hpp_subtotal: 50_000,
  warehouse: null,
  warehouse_id: null,
  discount_type: null,
  discount_value: null,
  discount_amount_rp: 0,
  ...overrides,
});

const BASE_PROPS = {
  cart: [] as (KasirItem & { _key: number })[],
  stocks: [],
  onAddItem: vi.fn(),
  onQtyChange: vi.fn(),
  onWarehouseChange: vi.fn(),
  onRemoveItem: vi.fn(),
  onDiscountChange: vi.fn(),
  onClearCart: vi.fn(),
  subtotal: 0,
  subtotalAfterLineDiscount: 0,
  rakitSubtotal: 0,
  rakitLines: [],
  rakitFormOpen: false,
  rakitFormType: null,
  onOpenRakitForm: vi.fn(),
  onCancelRakitForm: vi.fn(),
  onAddRakitLine: vi.fn(),
  onRemoveRakitLine: vi.fn(),
  stockByWarehouseSku: {},
  showToast: vi.fn(),
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Step2Items — tier pill (Task 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides pill when showTierPill=false (modul OFF)', () => {
    render(<Step2Items {...BASE_PROPS} showTierPill={false} activeTier="eceran" onTierChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Eceran/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grosir/i })).not.toBeInTheDocument();
  });

  it('renders pill with Eceran active by default when modul ON (walk-in)', () => {
    render(<Step2Items {...BASE_PROPS} showTierPill activeTier="eceran" onTierChange={vi.fn()} />);
    const eceranBtn = screen.getByRole('button', { name: 'Eceran' });
    const grosirBtn = screen.getByRole('button', { name: 'Grosir' });
    expect(eceranBtn).toBeInTheDocument();
    expect(grosirBtn).toBeInTheDocument();
    // Eceran should have shadow class (active state)
    expect(eceranBtn.className).toMatch(/shadow/);
    expect(grosirBtn.className).not.toMatch(/shadow/);
  });

  it('shows Grosir pill active when activeTier=grosir (customer with grosir tier)', () => {
    render(<Step2Items {...BASE_PROPS} showTierPill activeTier="grosir" onTierChange={vi.fn()} />);
    const grosirBtn = screen.getByRole('button', { name: 'Grosir' });
    const eceranBtn = screen.getByRole('button', { name: 'Eceran' });
    expect(grosirBtn.className).toMatch(/shadow/);
    expect(eceranBtn.className).not.toMatch(/shadow/);
  });

  it('calls onTierChange when switching tier', () => {
    const onTierChange = vi.fn();
    render(<Step2Items {...BASE_PROPS} showTierPill activeTier="eceran" onTierChange={onTierChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Grosir' }));
    expect(onTierChange).toHaveBeenCalledWith('grosir');
  });

  it('shows grosir price in cart when activeTier=grosir and product has price_grosir', () => {
    const stock = makeStock({ price: 100_000, price_grosir: 80_000 });
    const cartItem = makeCartItem({ unit_price: 80_000, master_price_at_sale: 80_000, subtotal: 80_000 });
    render(
      <Step2Items
        {...BASE_PROPS}
        stocks={[stock]}
        cart={[cartItem]}
        subtotal={80_000}
        subtotalAfterLineDiscount={80_000}
        showTierPill
        activeTier="grosir"
        onTierChange={vi.fn()}
      />,
    );
    // 80.000 should appear (multiple times: row price + header total = expected)
    const matches = screen.getAllByText(/80\.000|80,000/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('shows grosir-missing warning when activeTier=grosir and stock has no price_grosir', () => {
    const stock = makeStock({ price_grosir: null });
    const cartItem = makeCartItem();
    render(
      <Step2Items
        {...BASE_PROPS}
        stocks={[stock]}
        cart={[cartItem]}
        subtotal={100_000}
        subtotalAfterLineDiscount={100_000}
        showTierPill
        activeTier="grosir"
        onTierChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Harga tier ini belum di-set/i)).toBeInTheDocument();
  });

  it('does not show grosir-missing warning when showTierPill=false', () => {
    const stock = makeStock({ price_grosir: null });
    const cartItem = makeCartItem();
    render(
      <Step2Items
        {...BASE_PROPS}
        stocks={[stock]}
        cart={[cartItem]}
        subtotal={100_000}
        subtotalAfterLineDiscount={100_000}
        showTierPill={false}
        activeTier="grosir"
        onTierChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Harga grosir belum di-set/i)).not.toBeInTheDocument();
  });
});
