/**
 * T20 — Wave 1-3 QA-week smoke (prod, read-only)
 *
 * Verifies that Wave 1-3 FE changes (realtime filter, any-type sweep,
 * Sentry captureError sweep, 2J state coverage) have not introduced
 * regressions on app.caleo.id.
 *
 * Assertions:
 *   A1 — Login flow: session inject lands on authenticated dashboard
 *   A2 — Realtime subscription filter (Wave 1 2H): SalesInboxScreen renders
 *          without a console error storm (no TypeError / channel leak messages)
 *   A3 — Any-type sweep (Wave 3 P2-07): navigation across 4 screens produces
 *          zero console TypeErrors
 *   A4 — Sentry captureError sweep (Wave 3 P3-02): no "Cannot find module"
 *          or "captureError is not a function" errors in console
 *   A5 — 2J state coverage: PenjualanScreen, LaporanScreen, DashboardScreen
 *          all render (non-empty body, no white-screen crash text)
 *   A6 — No 5xx network responses across all visited screens
 *
 * Read-only. No writes. Safe to run against Toko Jaya Makmur (prod-testing-tenant).
 * Uses `tenantPage` fixture — real Supabase password-grant auth.
 */

import { test, expect } from '../../fixtures/auth';

const BASE = 'https://app.caleo.id';

// Screens visited by this spec (drives both A3 and A5).
const SCREENS_TO_VISIT = [
  { name: 'Dashboard',    url: `${BASE}/` },
  { name: 'Laporan',      url: `${BASE}/?screen=laporan` },
  { name: 'SalesInbox',   url: `${BASE}/?screen=sales-inbox` },
  { name: 'Penjualan',    url: `${BASE}/?screen=penjualan` },
];

// ─── Console-error filter helpers ────────────────────────────────────────────

/** Known-benign noise we always suppress. */
function isNoisyError(msg: string): boolean {
  return (
    msg.includes('DevTools') ||
    msg.includes('sentry') ||
    msg.includes('Sentry') ||
    msg.includes('adsbygoogle') ||
    /Failed to load resource.*401/.test(msg) ||
    // Supabase realtime channel close on page unload
    msg.includes('WebSocket connection') ||
    msg.includes('net::ERR_') ||
    // Chrome extension noise
    msg.includes('chrome-extension') ||
    // React strict-mode double-invoke artefacts (if visible in prod)
    msg.includes('react.dev')
  );
}

/** Flag TypeErrors specifically (Wave 3 P2-07 concern). */
function isTypeError(msg: string): boolean {
  return (
    msg.includes('TypeError') ||
    /is not a function/.test(msg) ||
    /Cannot read prop/.test(msg) ||
    /Cannot set prop/.test(msg) ||
    /undefined is not/.test(msg) ||
    /null is not/.test(msg)
  );
}

/** Flag Sentry-import / captureError problems (Wave 3 P3-02 concern). */
function isSentryImportError(msg: string): boolean {
  return (
    /captureError is not a function/i.test(msg) ||
    /Cannot find module.*sentry/i.test(msg) ||
    /Failed to fetch.*sentry/i.test(msg) ||
    /SentryError|@sentry\/browser.*not defined/i.test(msg)
  );
}

/** Flag realtime subscription anomalies (Wave 1 2H concern). */
function isRealtimeError(msg: string): boolean {
  return (
    /channel.*error/i.test(msg) ||
    /realtime.*fail/i.test(msg) ||
    /supabase.*subscribe.*error/i.test(msg) ||
    // Unchecked tenant_id filter would show all-tenant push and throw
    /multiple rows returned/i.test(msg)
  );
}

// ─── A1: Login / session bootstrap ───────────────────────────────────────────

test.describe('T20-A1 — Login flow (session inject)', () => {
  test('authenticated session lands on app.caleo.id', async ({ tenantPage }) => {
    // tenantPage fixture already signs in and reloads.
    await expect(tenantPage).toHaveURL(/app\.caleo\.id/);
    const bodyText = await tenantPage.locator('body').textContent();
    expect(bodyText).toBeTruthy();
    // Must have enough content for a real app shell (not a login redirect)
    expect((bodyText ?? '').length).toBeGreaterThan(200);
    // Explicit crash markers must be absent
    expect(bodyText ?? '').not.toContain('Application error');
    expect(bodyText ?? '').not.toContain('Something went wrong');
  });
});

// ─── A2: Realtime subscription filter (Wave 1 2H) ────────────────────────────

