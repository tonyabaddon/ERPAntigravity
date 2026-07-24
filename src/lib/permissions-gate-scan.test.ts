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
});
