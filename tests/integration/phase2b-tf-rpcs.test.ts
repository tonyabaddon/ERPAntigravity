// tests/integration/phase2b-tf-rpcs.test.ts
// Phase 2b: Tukar Faktur RPCs integration tests.
// Covers spec §12.1 list: record/delete happy + edge, paid_amount trigger,
// same-supplier guard, already-bundled guard, quick-add cascade soft-delete.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

let supplierA_id: string;
let supplierB_id: string;
let pesananA_id: string;
let pesananItemA_id: string;
const createdTfIds: string[] = [];
const createdPiIds: string[] = [];
const createdPesananIds: string[] = [];

async function createPesananForSupplier(supplier_id: string, supplier_name: string) {
  // ensure stock SKU exists for items
  const sku = (await sb.from('stocks').select('sku').limit(1).single()).data!.sku;
  const { data, error } = await sb.rpc('record_pesanan', {
    payload: {
      supplier_id,
      initial_status: 'ORDERED',
      items: [{ sku, product_name: `Test ${supplier_name}`, qty: 10, unit_cost: 1000 }],
    },
  });
  if (error) throw new Error('record_pesanan failed: ' + error.message);
  return (data as any).pesanan_id as string;
}

async function createTagihanFromPesanan(pesanan_id: string, total: number = 5000) {
  const { data: psn } = await sb.from('pesanan').select('supplier_id, items:pesanan_items(id, sku, qty, unit_cost)').eq('id', pesanan_id).single();
  const item = (psn as any).items[0];
  const { data, error } = await sb.rpc('record_pi', {
    payload: {
      type: 'STOCK',
      supplier_id: (psn as any).supplier_id,
      pesanan_id,
      purchase_date: '2026-06-20',
      supplier_invoice_number: 'INV-TEST-' + Math.floor(Math.random() * 100000),
      payment_due_at: '2026-07-20',
      initial_status: 'BELUM_LUNAS',
      items: [{ sku: item.sku, product_name: 'X', qty: 5, unit_cost: total / 5, sell_price: 0, pesanan_item_id: item.id }],
    },
  });
  if (error) throw new Error('record_pi failed: ' + error.message);
  return (data as any).pi_id as string;
}

beforeAll(async () => {
  // pick 2 distinct suppliers
  const { data } = await sb.from('suppliers').select('id, name').limit(2);
  supplierA_id = data![0].id;
  supplierB_id = data![1].id;
  pesananA_id = await createPesananForSupplier(supplierA_id, 'A');
  createdPesananIds.push(pesananA_id);
  pesananItemA_id = (await sb.from('pesanan_items').select('id').eq('pesanan_id', pesananA_id).limit(1).single()).data!.id;
});

afterAll(async () => {
  // Best-effort cleanup
  for (const id of createdTfIds) await sb.from('tukar_faktur').update({ voided_at: new Date().toISOString(), void_reason: 'test cleanup' }).eq('id', id);
  for (const id of createdPiIds) await sb.from('purchase_invoices').update({ voided_at: new Date().toISOString(), void_reason: 'test cleanup' }).eq('id', id);
});

