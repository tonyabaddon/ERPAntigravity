import { test, expect } from '@playwright/test';

const BASE = (process.env.CALEO_LANDING_BASE ?? 'https://caleo.id').replace(/\/$/, '');
const WA_NUMBER = '6285264787775';

test.describe('Caleo landing — smoke suite', () => {
  // ── T1: Home page loads with expected structure ──────────────────────────
  test('home page loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/`);
    expect(response?.status(), 'home page must return 200').toBe(200);
    await expect(page.locator('h1'), 'h1 must contain brand tagline').toContainText('Toko makin rapi');
    await expect(
      page.locator('nav .nav-cta').first(),
      'nav CTA button must be visible'
    ).toBeVisible();
  });

  // ── T2: All WA links contain the correct number ───────────────────────────
  test('all WA links contain the correct number', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const waLinks = await page.locator('.js-wa-link').all();
    expect(
      waLinks.length,
      `expected >=10 .js-wa-link anchors, got ${waLinks.length}`
    ).toBeGreaterThanOrEqual(10);
    for (const link of waLinks) {
      const href = await link.getAttribute('href');
      expect(href, `WA link href must contain wa.me/${WA_NUMBER}: ${href}`).toContain(
        `wa.me/${WA_NUMBER}`
      );
    }
  });

  // ── T3: Case-study page loads with back link to / ────────────────────────
  test('case-study page loads with back link to /', async ({ page }) => {
    const response = await page.goto(`${BASE}/case-study`);
    expect(response?.status(), 'case-study must return 200').toBe(200);
    await expect(page.locator('h1'), 'case-study h1 must be visible').toBeVisible();
    const backLink = page.locator('a.back-link');
    await expect(backLink, 'back-link must have href "/"').toHaveAttribute('href', '/');
  });

  // ── T4: privacy.html loads with expected structure ────────────────────────
  test('privacy.html loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/privacy.html`);
    expect(response?.status(), 'privacy.html must return 200').toBe(200);
    await expect(
      page.locator('h1'),
      'h1 must contain Kebijakan Privasi'
    ).toContainText('Kebijakan Privasi');
    await expect(
      page.getByText(/TL;DR untuk pemilik toko/i),
      'TL;DR section must be visible'
    ).toBeVisible();
  });

  // ── T5: terms.html loads with expected structure ──────────────────────────
  test('terms.html loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/terms.html`);
    expect(response?.status(), 'terms.html must return 200').toBe(200);
    await expect(
      page.locator('h1'),
      'h1 must contain Syarat & Ketentuan'
    ).toContainText(/Syarat.*Ketentuan/);
    await expect(
      page.getByText(/TL;DR untuk pemilik toko/i),
      'TL;DR section must be visible'
    ).toBeVisible();
  });

  // ── T6: robots.txt served with Sitemap directive ──────────────────────────
  // Note: robots.txt hardcodes the production URL (https://caleo.id/sitemap.xml),
  // so we assert the Sitemap directive exists and points to sitemap.xml rather
  // than interpolating BASE — the static file is environment-agnostic.
  test('robots.txt served with Sitemap directive', async ({ request }) => {
    const response = await request.get(`${BASE}/robots.txt`);
    expect(response.status(), 'robots.txt must return 200').toBe(200);
    const body = await response.text();
    expect(body, 'robots.txt must contain User-agent').toContain('User-agent: *');
    expect(body, 'robots.txt must contain Sitemap directive for sitemap.xml').toMatch(
      /Sitemap:\s+https?:\/\/\S+\/sitemap\.xml/
    );
  });

  // ── T7: sitemap.xml served as valid XML ──────────────────────────────────
  // URLs in sitemap.xml are hardcoded to caleo.id; we check structural validity
  // and the existence of the /case-study URL path without interpolating BASE.
  test('sitemap.xml served as valid XML', async ({ request }) => {
    const response = await request.get(`${BASE}/sitemap.xml`);
    expect(response.status(), 'sitemap.xml must return 200').toBe(200);
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType, 'sitemap.xml content-type must be XML').toMatch(/xml/);
    const body = await response.text();
    expect(body, 'sitemap must contain <urlset').toContain('<urlset');
    expect(body, 'sitemap must reference /case-study URL').toContain('/case-study');
  });

  // ── T8: CSP header present + script-src is self only ────────────────────
  test('CSP header present + script-src is self only', async ({ request }) => {
    const response = await request.get(`${BASE}/`);
    const csp = response.headers()['content-security-policy'] ?? '';
    expect(csp, "CSP must contain script-src 'self'").toContain("script-src 'self'");
    expect(csp, "CSP must contain default-src 'self'").toContain("default-src 'self'");
  });

  // ── T9: landing.js loads (external, not inline) ───────────────────────────
  test('landing.js loads (external, not inline)', async ({ request }) => {
    const response = await request.get(`${BASE}/assets/landing.js`);
    expect(response.status(), 'landing.js must return 200').toBe(200);
    const body = await response.text();
    expect(body, 'landing.js must reference roi-staff element').toContain('roi-staff');
    expect(body, 'landing.js must reference pricing logic').toContain('pricing');
  });

  // ── T10: OG image is served ───────────────────────────────────────────────
  test('OG image is served', async ({ request }) => {
    const response = await request.get(`${BASE}/assets/og-image.png`);
    expect(response.status(), 'og-image.png must return 200').toBe(200);
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType, 'og-image.png must be served as image/png').toMatch(/image\/png/);
  });

  // ── T11: Phase 3.1 semantic markers preserved on home ────────────────────
  test('Phase 3.1 semantic markers preserved on home', async ({ page }) => {
    await page.goto(`${BASE}/`);

    // .js-wa-link — all WhatsApp CTA anchors
    const waLinks = await page.locator('.js-wa-link').count();
    expect(waLinks, 'expected >=10 WhatsApp CTA anchors').toBeGreaterThanOrEqual(10);

    // #js-slot-counter — slot counter div in pricing section
    await expect(
      page.locator('#js-slot-counter'),
      '#js-slot-counter must be visible in DOM'
    ).toBeAttached();

    // .js-testi-card — 5 unique + 5 marquee duplicates = 10
    const testiCards = await page.locator('.js-testi-card').count();
    expect(testiCards, 'expected >=10 testimonial cards (5 unique + 5 marquee)').toBeGreaterThanOrEqual(10);

    // .js-stat-card — exactly 4 stat cards (SKU / Supplier / Pergerakan / Uptime)
    const statCards = await page.locator('.js-stat-card').count();
    expect(statCards, 'expected exactly 4 stat cards').toBe(4);

    // .js-promo-item — exactly 10 ticker items (5 unique + 5 duplicates in marquee)
    const promoItems = await page.locator('.js-promo-item').count();
    expect(promoItems, 'expected exactly 10 promo ticker items').toBe(10);
  });

  // ── T12: All Phase 3.0 sections render on home ───────────────────────────
  test('all Phase 3.0 sections render on home', async ({ page }) => {
    await page.goto(`${BASE}/`);

    const sections: [string, string][] = [
      ['#hero', 'hero section'],
      ['#stats', 'stats section'],
      ['#modul', 'modul section'],
      ['#modul-deep', 'modul-deep section'],
      ['#compare', 'compare section'],
      ['#fleksibel', 'fleksibel section'],
      ['#untuk-siapa', 'untuk-siapa section'],
      ['#cerita', 'cerita section'],
      ['#testimonials', 'testimonials section'],
      ['#solusi', 'solusi section'],
      ['#growth', 'growth section'],
      ['#roi', 'roi section'],
      ['#promos', 'promos section'],
      ['#onboarding', 'onboarding section'],
      ['#faq', 'faq section'],
      ['#cta', 'cta section'],
    ];
    for (const [selector, label] of sections) {
      await expect(page.locator(selector), `${label} must be visible`).toBeVisible();
    }

    // Audience cards — must have exactly 8 (including pabrik)
    const audienceCards = await page.locator('.aud-card').count();
    expect(audienceCards, 'expected 8 audience cards including pabrik').toBe(8);

    // Module cards — must have exactly 10 mod-icon-card
    const moduleCards = await page.locator('.mod-icon-card').count();
    expect(moduleCards, 'expected 10 module cards').toBe(10);

    // Onboarding steps — must have exactly 4
    const onbSteps = await page.locator('.onb-step').count();
    expect(onbSteps, 'expected 4 onboarding steps').toBe(4);
  });
});
