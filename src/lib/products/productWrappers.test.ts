import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

import { insertNewProduct } from './productWrappers';
import { supabase } from '../supabaseClient';

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock.mockReset();
});

describe('insertNewProduct', () => {
  function setupSuccess(row: object) {
    rpcMock.mockResolvedValueOnce({ data: row, error: null });
    return {};
  }

  it('inserts row with required defaults', async () => {
    setupSuccess({ sku: 'new-sku', name: 'X', stock_atas: 0 });
    await insertNewProduct({ name: 'X', category: 'MCB', price: 1000 });

    expect(rpcMock).toHaveBeenCalledWith('admin_upsert_product', expect.objectContaining({
      p_input: expect.objectContaining({
        name: 'X',
        category: 'MCB',
        price: 1000,
        stock_atas: 0,
        stock_bawah: 0,
        stock: 0,
        status: 'Sinkron',
        unit: 'pcs',
      }),
    }));
  });

  it('uses provided optional values', async () => {
    setupSuccess({ sku: 'new-sku', name: 'X' });
    await insertNewProduct({
      name: 'X', category: 'MCB', price: 1000,
      harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
    });

    expect(rpcMock).toHaveBeenCalledWith('admin_upsert_product', expect.objectContaining({
      p_input: expect.objectContaining({
        harga_modal: 700, unit: 'box', subcategory: 'Schneider', brand: 'Schneider',
      }),
    }));
  });

  it('throws on missing name', async () => {
    await expect(insertNewProduct({ name: '   ', category: 'MCB', price: 1 }))
      .rejects.toThrow(/name/i);
    expect(rpcMock).not.toHaveBeenCalled();
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
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'unique fail' } });

    await expect(insertNewProduct({ name: 'X', category: 'MCB', price: 1 }))
      .rejects.toThrow('unique fail');
  });
});