describe('record_tukar_faktur', () => {
  test('creates TF with 2 existing Tagihans, total = sum', async () => {
    const piA = await createTagihanFromPesanan(pesananA_id, 6000);
    const piB = await createTagihanFromPesanan(pesananA_id, 4000);
    createdPiIds.push(piA, piB);

    const { data, error } = await sb.rpc('record_tukar_faktur', {
      payload: {
        supplier_id: supplierA_id,
        tukar_date: '2026-06-20',
        payment_due_at: '2026-07-20',
        tagihan_ids: [piA, piB],
      },
    });
    expect(error).toBeNull();
    expect((data as any).tf_number).toMatch(/^TF-\d{4}-\d{2}-\d{3}$/);

    const tfId = (data as any).tf_id as string;
    createdTfIds.push(tfId);

    const { data: tf } = await sb.from('tukar_faktur').select('total_amount, paid_amount').eq('id', tfId).single();
    expect(Number(tf!.total_amount)).toBe(10000);
    expect(Number(tf!.paid_amount)).toBe(0);

    // both Tagihans linked
    const { data: linked } = await sb.from('purchase_invoices').select('id, tukar_faktur_id').in('id', [piA, piB]);
    expect(linked!.every((r: any) => r.tukar_faktur_id === tfId)).toBe(true);
  });

  test('mixed-supplier Tagihans raise same_supplier_violation', async () => {
    const piA = await createTagihanFromPesanan(pesananA_id, 1000);
    const pesananB_id = await createPesananForSupplier(supplierB_id, 'B');
    createdPesananIds.push(pesananB_id);
    const piB = await createTagihanFromPesanan(pesananB_id, 1000);
    createdPiIds.push(piA, piB);

    const { error } = await sb.rpc('record_tukar_faktur', {
      payload: {
        supplier_id: supplierA_id,
        tukar_date: '2026-06-20',
        payment_due_at: '2026-07-20',
        tagihan_ids: [piA, piB],
      },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/same_supplier_violation/);
  });

  test('already-bundled Tagihan raises tagihan_already_bundled', async () => {
    const pi = await createTagihanFromPesanan(pesananA_id, 1000);
    createdPiIds.push(pi);

    // First TF — succeeds
    const { data: first } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-20', payment_due_at: '2026-07-20', tagihan_ids: [pi] },
    });
    createdTfIds.push((first as any).tf_id);

    // Second TF with same Tagihan — should fail
    const { error } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-21', payment_due_at: '2026-07-21', tagihan_ids: [pi] },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/tagihan_already_bundled/);
  });

  test('quick_add Tagihan: creates is_tf_quick_add=true row with no pesanan_id', async () => {
    const { data, error } = await sb.rpc('record_tukar_faktur', {
      payload: {
        supplier_id: supplierA_id,
        tukar_date: '2026-06-20',
        payment_due_at: '2026-07-20',
        tagihan_ids: [],
        quick_add_tagihans: [{
          supplier_invoice_number: 'INV-QUICK-' + Date.now(),
          purchase_date: '2026-06-20',
          total: 3000,
          payment_due_at: '2026-07-20',
        }],
      },
    });
    expect(error).toBeNull();
    const tfId = (data as any).tf_id;
    createdTfIds.push(tfId);

    const { data: pi } = await sb.from('purchase_invoices').select('is_tf_quick_add, pesanan_id, tukar_faktur_id, type, total').eq('tukar_faktur_id', tfId).single();
    expect(pi!.is_tf_quick_add).toBe(true);
    expect(pi!.pesanan_id).toBeNull();
    expect(pi!.type).toBe('STOCK');
    expect(Number(pi!.total)).toBe(3000);
  });

  test('rejects empty Tagihan + empty quick_add', async () => {
    const { error } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-20', payment_due_at: '2026-07-20', tagihan_ids: [] },
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/tf_must_have_at_least_one_faktur/);
  });
});

