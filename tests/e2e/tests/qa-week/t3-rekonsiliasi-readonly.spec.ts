/**
 * T3 — Rekonsiliasi wizard (read-only)
 * Verifies wizard entry states, but doesn't upload PDF or perform matching.
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T3 — Rekonsiliasi wizard entry', () => {
  test('F1 — /rekonsiliasi loads', async ({ tenantPage }) => {
    // TODO(qa-week): expand
  });

  test('F7 — empty state when no reconciliation period active', async ({ tenantPage }) => {
    // TODO(qa-week): expand
  });

  test('F8 — bank account selector loads with tenant accounts', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Assert all tenant bank accounts appear in dropdown
    // - Assert no cross-tenant account visible
  });
});
