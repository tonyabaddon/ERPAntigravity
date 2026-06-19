import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'INV-DP/2026/00003', error: null }),
  },
}));

import { generateInvoiceDpPdf } from './invoiceDpPdf';
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

describe('generateInvoiceDpPdf', () => {
  test('produces a non-empty PDF blob with the right filename', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 3,
      funnel_sub_stage: '3a',
      order_type: 'KOMPONEN',
      total: 1000000,
      items: [{ name: 'Panel ATS', qty: 1, unit_price: 950000, subtotal: 950000 }],
      ongkir_amount: 50000,
      dp_amount: 400000,
    } as unknown as Order & {
      items: { name: string; qty: number; unit_price: number; subtotal: number }[];
      ongkir_amount: number;
      dp_amount: number;
    };

    const result = await generateInvoiceDpPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('INV-DP/2026/00003');
    expect(result.filename).toContain('Invoice_DP_INV-DP-2026-00003');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('tolerates an order with no items or DP', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 3,
      funnel_sub_stage: '3a',
      order_type: 'KOMPONEN',
      total: 0,
    } as unknown as Order;

    const result = await generateInvoiceDpPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
