// tests/integration/pi-phase1-record.test.ts
// BNL Phase 1 — Task 5: integration tests for record_pi RPC.
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;
const sb = createClient(url, key);

let supplierId: string;
let orderId: string;
let sku: string;

beforeAll(async () => {
  const { data: sup } = await sb.from('suppliers').select('id').limit(1).single();
  supplierId = sup!.id;
  const { data: ord } = await sb.from('orders').select('id').limit(1).single();
  orderId = ord!.id;
  const { data: stk } = await sb.from('stocks').select('sku').limit(1).single();
  sku = stk!.sku;
});

describe('record_pi', () => {
  test('creates BELUM_LUNAS PI and returns pi_number', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        order_id: orderId,
        payment_method: 'TEMPO',
        payment_due_at: '2026-07-14',
        initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'Test', qty: 2, unit_cost: 10000, sell_price: 15000 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
    expect(String((data as any).pi_number)).toMatch(/^PI-\d{4}-\d{2}-\d{3}$/);
  });

  test('creates LUNAS PI and inserts Kasir expense', async () => {
    const before = await sb.from('kasir_transactions').select('id', { count: 'exact', head: true })
      .eq('expense_category', 'Pembelian Pass-Through');
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        order_id: orderId,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku, product_name: 'Test', qty: 1, unit_cost: 5000, sell_price: 8000 }],
      },
    });
    expect(error).toBeNull();
    const after = await sb.from('kasir_transactions').select('id', { count: 'exact', head: true })
      .eq('expense_category', 'Pembelian Pass-Through');
    expect((after.count ?? 0)).toBeGreaterThan(before.count ?? 0);
  });

  test('rejects when order_id missing for PASSTHROUGH', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId,
        payment_method: 'CASH',
        initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    expect(error).not.toBeNull();
  });

  test('rejects empty items', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'CASH', initial_status: 'LUNAS', items: [],
      },
    });
    expect(error).not.toBeNull();
  });

  test('rejects BELUM_LUNAS without payment_due_at', async () => {
    const { error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'TEMPO', initial_status: 'BELUM_LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    expect(error).not.toBeNull();
  });

  test('zero stock impact: stocks.stock unchanged after record_pi', async () => {
    const { data: before } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 10, unit_cost: 1000, sell_price: 2000 }],
      },
    });
    const { data: after } = await sb.from('stocks').select('stock').eq('sku', sku).single();
    expect(after!.stock).toBe(before!.stock);
  });
});
