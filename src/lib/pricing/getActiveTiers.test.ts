import { describe, it, expect } from 'vitest';
import { getActiveTiers, resolveEffectiveTier, getTierPrice, type TierKey } from './getActiveTiers';
import type { DbTenantSettings } from '../../types';

const BASE_SETTINGS: DbTenantSettings = {
  // Only the fields getActiveTiers/resolveEffectiveTier reads matter here;
  // rest can be minimal to match the interface. Cast to satisfy TS.
  tier_1_label: 'Eceran',
  tier_2_label: 'Grosir',
  tier_3_label: null,
  tier_4_label: null,
} as DbTenantSettings;

describe('getActiveTiers', () => {
  it('returns 2 tiers when tier_3 and tier_4 labels are NULL', () => {
    const tiers = getActiveTiers(BASE_SETTINGS);
    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toEqual({ key: 'eceran', label: 'Eceran', slot: 1 });
    expect(tiers[1]).toEqual({ key: 'grosir', label: 'Grosir', slot: 2 });
  });

  it('returns 3 tiers when tier_3_label is set', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil' };
    const tiers = getActiveTiers(s);
    expect(tiers).toHaveLength(3);
    expect(tiers[2]).toEqual({ key: 'tier_3', label: 'Distributor Kecil', slot: 3 });
  });

  it('returns 4 tiers when both tier_3_label and tier_4_label are set', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor Kecil', tier_4_label: 'Distributor Besar' };
    const tiers = getActiveTiers(s);
    expect(tiers).toHaveLength(4);
    expect(tiers[3]).toEqual({ key: 'tier_4', label: 'Distributor Besar', slot: 4 });
  });

  it('preserves tenant-configured labels (renames)', () => {
    const s = { ...BASE_SETTINGS, tier_1_label: 'Retail Toko', tier_2_label: 'Grosir Kecil' };
    const tiers = getActiveTiers(s);
    expect(tiers[0].label).toBe('Retail Toko');
    expect(tiers[1].label).toBe('Grosir Kecil');
  });
});

describe('resolveEffectiveTier', () => {
  it('returns the customer tier when active', () => {
    const s = { ...BASE_SETTINGS, tier_3_label: 'Distributor' };
    expect(resolveEffectiveTier('tier_3', s)).toBe('tier_3');
  });

  it('falls back to eceran when the customer tier is disabled', () => {
    // customer tagged tier_3 but owner cleared tier_3_label
    expect(resolveEffectiveTier('tier_3', BASE_SETTINGS)).toBe('eceran');
  });

  it('keeps eceran and grosir even if legacy customer stores them (both always active)', () => {
    expect(resolveEffectiveTier('eceran', BASE_SETTINGS)).toBe('eceran');
    expect(resolveEffectiveTier('grosir', BASE_SETTINGS)).toBe('grosir');
  });
});

describe('getTierPrice', () => {
  const stock = {
    price: 100,
    price_grosir: 90,
    price_tier_3: 80,
    price_tier_4: null,
  };

  it('returns base price for eceran', () => {
    expect(getTierPrice(stock, 'eceran')).toBe(100);
  });

  it('returns price_grosir when tier=grosir', () => {
    expect(getTierPrice(stock, 'grosir')).toBe(90);
  });

  it('returns price_tier_3 when tier=tier_3', () => {
    expect(getTierPrice(stock, 'tier_3')).toBe(80);
  });

  it('falls back to base price when tier=tier_4 and price_tier_4 is null', () => {
    expect(getTierPrice(stock, 'tier_4')).toBe(100);
  });

  it('falls back to base price when tier=grosir and price_grosir is null', () => {
    const stockNoGrosir = { ...stock, price_grosir: null };
    expect(getTierPrice(stockNoGrosir, 'grosir')).toBe(100);
  });
});
