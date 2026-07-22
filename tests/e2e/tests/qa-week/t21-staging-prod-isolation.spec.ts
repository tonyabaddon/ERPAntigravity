/**
 * T21 — Staging/Prod isolation (post-Phase-3).
 *
 * Verifies:
 *   A1 — staging.app.caleo.id/select-tenant should not surface prod tenant slugs
 *   A2 — app.caleo.id/select-tenant should not surface staging tenant slugs
 *
 * Cross-env DB-layer leak (staging JWT reads prod tenant rows) is covered by
 * tests/sql/qa-week/staging-prod-isolation-regression.sql (Part B).
 */
import { test, expect } from '../../fixtures/auth';

const STAGING_TENANTS = ['garindo-staging', 'toko-jaya-makmur-staging', 'warung-sinar-rezeki-staging'];
const PROD_TENANTS = ['garindo', 'toko-jaya-makmur', 'warung-sinar-rezeki'];

test.describe('T21 — Staging/Prod tenant picker isolation', () => {
  test.setTimeout(120_000);

  test('A1 — staging.app.caleo.id does not surface prod tenant slugs', async ({ tenantPage }) => {
    await tenantPage.goto('https://staging.app.caleo.id/select-tenant', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3_000);
    const bodyText = (await tenantPage.locator('body').textContent()) || '';
    for (const prod of PROD_TENANTS) {
      expect(bodyText).not.toMatch(new RegExp(`\\b${prod}\\b(?!-staging)`, 'i'));
    }
  });

  test('A2 — app.caleo.id does not surface staging tenant slugs', async ({ tenantPage }) => {
    await tenantPage.goto('https://app.caleo.id/select-tenant', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await tenantPage.waitForTimeout(3_000);
    const bodyText = (await tenantPage.locator('body').textContent()) || '';
    for (const staging of STAGING_TENANTS) {
      expect(bodyText).not.toContain(staging);
    }
  });
});
