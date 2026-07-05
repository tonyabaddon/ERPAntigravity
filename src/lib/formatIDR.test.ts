import { describe, it, expect } from 'vitest';
import { formatIDR } from './formatIDR';

describe('formatIDR', () => {
  it('formats 1234567 as Rp 1.234.567', () => {
    expect(formatIDR(1234567)).toBe('Rp 1.234.567');
  });

  it('formats 0 as Rp 0', () => {
    expect(formatIDR(0)).toBe('Rp 0');
  });

  it('formats 1000 as Rp 1.000', () => {
    expect(formatIDR(1000)).toBe('Rp 1.000');
  });

  it('formats 3600000 as Rp 3.600.000', () => {
    expect(formatIDR(3600000)).toBe('Rp 3.600.000');
  });

  it('formats 100 as Rp 100 (no separator under 1000)', () => {
    expect(formatIDR(100)).toBe('Rp 100');
  });

  it('truncates decimal cents — no fractional part', () => {
    expect(formatIDR(1234567.89)).toBe('Rp 1.234.567');
  });

  it('formats 50000000 as Rp 50.000.000', () => {
    expect(formatIDR(50000000)).toBe('Rp 50.000.000');
  });

  it('formats large values without overflow', () => {
    const result = formatIDR(1000000000);
    expect(result).toBe('Rp 1.000.000.000');
  });
});
