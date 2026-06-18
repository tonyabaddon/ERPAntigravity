import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'INV-PEL/2026/00002', error: null }),
  },
}));

import { generateInvoicePelunasanPdf } from './invoicePelunasanPdf';
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

describe('generateInvoicePelunasanPdf', () => {
  test('produces a non-empty PDF blob with the right filename', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 8500000,
      items: [{ name: 'Panel ATS', qty: 1, unit_price: 8500000, subtotal: 8500000 }],
      ongkir_amount: 0,
      dp_amount: 3400000,
    } as unknown as Order & {
      items: { name: string; qty: number; unit_price: number; subtotal: number }[];
      ongkir_amount: number;
      dp_amount: number;
    };

    const result = await generateInvoicePelunasanPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('INV-PEL/2026/00002');
    expect(result.filename).toContain('Invoice_Pelunasan_INV-PEL-2026-00002');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('tolerates missing dp_amount (pelunasan defaults to total)', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 100000,
    } as unknown as Order;

    const result = await generateInvoicePelunasanPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
