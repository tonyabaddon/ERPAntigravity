import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QtyTiersEditor from './QtyTiersEditor';
import * as supabaseClientModule from '../../lib/supabaseClient';
import type { StockQtyTier } from '../../types';

vi.mock('../../lib/supabaseClient', async (importOriginal) => {
  const original = await importOriginal<typeof supabaseClientModule>();
  return {
    ...original,
    stockService: {
      setQtyTiers: vi.fn(),
      deleteAllQtyTiers: vi.fn(),
    },
  };
});

const BASE_PROPS = {
  stockSku: 'TJM-EL-002',
  basePrice: 18000,
  initialTiers: [] as StockQtyTier[],
  onSaved: vi.fn(),
  showToast: vi.fn(),
};

describe('QtyTiersEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabaseClientModule.stockService.setQtyTiers as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('renders empty state with 1 blank row when initialTiers is empty', () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    // Expect at least one row with min_qty + price inputs
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(1);
    expect(screen.getAllByLabelText(/harga/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders initialTiers when present', () => {
    const tiers: StockQtyTier[] = [
      { stock_sku: 'TJM-EL-002', min_qty: 5, price: 16000 },
      { stock_sku: 'TJM-EL-002', min_qty: 10, price: 15000 },
    ];
    render(<QtyTiersEditor {...BASE_PROPS} initialTiers={tiers} />);
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(2);
  });

  it('"+ Tambah tier volume" adds a row up to cap of 5', () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    const addBtn = screen.getByRole('button', { name: /tambah tier/i });
    // 1 default row; click 4 times to reach cap 5
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);
    expect(screen.getAllByLabelText(/mulai/i)).toHaveLength(5);
    // 5th click — button should be disabled
    expect(addBtn).toBeDisabled();
  });

  it('save calls setQtyTiers with sorted non-empty rows', async () => {
    render(<QtyTiersEditor {...BASE_PROPS} />);
    const minQtyInput = screen.getByLabelText(/mulai/i);
    const priceInput = screen.getAllByLabelText(/harga/i)[0];

    fireEvent.change(minQtyInput, { target: { value: '5' } });
    fireEvent.change(priceInput, { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));

    await waitFor(() => {
      expect(supabaseClientModule.stockService.setQtyTiers).toHaveBeenCalledWith(
        'TJM-EL-002',
        [{ min_qty: 5, price: 16000 }],
      );
    });
    expect(BASE_PROPS.onSaved).toHaveBeenCalled();
    expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/tersimpan/i), 'success');
  });

  it('maps QTP_INVALID_MIN_QTY error to Bahasa toast', async () => {
    (supabaseClientModule.stockService.setQtyTiers as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('QTP_INVALID_MIN_QTY'), { code: 'P0400', hint: '1' })
    );
    render(<QtyTiersEditor {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/mulai/i), { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText(/harga/i)[0], { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/minimal.*2/i), 'warning');
    });
  });

  it('maps QTP_TOO_MANY_TIERS to Bahasa toast', async () => {
    (supabaseClientModule.stockService.setQtyTiers as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new Error('QTP_TOO_MANY_TIERS'), { code: 'P0400' })
    );
    render(<QtyTiersEditor {...BASE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/mulai/i), { target: { value: '5' } });
    fireEvent.change(screen.getAllByLabelText(/harga/i)[0], { target: { value: '16000' } });
    fireEvent.click(screen.getByRole('button', { name: /simpan/i }));
    await waitFor(() => {
      expect(BASE_PROPS.showToast).toHaveBeenCalledWith(expect.stringMatching(/max 5/i), 'warning');
    });
  });
});
