// tests/integration/dateRange.test.ts
import { describe, test, expect } from 'vitest';
import {
  resolveRange,
  periodLabel,
  resolvedRangeShort,
  inRange,
} from '../../src/lib/dateRange';

const T = '2026-06-13'; // pretend "today WIB" for deterministic tests

describe('resolveRange', () => {
  test('bulan_ini → first of month to today', () => {
    expect(resolveRange({ preset: 'bulan_ini' }, T)).toEqual({ from: '2026-06-01', to: '2026-06-13' });
  });

  test('30_hari → 30-day rolling window inclusive of today', () => {
    expect(resolveRange({ preset: '30_hari' }, T)).toEqual({ from: '2026-05-15', to: '2026-06-13' });
  });

  test('90_hari → 90-day rolling window inclusive of today', () => {
    expect(resolveRange({ preset: '90_hari' }, T)).toEqual({ from: '2026-03-16', to: '2026-06-13' });
  });

  test('custom → uses supplied from/to', () => {
    expect(resolveRange({ preset: 'custom', customFrom: '2026-04-01', customTo: '2026-04-30' }, T))
      .toEqual({ from: '2026-04-01', to: '2026-04-30' });
  });

  test('custom without inputs → falls back to bulan_ini bounds', () => {
    expect(resolveRange({ preset: 'custom' }, T)).toEqual({ from: '2026-06-01', to: '2026-06-13' });
  });

  test('30_hari at month boundary (first of month) does not roll back', () => {
    // operator opens screen at WIB 1 Jun → today must stay 1 Jun
    const r = resolveRange({ preset: '30_hari' }, '2026-06-01');
    expect(r.to).toBe('2026-06-01');
    expect(r.from).toBe('2026-05-03');
  });
});

describe('periodLabel', () => {
  test('preset labels are Indonesian', () => {
    expect(periodLabel({ preset: 'bulan_ini' }, T)).toBe('Bulan Ini');
    expect(periodLabel({ preset: '30_hari' }, T)).toBe('30 Hari Terakhir');
    expect(periodLabel({ preset: '90_hari' }, T)).toBe('90 Hari Terakhir');
  });

  test('custom full-month → "Mei 2026"', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2026-05-01', customTo: '2026-05-31' }, T))
      .toBe('Mei 2026');
  });

  test('custom partial range → "15 Apr – 30 Mei 2026"', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2026-04-15', customTo: '2026-05-30' }, T))
      .toBe('15 Apr – 30 Mei 2026');
  });

  test('custom year-crossing → both years shown', () => {
    expect(periodLabel({ preset: 'custom', customFrom: '2025-12-20', customTo: '2026-01-05' }, T))
      .toBe('20 Des 2025 – 5 Jan 2026');
  });
});

describe('resolvedRangeShort', () => {
  test('bulan_ini at T → "1 Jun – 13 Jun 2026"', () => {
    expect(resolvedRangeShort({ preset: 'bulan_ini' }, T)).toBe('1 Jun – 13 Jun 2026');
  });
});

describe('inRange', () => {
  test('inclusive at both ends', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange('2026-06-01', r)).toBe(true);
    expect(inRange('2026-06-13', r)).toBe(true);
    expect(inRange('2026-06-07', r)).toBe(true);
  });
  test('exclusive outside', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange('2026-05-31', r)).toBe(false);
    expect(inRange('2026-06-14', r)).toBe(false);
  });
  test('null / undefined date → false (defensive)', () => {
    const r = { from: '2026-06-01', to: '2026-06-13' };
    expect(inRange(null as unknown as string, r)).toBe(false);
    expect(inRange(undefined as unknown as string, r)).toBe(false);
    expect(inRange('', r)).toBe(false);
  });
});
