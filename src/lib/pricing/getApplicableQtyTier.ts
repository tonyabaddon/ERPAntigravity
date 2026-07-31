export interface QtyTier {
  min_qty: number;
  price: number;
}

/**
 * Returns the highest-threshold qty tier that applies at the given quantity,
 * or null if no tier applies. Highest-matching-wins: at qty=15 with tiers
 * [5, 10, 20], the tier at min_qty=10 fires (not 5), because 15 crosses both
 * 5 and 10 but not 20.
 */
export function getApplicableQtyTier(
  tiers: QtyTier[] | undefined,
  qty: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  const matching = tiers
    .filter(t => t.min_qty <= qty)
    .sort((a, b) => b.min_qty - a.min_qty);
  return matching[0] ?? null;
}

/**
 * Returns the next tier above the current quantity that would beat the
 * currentUnitPrice, or null. Used to render the kasir upsell hint
 * "Tip: beli N+ pcs jadi Rp X/pcs". Only suggests tiers that actually
 * improve the customer's price — if the current price (e.g. from customer
 * tier) is already better than any qty tier, no hint fires.
 */
export function getNextUpsellTier(
  tiers: QtyTier[] | undefined,
  currentQty: number,
  currentUnitPrice: number,
): QtyTier | null {
  if (!tiers || tiers.length === 0) return null;
  const candidates = tiers
    .filter(t => t.min_qty > currentQty && t.price < currentUnitPrice)
    .sort((a, b) => a.min_qty - b.min_qty);
  return candidates[0] ?? null;
}
