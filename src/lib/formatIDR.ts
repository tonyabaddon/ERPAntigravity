/**
 * Format a number as Indonesian Rupiah with thousands separator, no cents.
 * Output: "Rp 1.234.567" (using period as thousands separator, Indonesian locale).
 *
 * This helper is intentionally separate from src/lib/format.ts (formatRp)
 * which is used in the tenant-facing POS/sales UI. formatIDR is used in the
 * admin revenue dashboard where the "Rp" prefix with a space is the canonical
 * display form for large payment amounts.
 *
 * @param n - Amount in IDR (integer or float; cents are truncated)
 * @returns  Formatted string e.g. "Rp 1.234.567"
 */
export function formatIDR(n: number): string {
  // Use Intl for locale-safe thousands separator.
  // 'id-ID' uses period as thousands separator, comma as decimal.
  const formatted = new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
  }).format(Math.trunc(n));
  return `Rp ${formatted}`;
}
