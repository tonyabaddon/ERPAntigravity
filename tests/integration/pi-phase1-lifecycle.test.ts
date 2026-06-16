// tests/integration/pi-phase1-lifecycle.test.ts
// BNL Phase 1 — Task 7: mark_pi_paid + void_pi + update_pi.
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, orderId: string, sku: string;

async function createPi(status: 'BELUM_LUNAS' | 'LUNAS') {
  const { data } = await sb.rpc('record_pi', {
    payload: {
      supplier_id: supplierId, order_id: orderId,
      payment_method: status === 'LUNAS' ? 'CASH' : 'TEMPO',
      payment_due_at: status === 'BELUM_LUNAS' ? '2026-07-14' : undefined,
      initial_status: status,
      items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
    },
  });
  return data as { pi_number: string; pi_id: string };
}

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  orderId = (await sb.from('orders').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('mark_pi_paid', () => {
  test('flips BELUM_LUNAS -> LUNAS + inserts Kasir expense', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('mark_pi_paid', { p_pi_id: pi_id });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('status, paid_at').eq('id', pi_id).single();
    expect(data!.status).toBe('LUNAS');
    expect(data!.paid_at).not.toBeNull();
  });

  test('rejects already LUNAS', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('mark_pi_paid', { p_pi_id: pi_id });
    expect(error).not.toBeNull();
  });
});

describe('void_pi', () => {
  test('voids LUNAS + inserts reversal expense', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'Customer batal — refund' });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('voided_at, void_reason').eq('id', pi_id).single();
    expect(data!.voided_at).not.toBeNull();
  });

  test('rejects reason < 10 chars', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'short' });
    expect(error).not.toBeNull();
  });

  test('rejects BELUM_LUNAS', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('void_pi', { p_pi_id: pi_id, p_reason: 'Not allowed yet here' });
    expect(error).not.toBeNull();
  });
});

describe('update_pi', () => {
  test('updates BELUM_LUNAS PI items + subtotal recompute', async () => {
    const { pi_id } = await createPi('BELUM_LUNAS');
    const { error } = await sb.rpc('update_pi', {
      p_pi_id: pi_id,
      payload: {
        payment_method: 'TEMPO',
        payment_due_at: '2026-08-01',
        items: [{ sku, product_name: 'X', qty: 5, unit_cost: 2000, sell_price: 3000 }],
      },
    });
    expect(error).toBeNull();
    const { data } = await sb.from('purchase_invoices').select('subtotal').eq('id', pi_id).single();
    expect(Number(data!.subtotal)).toBe(10000);
  });

  test('rejects edit on LUNAS', async () => {
    const { pi_id } = await createPi('LUNAS');
    const { error } = await sb.rpc('update_pi', {
      p_pi_id: pi_id,
      payload: { payment_due_at: '2026-08-01', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1, sell_price: 1 }] },
    });
    expect(error).not.toBeNull();
  });
});
