import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { from: vi.fn() },
}));

import { insertNewProduct } from './productWrappers';
import { supabase } from '../supabaseClient';

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  fromMock.mockReset();
});

describe('insertNewProduct', () => {
  function setupSuccess(row: object) {
    const single = vi.fn().mockResolvedValueOnce({ data: row, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ insert });
    return { insert, select, single };
  }

  it('inserts row with required defaults', async () => {
    const { insert } = setupSuccess({ sku: 'new-sku', name: 'X', stock_atas: 0 });
    await insertNewProduct({ name: 'X', category: 'MCB', price: 1000 });

    expect(fromMock).toHaveBeenCalledWith('stocks');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'X',
      category: 'MCB',
      price: 1000,
      stock_atas: 0,
      stock_bawah: 0,
      stock: 0,
      status: 'aktif',
      unit: 'pcs',
    }));
  });

  it('uses provided optional values', async () => {
    const { insert } = setupSuccess({ sku: 'new-sku', name: 'X' });
    await insertNewProduct({
      name: 'X', category: 'MCB', price: 1000,
      harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
    }));
  });

  it('throws on missing name', async () => {
    await expect(insertNewProduct({ name: '   ', category: 'MCB', price: 1 }))
      .rejects.toThrow(/name/i);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('throws on missing category', async () => {
    await expect(insertNewProduct({ name: 'X', category: '', price: 1 }))
      .rejects.toThrow(/category/i);
  });

  it('throws on non-positive price', async () => {
    await expect(insertNewProduct({ name: 'X', category: 'MCB', price: 0 }))
      .rejects.toThrow(/price/i);
  });

  it('throws when Supabase returns error', async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'unique fail' } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ insert });

    await expect(insertNewProduct({ name: 'X', category: 'MCB', price: 1 }))
      .rejects.toThrow('unique fail');
  });
});
