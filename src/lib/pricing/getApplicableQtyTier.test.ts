import { describe, it, expect } from 'vitest';
import { getApplicableQtyTier, getNextUpsellTier, type QtyTier } from './getApplicableQtyTier';

const TIERS: QtyTier[] = [
  { min_qty: 5, price: 8000 },
  { min_qty: 10, price: 7000 },
  { min_qty: 20, price: 6500 },
];

describe('getApplicableQtyTier', () => {
  it('returns null when tiers is undefined', () => {
    expect(getApplicableQtyTier(undefined, 10)).toBeNull();
  });

  it('returns null when tiers is empty', () => {
    expect(getApplicableQtyTier([], 10)).toBeNull();
  });

  it('returns null when qty below all thresholds', () => {
    expect(getApplicableQtyTier(TIERS, 3)).toBeNull();
  });

  it('returns the exact-match tier at threshold', () => {
    expect(getApplicableQtyTier(TIERS, 5)).toEqual({ min_qty: 5, price: 8000 });
  });

  it('returns highest matching tier when qty exceeds multiple thresholds', () => {
    expect(getApplicableQtyTier(TIERS, 15)).toEqual({ min_qty: 10, price: 7000 });
  });

  it('returns top tier when qty far exceeds top threshold', () => {
    expect(getApplicableQtyTier(TIERS, 500)).toEqual({ min_qty: 20, price: 6500 });
  });

  it('tolerates unsorted tier input', () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
    expect(getApplicableQtyTier(shuffled, 15)).toEqual({ min_qty: 10, price: 7000 });
  });
});

describe('getNextUpsellTier', () => {
  it('returns null when tiers is undefined', () => {
    expect(getNextUpsellTier(undefined, 3, 10000)).toBeNull();
  });

  it('returns null when tiers is empty', () => {
    expect(getNextUpsellTier([], 3, 10000)).toBeNull();
  });

  it('returns first tier above qty when it beats currentUnitPrice', () => {
    // qty=3, current=10000; tier 5 at 8000 beats → suggest 5
    expect(getNextUpsellTier(TIERS, 3, 10000)).toEqual({ min_qty: 5, price: 8000 });
  });

  it('returns next tier when qty already at a tier', () => {
    // qty=7 already at tier 5 (unit=8000); tier 10 at 7000 beats → suggest 10
    expect(getNextUpsellTier(TIERS, 7, 8000)).toEqual({ min_qty: 10, price: 7000 });
  });

  it('returns null when qty already at top tier', () => {
    expect(getNextUpsellTier(TIERS, 25, 6500)).toBeNull();
  });

  it('returns null when next tier would NOT beat currentUnitPrice', () => {
    // currentUnitPrice is customer tier at 6000; qty=3; next tier 5 at 8000 is WORSE → no upsell
    expect(getNextUpsellTier(TIERS, 3, 6000)).toBeNull();
  });

  it('skips tiers that do not beat current price, returns next that does', () => {
    // currentUnitPrice=7500; qty=3
    // tier 5 at 8000 doesn't beat; tier 10 at 7000 beats → suggest 10
    expect(getNextUpsellTier(TIERS, 3, 7500)).toEqual({ min_qty: 10, price: 7000 });
  });
});
