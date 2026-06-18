/**
 * Compact Rupiah formatter for dashboard stats cards.
 * Renders millions as "Rp 18.7M", thousands as "Rp 380K", and sub-thousand
 * as-is "Rp 50". Intentionally simpler than formatRp (which uses Intl) to
 * keep the output predictable for UI size constraints.
 */
export function formatJuta(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}K`;
  return `Rp ${n}`;
}
