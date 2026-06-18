import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'SO/2026/00001', error: null }),
  },
}));

import { generateSalesOrderPdf } from './salesOrderPdf';
import type { Order } from '../types';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';

const settings: StoreSettings = {
  id: 1,
  nama_toko: 'Sinar Elektrik',
  alamat_lengkap: 'Jl. X',
  kota: 'Surabaya',
  telp_wa: '0812',
  updated_at: '',
};

const banks: BankAccount[] = [
  {
    id: 'u1',
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Sinar Elektrik',
    is_active: true,
    sort_order: 0,
  },
];

describe('generateSalesOrderPdf', () => {
  test('produces a non-empty PDF blob with the right filename', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 2,
      funnel_sub_stage: '2c',
      order_type: 'KOMPONEN',
      total: 380000,
      items: [{ name: 'Kabel', qty: 1, unit_price: 380000, subtotal: 380000 }],
      ongkir_amount: 50000,
    } as unknown as Order & { items: { name: string; qty: number; unit_price: number; subtotal: number }[]; ongkir_amount: number };

    const result = await generateSalesOrderPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('SO/2026/00001');
    expect(result.filename).toContain('Sales_Order_SO-2026-00001');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('tolerates an order with no items', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 2,
      funnel_sub_stage: '2c',
      order_type: 'KOMPONEN',
      total: 0,
    } as unknown as Order;

    const result = await generateSalesOrderPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
