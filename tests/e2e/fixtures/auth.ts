/**
 * Playwright auth fixture — injects a Supabase Auth session into browser
 * localStorage before test navigation so tests run as authenticated users.
 *
 * DESIGN NOTES
 * ────────────
 * - Uses real Supabase Auth `signInWithPassword` — no mocking.
 * - Both test users are REAL auth.users rows created via direct SQL (not the
 *   Admin API, which requires the service_role key that lives in GCP Secret
 *   Manager and is not available locally).
 * - The stored session shape mirrors what @supabase/supabase-js v2.106.2
 *   writes: the full session object (access_token, refresh_token, expires_at,
 *   expires_in, token_type, user) stored under the key
 *   `sb-<project-ref>-auth-token`.  No split userStorage is configured.
 * - After injection we reload so the app's onAuthStateChange fires and the
 *   app bootstraps normally from the persisted session.
 *
 * TEST USERS (created by migration-free SQL fixture, 2026-07-17)
 * ─────────────────────────────────────────────────────────────
 * playwright-toko-owner@caleo.id   — tenant owner, Toko Jaya Makmur
 *   UUID: aaaaaaaa-0001-0001-0001-000000000001
 *   JWT claims: tenant_id=22222222-…, is_platform_admin=false
 *
 * playwright-admin@caleo.id        — platform super_admin (no tenant)
 *   UUID: aaaaaaaa-0002-0002-0002-000000000002
 *   JWT claims: is_platform_admin=true, platform_admin_role=super_admin
 *
 * Credentials are read from env vars set in .env (git-ignored).
 * In CI: auth tests are skipped unless PLAYWRIGHT_TOKO_EMAIL is set.
 */

import { test as base, type Page } from '@playwright/test';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  ?? 'https://ekhhojaezdfjfwuxyjkl.supabase.co';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const STORAGE_KEY   = 'sb-ekhhojaezdfjfwuxyjkl-auth-token';
const PROD_APP_URL  = process.env.PROD_APP_URL   ?? 'https://app.caleo.id';
const PROD_ADMIN_URL = process.env.PROD_ADMIN_URL ?? 'https://admin.caleo.id';

/** Sign in via Supabase password grant and return the raw session object. */
async function signInWithPassword(email: string, password: string) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Supabase signInWithPassword failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

/** Inject a Supabase session into the browser's localStorage. */
async function injectSession(page: Page, appUrl: string, session: Record<string, unknown>) {
  // Navigate to a known-stable sub-path to ensure the same-origin context is
  // established before we call evaluate().  For admin.caleo.id the root URL
  // immediately issues window.location.replace('/admin') which can destroy the
  // evaluation context mid-flight.  Navigating directly to /admin skips the
  // redirect and gives us a stable frame for the localStorage write.
  const stableUrl = appUrl.includes('admin') ? `${appUrl}/admin` : appUrl;

  await page.goto(stableUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 });

  // Wait for the frame to be truly stable — the redirect on admin.caleo.id fires
  // inside a useEffect so we give it a tick to settle before writing localStorage.
  await page.waitForTimeout(500);

  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: JSON.stringify(session) },
  );

  // Reload so the app's onAuthStateChange / INITIAL_SESSION fires and the app
  // bootstraps from the persisted session instead of showing the login screen.
  // Use 'domcontentloaded' — 'networkidle' can time out on pages with
  // persistent WebSocket connections (Supabase realtime).
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Give async React rendering + Supabase data fetches a moment to settle.
  await page.waitForTimeout(2000);
}

// ─── Fixture type ────────────────────────────────────────────────────────────

type AuthFixtures = {
  /** Authenticated page for the Toko Jaya Makmur owner test user. */
  tenantPage: Page;
  /** Authenticated page for the platform super_admin test user. */
  adminPage: Page;
};

// ─── Extended test ───────────────────────────────────────────────────────────

export const test = base.extend<AuthFixtures>({
  tenantPage: async ({ page }, use) => {
    const email    = process.env.PLAYWRIGHT_TOKO_EMAIL    ?? 'playwright-toko-owner@caleo.id';
    const password = process.env.PLAYWRIGHT_TOKO_PASSWORD ?? 'PlaywrightTest2026!Secure';

    if (!SUPABASE_ANON) throw new Error('VITE_SUPABASE_ANON_KEY is not set — check .env');

    const session = await signInWithPassword(email, password);
    await injectSession(page, PROD_APP_URL, session);
    await use(page);
  },

  adminPage: async ({ page }, use) => {
    const email    = process.env.PLAYWRIGHT_ADMIN_EMAIL    ?? 'playwright-admin@caleo.id';
    const password = process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? 'PlaywrightAdmin2026!Secure';

    if (!SUPABASE_ANON) throw new Error('VITE_SUPABASE_ANON_KEY is not set — check .env');

    const session = await signInWithPassword(email, password);
    // Admin app lives at admin.caleo.id — inject there so the same-origin
    // localStorage is populated for that hostname.
    await injectSession(page, PROD_ADMIN_URL, session);
    await use(page);
  },
});

export { expect } from '@playwright/test';