test.describe('T20-A2 — Realtime filter: SalesInboxScreen', () => {
  test.setTimeout(60_000);
  test('SalesInbox renders without realtime error storm', async ({ tenantPage }) => {
    const realtimeErrors: string[] = [];
    const allErrors: string[] = [];

    tenantPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        allErrors.push(text);
        if (isRealtimeError(text) && !isNoisyError(text)) {
          realtimeErrors.push(text);
        }
      }
    });

    await tenantPage.goto(`${BASE}/?screen=sales-inbox`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // Allow realtime subscription to settle
    await tenantPage.waitForTimeout(4000);

    const bodyText = await tenantPage.locator('body').textContent();
    expect(bodyText ?? '').not.toContain('Application error');
    expect(bodyText ?? '').not.toContain('Something went wrong');
    expect((bodyText ?? '').length).toBeGreaterThan(200);

    if (realtimeErrors.length > 0) {
      console.log('Realtime errors on SalesInbox:', realtimeErrors.slice(0, 5));
    }
    expect(realtimeErrors.length).toBe(0);
  });
});

// ─── A3: Any-type sweep — no TypeErrors during navigation (Wave 3 P2-07) ─────

test.describe('T20-A3 — Any-type sweep: no TypeErrors during navigation', () => {
  test.setTimeout(120_000);
  test('zero TypeErrors across all visited screens', async ({ tenantPage }) => {
    const typeErrors: { screen: string; msg: string }[] = [];

    // Start listening before we begin navigating
    tenantPage.on('console', (msg) => {
      if (msg.type() === 'error' && isTypeError(msg.text()) && !isNoisyError(msg.text())) {
        // We tag by current URL since we navigate sequentially
        typeErrors.push({ screen: tenantPage.url(), msg: msg.text() });
      }
    });

    for (const screen of SCREENS_TO_VISIT) {
      await tenantPage.goto(screen.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await tenantPage.waitForTimeout(2500);
    }

    if (typeErrors.length > 0) {
      console.log('TypeErrors found during navigation:');
      for (const te of typeErrors.slice(0, 10)) {
        console.log(`  [${te.screen}] ${te.msg.substring(0, 200)}`);
      }
    }
    expect(typeErrors.length).toBe(0);
  });
});

// ─── A4: Sentry captureError sweep (Wave 3 P3-02) ────────────────────────────

test.describe('T20-A4 — Sentry import: no captureError missing-import errors', () => {
  test.setTimeout(90_000);
  test('no Sentry import errors across screens', async ({ tenantPage }) => {
    const sentryErrors: string[] = [];

    tenantPage.on('console', (msg) => {
      if (msg.type() === 'error' && isSentryImportError(msg.text())) {
        sentryErrors.push(msg.text());
      }
    });

    for (const screen of SCREENS_TO_VISIT) {
      await tenantPage.goto(screen.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await tenantPage.waitForTimeout(2000);
    }

    if (sentryErrors.length > 0) {
      console.log('Sentry import/captureError errors found:', sentryErrors.slice(0, 5));
    }
    expect(sentryErrors.length).toBe(0);
  });
});

// ─── A5: 2J state coverage — render check on key screens ─────────────────────

test.describe('T20-A5 — 2J state coverage: screens render without crash', () => {
  test.setTimeout(120_000);

  for (const screen of SCREENS_TO_VISIT) {
    test(`${screen.name} renders (no white-screen crash)`, async ({ tenantPage }) => {
      await tenantPage.goto(screen.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await tenantPage.waitForTimeout(3000);

      const bodyText = await tenantPage.locator('body').textContent();
      // No crash markers
      expect(bodyText ?? '').not.toContain('Application error');
      expect(bodyText ?? '').not.toContain('Something went wrong');
      expect(bodyText ?? '').not.toContain('Minified React error');
      // Non-trivial content (real screen, not blank page)
      expect((bodyText ?? '').length).toBeGreaterThan(200);
    });
  }
});

// ─── A6: No 5xx network responses ────────────────────────────────────────────

test.describe('T20-A6 — Network health: no 5xx across visited screens', () => {
  test.setTimeout(120_000);
  test('zero 5xx responses during smoke navigation', async ({ tenantPage }) => {
    const fails: { screen: string; url: string; status: number }[] = [];

    tenantPage.on('response', (resp) => {
      if (resp.status() >= 500) {
        fails.push({ screen: tenantPage.url(), url: resp.url(), status: resp.status() });
      }
    });

    for (const screen of SCREENS_TO_VISIT) {
      await tenantPage.goto(screen.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await tenantPage.waitForTimeout(2500);
    }

    if (fails.length > 0) {
      console.log('5xx responses found:');
      for (const f of fails.slice(0, 10)) {
        console.log(`  [${f.screen.substring(0, 60)}] HTTP ${f.status}: ${f.url.substring(0, 120)}`);
      }
    }
    expect(fails.length).toBe(0);
  });
});
