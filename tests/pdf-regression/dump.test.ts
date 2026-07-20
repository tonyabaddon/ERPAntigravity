/**
 * PDF regression dump — Task 10 QA-week P1-07.
 *
 * Runs each of the 13 PDF generators with a fixed fixture and writes the
 * resulting Blob to `docs/qa-week/pdf-regression/<mode>/<name>.pdf` where
 * mode is controlled by env var PDF_REGRESSION_MODE=pre|post.
 *
 * jsdom provides Blob/URL/document/window; we mock supabaseClient for the
 * sales PDFs that call `nextInvoiceNumber` (RPC-backed doc numbers).
 *
 * Deterministic: Date is monkey-patched to 2026-07-20T00:00:00Z so both
 * pre and post runs produce byte-identical timestamps in headers/footers
 * (though jsPDF /CreationDate still stamps real wall-clock; text diff
 * ignores metadata since we only run pdftotext on body).
 *
 * Run:
 *   PDF_REGRESSION_MODE=post npx vitest run tests/pdf-regression/dump.test.ts
 *   PDF_REGRESSION_MODE=pre  npx vitest run tests/pdf-regression/dump.test.ts
 */

import { describe, test, expect, vi, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Freeze Date to a fixed instant so both runs stamp identical "Dicetak" etc.
// ---------------------------------------------------------------------------
const FIXED_MS = new Date('2026-07-20T00:00:00Z').getTime();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(FIXED_MS);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      super(...(args as ConstructorParameters<typeof RealDate>));
    }
  }
  static now() {
    return FIXED_MS;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Date = FakeDate as any;

// ---------------------------------------------------------------------------
// Mock supabaseClient (sales PDFs call nextInvoiceNumber → supabase.rpc).
// Return deterministic doc numbers per RPC name.
// ---------------------------------------------------------------------------
vi.mock('../../src/lib/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => {
      const numberMap: Record<string, string> = {
        rpc_next_sales_order_number: 'SO/2026/00001',
        rpc_next_invoice_dp_number: 'INV-DP/2026/00003',
        rpc_next_invoice_lunas_number: 'INV/2026/00007',
        rpc_next_invoice_pelunasan_number: 'INV-PEL/2026/00002',
        rpc_next_surat_jalan_number: 'SJ/2026/00009',
        rpc_next_catatan_pembatalan_number: 'CAN/2026/00001',
      };
      return { data: numberMap[name] ?? `${name.toUpperCase()}/2026/00001`, error: null };
    }),
    from: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  },
}));

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
const MODE = (process.env.PDF_REGRESSION_MODE ?? 'post') as 'pre' | 'post';
const OUT_DIR = path.join(process.cwd(), 'docs/qa-week/pdf-regression', MODE);

async function saveBlob(name: string, blob: Blob): Promise<void> {
  const buf = Buffer.from(await blob.arrayBuffer());
  const fp = path.join(OUT_DIR, `${name}.pdf`);
  await fs.writeFile(fp, buf);
}

beforeAll(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`[pdf-regression] MODE=${MODE} → ${OUT_DIR}`);
});

// ---------------------------------------------------------------------------
// Common fixtures
// ---------------------------------------------------------------------------
const storeSettings = {
  id: 1,
  nama_toko: 'Sinar Elektrik',
  alamat_lengkap: 'Jl. Sudirman No. 1, Surabaya',
  kota: 'Surabaya',
  telp_wa: '081234567890',
  updated_at: '2026-07-01T00:00:00Z',
  // logo_url intentionally undefined → skip fetch
} as unknown as import('../../src/lib/pengaturan/types').StoreSettings;

const bankAccounts: import('../../src/lib/pengaturan/types').BankAccount[] = [
  {
    id: 'bank-1',
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Sinar Elektrik',
    is_active: true,
    sort_order: 0,
  },
];

