import { describe, it, expect } from 'vitest';
import { terbilangRupiah } from './terbilang';

describe('terbilangRupiah', () => {
  const cases: Array<[number, string]> = [
    [0, 'Nol Rupiah'],
    [1, 'Satu Rupiah'],
    [2, 'Dua Rupiah'],
    [10, 'Sepuluh Rupiah'],
    [11, 'Sebelas Rupiah'],
    [12, 'Dua Belas Rupiah'],
    [19, 'Sembilan Belas Rupiah'],
    [20, 'Dua Puluh Rupiah'],
    [21, 'Dua Puluh Satu Rupiah'],
    [99, 'Sembilan Puluh Sembilan Rupiah'],
    [100, 'Seratus Rupiah'],
    [101, 'Seratus Satu Rupiah'],
    [111, 'Seratus Sebelas Rupiah'],
    [200, 'Dua Ratus Rupiah'],
    [999, 'Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000, 'Seribu Rupiah'],
    [1_001, 'Seribu Satu Rupiah'],
    [1_500, 'Seribu Lima Ratus Rupiah'],
    [2_000, 'Dua Ribu Rupiah'],
    [10_000, 'Sepuluh Ribu Rupiah'],
    [11_000, 'Sebelas Ribu Rupiah'],
    [100_000, 'Seratus Ribu Rupiah'],
    [999_999, 'Sembilan Ratus Sembilan Puluh Sembilan Ribu Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000_000, 'Satu Juta Rupiah'],
    [1_500_000, 'Satu Juta Lima Ratus Ribu Rupiah'],
    [18_300_000, 'Delapan Belas Juta Tiga Ratus Ribu Rupiah'],
    [100_000_000, 'Seratus Juta Rupiah'],
    [999_999_999, 'Sembilan Ratus Sembilan Puluh Sembilan Juta Sembilan Ratus Sembilan Puluh Sembilan Ribu Sembilan Ratus Sembilan Puluh Sembilan Rupiah'],
    [1_000_000_000, 'Satu Milyar Rupiah'],
    [2_500_000_000, 'Dua Milyar Lima Ratus Juta Rupiah'],
    [1_000_000_000_000, 'Satu Triliun Rupiah'],
  ];

  it.each(cases)('terbilangRupiah(%d) → %s', (n, expected) => {
    expect(terbilangRupiah(n)).toBe(expected);
  });

  it('rejects negative numbers', () => {
    expect(() => terbilangRupiah(-1)).toThrow(/non-negative/i);
  });

  it('rounds fractional to integer (rupiah has no sen)', () => {
    expect(terbilangRupiah(1.7)).toBe('Dua Rupiah');
  });
});
