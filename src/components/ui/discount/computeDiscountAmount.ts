import type { DiscountType } from '../../../types';

/**
 * Resolve raw discount input (value + type) to a Rupiah amount.
 *
 * - `AMOUNT`: value adalah total Rp off the line/order; capped to `base`.
 * - `PERCENT`: value adalah persen terhadap `base`; rounded to nearest Rp.
 * - `null`/`NaN`/`< 0`: treated as no discount (returns 0).
 * - `base ≤ 0`: returns 0.
 */
export function computeDiscountAmount(
  value: number | null,
  type: DiscountType,
  base: number,
): number {
  if (type === null) return 0;
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;

  let raw: number;
  if (type === 'AMOUNT') {
    raw = value;
  } else {
    raw = Math.round((base * value) / 100);
  }
  return Math.min(raw, base);
}
