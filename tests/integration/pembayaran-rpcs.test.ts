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

  test('void_pembayaran on synthesized (LUNAS-shortcut) Pembayaran reverses Tagihan to BELUM_LUNAS', async () => {
    // Create a Tagihan via LUNAS shortcut — this synthesizes a Pembayaran inline
    const sku2 = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
    const { data: psn3 } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED',
        items: [{ sku: sku2, product_name: 'X', qty: 1, unit_cost: 3333 }] },
    });
    const psn3Id = (psn3 as any).pesanan_id;
    const { data: items3 } = await sb.from('pesanan_items').select('id').eq('pesanan_id', psn3Id);
    const { data: tgh } = await sb.rpc('record_pi', {
      payload: {
        type: 'STOCK',
        supplier_id: supplierId,
        pesanan_id: psn3Id,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku: sku2, product_name: 'X', qty: 1, unit_cost: 3333, sell_price: 0, pesanan_item_id: items3![0].id }],
      },
    });
    const synthTagihanId = (tgh as any).pi_id;

    // Look up the synthesized Pembayaran via the join
    const { data: link } = await sb.from('pembayaran_items')
      .select('pembayaran_id').eq('tagihan_id', synthTagihanId).single();
    const synthPmbId = link!.pembayaran_id;

    // Pre-void sanity
    const { data: tPre } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', synthTagihanId).single();
    expect(tPre!.status).toBe('LUNAS');
    expect(Number(tPre!.paid_amount)).toBe(3333);

    // Void it
    const { error: voidErr } = await sb.rpc('void_pembayaran', {
      p_pembayaran_id: synthPmbId,
      p_reason: 'integration test reversal of synthesized PMB',
    });
    expect(voidErr).toBeNull();

    // Tagihan back to BELUM_LUNAS, paid_amount=0
    const { data: tPost } = await sb.from('purchase_invoices').select('status, paid_amount').eq('id', synthTagihanId).single();
    expect(tPost!.status).toBe('BELUM_LUNAS');
    expect(Number(tPost!.paid_amount)).toBe(0);

    // Reverse kasir entry inserted (negative subtotal, description prefix 'VOID Pembayaran')
    const { data: pmb } = await sb.from('pembayaran').select('pembayaran_number').eq('id', synthPmbId).single();
    const { data: reverseKasir } = await sb.from('kasir_transactions')
      .select('subtotal, description')
      .like('description', `%VOID Pembayaran ${pmb!.pembayaran_number}%`);
    expect(reverseKasir).toHaveLength(1);
    expect(Number(reverseKasir![0].subtotal)).toBeLessThan(0);
  });
});
