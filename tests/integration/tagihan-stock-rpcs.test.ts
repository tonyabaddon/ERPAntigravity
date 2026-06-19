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

  test('initial_status=LUNAS synthesizes pembayaran + pembayaran_items + flips Tagihan to LUNAS', async () => {
    // Use a separate Pesanan so we don't interfere with state from earlier tests
    // in this file (which already partially-receive against pesananItemId).
    const { data: psn2 } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 7777 }] },
    });
    const psn2Id = (psn2 as any).pesanan_id;
    const { data: items2 } = await sb.from('pesanan_items').select('id').eq('pesanan_id', psn2Id);
    const pesananItem2Id = items2![0].id;

    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        type: 'STOCK',
        supplier_id: supplierId,
        pesanan_id: psn2Id,
        payment_method: 'TRANSFER',
        initial_status: 'LUNAS',
        notes: 'integration test LUNAS shortcut',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 7777, sell_price: 0, pesanan_item_id: pesananItem2Id }],
      },
    });
    expect(error).toBeNull();
    const tagihanId = (data as any).pi_id;

    // Tagihan flipped to LUNAS via _recompute_tagihan_status (sum-of-truth)
    const { data: t } = await sb.from('purchase_invoices')
      .select('status, paid_amount, paid_at')
      .eq('id', tagihanId).single();
    expect(t!.status).toBe('LUNAS');
    expect(Number(t!.paid_amount)).toBe(7777);
    expect(t!.paid_at).not.toBeNull();

    // Exactly one pembayaran_items row links to this Tagihan with full amount
    const { data: pi_items } = await sb.from('pembayaran_items')
      .select('amount, pembayaran_id')
      .eq('tagihan_id', tagihanId);
    expect(pi_items).toHaveLength(1);
    expect(Number(pi_items![0].amount)).toBe(7777);

    // Synthesized Pembayaran row exists with the right shape; account_id intentionally NULL
    const { data: pmb } = await sb.from('pembayaran')
      .select('pembayaran_number, supplier_id, account_id, account_label, amount_total, payment_method, status')
      .eq('id', pi_items![0].pembayaran_id).single();
    expect(pmb!.supplier_id).toBe(supplierId);
    expect(pmb!.account_id).toBeNull();
    expect(pmb!.account_label).toBeNull();
    expect(Number(pmb!.amount_total)).toBe(7777);
    expect(pmb!.payment_method).toBe('TRANSFER');
    expect(pmb!.status).toBe('LUNAS');
    expect(pmb!.pembayaran_number).toMatch(/^PMB-\d{4}-\d{2}-\d{3}$/);

    // Exactly one kasir expense row references the synthesized PMB and includes the "otomatis dari" suffix
    const { data: kasir } = await sb.from('kasir_transactions')
      .select('description, expense_category, subtotal')
      .like('description', `%${pmb!.pembayaran_number}%`);
    expect(kasir).toHaveLength(1);
    expect(kasir![0].description).toContain('otomatis dari TGH');
    expect(kasir![0].expense_category).toBe('Pembelian Stok');
    expect(Number(kasir![0].subtotal)).toBe(7777);
  });
});
