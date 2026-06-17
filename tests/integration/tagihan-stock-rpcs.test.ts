import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, sku: string, pesananId: string, pesananItemId: string;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
  const { data: psn } = await sb.rpc('record_pesanan', {
    payload: { supplier_id: supplierId, initial_status: 'ORDERED',
      items: [{ sku, product_name: 'X', qty: 100, unit_cost: 1000 }] },
  });
  pesananId = (psn as any).pesanan_id;
  const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', pesananId);
  pesananItemId = items![0].id;
});

describe('record_pi type=STOCK', () => {
  test('creates Tagihan STOCK with pesanan_id and increments stock', async () => {
    const { data: before } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    const { data, error } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: pesananId,
        payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 60, unit_cost: 1000, sell_price: 0, pesanan_item_id: pesananItemId }] },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
    const { data: after } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    expect(after!.stock).toBeGreaterThan(before!.stock);
  });

  test('rejects STOCK without pesanan_id', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 0 }] },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/pesanan_id required for type=STOCK/);
  });

  test('updates pesanan_items.qty_received_total via trigger', async () => {
    const { data } = await sb.from('pesanan_items').select('qty_received_total').eq('id', pesananItemId).single();
    expect(data!.qty_received_total).toBeGreaterThanOrEqual(60);
  });
});
