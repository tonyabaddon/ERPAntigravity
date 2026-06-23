import { describe, expect, test } from 'vitest';
import { computeDiscountAmount } from './computeDiscountAmount';

describe('computeDiscountAmount', () => {
  test('null type returns 0', () => {
    expect(computeDiscountAmount(50, null, 1000)).toBe(0);
    expect(computeDiscountAmount(null, null, 1000)).toBe(0);
  });

  test('AMOUNT returns value clamped to base', () => {
    expect(computeDiscountAmount(50000, 'AMOUNT', 100000)).toBe(50000);
    expect(computeDiscountAmount(150000, 'AMOUNT', 100000)).toBe(100000); // capped
    expect(computeDiscountAmount(0, 'AMOUNT', 100000)).toBe(0);
  });

  test('PERCENT resolves to base × value / 100, clamped', () => {
    expect(computeDiscountAmount(10, 'PERCENT', 100000)).toBe(10000);
    expect(computeDiscountAmount(5, 'PERCENT', 200000)).toBe(10000);
    expect(computeDiscountAmount(100, 'PERCENT', 50000)).toBe(50000);
    expect(computeDiscountAmount(150, 'PERCENT', 50000)).toBe(50000); // capped
  });

  test('null value treated as 0', () => {
    expect(computeDiscountAmount(null, 'PERCENT', 1000)).toBe(0);
    expect(computeDiscountAmount(null, 'AMOUNT', 1000)).toBe(0);
  });

  test('NaN and negative values guarded', () => {
    expect(computeDiscountAmount(NaN, 'AMOUNT', 1000)).toBe(0);
    expect(computeDiscountAmount(-50, 'AMOUNT', 1000)).toBe(0);
    expect(computeDiscountAmount(-10, 'PERCENT', 1000)).toBe(0);
  });

  test('base ≤ 0 returns 0', () => {
    expect(computeDiscountAmount(50, 'AMOUNT', 0)).toBe(0);
    expect(computeDiscountAmount(10, 'PERCENT', -100)).toBe(0);
  });

  test('PERCENT result is rounded to nearest Rupiah (no fractional cents)', () => {
    // Decision: round to nearest integer (NUMERIC stored, but stable display).
    // 3% of 333 = 9.99 → 10. 1% of 123 = 1.23 → 1.
    expect(computeDiscountAmount(3, 'PERCENT', 333)).toBe(10);
    expect(computeDiscountAmount(1, 'PERCENT', 123)).toBe(1); // 1.23 → 1
  });
});
