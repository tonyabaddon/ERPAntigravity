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
