export interface NewProductFormState {
  name: string;
  category: string;
  price: string;      // raw input as string (parsed inside)
  hppText: string;    // optional
  unit: string;
}

export interface NewProductValidationResult {
  ok: boolean;
  errors: string[];
}

function parseRupiah(raw: string): number {
  // accept "45.000", "45,000", "45000"
  const cleaned = raw.replace(/[.,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

export function validateNewProductForm(s: NewProductFormState): NewProductValidationResult {
  const errors: string[] = [];
  if (!s.name || s.name.trim().length === 0) errors.push('Nama produk wajib diisi');
  if (!s.category || s.category.trim().length === 0) errors.push('Kategori wajib dipilih');
  const price = parseRupiah(s.price);
  if (!Number.isFinite(price) || price <= 0) errors.push('Harga jual wajib > 0');
  if (s.hppText && s.hppText.trim().length > 0) {
    const hpp = parseRupiah(s.hppText);
    if (!Number.isFinite(hpp) || hpp < 0) errors.push('HPP harus angka ≥ 0');
  }
  return { ok: errors.length === 0, errors };
}

export function parsePriceLike(raw: string): number {
  return parseRupiah(raw);
}