describe('delete_tukar_faktur', () => {
  test('unpaid TF: unlinks normal Tagihans, cascade soft-deletes quick_add', async () => {
    const normalPi = await createTagihanFromPesanan(pesananA_id, 2000);
    createdPiIds.push(normalPi);

    const { data: tfData } = await sb.rpc('record_tukar_faktur', {
      payload: {
        supplier_id: supplierA_id,
        tukar_date: '2026-06-20',
        payment_due_at: '2026-07-20',
        tagihan_ids: [normalPi],
        quick_add_tagihans: [{
          supplier_invoice_number: 'INV-DEL-' + Date.now(),
          purchase_date: '2026-06-20',
          total: 1000,
          payment_due_at: '2026-07-20',
        }],
      },
    });
    const tfId = (tfData as any).tf_id;
    createdTfIds.push(tfId);

    const { data: quickPi } = await sb.from('purchase_invoices').select('id').eq('tukar_faktur_id', tfId).eq('is_tf_quick_add', true).single();

    // Delete TF
    const { error } = await sb.rpc('delete_tukar_faktur', { p_tf_id: tfId, p_reason: 'test cleanup' });
    expect(error).toBeNull();

    // TF soft-deleted
    const { data: tfAfter } = await sb.from('tukar_faktur').select('voided_at').eq('id', tfId).single();
    expect(tfAfter!.voided_at).not.toBeNull();

    // Normal Tagihan unlinked, not voided
    const { data: normalAfter } = await sb.from('purchase_invoices').select('tukar_faktur_id, voided_at').eq('id', normalPi).single();
    expect(normalAfter!.tukar_faktur_id).toBeNull();
    expect(normalAfter!.voided_at).toBeNull();

    // Quick-add Tagihan soft-deleted
    const { data: quickAfter } = await sb.from('purchase_invoices').select('voided_at, void_reason').eq('id', quickPi!.id).single();
    expect(quickAfter!.voided_at).not.toBeNull();
    expect(quickAfter!.void_reason).toMatch(/cascade from TF deletion/);
  });

  test('paid TF raises cannot_delete_paid_tf', async () => {
    const pi = await createTagihanFromPesanan(pesananA_id, 5000);
    createdPiIds.push(pi);
    const { data: tfData } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-20', payment_due_at: '2026-07-20', tagihan_ids: [pi] },
    });
    const tfId = (tfData as any).tf_id;
    createdTfIds.push(tfId);

    // Simulate paid by directly inserting pembayaran + pembayaran_items
    const { data: pmb } = await sb.rpc('record_pembayaran', {
      payload: {
        supplier_id: supplierA_id,
        paid_at: new Date().toISOString(),
        payment_method: 'CASH',
        items: [{ tukar_faktur_id: tfId, amount: 5000 }],
      },
    });

    const { error } = await sb.rpc('delete_tukar_faktur', { p_tf_id: tfId, p_reason: 'attempt' });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/cannot_delete_paid_tf/);

    // cleanup: void pembayaran
    if (pmb) await sb.rpc('void_pembayaran', { p_pembayaran_id: (pmb as any).pembayaran_id, p_reason: 'test cleanup' });
  });
});

describe('_tf_recompute_paid_amount trigger', () => {
  test('record_pembayaran on TF updates tf.paid_amount; void_pembayaran reverts', async () => {
    const pi = await createTagihanFromPesanan(pesananA_id, 4000);
    createdPiIds.push(pi);
    const { data: tfData } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-20', payment_due_at: '2026-07-20', tagihan_ids: [pi] },
    });
    const tfId = (tfData as any).tf_id;
    createdTfIds.push(tfId);

    const { data: pmb } = await sb.rpc('record_pembayaran', {
      payload: {
        supplier_id: supplierA_id,
        paid_at: new Date().toISOString(),
        payment_method: 'TRANSFER',
        items: [{ tukar_faktur_id: tfId, amount: 4000 }],
      },
    });
    expect(pmb).not.toBeNull();

    const { data: tfAfter } = await sb.from('tukar_faktur').select('paid_amount').eq('id', tfId).single();
    expect(Number(tfAfter!.paid_amount)).toBe(4000);

    // Void
    await sb.rpc('void_pembayaran', { p_pembayaran_id: (pmb as any).pembayaran_id, p_reason: 'test cleanup' });
    const { data: tfReverted } = await sb.from('tukar_faktur').select('paid_amount').eq('id', tfId).single();
    expect(Number(tfReverted!.paid_amount)).toBe(0);
  });
});

describe('pembayaran_suggest_outstanding (extended)', () => {
  test('returns both tagihan + tukar_faktur arrays for a supplier', async () => {
    const piLoose = await createTagihanFromPesanan(pesananA_id, 1500);
    const piBundled = await createTagihanFromPesanan(pesananA_id, 2500);
    createdPiIds.push(piLoose, piBundled);
    const { data: tfData } = await sb.rpc('record_tukar_faktur', {
      payload: { supplier_id: supplierA_id, tukar_date: '2026-06-20', payment_due_at: '2026-07-20', tagihan_ids: [piBundled] },
    });
    createdTfIds.push((tfData as any).tf_id);

    const { data, error } = await sb.rpc('pembayaran_suggest_outstanding', { p_supplier_id: supplierA_id });
    expect(error).toBeNull();
    expect(data).toHaveProperty('tagihan');
    expect(data).toHaveProperty('tukar_faktur');
    // Loose Tagihan present, bundled excluded
    const tagihanIds = ((data as any).tagihan as any[]).map(t => t.id);
    expect(tagihanIds).toContain(piLoose);
    expect(tagihanIds).not.toContain(piBundled);
    // TF present
    const tfNums = ((data as any).tukar_faktur as any[]).map(t => t.tf_number);
    expect(tfNums).toContain((tfData as any).tf_number);
  });
});
