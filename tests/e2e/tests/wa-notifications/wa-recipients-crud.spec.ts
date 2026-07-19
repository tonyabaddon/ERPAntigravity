/**
 * WA Recipients CRUD lifecycle test
 *
 * Verifies the full add → verify normalization → delete flow for WA recipient
 * management in Pengaturan → Umum tab.
 *
 * Requires .env with:
 *   PLAYWRIGHT_TOKO_EMAIL, PLAYWRIGHT_TOKO_PASSWORD
 *   PROD_APP_URL (default: https://app.caleo.id)
 *
 * CI note: test is skipped automatically if PLAYWRIGHT_TOKO_EMAIL is not set.
 */

import { test, expect } from '../../fixtures/auth';

const PROD_APP_URL = process.env.PROD_APP_URL ?? 'https://app.caleo.id';

const hasAuthCreds = !!(
  process.env.PLAYWRIGHT_TOKO_EMAIL ?? 'playwright-toko-owner@caleo.id'
);

test.describe('WA Recipients CRUD lifecycle', () => {
  test.skip(!hasAuthCreds, 'Auth credentials not available (CI without secrets)');

  test('add recipient with 085x format → phone normalized → delete', async ({ tenantPage: page }) => {
    // Navigate to Pengaturan → Umum tab
    await page.goto(`${PROD_APP_URL}/?screen=pengaturan`);
    await expect(page.locator('text=/Pengaturan/i').first()).toBeVisible({ timeout: 15_000 });

    // Open add form
    await page.click('button:has-text("Tambah Penerima")');
    await expect(page.locator('text=Tambah Penerima Baru')).toBeVisible({ timeout: 5_000 });

    // Fill form with 085x format — should be normalized to 6285x on save
    await page.fill('input[placeholder*="085"]', 'Playwright Test User');

    // Fill name field (find by label proximity)
    const nameInput = page.locator('input[placeholder="Nama admin"]');
    await nameInput.fill('Playwright Test User');

    const phoneInput = page.locator('input[placeholder*="085x"]');
    await phoneInput.fill('085123456789');

    // Select owner role
    await page.selectOption('select', 'owner');

    // Save
    await page.click('button:has-text("Simpan")');

    // The saved row should display normalized number 6285123456789
    await expect(
      page.locator('p.font-mono', { hasText: '6285123456789' })
    ).toBeVisible({ timeout: 10_000 });

    // "Kirim tes" button should be visible for the new row
    const row = page.locator('div', { has: page.locator('p.font-mono:has-text("6285123456789")') }).first();
    await expect(row.locator('button:has-text("Kirim tes")')).toBeVisible();

    // Delete the test row
    await row.locator('button[title="Hapus"]').click();

    // Confirm deletion dialog
    page.on('dialog', d => d.accept());

    // Row should be gone
    await expect(
      page.locator('p.font-mono:has-text("6285123456789")')
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
