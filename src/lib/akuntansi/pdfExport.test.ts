/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  generateLabaRugiPDF,
  generateNeracaPDF,
  type LabaRugiData,
  type NeracaData,
  type PDFGenerationOptions,
} from './pdfExport';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleOptions: PDFGenerationOptions = {
  company: {
    companyName: 'PT Garindo Sejahtera',
    npwp: '01.234.567.8-910.000',
    address: 'Jl. Sudirman No. 1, Jakarta Pusat 10220',
  },
  generatedAt: new Date('2026-06-22T10:00:00Z'),
  fileName: 'laporan.pdf',
};

const sampleLabaRugiData: LabaRugiData = {
  periodLabel: 'Periode 1-30 Juni 2026',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  pendapatan: [
    { code: '4-001', name: 'Pendapatan Penjualan', amount: 50_000_000 },
    { code: '4-002', name: 'Pendapatan Jasa', amount: 5_000_000 },
  ],
  diskonPenjualan: 1_000_000,
  pendapatanBersih: 54_000_000,
  hpp: [
    { code: '5-001', name: 'Harga Pokok Barang', amount: 30_000_000 },
  ],
  labaKotor: 24_000_000,
  bebanOperasional: [
    { code: '6-001', name: 'Beban Gaji', amount: 8_000_000 },
    { code: '6-002', name: 'Beban Sewa', amount: 2_000_000 },
    { code: '6-003', name: 'Beban Listrik', amount: 500_000 },
  ],
  totalBebanOp: 10_500_000,
  labaOperasional: 13_500_000,
  pendapatanLainLain: [
    { code: '7-001', name: 'Pendapatan Bunga', amount: 200_000 },
  ],
  bebanLainLain: [
    { code: '8-001', name: 'Beban Bunga Bank', amount: 100_000 },
  ],
  labaSebelumPajak: 13_600_000,
  bebanPajak: 340_000,
  labaNeto: 13_260_000,
};

const sampleNeracaData: NeracaData = {
  asOfDate: '2026-06-30',
  asOfLabel: 'Per 30 Juni 2026',
  asetLancar: [
    { code: '1-001', name: 'Kas', amount: 5_000_000 },
    { code: '1-002', name: 'Bank BCA', amount: 20_000_000 },
    { code: '1-003', name: 'Piutang Usaha', amount: 10_000_000 },
    { code: '1-004', name: 'Persediaan', amount: 15_000_000 },
  ],
  totalAsetLancar: 50_000_000,
  asetTetap: [
    { code: '1-101', name: 'Kendaraan', amount: 80_000_000 },
    { code: '1-102', name: 'Peralatan', amount: 20_000_000 },
  ],
  akumulasiPenyusutan: 15_000_000,
  totalAsetTetap: 85_000_000,
  totalAset: 135_000_000,
  liabilitasLancar: [
    { code: '2-001', name: 'Utang Usaha', amount: 8_000_000 },
    { code: '2-002', name: 'Utang Pajak', amount: 2_000_000 },
  ],
  totalLiabLancar: 10_000_000,
  liabilitasJkPanjang: [
    { code: '2-101', name: 'Pinjaman Bank', amount: 50_000_000 },
  ],
  totalLiabJkPanjang: 50_000_000,
  totalLiabilitas: 60_000_000,
  ekuitas: [
    { code: '3-001', name: 'Modal Disetor', amount: 60_000_000 },
    { code: '3-002', name: 'Laba Ditahan', amount: 15_000_000 },
  ],
  totalEkuitas: 75_000_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getPDFHeader(blob: Blob): Promise<string> {
  const arr = new Uint8Array(await blob.arrayBuffer());
  return String.fromCharCode(...arr.slice(0, 4));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateLabaRugiPDF', () => {
  it('returns a Blob', () => {
    const blob = generateLabaRugiPDF(sampleLabaRugiData, sampleOptions);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('blob size is greater than 1000 bytes', () => {
    const blob = generateLabaRugiPDF(sampleLabaRugiData, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('blob type is application/pdf', () => {
    const blob = generateLabaRugiPDF(sampleLabaRugiData, sampleOptions);
    expect(blob.type).toBe('application/pdf');
  });

  it('first 4 bytes are %PDF (PDF magic bytes)', async () => {
    const blob = generateLabaRugiPDF(sampleLabaRugiData, sampleOptions);
    const header = await getPDFHeader(blob);
    expect(header).toBe('%PDF');
  });

  it('handles zero labaNeto gracefully', () => {
    const zeroData: LabaRugiData = {
      ...sampleLabaRugiData,
      labaNeto: 0,
      labaSebelumPajak: 0,
      labaOperasional: 0,
      labaKotor: 0,
    };
    const blob = generateLabaRugiPDF(zeroData, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('works when npwp and address are null', () => {
    const opts: PDFGenerationOptions = {
      ...sampleOptions,
      company: { companyName: 'CV Test', npwp: null, address: null },
    };
    const blob = generateLabaRugiPDF(sampleLabaRugiData, opts);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('works with empty pendapatan and beban arrays', () => {
    const minimalData: LabaRugiData = {
      ...sampleLabaRugiData,
      pendapatan: [],
      hpp: [],
      bebanOperasional: [],
      pendapatanLainLain: [],
      bebanLainLain: [],
      diskonPenjualan: 0,
      bebanPajak: 0,
    };
    const blob = generateLabaRugiPDF(minimalData, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('generateNeracaPDF', () => {
  it('returns a Blob', () => {
    const blob = generateNeracaPDF(sampleNeracaData, sampleOptions);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('blob size is greater than 1000 bytes', () => {
    const blob = generateNeracaPDF(sampleNeracaData, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('blob type is application/pdf', () => {
    const blob = generateNeracaPDF(sampleNeracaData, sampleOptions);
    expect(blob.type).toBe('application/pdf');
  });

  it('first 4 bytes are %PDF (PDF magic bytes)', async () => {
    const blob = generateNeracaPDF(sampleNeracaData, sampleOptions);
    const header = await getPDFHeader(blob);
    expect(header).toBe('%PDF');
  });

  it('handles zero totalAset gracefully', () => {
    const zeroData: NeracaData = {
      ...sampleNeracaData,
      totalAset: 0,
      totalLiabilitas: 0,
      totalEkuitas: 0,
    };
    const blob = generateNeracaPDF(zeroData, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('works with no long-term liabilities', () => {
    const noLongTerm: NeracaData = {
      ...sampleNeracaData,
      liabilitasJkPanjang: [],
      totalLiabJkPanjang: 0,
    };
    const blob = generateNeracaPDF(noLongTerm, sampleOptions);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
