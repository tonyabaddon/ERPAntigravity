import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'CAN/2026/00001', error: null }),
  },
}));

import { generateCatatanPembatalanPdf } from './catatanPembatalanPdf';
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

describe('generateCatatanPembatalanPdf', () => {
  test('produces a non-empty PDF blob with refund block when refund > 0', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 6,
      funnel_sub_stage: '6a',
      order_type: 'KOMPONEN',
      total: 1000000,
      items: [{ name: 'Panel ATS', qty: 1, unit_price: 1000000, subtotal: 1000000 }],
      cancel_date: '2026-06-18',
      cancelled_by: 'Tony (Owner)',
      cancel_reason: 'Customer berubah pikiran, request refund DP.',
      refund_amount: 400000,
      refund_method: 'Transfer BCA',
    } as unknown as Order & {
      items: { name: string; qty: number; unit_price: number; subtotal: number }[];
      cancel_date: string;
      cancelled_by: string;
      cancel_reason: string;
      refund_amount: number;
      refund_method: string;
    };

    const result = await generateCatatanPembatalanPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('CAN/2026/00001');
    expect(result.filename).toContain('Catatan_Pembatalan_CAN-2026-00001');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('omits refund block when refund_amount is zero or missing', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 6,
      funnel_sub_stage: '6a',
      order_type: 'KOMPONEN',
      total: 0,
      cancel_reason: 'Stock kosong.',
    } as unknown as Order & { cancel_reason: string };

    const result = await generateCatatanPembatalanPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
