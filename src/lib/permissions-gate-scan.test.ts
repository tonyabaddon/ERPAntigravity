import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_ROOT = resolve(__dirname, '..');

/**
 * Files known to gate on `can_*` permissions. When you add a new consumer,
 * append it here — the test will scan for the anti-pattern.
 *
 * Anti-pattern: `permissions?.can_xxx !== false` (default-visible → silent
 * bypass when undefined).
 *
 * Correct pattern: `permissions?.can_xxx === true` (opt-in gate) OR
 * `!!permissions?.can_xxx` (truthy, equivalent for boolean).
 */
const GATED_FILES = [
  'components/Sidebar.tsx',
  'components/pembelian/PurchaseOrderFormPage.tsx',
  'components/pembelian/PembelianDetailPage.tsx',
  'components/stok/StockOpnameScreen.tsx',
  'components/ManajemenGudangScreen.tsx',
  'components/PengaturanScreen.tsx',
  'components/PenjualanScreen.tsx',
];

const BAD_PATTERN = /\w+\?\.\s*can_\w+\s*!==\s*false/g;

describe('permissions gate consistency', () => {
  it.each(GATED_FILES)('%s does not use default-visible `!== false` gate on can_*', (rel) => {
    const src = readFileSync(resolve(SRC_ROOT, rel), 'utf8');
    const matches = src.match(BAD_PATTERN);
    expect(
      matches,
      `${rel} uses default-visible can_* gate (silent bypass risk). Change to === true.`,
    ).toBeNull();
  });

  /**
   * Guard against components reimplementing isVisible with the string-prefix
   * pattern (`key.startsWith('can_')`). This pattern silently bypasses the
   * registry's isActionPerm gate — e.g. `canConfigureSalesChannels` has
   * isActionPerm:true but doesn't start with 'can_', so it would default to
   * the `value !== false` branch and become visible even when not granted.
   *
   * Correct pattern: use REGISTRY_MAP.get(key as PermissionKey)?.isActionPerm
   * (mirrors Sidebar.tsx isPermVisible implementation).
   */
  it.each(GATED_FILES)('%s does not reimplement string-prefix isPermVisible', (rel) => {
    const src = readFileSync(resolve(SRC_ROOT, rel), 'utf8');
    const badPrefixPattern = /startsWith\(['"]can_['"]\)/g;
    const matches = src.match(badPrefixPattern);
    expect(
      matches,
      `${rel} uses string-prefix gate (canConfigureSalesChannels silent bypass risk). Use REGISTRY_MAP.get(key)?.isActionPerm instead.`,
    ).toBeNull();
  });
});
