import type { DbTenantSettings } from '../../types';

export type TierKey = 'eceran' | 'grosir' | 'tier_3' | 'tier_4';

export interface Tier {
  key: TierKey;
  label: string;
  slot: 1 | 2 | 3 | 4;
}

/**
 * Single source of truth for "what tiers exist on this tenant, in what order,
 * with what labels". Tier 1 (eceran/base) and tier 2 (grosir) are always active.
 * Tier 3 and Tier 4 are active only when the owner has set a label for them;
 * NULL label = disabled.
 */
export function getActiveTiers(s: DbTenantSettings): Tier[] {
  const tiers: Tier[] = [
    { key: 'eceran', label: s.tier_1_label, slot: 1 },
    { key: 'grosir', label: s.tier_2_label, slot: 2 },
  ];
  if (s.tier_3_label) tiers.push({ key: 'tier_3', label: s.tier_3_label, slot: 3 });
  if (s.tier_4_label) tiers.push({ key: 'tier_4', label: s.tier_4_label, slot: 4 });
  return tiers;
}

/**
 * Orphan-tolerant read-time fallback: if the customer's stored tier is no longer
 * active (owner disabled it), return 'eceran' as the effective tier. Preserves
 * the stored value in DB; the fallback only affects rendering + line-add price
 * selection.
 */
export function resolveEffectiveTier(
  customerTier: TierKey,
  s: DbTenantSettings,
): TierKey {
  const activeKeys = getActiveTiers(s).map(t => t.key);
  return activeKeys.includes(customerTier) ? customerTier : 'eceran';
}

/**
 * Read-time price lookup for a stock item at a given tier. Missing tier price
 * falls back to the base `price` column, mirroring the existing price_grosir
 * fallback used in kasir/quotation RPCs.
 */
export function getTierPrice(
  stock: {
    price: number;
    price_grosir?: number | null;
    price_tier_3?: number | null;
    price_tier_4?: number | null;
  },
  tier: TierKey,
): number {
  switch (tier) {
    case 'grosir': return stock.price_grosir ?? stock.price;
    case 'tier_3': return stock.price_tier_3 ?? stock.price;
    case 'tier_4': return stock.price_tier_4 ?? stock.price;
    default:       return stock.price;
  }
}
