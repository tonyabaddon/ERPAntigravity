import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, tagihanId: string, tagihanTotal: number;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  const sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
  const { data: psn } = await sb.rpc('record_pesanan', {
    payload: { supplier_id: supplierId, initial_status: 'ORDERED',
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 10000 }] },
  });
  const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', (psn as any).pesanan_id);
  const { data: tgh } = await sb.rpc('record_pi', {
    payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: (psn as any).pesanan_id,
      payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 10000, sell_price: 0, pesanan_item_id: items![0].id }] },
  });
  tagihanId = (tgh as any).pi_id;
  tagihanTotal = 10000;
});

describe('record_pembayaran', () => {
  test('full payment → Tagihan status LUNAS', async () => {
    const { data, error } = await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'TRANSFER',
        items: [{ tagihan_id: tagihanId, amount: tagihanTotal }] },
    });
    expect(error).toBeNull();
    expect((data as any).pembayaran_number).toMatch(/^PMB-\d{4}-\d{2}-\d{3}$/);
    const { data: t } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', tagihanId).single();
    expect(t!.status).toBe('LUNAS');
    expect(Number(t!.paid_amount)).toBe(tagihanTotal);
  });

  test('partial payment → DIBAYAR_SEBAGIAN', async () => {
    const sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
    const { data: psn } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 5000 }] },
    });
    const { data: items } = await sb.from('pesanan_items').select('id').eq('pesanan_id', (psn as any).pesanan_id);
    const { data: tgh } = await sb.rpc('record_pi', {
      payload: { type: 'STOCK', supplier_id: supplierId, pesanan_id: (psn as any).pesanan_id,
        payment_method: 'TEMPO', payment_due_at: '2026-07-30', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 5000, sell_price: 0, pesanan_item_id: items![0].id }] },
    });
    await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'CASH',
        items: [{ tagihan_id: (tgh as any).pi_id, amount: 2000 }] },
    });
    const { data: t } = await sb.from('purchase_invoices').select('status').eq('id', (tgh as any).pi_id).single();
    expect(t!.status).toBe('DIBAYAR_SEBAGIAN');
  });

  test('rejects overpayment', async () => {
    const { error } = await sb.rpc('record_pembayaran', {
      payload: { supplier_id: supplierId, payment_method: 'CASH',
        items: [{ tagihan_id: tagihanId, amount: 999999 }] },
    });
    expect(error).not.toBeNull();
  });
});
