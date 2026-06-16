import { describe, it, expect } from 'vitest';

interface ValidationError { field: string; message: string; }

function validate(input: { category: string; unit: string; price: number; photos: number;
  unitAlt: string | null; unitAltFactor: number | null;
}): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!input.category) errs.push({ field: 'category', message: 'Kategori wajib' });
  if (!input.unit) errs.push({ field: 'unit', message: 'Satuan wajib' });
  if (!input.price || input.price <= 0) errs.push({ field: 'price', message: 'Harga > 0' });
  if (input.photos < 1) errs.push({ field: 'photos', message: 'Min 1 foto' });
  if ((input.unitAlt && !input.unitAltFactor) || (!input.unitAlt && input.unitAltFactor))
    errs.push({ field: 'multi_satuan', message: 'mismatched' });
  if (input.unitAlt && input.unitAlt === input.unit) errs.push({ field: 'unit_alt', message: 'same' });
  if (input.unitAltFactor !== null && input.unitAltFactor <= 1)
    errs.push({ field: 'unit_alt_factor', message: '>1' });
  return errs;
}

describe('productForm validate', () => {
  const ok = { category: 'MCB', unit: 'pcs', price: 100, photos: 1, unitAlt: null, unitAltFactor: null };
  it('accepts minimal valid', () => expect(validate(ok)).toEqual([]));
  it('rejects 0 photos', () => expect(validate({...ok, photos: 0})[0].field).toBe('photos'));
  it('rejects factor=1', () => expect(validate({...ok, unitAlt: 'roll', unitAltFactor: 1})[0].field).toBe('unit_alt_factor'));
  it('rejects same unit', () => expect(validate({...ok, unitAlt: 'pcs', unitAltFactor: 2})[0].field).toBe('unit_alt'));
  it('rejects half-multi-satuan', () => expect(validate({...ok, unitAlt: 'roll', unitAltFactor: null})[0].field).toBe('multi_satuan'));
});
