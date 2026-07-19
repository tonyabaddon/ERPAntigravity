/**
 * T2 — Kasir POS golden path (WRITE)
 *
 * ⚠️ WRITE-CAPABLE — creates test data in Toko Jaya Makmur tenant.
 * Gated by env: PLAYWRIGHT_ALLOW_WRITES=1
 *
 * Founder approval required before enabling. Post-QA cleanup:
 *   DELETE FROM kasir_transactions WHERE date >= '2026-07-20' AND note LIKE 'QA-WEEK-%';
 *
 * Scenarios covered:
 *   F1 positive — happy path: select product, quantity 1, cash payment, submit
 *   F4 state — cannot submit twice with same idempotency key
 *   F6 boundary — quantity 0 rejected
 *   F9 error — negative stock warning shown (allowed per memory allow_negative_stock_preorder)
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T2 — Kasir POS (WRITE, gated)', () => {
  test.beforeEach(async () => {
    if (process.env.PLAYWRIGHT_ALLOW_WRITES !== '1') {
      test.skip(true, 'Set PLAYWRIGHT_ALLOW_WRITES=1 to run write tests');
    }
  });

  test('F1 — happy path: submit kasir transaction', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Navigate to Kasir
    // - Search + add 1 product to cart
    // - Set payment method: CASH
    // - Submit
    // - Assert success toast
    // - Assert transaction appears in list with note "QA-WEEK-<timestamp>"
  });

  test('F4 — double-submit protected by idempotency', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Same steps as F1
    // - After submit, immediately click submit again (before UI response)
    // - Assert only ONE transaction created
    // - Uses record_pembayaran idempotency (memory smoke_test_security_definer_rpcs)
  });

  test('F6 — quantity 0 rejected client-side', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Add product, set qty = 0
    // - Assert submit button disabled OR error message shown
  });

  test('F9 — negative stock allowed with warning (pre-order pattern)', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Add product where cart qty > available stock
    // - Assert warning shown ("stok akan minus...")
    // - Assert submit still enabled (per memory allow_negative_stock_preorder)
  });
});
