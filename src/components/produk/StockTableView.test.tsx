/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StockTableView, { type StockTableViewPendingIndex } from './StockTableView';
import type { StockItem, Warehouse } from '../../types';

// ── minimal fixtures ────────────────────────────────────────────────────────

const makeItem = (overrides: Partial<StockItem> = {}): StockItem => ({
  sku: 'TEST-001',
  name: 'MCB Schneider 10A 1P',
  category: 'MCB',
  unit: 'pcs',
  price: 150000,
  stock: 20,
  status: 'Sinkron',
  specs: { mcb_merek: 'Schneider', mcb_ampere: '10', mcb_phase: '1P' },
  harga_modal: null,
  price_grosir: null,
  ...overrides,
});

const WAREHOUSES: Warehouse[] = [
  {
    id: 'wh-1',
    name: 'Gudang Atas',
    code: 'ATAS',
    is_default: true,
    is_active: true,
    tenant_id: null,
    address: null,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const PENDING_INDEX: StockTableViewPendingIndex = {
  adjMap: new Map(),
  priceMap: new Map(),
};

const BASE_PROPS = {
  stockList: [makeItem()],
  warehouses: WAREHOUSES,
  currentUser: null,
  pendingIndex: PENDING_INDEX,
  onDelete: vi.fn(),
  onTransfer: vi.fn(),
  onInlineUpdate: vi.fn(),
  onRequestPriceChange: vi.fn(),
  onRequestAdjustment: vi.fn(),
  showToast: vi.fn(),
};

// ── tests ───────────────────────────────────────────────────────────────────

describe('StockTableView — multi-tier grosir display', () => {
  it('modul OFF → shows single "Harga" label, no Grosir info', () => {
    render(<StockTableView {...BASE_PROPS} showGrosir={false} />);
    // Should show "Harga" label (not "Harga Eceran")
    expect(screen.getByText('Harga')).toBeInTheDocument();
    expect(screen.queryByText(/Harga Eceran/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grosir/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Belum di-set/i)).not.toBeInTheDocument();
  });

  it('modul ON → shows "Harga Eceran" label and "Grosir:" row', () => {
    const item = makeItem({ price_grosir: 120000 });
    render(
      <StockTableView
        {...BASE_PROPS}
        stockList={[item]}
        showGrosir={true}
      />,
    );
    expect(screen.getByText(/Harga Eceran/i)).toBeInTheDocument();
    expect(screen.getByText(/Grosir:/i)).toBeInTheDocument();
    // price_grosir = 120000 → rendered as currency, not "Belum di-set"
    expect(screen.queryByText(/Belum di-set/i)).not.toBeInTheDocument();
  });

  it('modul ON + null price_grosir → renders "Belum di-set" amber warning', () => {
    const item = makeItem({ price_grosir: null });
    render(
      <StockTableView
        {...BASE_PROPS}
        stockList={[item]}
        showGrosir={true}
      />,
    );
    expect(screen.getByText(/Belum di-set/i)).toBeInTheDocument();
  });
});
