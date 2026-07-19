/**
 * T2 — Warehouse Transfer (read-only)
 * Verifies transfer list + detail views. No writes (create/cancel gated).
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T2 — Warehouse Transfer list', () => {
  test('F1 — /warehouse-transfer list loads', async ({ tenantPage }) => {
    // TODO(qa-week): expand
  });

  test('F7 — empty state shows helpful CTA when no transfers', async ({ tenantPage }) => {
    // TODO(qa-week): expand
  });

  test('F1 — detail page loads for an existing transfer', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Find first row in list
    // - Click detail
    // - Assert doc_no + line items + status visible
  });
});
