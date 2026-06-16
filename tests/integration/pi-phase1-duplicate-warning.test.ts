// tests/integration/pi-phase1-duplicate-warning.test.ts
// BNL Phase 1 — Task 6: BR6 soft duplicate supplier_invoice_number warning.
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string, orderId: string, sku: string;
const INVNUM = 'BR6-TEST-' + Date.now();

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  orderId = (await sb.from('orders').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('BR6 — duplicate supplier_invoice_number soft warning', () => {
  test('first insert succeeds', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
  });

  test('second insert with same supplier+invnum returns warning, no INSERT', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('warning', 'duplicate_supplier_invoice');
    expect(data).toHaveProperty('existing_pi');
  });

  test('ignore_duplicate_warning=true overrides and inserts', async () => {
    const { data, error } = await sb.rpc('record_pi', {
      payload: {
        supplier_id: supplierId, order_id: orderId,
        supplier_invoice_number: INVNUM,
        ignore_duplicate_warning: true,
        payment_method: 'CASH', initial_status: 'LUNAS',
        items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100, sell_price: 200 }],
      },
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty('pi_number');
  });
});
