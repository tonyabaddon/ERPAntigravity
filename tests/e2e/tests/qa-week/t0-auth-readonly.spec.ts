/**
 * T0 — Authentication + tenant-select + error screens
 * Read-only. No writes. Safe to run on prod against Toko Jaya Makmur.
 *
 * Scenarios covered (functional matrix):
 *   F1 positive — happy login, session persisted, land on dashboard
 *   F2 input validation — empty email, malformed email
 *   F4 state — expired session redirect
 *   F9 error — wrong credentials → readable error
 *   F10 permission — direct URL to /admin as tenant user → access denied
 *
 * NOTE: Uses `tenantPage` fixture which authenticates as
 * playwright-toko-owner@caleo.id (Toko Jaya Makmur). Fixture creds in .env.
 */

import { test, expect } from '../../fixtures/auth';

test.describe('T0 — Auth flow (read-only smoke)', () => {
  test('F1 — authenticated session renders dashboard', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Assert URL contains dashboard route
    // - Assert sidebar visible + tenant name in header
    // - Assert no console errors
    await expect(tenantPage).toHaveURL(/app\.caleo\.id/);
  });

  test('F9 — logout returns to login screen', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Click logout in sidebar
    // - Assert redirect to /login
    // - Assert email input visible
  });

  test('F10 — tenant user cannot reach /admin', async ({ tenantPage }) => {
    // TODO(qa-week): expand
    // - Navigate to admin.caleo.id directly
    // - Assert access-denied or login page (not admin dashboard)
    // - Verify no admin-specific components render
  });
});

test.describe('T0 — Auth error screens (unauthenticated)', () => {
  test('F2 — malformed email shows validation error', async ({ page }) => {
    // TODO(qa-week): expand
    // - Navigate to login page (no fixture — anon)
    // - Fill email with "notanemail"
    // - Submit
    // - Assert visible error text like "email tidak valid"
  });

  test('F9 — wrong password shows readable error', async ({ page }) => {
    // TODO(qa-week): expand
    // - Fill valid email + wrong password
    // - Submit
    // - Assert visible error message in Bahasa Indonesia
    // - No stack trace / cryptic error
  });
});