// ---------------------------------------------------------------------------
// 1-2. Akuntansi Laba Rugi + Neraca
// ---------------------------------------------------------------------------
describe('01-02 akuntansi/pdfExport', () => {
  test('generateLabaRugiPDF', async () => {
    const { generateLabaRugiPDF } = await import('../../src/lib/akuntansi/pdfExport');
    const blob = generateLabaRugiPDF(
      {
        periodLabel: 'Periode 1-30 Juni 2026',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        pendapatan: [
          { code: '4-001', name: 'Pendapatan Penjualan', amount: 50_000_000 },
          { code: '4-002', name: 'Pendapatan Jasa', amount: 5_000_000 },
        ],
        diskonPenjualan: 1_000_000,
        pendapatanBersih: 54_000_000,
        hpp: [{ code: '5-001', name: 'Harga Pokok Barang', amount: 30_000_000 }],
        labaKotor: 24_000_000,
        bebanOperasional: [
          { code: '6-001', name: 'Beban Gaji', amount: 8_000_000 },
          { code: '6-002', name: 'Beban Sewa', amount: 2_000_000 },
          { code: '6-003', name: 'Beban Listrik', amount: 500_000 },
        ],
        totalBebanOp: 10_500_000,
        labaOperasional: 13_500_000,
        pendapatanLainLain: [{ code: '7-001', name: 'Pendapatan Bunga', amount: 200_000 }],
        bebanLainLain: [{ code: '8-001', name: 'Beban Bunga Bank', amount: 100_000 }],
        labaSebelumPajak: 13_600_000,
        bebanPajak: 340_000,
        labaNeto: 13_260_000,
      },
      {
        company: {
          companyName: 'PT Garindo Sejahtera',
          npwp: '01.234.567.8-910.000',
          address: 'Jl. Sudirman No. 1, Jakarta Pusat 10220',
        },
        generatedAt: new Date('2026-06-22T10:00:00Z'),
        fileName: 'laba-rugi.pdf',
      },
    );
    expect(blob.size).toBeGreaterThan(1000);
    await saveBlob('01-labaRugi', blob);
  });

  test('generateNeracaPDF', async () => {
    const { generateNeracaPDF } = await import('../../src/lib/akuntansi/pdfExport');
    const blob = generateNeracaPDF(
      {
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
        liabilitasJkPanjang: [{ code: '2-101', name: 'Pinjaman Bank', amount: 50_000_000 }],
        totalLiabJkPanjang: 50_000_000,
        totalLiabilitas: 60_000_000,
        ekuitas: [
          { code: '3-001', name: 'Modal Disetor', amount: 60_000_000 },
          { code: '3-002', name: 'Laba Ditahan', amount: 15_000_000 },
        ],
        totalEkuitas: 75_000_000,
      },
      {
        company: {
          companyName: 'PT Garindo Sejahtera',
          npwp: '01.234.567.8-910.000',
          address: 'Jl. Sudirman No. 1, Jakarta Pusat 10220',
        },
        generatedAt: new Date('2026-06-22T10:00:00Z'),
        fileName: 'neraca.pdf',
      },
    );
    expect(blob.size).toBeGreaterThan(1000);
    await saveBlob('02-neraca', blob);
  });
});

