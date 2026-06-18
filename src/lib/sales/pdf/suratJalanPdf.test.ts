import { describe, test, expect, vi } from 'vitest';

vi.mock('../../supabaseClient', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: 'SJ/2026/00009', error: null }),
  },
}));

import { generateSuratJalanPdf } from './suratJalanPdf';
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

describe('generateSuratJalanPdf', () => {
  test('produces a non-empty PDF blob with the right filename', async () => {
    const order = {
      id: 'abcd1234',
      customer: 'Jenny',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4b',
      order_type: 'KOMPONEN',
      total: 380000,
      delivery_method: 'DELIVERY',
      items: [
        { name: 'Kabel 10m', qty: 2, subtotal: 100000 },
        { name: 'MCB 20A', qty: 5, subtotal: 250000 },
      ],
      resi_number: 'JNE-123456',
      delivery_notes: 'Antar siang hari',
    } as unknown as Order & {
      items: { name: string; qty: number; subtotal: number }[];
      resi_number: string;
      delivery_notes: string;
    };

    const result = await generateSuratJalanPdf(order, settings, banks);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.docNumber).toBe('SJ/2026/00009');
    expect(result.filename).toContain('Surat_Jalan_SJ-2026-00009');
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });

  test('tolerates missing resi/notes (renders "-")', async () => {
    const order = {
      id: 'efgh5678',
      customer: 'Andi',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 0,
    } as unknown as Order;

    const result = await generateSuratJalanPdf(order, settings, banks);
    expect(result.blob.size).toBeGreaterThan(2000);
    expect(result.filename).toContain('AN');
  });
});
