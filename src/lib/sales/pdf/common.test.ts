import { describe, test, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  renderHeader,
  renderDocTitle,
  renderCustomerBlock,
  renderBankBlock,
  renderFooter,
  formatRupiah,
  formatTanggal,
  MARGIN_MM,
  renderPageHeader,
  addPageWithHeader,
  measureItemRowHeight,
  renderRunningFooter,
  PAGE_INFO_HALAMAN_Y_OFFSET,
  PAGE_INFO_HALAMAN_X_OFFSET,
} from './common';
import type { StoreSettings, BankAccount } from '../../pengaturan/types';

const settings: StoreSettings = {
  id: 1,
  nama_toko: 'Sinar Elektrik',
  alamat_lengkap: 'Jl. X',
  kota: 'Surabaya',
  telp_wa: '0812',
  updated_at: '',
};

describe('PDF common', () => {
  test('formatRupiah formats with thousand separators', () => {
    expect(formatRupiah(1234567)).toBe('1.234.567');
    expect(formatRupiah(1234567, true)).toMatch(/^Rp/);
  });

  test('formatRupiah falls back to zero on non-finite input', () => {
    expect(formatRupiah(Number.NaN)).toBe('0');
  });

  test('formatTanggal returns long Indonesian date', () => {
    const s = formatTanggal('2026-06-19');
    expect(s).toMatch(/Juni|June/);
    expect(s).toMatch(/2026/);
  });

  test('renderHeader returns y past divider', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = renderHeader(doc, settings, 'SO/2026/00001', '2026-06-19');
    expect(y).toBeGreaterThan(MARGIN_MM + 21); // logo bottom
  });

  test('renderHeader accepts optional order short id', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = renderHeader(doc, settings, 'INV-DP/2026/00002', '2026-06-19', 'abcd1234');
    expect(y).toBeGreaterThan(0);
  });

  test('renderDocTitle advances y', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = renderDocTitle(doc, 'PESANAN PENJUALAN', 40);
    expect(y).toBeGreaterThan(40);
  });

  test('renderCustomerBlock advances y', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = renderCustomerBlock(doc, { name: 'X' }, { method: 'Delivery' }, 50);
    expect(y).toBeGreaterThan(50);
  });

  test('renderCustomerBlock tolerates missing optional fields', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    expect(() =>
      renderCustomerBlock(
        doc,
        { name: 'Jenny', phone: undefined, address: undefined },
        { method: 'Pickup', destination: undefined },
        70,
      ),
    ).not.toThrow();
  });

  test('renderBankBlock renders fallback line when no banks provided', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const y = renderBankBlock(doc, [], 80);
    expect(y).toBeGreaterThan(80);
  });

  test('renderBankBlock renders one row per active bank', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const banks: BankAccount[] = [
      { id: 'a', bank_name: 'BCA', account_number: '1234567890', account_holder: 'Sinar Elektrik', is_active: true, sort_order: 0 },
      { id: 'b', bank_name: 'BRI', account_number: '0987654321', account_holder: 'Sinar Elektrik', is_active: true, sort_order: 1 },
    ];
    const y = renderBankBlock(doc, banks, 80);
    expect(y).toBeGreaterThan(80 + 14); // header + 2 rows
  });

  test('renderFooter does not throw and writes within page', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    expect(() =>
      renderFooter(doc, 'SYARAT & KETENTUAN', [
        'Barang yang telah dibeli tidak dapat dikembalikan',
        'Pembayaran dianggap sah setelah dana masuk ke rekening kami',
      ]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multi-page primitives (task 11)
// ---------------------------------------------------------------------------

const soSettings: StoreSettings = {
  id: 1,
  nama_toko: 'Sinar Elektrik',
  alamat_lengkap: 'Jl. Y No. 5',
  kota: 'Bandung',
  telp_wa: '08123456789',
  updated_at: '',
  telp_kantor: '02212345',
  email: 'sinar@example.com',
  website_url: 'https://sinar.co.id',
  footer_show_telp_kantor: true,
  footer_show_wa: true,
  footer_show_email: true,
  footer_show_website: false,
};

describe('measureItemRowHeight', () => {
  test('returns base height for item without sub_parts', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const h = measureItemRowHeight(doc, { name: 'Test' }, {
      rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2,
    });
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(25);  // sanity
  });

  test('grows with sub_parts count', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const short = measureItemRowHeight(doc, { name: 'Test' }, {
      rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2,
    });
    const long = measureItemRowHeight(doc, {
      name: 'Test',
      sub_parts: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }],
    }, { rowFontSize: 10, subPartFontSize: 9, lineHeight: 1.2, padVertical: 2 });
    expect(long).toBeGreaterThan(short + 40);  // 5 sub-parts should add >= 40mm
  });
});

describe('renderPageHeader', () => {
  test('returns Y past header + banner block', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const ctx = {
      store: soSettings,
      logoDataUrl: null,
      docLabel: 'PENAWARAN HARGA',
      docNumber: 'SO/2026/00012',
      docDate: '04 Agustus 2026',
      validUntil: '18 Agustus 2026',
      pageNumber: 1,
      totalPages: 1,
    };
    const y = renderPageHeader(doc, ctx);
    expect(y).toBeGreaterThan(50); // banner ends around 53mm, content starts after
  });

  test('does not throw for minimal store settings', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const minimal: StoreSettings = {
      id: 1, nama_toko: 'Min', alamat_lengkap: '', kota: '', telp_wa: '', updated_at: '',
    };
    expect(() => renderPageHeader(doc, {
      store: minimal, logoDataUrl: null,
      docLabel: 'PENAWARAN HARGA', docNumber: 'SO/1', docDate: '2026-08-04', validUntil: '2026-08-18',
      pageNumber: 1, totalPages: 1,
    })).not.toThrow();
  });
});

describe('addPageWithHeader', () => {
  test('adds a page and returns valid Y', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    expect(doc.getNumberOfPages()).toBe(1);
    const ctx = {
      store: soSettings, logoDataUrl: null,
      docLabel: 'PENAWARAN HARGA', docNumber: 'SO/2026/00012',
      docDate: '04 Agustus 2026', validUntil: '18 Agustus 2026',
      pageNumber: 2, totalPages: 2,
    };
    const y = addPageWithHeader(doc, ctx);
    expect(doc.getNumberOfPages()).toBe(2);
    expect(y).toBeGreaterThan(0);
  });
});

describe('renderRunningFooter', () => {
  test('does not throw with full store settings', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    expect(() => renderRunningFooter(doc, soSettings)).not.toThrow();
  });

  test('does not throw with minimal store settings (no optional fields)', () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const minimal: StoreSettings = {
      id: 1, nama_toko: 'Min', alamat_lengkap: '', kota: '', telp_wa: '', updated_at: '',
    };
    expect(() => renderRunningFooter(doc, minimal)).not.toThrow();
  });
});

describe('PAGE_INFO_HALAMAN constants', () => {
  test('Y offset matches bannerY + 20 + 3*6 = 53', () => {
    expect(PAGE_INFO_HALAMAN_Y_OFFSET).toBe(53);
  });

  test('X offset is 30', () => {
    expect(PAGE_INFO_HALAMAN_X_OFFSET).toBe(30);
  });
});
