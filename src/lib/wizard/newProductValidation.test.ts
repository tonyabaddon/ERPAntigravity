import { describe, it, expect } from 'vitest';
import { validateNewProductForm } from './newProductValidation';

describe('validateNewProductForm', () => {
  const valid = { name: 'MCB Schneider 25A', category: 'MCB', price: '50000', hppText: '30000', unit: 'pcs' };

  it('passes for fully-valid input', () => {
    const r = validateNewProductForm(valid);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects empty name', () => {
    const r = validateNewProductForm({ ...valid, name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/nama/i);
  });

  it('rejects empty category', () => {
    const r = validateNewProductForm({ ...valid, category: '' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/kategori/i);
  });

  it('rejects non-positive price', () => {
    const r = validateNewProductForm({ ...valid, price: '0' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/harga jual/i);
  });

  it('rejects non-numeric price', () => {
    const r = validateNewProductForm({ ...valid, price: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/harga jual/i);
  });

  it('allows empty hpp (optional)', () => {
    const r = validateNewProductForm({ ...valid, hppText: '' });
    expect(r.ok).toBe(true);
  });

  it('rejects negative hpp', () => {
    const r = validateNewProductForm({ ...valid, hppText: '-10' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/hpp/i);
  });
});
