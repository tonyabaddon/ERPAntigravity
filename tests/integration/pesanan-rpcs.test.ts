import { describe, test, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierId: string;
let sku: string;

beforeAll(async () => {
  supplierId = (await sb.from('suppliers').select('id').limit(1).single()).data!.id;
  sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
});

describe('record_pesanan', () => {
  test('creates DRAFT Pesanan with PSN-YYYY-MM-NNN number', async () => {
    const { data, error } = await sb.rpc('record_pesanan', {
      payload: {
        supplier_id: supplierId,
        initial_status: 'DRAFT',
        items: [{ sku, product_name: 'Test', qty: 10, unit_cost: 1000 }],
      },
    });
    expect(error).toBeNull();
    expect((data as any).pesanan_number).toMatch(/^PSN-\d{4}-\d{2}-\d{3}$/);
  });

  test('creates ORDERED Pesanan with ordered_at set', async () => {
    const { data, error } = await sb.rpc('record_pesanan', {
      payload: {
        supplier_id: supplierId,
        initial_status: 'ORDERED',
        items: [{ sku, product_name: 'Test', qty: 5, unit_cost: 2000 }],
      },
    });
    expect(error).toBeNull();
    const { data: row } = await sb.from('pesanan').select('status, ordered_at').eq('id', (data as any).pesanan_id).single();
    expect(row!.status).toBe('ORDERED');
    expect(row!.ordered_at).not.toBeNull();
  });

  test('rejects missing supplier_id', async () => {
    const { error } = await sb.rpc('record_pesanan', {
      payload: { initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    expect(error).not.toBeNull();
  });

  test('rejects empty items', async () => {
    const { error } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [] },
    });
    expect(error).not.toBeNull();
  });
});

describe('mark_pesanan_ordered', () => {
  test('DRAFT → ORDERED', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('mark_pesanan_ordered', { p_pesanan_id: (data as any).pesanan_id });
    expect(error).toBeNull();
    const { data: row } = await sb.from('pesanan').select('status').eq('id', (data as any).pesanan_id).single();
    expect(row!.status).toBe('ORDERED');
  });

  test('rejects ORDERED (not DRAFT)', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'ORDERED', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('mark_pesanan_ordered', { p_pesanan_id: (data as any).pesanan_id });
    expect(error).not.toBeNull();
  });
});

describe('void_pesanan', () => {
  test('rejects reason < 10 chars', async () => {
    const { data } = await sb.rpc('record_pesanan', {
      payload: { supplier_id: supplierId, initial_status: 'DRAFT', items: [{ sku, product_name: 'X', qty: 1, unit_cost: 100 }] },
    });
    const { error } = await sb.rpc('void_pesanan', { p_pesanan_id: (data as any).pesanan_id, p_reason: 'short' });
    expect(error).not.toBeNull();
  });
});
