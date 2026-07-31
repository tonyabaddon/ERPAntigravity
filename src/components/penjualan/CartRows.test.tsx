/**
 * CartRows.test.tsx — Phase 2.2 manual override toggle
 *
 * Tests:
 *   1. Renders LockOpen icon toggle button per cart line (manual mode OFF).
 *   2. Toggle click calls onToggleManual with the correct key.
 *   3a. When item.manual_override=true, handlePriceChange calls onManualPriceOverride.
 *   3b. When item.manual_override=false, handlePriceChange calls onDiscountChange.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CartRows from './CartRows';
import type { KasirItem } from '../../types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../hooks/useWarehouses', () => ({
  useWarehouses: () => ({ warehouses: [], loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('../warehouse/WarehousePicker', () => ({
  default: () => null,
}));

vi.mock('../../contexts/TenantContext', () => ({
  useTenant: () => ({ tenant_id: 'test-tenant' }),
}));

vi.mock('../../lib/supabaseClient', () => ({
  isSupabaseConfigured: false,
  supabase: null,
  warehousesService: {
    fetchActive: vi.fn().mockResolvedValue([]),
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<KasirItem & { _key: number }> = {}): KasirItem & { _key: number } {
  return {
    _key: 1,
    sku: 'SKU-001',
    name: 'Test Produk',
    qty: 2,
    unit_price: 100_000,
    hpp_per_unit: 80_000,
    subtotal: 200_000,
    hpp_subtotal: 160_000,
    warehouse: null,
    warehouse_id: null,
    master_price_at_sale: 100_000,
    discount_type: null,
    discount_value: null,
    discount_amount_rp: 0,
    manual_override: false,
    ...overrides,
  };
}

const noopStock = [] as never[];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CartRows — Phase 2.2 manual override toggle', () => {
  it('renders LockOpen icon toggle button per line when manual_override is false', () => {
    render(
      <CartRows
        items={[makeItem()]}
        stocks={noopStock}
        onQtyChange={vi.fn()}
        onWarehouseChange={vi.fn()}
        onRemove={vi.fn()}
        modulDiskonOn={true}
        onToggleManual={vi.fn()}
        onManualPriceOverride={vi.fn()}
      />
    );

    // Tooltip for inactive (LockOpen) state
    const btn = screen.getByTitle('Klik untuk edit harga manual (bukan diskon)');
    expect(btn).toBeTruthy();
  });

  it('calls onToggleManual with the correct key when toggle button is clicked', () => {
    const onToggleManual = vi.fn();
    const item = makeItem({ _key: 42 });

    render(
      <CartRows
        items={[item]}
        stocks={noopStock}
        onQtyChange={vi.fn()}
        onWarehouseChange={vi.fn()}
        onRemove={vi.fn()}
        modulDiskonOn={true}
        onToggleManual={onToggleManual}
        onManualPriceOverride={vi.fn()}
      />
    );

    const btn = screen.getByTitle('Klik untuk edit harga manual (bukan diskon)');
    fireEvent.click(btn);

    expect(onToggleManual).toHaveBeenCalledTimes(1);
    expect(onToggleManual).toHaveBeenCalledWith(42);
  });

  it('when manual_override=true renders Lock icon with manual tooltip', () => {
    const item = makeItem({ _key: 7, manual_override: true });

    render(
      <CartRows
        items={[item]}
        stocks={noopStock}
        onQtyChange={vi.fn()}
        onWarehouseChange={vi.fn()}
        onRemove={vi.fn()}
        modulDiskonOn={true}
        onToggleManual={vi.fn()}
        onManualPriceOverride={vi.fn()}
      />
    );

    const btn = screen.getByTitle('Mode manual — harga diedit langsung');
    expect(btn).toBeTruthy();
  });

  it('when manual_override=true, price input change calls onManualPriceOverride (not onDiscountChange)', () => {
    const onManualPriceOverride = vi.fn();
    const onDiscountChange = vi.fn();
    const item = makeItem({ _key: 5, manual_override: true, unit_price: 90_000 });

    render(
      <CartRows
        items={[item]}
        stocks={noopStock}
        onQtyChange={vi.fn()}
        onWarehouseChange={vi.fn()}
        onRemove={vi.fn()}
        onDiscountChange={onDiscountChange}
        modulDiskonOn={true}
        onToggleManual={vi.fn()}
        onManualPriceOverride={onManualPriceOverride}
      />
    );

    // NumberInput renders <input type="text"> (role=textbox).
    // In manual mode the price input displays item.unit_price (90000).
    // serialise(90000) = "90000"
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const priceInput = inputs.find((inp) => inp.value === '90000');
    expect(priceInput).toBeTruthy();

    fireEvent.change(priceInput!, { target: { value: '95000' } });

    expect(onManualPriceOverride).toHaveBeenCalledWith(5, 95000);
    expect(onDiscountChange).not.toHaveBeenCalled();
  });

  it('when manual_override=false, price input change calls onDiscountChange (not onManualPriceOverride)', () => {
    const onManualPriceOverride = vi.fn();
    const onDiscountChange = vi.fn();
    const item = makeItem({ _key: 3, manual_override: false, unit_price: 100_000, master_price_at_sale: 100_000 });

    render(
      <CartRows
        items={[item]}
        stocks={noopStock}
        onQtyChange={vi.fn()}
        onWarehouseChange={vi.fn()}
        onRemove={vi.fn()}
        onDiscountChange={onDiscountChange}
        modulDiskonOn={true}
        onToggleManual={vi.fn()}
        onManualPriceOverride={onManualPriceOverride}
      />
    );

    // NumberInput renders <input type="text"> (role=textbox).
    // In discount mode the price input displays binding.state.typed_price
    // which initializes to master_price_at_sale (100000). serialise(100000) = "100000"
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    const priceInput = inputs.find((inp) => inp.value === '100000');
    expect(priceInput).toBeTruthy();

    // Type a price below master to trigger discount
    fireEvent.change(priceInput!, { target: { value: '90000' } });

    expect(onDiscountChange).toHaveBeenCalled();
    expect(onManualPriceOverride).not.toHaveBeenCalled();
  });
});
