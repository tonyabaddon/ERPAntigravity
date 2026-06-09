// Indonesian Rupiah currency formatter. Shared across kasir/penjualan UI to
// avoid duplicating identical Intl.NumberFormat options in every component.
export function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}
