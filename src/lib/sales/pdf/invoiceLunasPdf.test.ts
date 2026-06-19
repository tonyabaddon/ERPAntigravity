import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'INV/2026/00007', error: null }),
  },
}));

import { generateInvoiceLunasPdf } from './invoiceLunasPdf';
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

const banks: BankAccount[] = [];

describe('generateInvoiceLunasPdf', () => {
  test('produces a non-empty PDF blob with the right filename', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 380000,
      items: [{ name: 'Kabel', qty: 1, unit_price: 380000, subtotal: 380000 }],
      ongkir_amount: 0,
      payment_method: 'Transfer BCA',
    } as unknown as Order & {
      items: { name: string; qty: number; unit_price: number; subtotal: number }[];
      ongkir_amount: number;
      payment_method: string;
    };

    const result = await generateInvoiceLunasPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('INV/2026/00007');
    expect(result.filename).toContain('Invoice_Lunas_INV-2026-00007');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('tolerates missing payment_method (defaults to Tunai)', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 0,
    } as unknown as Order;

    const result = await generateInvoiceLunasPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