// ---------------------------------------------------------------------------
// 3. belanjaNumpangLewatPdf
// ---------------------------------------------------------------------------
describe('03 belanjaNumpangLewatPdf', () => {
  test('generateBelanjaNumpangLewatPdf', async () => {
    const { generateBelanjaNumpangLewatPdf } = await import(
      '../../src/lib/pdf/belanjaNumpangLewatPdf'
    );
    const pi = {
      id: 'pi-1',
      pi_number: 'BNL/2026/00042',
      type: 'BNL',
      supplier_id: 'sup-1',
      order_id: 'order-abc-xyz-1234',
      purchase_date: '2026-07-15',
      supplier_invoice_number: 'INV-SUPP-9988',
      supplier_invoice_photo_url: null,
      payment_method: 'CASH',
      payment_due_at: '2026-07-15',
      paid_at: '2026-07-15',
      payment_proof_url: null,
      subtotal: 850_000,
      total: 850_000,
      status: 'LUNAS',
      notes: 'Numpang lewat via toko',
      created_by_user_id: null,
      created_at: '2026-07-15T09:00:00Z',
      updated_at: '2026-07-15T09:00:00Z',
      voided_at: null,
      voided_by_user_id: null,
      void_reason: null,
      supplier: {
        id: 'sup-1',
        name: 'PT Grosir Elektrik Nusantara',
        payment_term_days: 30,
        created_at: '2026-01-01T00:00:00Z',
      },
      items: [
        {
          id: 'pii-1',
          pi_id: 'pi-1',
          sku: 'KBL-10M',
          product_name: 'Kabel 10 meter',
          qty: 5,
          unit_cost: 100_000,
          sell_price: 120_000,
          subtotal: 500_000,
          created_at: '2026-07-15T09:00:00Z',
        },
        {
          id: 'pii-2',
          pi_id: 'pi-1',
          sku: 'MCB-20A',
          product_name: 'MCB 20A Schneider',
          qty: 7,
          unit_cost: 50_000,
          sell_price: 65_000,
          subtotal: 350_000,
          created_at: '2026-07-15T09:00:00Z',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const blob = generateBelanjaNumpangLewatPdf({ pi });
    expect(blob.size).toBeGreaterThan(1000);
    await saveBlob('03-belanjaNumpangLewat', blob);
  });
});

// ---------------------------------------------------------------------------
// 4. purchaseOrderPdf
// ---------------------------------------------------------------------------
describe('04 purchaseOrderPdf', () => {
  test('generatePoPdf (normal mode)', async () => {
    const { generatePoPdf } = await import('../../src/lib/pdf/purchaseOrderPdf');
    const supplier = {
      id: 'sup-1',
      name: 'PT Grosir Elektrik Nusantara',
      contact_name: 'Budi Santoso',
      phone: '081234567890',
      payment_term_days: 30,
      created_at: '2026-01-01T00:00:00Z',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const po = {
      id: 'po-1',
      po_number: 'PO/2026/00015',
      supplier_id: 'sup-1',
      status: 'ORDERED',
      notes: 'Kirim ke gudang utama',
      ordered_at: '2026-07-10T00:00:00Z',
      payment_due_at: '2026-08-10',
      tax_rate: 0.11,
      tax_amount: 165_000,
      subtotal: 1_500_000,
      total: 1_665_000,
      created_at: '2026-07-10T00:00:00Z',
      expected_receive_date: '2026-07-20',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const items = [
      {
        id: 'poi-1',
        po_id: 'po-1',
        sku: 'KBL-10M',
        product_name: 'Kabel 10 meter',
        qty: 10,
        unit_cost: 100_000,
        subtotal: 1_000_000,
        qty_received: 0,
        qty_damaged: 0,
        damage_status: 'NONE',
      },
      {
        id: 'poi-2',
        po_id: 'po-1',
        sku: 'MCB-20A',
        product_name: 'MCB 20A Schneider',
        qty: 10,
        unit_cost: 50_000,
        subtotal: 500_000,
        qty_received: 0,
        qty_damaged: 0,
        damage_status: 'NONE',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    const blob = await generatePoPdf({
      po,
      supplier,
      items,
      storeSettings,
      createdByName: 'Tony (Owner)',
      printMode: 'normal',
    });
    expect(blob.size).toBeGreaterThan(1000);
    await saveBlob('04-purchaseOrder', blob);
  });
});

// ---------------------------------------------------------------------------
// 5. warehouseTransferPDF
// ---------------------------------------------------------------------------
describe('05 warehouseTransferPDF', () => {
  test('renderTransferSuratJalan', async () => {
    const { renderTransferSuratJalan } = await import(
      '../../src/lib/pdf/warehouseTransferPDF'
    );
    const blob = await renderTransferSuratJalan(
      {
        header: {
          id: 42,
          doc_no: 'TR-2026-07-042',
          status: 'IN_TRANSIT',
          from_warehouse_id: 'wa',
          to_warehouse_id: 'wb',
          sender_user_id: 'u1',
          receiver_user_id: 'u2',
          total_qty_sent: 8,
          total_qty_received: null,
          total_loss_qty: null,
          initiated_at: '2026-07-12T10:23:00Z',
          received_at: null,
          cancelled_at: null,
          n_items: 2,
          notes: 'Transfer cat + kuas',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        items: [
          {
            transfer_id: 42,
            line_no: 1,
            sku: 'CAT-BIRU',
            qty_sent: 5,
            qty_received: null,
            loss_qty: null,
            loss_movement_id: null,
          },
          {
            transfer_id: 42,
            line_no: 2,
            sku: 'KUAS-3',
            qty_sent: 3,
            qty_received: null,
            loss_qty: null,
            loss_movement_id: null,
          },
        ],
      },
      {
        tenantName: 'PT Toko Uji Regression',
        tenantAddress: 'Jl. Test 1, Surabaya',
        fromWarehouseName: 'Gudang Atas',
        toWarehouseName: 'Gudang Bawah',
        senderName: 'Rudi Setiawan',
        receiverName: 'Sari Wulandari',
        skuNames: { 'CAT-BIRU': 'Cat Biru Dulux 5L', 'KUAS-3': 'Kuas 3 inci' },
        logoUrl: null,
      },
    );
    expect(blob.size).toBeGreaterThan(500);
    await saveBlob('05-warehouseTransfer', blob);
  });
});

// ---------------------------------------------------------------------------
// 6. catatanPembatalanPdf
// ---------------------------------------------------------------------------
describe('06 catatanPembatalanPdf', () => {
  test('generateCatatanPembatalanPdf', async () => {
    const { generateCatatanPembatalanPdf } = await import(
      '../../src/lib/sales/pdf/catatanPembatalanPdf'
    );
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 6,
      funnel_sub_stage: '6a',
      order_type: 'KOMPONEN',
      total: 1_000_000,
      items: [{ name: 'Panel ATS', qty: 1, unit_price: 1_000_000, subtotal: 1_000_000 }],
      cancel_date: '2026-06-18',
      cancelled_by: 'Tony (Owner)',
      cancel_reason: 'Customer berubah pikiran, request refund DP.',
      refund_amount: 400_000,
      refund_method: 'Transfer BCA',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateCatatanPembatalanPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('06-catatanPembatalan', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 7. invoiceDpPdf
// ---------------------------------------------------------------------------
describe('07 invoiceDpPdf', () => {
  test('generateInvoiceDpPdf', async () => {
    const { generateInvoiceDpPdf } = await import('../../src/lib/sales/pdf/invoiceDpPdf');
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 3,
      funnel_sub_stage: '3a',
      order_type: 'KOMPONEN',
      total: 1_000_000,
      items: [{ name: 'Panel ATS', qty: 1, unit_price: 950_000, subtotal: 950_000 }],
      ongkir_amount: 50_000,
      dp_amount: 400_000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateInvoiceDpPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('07-invoiceDp', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 8. invoiceLunasPdf
// ---------------------------------------------------------------------------
describe('08 invoiceLunasPdf', () => {
  test('generateInvoiceLunasPdf', async () => {
    const { generateInvoiceLunasPdf } = await import(
      '../../src/lib/sales/pdf/invoiceLunasPdf'
    );
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 380_000,
      items: [{ name: 'Kabel 10m', qty: 1, unit_price: 380_000, subtotal: 380_000 }],
      ongkir_amount: 0,
      payment_method: 'Transfer BCA',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateInvoiceLunasPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('08-invoiceLunas', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 9. invoicePelunasanPdf
// ---------------------------------------------------------------------------
describe('09 invoicePelunasanPdf', () => {
  test('generateInvoicePelunasanPdf', async () => {
    const { generateInvoicePelunasanPdf } = await import(
      '../../src/lib/sales/pdf/invoicePelunasanPdf'
    );
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4a',
      order_type: 'KOMPONEN',
      total: 8_500_000,
      items: [{ name: 'Panel ATS Deluxe', qty: 1, unit_price: 8_500_000, subtotal: 8_500_000 }],
      ongkir_amount: 0,
      dp_amount: 3_400_000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateInvoicePelunasanPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('09-invoicePelunasan', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 10. salesOrderPdf
// ---------------------------------------------------------------------------
describe('10 salesOrderPdf', () => {
  test('generateSalesOrderPdf', async () => {
    const { generateSalesOrderPdf } = await import(
      '../../src/lib/sales/pdf/salesOrderPdf'
    );
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 2,
      funnel_sub_stage: '2c',
      order_type: 'KOMPONEN',
      total: 380_000,
      items: [{ name: 'Kabel 10m', qty: 1, unit_price: 380_000, subtotal: 380_000 }],
      ongkir_amount: 50_000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateSalesOrderPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('10-salesOrder', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 11. suratJalanPdf
// ---------------------------------------------------------------------------
describe('11 suratJalanPdf', () => {
  test('generateSuratJalanPdf', async () => {
    const { generateSuratJalanPdf } = await import(
      '../../src/lib/sales/pdf/suratJalanPdf'
    );
    const order = {
      id: 'abcd1234',
      customer: 'Jenny Halim',
      version: 0,
      funnel_stage: 4,
      funnel_sub_stage: '4b',
      order_type: 'KOMPONEN',
      total: 380_000,
      delivery_method: 'DELIVERY',
      items: [
        { name: 'Kabel 10m', qty: 2, subtotal: 100_000 },
        { name: 'MCB 20A', qty: 5, subtotal: 250_000 },
      ],
      resi_number: 'JNE-123456',
      delivery_notes: 'Antar siang hari',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = await generateSuratJalanPdf(order, storeSettings, bankAccounts);
    expect(result.blob.size).toBeGreaterThan(2000);
    await saveBlob('11-suratJalan', result.blob);
  });
});

// ---------------------------------------------------------------------------
// 12. tandaTerimaPdf (generateTandaTerima only — NOT printTandaTerima)
// ---------------------------------------------------------------------------
describe('12 tandaTerimaPdf', () => {
  test('generateTandaTerima', async () => {
    const { generateTandaTerima } = await import('../../src/lib/tandaTerimaPdf');
    const tf = {
      id: 'tf-1',
      tf_number: 'TF/2026/00023',
      supplier_id: 'sup-1',
      supplier: { id: 'sup-1', name: 'PT Grosir Elektrik Nusantara', payment_term_days: 30 },
      tukar_date: '2026-07-18',
      payment_due_at: '2026-08-17',
      total_amount: 12_500_000,
      paid_amount: 0,
      photo_urls: [],
      tanda_terima_printed_at: null,
      notes: 'Tukar 3 faktur bulan Juli',
      created_at: '2026-07-18T00:00:00Z',
      updated_at: '2026-07-18T00:00:00Z',
      voided_at: null,
      status: 'PENDING',
      tagihans: [
        {
          id: 't-1',
          pi_number: 'PI/2026/00101',
          supplier_invoice_number: 'INV-SUPP-1001',
          purchase_date: '2026-07-01',
          payment_due_at: '2026-07-31',
          total: 5_000_000,
          paid_amount: 0,
          is_tf_quick_add: false,
        },
        {
          id: 't-2',
          pi_number: 'PI/2026/00102',
          supplier_invoice_number: 'INV-SUPP-1002',
          purchase_date: '2026-07-05',
          payment_due_at: '2026-08-04',
          total: 7_500_000,
          paid_amount: 0,
          is_tf_quick_add: false,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const blob = generateTandaTerima(tf, 'Sinar Elektrik');
    expect(blob.size).toBeGreaterThan(500);
    await saveBlob('12-tandaTerima', blob);
  });
});

// ---------------------------------------------------------------------------
// 13. SaldoAwalPDF (renderSaldoAwalPDF) — has document.createElement side-effect
// ---------------------------------------------------------------------------
describe('13 SaldoAwalPDF', () => {
  test('renderSaldoAwalPDF', async () => {
    // Neutralize the auto-download side-effect (a.click) — jsdom allows it
    // but we don't want an actual "download" event.
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      /* no-op */
    };

    try {
      const { renderSaldoAwalPDF } = await import(
        '../../src/components/pengaturan/saldoAwal/SaldoAwalPDF'
      );
      const snapshot = {
        id: 'sa-1',
        cutover_date: '2026-06-30',
        status: 'draft',
        posted_je_id: null,
        step_data: {
          wizard_version: 1 as const,
          step1_cash: {
            accounts: [
              {
                cash_account_id: 'ca-1',
                cash_account_name: 'Kas Kecil',
                opening_balance: 5_000_000,
                as_of: '2026-06-30',
              },
              {
                cash_account_id: 'ca-2',
                cash_account_name: 'Bank BCA',
                opening_balance: 25_000_000,
                as_of: '2026-06-30',
              },
            ],
          },
          step2_aktiva: {
            piutang: { mode: 'aggregate' as const, aggregate_amount: 15_000_000 },
            persediaan: {
              auto_computed_amount: 40_000_000,
              manual_override: false,
              final_amount: 40_000_000,
              override_reason: null,
            },
            aktiva_tetap: { amount: 80_000_000, notes: 'Kendaraan + Peralatan' },
            lain_lain: [
              { coa_code: '1-1460', coa_name: 'Deposit Sewa Toko', amount: 5_000_000, notes: '' },
            ],
          },
          step3_kewajiban: {
            hutang_usaha: { mode: 'aggregate' as const, aggregate_amount: 20_000_000 },
            lain_lain: [
              { coa_code: '2-1400', coa_name: 'Utang Bank Jk Pendek', amount: 10_000_000, notes: '' },
            ],
          },
          step4_ekuitas: {
            modal_owner: { amount: 100_000_000 },
            prive: { amount: 5_000_000 },
            laba_ditahan_calculated: null,
          },
        },
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const blob = await renderSaldoAwalPDF(snapshot, 'Sinar Elektrik');
      expect(blob.size).toBeGreaterThan(1000);
      await saveBlob('13-saldoAwal', blob);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
});
