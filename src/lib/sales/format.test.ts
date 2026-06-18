import { describe, test, expect } from 'vitest';
import { formatJuta } from './format';

describe('formatJuta', () => {
  test('formats millions', () => { expect(formatJuta(18_700_000)).toBe('Rp 18.7M'); });
  test('formats thousands', () => { expect(formatJuta(380_000)).toBe('Rp 380K'); });
  test('formats single rupiahs', () => { expect(formatJuta(50)).toBe('Rp 50'); });
});
