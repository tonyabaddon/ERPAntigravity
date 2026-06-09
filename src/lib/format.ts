// Indonesian Rupiah currency formatter. Shared across kasir/penjualan UI to
// avoid duplicating identical Intl.NumberFormat options in every component.
export function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

// Returns YYYY-MM-DD for the given moment in Asia/Jakarta (WIB, UTC+7).
//
// Why this helper exists: `new Date().toISOString().slice(0, 10)` returns the
// UTC calendar date. For a user in WIB recording a sale at 21:00 local time,
// UTC is 14:00 — same day — so it happens to work. But at 17:00-23:59 WIB,
// UTC has already rolled over to H+1, so `toISOString().slice(0, 10)` returns
// tomorrow's date and the sale lands on the wrong day in the books. This
// helper formats the moment in the Jakarta zone so the date string matches
// the cashier's wall clock.
//
// Accepts a Date or defaults to "now". `toLocaleDateString('en-CA', …)` is
// guaranteed to produce ISO-8601 `YYYY-MM-DD` by spec.
export function wibDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
