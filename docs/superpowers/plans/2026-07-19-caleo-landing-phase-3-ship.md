# Caleo Landing Phase 3 Ship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the audited landing + case-study + legal pages to `caleo.id` via a repo-managed Cloudflare Worker as pure static content, replacing the current "Segera Hadir" placeholder.

**Architecture:** Static HTML/CSS/JS served by a Cloudflare Worker at `caleo.id/*`. Worker bundles files from a new `public/` directory + applies enforcing security headers per spec §5.5. No backend endpoint. No Supabase migration. Progressive-enhancement pattern: HTML renders standalone; JS mutations (Phase 3.1) attach atop via existing `js-*` semantic markers. Rollback via `wrangler rollback` or `git revert` + redeploy.

**Tech Stack:** Cloudflare Workers (JS/TS runtime), `wrangler` CLI (npx), HTML5 + CSS3 + vanilla JS (no framework), Playwright for E2E smoke, `pandoc` for MD → HTML conversion, ImageMagick for OG image generation.

**Reference spec:** `docs/superpowers/specs/2026-07-18-caleo-landing-phase-3-design.md` — read §5 (Architecture) and §6 (Deployment plan) before starting.

## Global Constraints

- **Pure static ship** — no backend endpoint added, no Supabase migration, no landing_config table (all deferred to Phase 3.1 per §12).
- **Zero added infra cost** — Cloudflare Workers free tier (100K req/day).
- **Lighthouse targets** — Performance ≥ 85 mobile, ≥ 95 desktop (§4 success criteria).
- **CSP enforcing** (not report-only) per §5.5 — this means ALL inline `<script>` blocks in the mockup MUST be extracted to `/assets/landing.js` so `script-src 'self'` works. Inline `style="..."` attributes stay (covered by `style-src 'unsafe-inline'`).
- **Semantic markers intact** — `.js-wa-link`, `#js-slot-counter`, `.js-testi-card`, `.js-stat-card`, `.js-promo-item` must survive path rewrites and any post-processing. These are the Phase 3.1 hydration selectors per spec §17.
- **Asset paths** — production references `/assets/*` (root-relative). Mockup source references bare filenames (e.g. `CALEO-icon-HD.png`). Path rewrite is a required step.
- **Legal pages** — inherit landing typography (Inter font, navy/gold palette). Match the mockup's aesthetic, don't build a separate design.
- **Bahasa Indonesia only** — no i18n scaffolding.
- **Rollback path** — every task with a deployable artifact ends with the exact revert command.
- **WA number `6285264787775`** — hardcoded across ~14 anchors. Do not modify. Phase 3.1 patcher rewrites via `.js-wa-link` markers.
- **Existing Task 16 CSP report endpoint** — `https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report`. Reused, not modified.
- **`docs/legal/kebijakan-privasi.md` + `docs/legal/syarat-ketentuan.md`** — source of truth for legal HTML. Do not re-author content in HTML; convert MD faithfully.
- **`docs/design-mockups/caleo-landing-v1.html` + `caleo-case-study.html`** — source of truth for landing HTML. Do not edit these during the ship (they're the design baseline). Copy to `public/`, then transform paths + extract JS on the copies.
- **Do NOT copy** `docs/design-mockups/caleo-pembelian-real.png` (603 KB, superseded by CSS-drawn PO mock in HTML).

---

## File Structure

**New files created by this plan:**

```
public/                                        ← NEW dir, bundled into Worker deploy
├── index.html                                 ← copied from docs/design-mockups/caleo-landing-v1.html + path rewrites + JS extract
├── case-study.html                            ← copied from docs/design-mockups/caleo-case-study.html + path rewrites
├── privacy.html                               ← hand-converted from docs/legal/kebijakan-privasi.md
├── terms.html                                 ← hand-converted from docs/legal/syarat-ketentuan.md
├── robots.txt                                 ← 3 lines
├── sitemap.xml                                ← 4 URL entries
├── favicon.ico                                ← generated from CALEO-icon-HD.png
└── assets/
    ├── CALEO-icon-HD.png                      ← copied from docs/logo-png-final/
    ├── CALEO-logo-horizontal-HD-v2.png        ← copied from docs/logo-png-final/
    ├── CALEO-logo-horizontal-white-HD.png     ← copied from docs/logo-png-final/
    ├── caleo-qr.png                           ← copied from docs/design-mockups/
    ├── og-image.png                           ← 1200×630 generated
    ├── og-case-study.png                      ← 1200×630 generated
    ├── landing.js                             ← extracted from public/index.html inline <script>
    └── legal.css                              ← shared minimal stylesheet for privacy.html + terms.html

infra/
└── caleo-landing-worker/                      ← NEW dir
    ├── wrangler.toml                          ← Worker config, assets binding, route caleo.id/*
    ├── worker.js                              ← Worker entry: serves public/, applies CSP + security headers
    └── README.md                              ← runbook: deploy, rollback, email routing setup

tests/e2e/tests/
└── landing-smoke.spec.ts                      ← NEW Playwright smoke suite

docs/runbooks/
└── caleo-id-landing-ops.md                    ← NEW ops runbook: deploy, rollback, email routing, monitoring
```

**Modified files:**
- `progress.md` — append Phase 3 ship line (final task)

---

## Task 1: Bootstrap `public/` dir + copy landing + case-study HTML with path rewrites

**Files:**
- Create: `public/index.html` (copy of `docs/design-mockups/caleo-landing-v1.html` with asset paths rewritten to `/assets/*`)
- Create: `public/case-study.html` (copy of `docs/design-mockups/caleo-case-study.html` with same rewrites)
- Test: manual — start `python3 -m http.server 8765 --directory public` and curl-check

**Interfaces:**
- Consumes: `docs/design-mockups/caleo-landing-v1.html` and `caleo-case-study.html` (unchanged source-of-truth mockups)
- Produces: `public/index.html`, `public/case-study.html` — both reference `/assets/*` paths (matching Worker route)

- [ ] **Step 1: Create public/ dir and copy raw files**

```bash
mkdir -p public/assets
cp docs/design-mockups/caleo-landing-v1.html public/index.html
cp docs/design-mockups/caleo-case-study.html public/case-study.html
```

Expected: 2 files copied, no errors. Verify with `ls -la public/`.

- [ ] **Step 2: Rewrite asset paths in `public/index.html`**

The mockup references assets as bare filenames. Production needs `/assets/`-prefixed paths.

Files to rewrite (use `sed` in-place, macOS BSD syntax with `-i ''`):

```bash
sed -i '' \
  -e 's|href="CALEO-icon-HD.png"|href="/assets/CALEO-icon-HD.png"|g' \
  -e 's|src="CALEO-logo-horizontal-HD-v2.png"|src="/assets/CALEO-logo-horizontal-HD-v2.png"|g' \
  -e 's|src="CALEO-logo-horizontal-white-HD.png"|src="/assets/CALEO-logo-horizontal-white-HD.png"|g' \
  -e 's|src="caleo-qr.png"|src="/assets/caleo-qr.png"|g' \
  public/index.html
```

- [ ] **Step 3: Rewrite asset paths in `public/case-study.html`**

```bash
sed -i '' \
  -e 's|href="CALEO-icon-HD.png"|href="/assets/CALEO-icon-HD.png"|g' \
  -e 's|src="CALEO-logo-horizontal-HD-v2.png"|src="/assets/CALEO-logo-horizontal-HD-v2.png"|g' \
  public/case-study.html
```

- [ ] **Step 4: Verify path rewrites landed**

```bash
grep -n '/assets/' public/index.html | head -5
grep -n 'CALEO-icon-HD.png\|CALEO-logo-horizontal' public/index.html | grep -v '/assets/' | head
```

Expected: first command shows several `/assets/` references. Second command produces **no output** (no bare filenames remain).

- [ ] **Step 5: Start local http server and verify HTML loads**

```bash
python3 -m http.server 8765 --directory public > /tmp/caleo-ship-preview.log 2>&1 &
sleep 1
curl -sI http://localhost:8765/index.html | head -3
curl -sI http://localhost:8765/case-study.html | head -3
```

Expected: both return `HTTP/1.0 200 OK`.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/case-study.html
git commit -m "feat(landing): bootstrap public/ dir with landing + case-study HTML

Copy audited mockups to public/ with asset paths rewritten to /assets/*
(root-relative) for Cloudflare Worker serving. Source mockups in
docs/design-mockups/ remain the design source-of-truth."
```

- [ ] **Step 7: Rollback path (documentation only)**

To undo: `git revert <this-commit>` + `rm -rf public/`. No production impact yet (not deployed).

---

## Task 2: Extract inline `<script>` from `public/index.html` to `public/assets/landing.js`

**Why:** Spec §5.5 requires CSP `script-src 'self'` (no `'unsafe-inline'`). The mockup embeds ~140 lines of vanilla JS (ROI calc + pricing toggle + scroll reveal) inline. CSP would block it. Extract to external file.

**Files:**
- Create: `public/assets/landing.js`
- Modify: `public/index.html:1987-2125` (approximately — locate by markers)
- Test: manual browser + curl

**Interfaces:**
- Consumes: `public/index.html` inline `<script>` block (from Task 1)
- Produces: `public/assets/landing.js` (the extracted JS), `public/index.html` (now references `<script defer src="/assets/landing.js"></script>`)

- [ ] **Step 1: Locate the inline `<script>` block in `public/index.html`**

```bash
grep -n '<script>\|</script>' public/index.html
```

Expected: prints line numbers. There should be TWO relevant matches — the JSON-LD `<script type="application/ld+json">` (KEEP INLINE — CSP allows it) and the plain `<script>` block (EXTRACT). Note the line range of the plain `<script>` block for step 2.

- [ ] **Step 2: Extract the JS body to `public/assets/landing.js`**

Read `public/index.html` from the opening `<script>` (the plain one, NOT JSON-LD) to `</script>`. Copy the CONTENT (not the tags) to `public/assets/landing.js`.

Use a Node one-liner to be safe against boundary mistakes:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
// Match the LAST <script>...</script> (the plain JS, after JSON-LD)
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (matches.length === 0) { console.error('No plain <script> block found'); process.exit(1); }
const jsBody = matches[matches.length - 1][1];
fs.writeFileSync('public/assets/landing.js', jsBody.trim() + '\n');
console.log('Extracted', jsBody.length, 'chars to public/assets/landing.js');
"
```

Expected: prints `Extracted <N> chars`. Verify:

```bash
head -5 public/assets/landing.js
wc -l public/assets/landing.js
```

Expected: `head` shows the ROI calc IIFE opening (`(function() {` and `const staffEl = document.getElementById('roi-staff');`). `wc -l` reports ~130-140 lines.

- [ ] **Step 3: Replace inline `<script>...</script>` block with external reference in `public/index.html`**

```bash
node -e "
const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');
// Replace the LAST <script>...</script> (plain, not JSON-LD) with external reference
const matches = [...html.matchAll(/<script>[\s\S]*?<\/script>/g)];
if (matches.length === 0) { console.error('No plain <script> block found'); process.exit(1); }
const lastMatch = matches[matches.length - 1];
const before = html.substring(0, lastMatch.index);
const after = html.substring(lastMatch.index + lastMatch[0].length);
html = before + '<script defer src=\"/assets/landing.js\"></script>' + after;
fs.writeFileSync('public/index.html', html);
console.log('Replaced inline script with external reference');
"
```

Verify:

```bash
grep -n '<script' public/index.html
```

Expected: shows JSON-LD `<script type="application/ld+json">` (kept) + new `<script defer src="/assets/landing.js"></script>` (replacement). NO plain `<script>` remain.

- [ ] **Step 4: Browser smoke test — verify JS still works after extraction**

Restart local preview and open in browser:

```bash
kill $(lsof -ti:8765) 2>/dev/null; sleep 1
python3 -m http.server 8765 --directory public > /tmp/caleo-ship-preview.log 2>&1 &
sleep 1
open http://localhost:8765/
```

**Manual verification checklist (open DevTools Console):**
- Console shows **zero errors**
- Scroll to `#roi` section → change "Jumlah Karyawan" dropdown → ROI numbers recalculate live
- Scroll to `#promos` (pricing) → click "6 Bulan" toggle → all 3 tier prices flip, callout text updates
- Scroll to any card section (e.g., `#stats`) → verify `fadeUp` reveal animation triggers on scroll (fade-up from below)

If any of these fail, the extraction split the file incorrectly — revert Steps 2-3 and re-do.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/assets/landing.js
git commit -m "feat(landing): extract inline JS to public/assets/landing.js

CSP script-src 'self' requires external scripts. Extract ROI calc +
pricing toggle + IntersectionObserver reveal (~140 lines) from inline
<script> to public/assets/landing.js, referenced via <script defer>.
JSON-LD script tag stays inline (allowed by CSP). H7 audit fix per
spec section 5.5."
```

- [ ] **Step 6: Rollback**

`git revert <this-commit>` — restores inline script. Preview still works.

---

## Task 3: Copy PNG assets + generate OG images + generate favicon

**Files:**
- Copy: `docs/logo-png-final/CALEO-icon-HD.png` → `public/assets/CALEO-icon-HD.png`
- Copy: `docs/logo-png-final/CALEO-logo-horizontal-HD-v2.png` → `public/assets/CALEO-logo-horizontal-HD-v2.png`
- Copy: `docs/logo-png-final/CALEO-logo-horizontal-white-HD.png` → `public/assets/CALEO-logo-horizontal-white-HD.png`
- Copy: `docs/design-mockups/caleo-qr.png` → `public/assets/caleo-qr.png`
- Generate: `public/assets/og-image.png` (1200×630, landing OG card)
- Generate: `public/assets/og-case-study.png` (1200×630, case-study OG card)
- Generate: `public/favicon.ico` (32×32 from `CALEO-icon-HD.png`)
- Test: `curl -sI` all asset URLs return 200

**Interfaces:**
- Consumes: `docs/logo-png-final/*` + `docs/design-mockups/caleo-qr.png`
- Produces: 6 PNG files + 1 ICO in `public/assets/` + 1 favicon at `public/favicon.ico`

- [ ] **Step 1: Copy logo + QR assets to `public/assets/`**

```bash
cp docs/logo-png-final/CALEO-icon-HD.png public/assets/
cp docs/logo-png-final/CALEO-logo-horizontal-HD-v2.png public/assets/
cp docs/logo-png-final/CALEO-logo-horizontal-white-HD.png public/assets/
cp docs/design-mockups/caleo-qr.png public/assets/
ls -la public/assets/*.png
```

Expected: 4 PNG files listed with non-zero sizes.

- [ ] **Step 2: Verify ImageMagick is installed**

```bash
which convert || brew install imagemagick
convert -version | head -1
```

Expected: prints `ImageMagick 7.x.x` or similar. If not installed, `brew install imagemagick`.

- [ ] **Step 3: Generate `public/assets/og-image.png` (1200×630 landing OG)**

Approach: use CALEO horizontal logo centered on navy background with tagline text.

```bash
convert -size 1200x630 xc:'#0B2545' \
  \( public/assets/CALEO-logo-horizontal-white-HD.png -resize 500x -background none -gravity center -extent 500x120 \) \
  -gravity center -geometry +0-60 -composite \
  -font "Helvetica-Bold" -pointsize 40 -fill '#FBBF24' -gravity center -annotate +0+60 "Toko Rapi, Untung Jelas" \
  -font "Helvetica" -pointsize 24 -fill white -gravity center -annotate +0+120 "Sistem ERP untuk toko, distributor, & pabrik UMKM Indonesia" \
  public/assets/og-image.png
identify public/assets/og-image.png
```

Expected: `identify` reports `public/assets/og-image.png PNG 1200x630`. If font "Helvetica-Bold" not found on the system, substitute with `-font "Arial-Bold"` or omit font flag (uses default).

- [ ] **Step 4: Generate `public/assets/og-case-study.png` (1200×630 case-study OG)**

```bash
convert -size 1200x630 xc:'#0B2545' \
  \( public/assets/CALEO-logo-horizontal-white-HD.png -resize 500x -background none -gravity center -extent 500x120 \) \
  -gravity center -geometry +0-60 -composite \
  -font "Helvetica-Bold" -pointsize 36 -fill '#FBBF24' -gravity center -annotate +0+60 "Case Study" \
  -font "Helvetica" -pointsize 22 -fill white -gravity center -annotate +0+120 "Distributor UMKM Jakarta: 474 SKU, 290+ supplier, 1 minggu setup" \
  public/assets/og-case-study.png
identify public/assets/og-case-study.png
```

Expected: `1200x630 PNG`.

- [ ] **Step 5: Generate `public/favicon.ico`**

```bash
convert public/assets/CALEO-icon-HD.png -resize 32x32 public/favicon.ico
identify public/favicon.ico
```

Expected: `public/favicon.ico ICO 32x32`.

- [ ] **Step 6: Local preview curl check — all assets return 200**

Server should still be running from Task 2. If not:

```bash
kill $(lsof -ti:8765) 2>/dev/null; sleep 1
python3 -m http.server 8765 --directory public > /tmp/caleo-ship-preview.log 2>&1 &
sleep 1
```

Then:

```bash
for asset in \
  /assets/CALEO-icon-HD.png \
  /assets/CALEO-logo-horizontal-HD-v2.png \
  /assets/CALEO-logo-horizontal-white-HD.png \
  /assets/caleo-qr.png \
  /assets/og-image.png \
  /assets/og-case-study.png \
  /favicon.ico; do
  code=$(curl -so /dev/null -w "%{http_code}" "http://localhost:8765${asset}")
  echo "$code  $asset"
done
```

Expected: every line starts with `200`.

- [ ] **Step 7: Browser visual smoke — landing hero renders logo, footer renders logo, final CTA renders QR**

```bash
open http://localhost:8765/
```

**Manual check**: nav shows CALEO logo (blue navy text on white bg), footer shows CALEO logo (dark on light-gray bg), scroll to `#cta` section (final CTA) — QR code image renders. No broken image icons.

- [ ] **Step 8: Commit**

```bash
git add public/assets/*.png public/favicon.ico
git commit -m "feat(landing): copy logo assets + generate OG images + favicon

Copy CALEO-icon/logo/QR PNGs to public/assets/. Generate 1200x630 OG
cards for landing + case-study (H6 audit fix). Generate 32x32 favicon
from CALEO-icon-HD.png."
```

- [ ] **Step 9: Rollback**

`git revert <this-commit>` — removes assets from public/. Source files in `docs/logo-png-final/` untouched.

---

## Task 4: Hand-convert legal MDs to HTML + shared `legal.css`

**Files:**
- Create: `public/assets/legal.css` (shared minimal stylesheet matching landing typography)
- Create: `public/privacy.html` (from `docs/legal/kebijakan-privasi.md`)
- Create: `public/terms.html` (from `docs/legal/syarat-ketentuan.md`)
- Test: `pandoc --version` + browser render

**Interfaces:**
- Consumes: `docs/legal/kebijakan-privasi.md` (231 lines) + `docs/legal/syarat-ketentuan.md` (423 lines) — source of truth
- Produces: `public/privacy.html` + `public/terms.html` + `public/assets/legal.css`

- [ ] **Step 1: Verify `pandoc` is installed**

```bash
which pandoc || brew install pandoc
pandoc --version | head -1
```

Expected: `pandoc 3.x` or similar.

- [ ] **Step 2: Create `public/assets/legal.css` — shared stylesheet**

Write this file:

```css
:root {
  --navy: #0B2545;
  --slate: #5A6472;
  --gold: #F59E0B;
  --border: #E2E8F0;
  --bg-alt: #F8FAFC;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--navy);
  background: #fff;
  font-size: 15px;
  line-height: 1.7;
  padding: 60px 24px 100px;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 780px;
  margin: 0 auto;
}
nav.legal-nav {
  max-width: 780px;
  margin: 0 auto 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--slate);
}
nav.legal-nav a { color: var(--slate); text-decoration: none; font-weight: 600; }
nav.legal-nav a:hover { color: var(--navy); }
nav.legal-nav img { height: 32px; width: auto; display: block; }
h1 { font-size: 32px; font-weight: 900; letter-spacing: -0.8px; margin-bottom: 8px; line-height: 1.2; }
h2 { font-size: 22px; font-weight: 800; margin: 36px 0 12px; letter-spacing: -0.3px; }
h3 { font-size: 17px; font-weight: 700; margin: 24px 0 8px; }
p { margin-bottom: 14px; }
strong { color: var(--navy); font-weight: 700; }
ul, ol { margin: 12px 0 16px 24px; }
li { margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
table th, table td { border: 1px solid var(--border); padding: 10px 12px; text-align: left; }
table th { background: var(--bg-alt); font-weight: 700; }
code { background: var(--bg-alt); padding: 2px 6px; border-radius: 4px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; }
hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }
blockquote { border-left: 3px solid var(--gold); background: var(--bg-alt); padding: 12px 16px; margin: 16px 0; font-style: italic; color: var(--slate); }
a { color: var(--gold); text-decoration: underline; }
footer.legal-foot { max-width: 780px; margin: 60px auto 0; padding-top: 24px; border-top: 1px solid var(--border); font-size: 12px; color: var(--slate); text-align: center; }
```

Save to `public/assets/legal.css`. Verify:

```bash
wc -l public/assets/legal.css
```

Expected: ~55 lines.

- [ ] **Step 3: Convert `docs/legal/kebijakan-privasi.md` → `public/privacy.html`**

Use pandoc standalone HTML with our stylesheet linked:

```bash
pandoc docs/legal/kebijakan-privasi.md \
  --standalone \
  --metadata title="Kebijakan Privasi — Caleo" \
  --metadata lang=id-ID \
  --template=- \
  -o public/privacy.html <<'TEMPLATE'
<!DOCTYPE html>
<html lang="$lang$">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$title$</title>
<meta name="description" content="Kebijakan Privasi Caleo — bagaimana kami memproses data Anda di platform ERP Caleo.">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/png" href="/assets/CALEO-icon-HD.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/legal.css">
</head>
<body>
<nav class="legal-nav">
  <a href="/"><img src="/assets/CALEO-logo-horizontal-HD-v2.png" alt="Caleo"></a>
  <a href="/">← Kembali ke Beranda</a>
</nav>
<main>
$body$
</main>
<footer class="legal-foot">
  © 2026 Caleo · LTC Glodok Jakarta · WA <a href="https://wa.me/6285264787775">0852-6478-7775</a> · <a href="mailto:halo@caleo.id">halo@caleo.id</a><br>
  <a href="/">Beranda</a> · <a href="/terms.html">Syarat &amp; Ketentuan</a>
</footer>
</body>
</html>
TEMPLATE
```

Expected: `public/privacy.html` created. Verify:

```bash
head -10 public/privacy.html
wc -l public/privacy.html
```

Expected: `head` shows `<!DOCTYPE html>` + head tag + nav. `wc -l` reports ~250-300 lines.

- [ ] **Step 4: Convert `docs/legal/syarat-ketentuan.md` → `public/terms.html`**

```bash
pandoc docs/legal/syarat-ketentuan.md \
  --standalone \
  --metadata title="Syarat & Ketentuan — Caleo" \
  --metadata lang=id-ID \
  --template=- \
  -o public/terms.html <<'TEMPLATE'
<!DOCTYPE html>
<html lang="$lang$">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>$title$</title>
<meta name="description" content="Syarat & Ketentuan Layanan Caleo — perjanjian penggunaan platform ERP.">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/png" href="/assets/CALEO-icon-HD.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/legal.css">
</head>
<body>
<nav class="legal-nav">
  <a href="/"><img src="/assets/CALEO-logo-horizontal-HD-v2.png" alt="Caleo"></a>
  <a href="/">← Kembali ke Beranda</a>
</nav>
<main>
$body$
</main>
<footer class="legal-foot">
  © 2026 Caleo · LTC Glodok Jakarta · WA <a href="https://wa.me/6285264787775">0852-6478-7775</a> · <a href="mailto:halo@caleo.id">halo@caleo.id</a><br>
  <a href="/">Beranda</a> · <a href="/privacy.html">Kebijakan Privasi</a>
</footer>
</body>
</html>
TEMPLATE
```

Verify:

```bash
head -10 public/terms.html
wc -l public/terms.html
```

Expected: header + ~450-500 lines.

- [ ] **Step 5: Browser smoke — both pages render, TL;DR present, tables render**

```bash
open http://localhost:8765/privacy.html
open http://localhost:8765/terms.html
```

**Manual checks:**
- `privacy.html`: page loads, "Kebijakan Privasi Caleo" as `<h1>`, "TL;DR untuk pemilik toko" heading present, sub-processor table renders as HTML table, retention table renders, nav "← Kembali ke Beranda" links to `/`
- `terms.html`: page loads, "Syarat & Ketentuan Layanan Caleo" as `<h1>`, "TL;DR" present, SLA severity table (Kritis/Tinggi/Sedang/Rendah) renders as table, footer links to `/privacy.html`

If tables render as raw text (`|Column|Column|`), the pandoc conversion missed table extension. Add `-f markdown+pipe_tables` to the pandoc command.

- [ ] **Step 6: Commit**

```bash
git add public/privacy.html public/terms.html public/assets/legal.css
git commit -m "feat(landing): hand-convert legal MDs to HTML + shared legal.css

Convert docs/legal/kebijakan-privasi.md + syarat-ketentuan.md to
public/privacy.html + terms.html via pandoc with minimal Caleo-themed
stylesheet. Nav back-link to /, footer email + WA. B4 audit fix ships
now that .html suffix paths resolve."
```

- [ ] **Step 7: Rollback**

`git revert <this-commit>`. Source MDs untouched. Legal.css can be regenerated.

---

## Task 5: Create `robots.txt` + `sitemap.xml`

**Files:**
- Create: `public/robots.txt`
- Create: `public/sitemap.xml`
- Test: `curl -sI` returns 200 + content-type

**Interfaces:**
- Produces: 2 SEO-baseline files served at root

- [ ] **Step 1: Write `public/robots.txt`**

Content:

```
User-agent: *
Allow: /
Sitemap: https://caleo.id/sitemap.xml
```

Save to `public/robots.txt`. Verify:

```bash
cat public/robots.txt
```

Expected: exactly 3 lines above.

- [ ] **Step 2: Write `public/sitemap.xml`**

Content (update `<lastmod>` to today's ISO date at ship time):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://caleo.id/</loc>
    <lastmod>2026-07-19</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://caleo.id/case-study</loc>
    <lastmod>2026-07-19</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://caleo.id/privacy.html</loc>
    <lastmod>2026-07-19</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://caleo.id/terms.html</loc>
    <lastmod>2026-07-19</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>
```

Save to `public/sitemap.xml`. Verify XML parses:

```bash
xmllint --noout public/sitemap.xml && echo "XML valid"
```

Expected: prints `XML valid`. If `xmllint` not installed, fall back to Python:

```bash
python3 -c "import xml.etree.ElementTree as ET; ET.parse('public/sitemap.xml'); print('XML valid')"
```

- [ ] **Step 3: Local http server serves both files**

```bash
curl -sI http://localhost:8765/robots.txt | head -3
curl -sI http://localhost:8765/sitemap.xml | head -3
```

Expected: both return `200 OK`. Content of `robots.txt` should have `Content-Type: text/plain`, `sitemap.xml` should have `Content-Type: application/xml` or `text/xml`. Python http.server may set `application/octet-stream` for sitemap — the production Worker (Task 6) will set correct content types.

- [ ] **Step 4: Commit**

```bash
git add public/robots.txt public/sitemap.xml
git commit -m "feat(landing): add robots.txt + sitemap.xml

SEO baseline. Sitemap lists 4 URLs: /, /case-study, /privacy.html,
/terms.html. H10 audit fix."
```

- [ ] **Step 5: Rollback**

`git revert <this-commit>`.

---

## Task 6: Create Cloudflare Worker (`wrangler.toml` + `worker.js`) with enforcing CSP

**Files:**
- Create: `infra/caleo-landing-worker/wrangler.toml`
- Create: `infra/caleo-landing-worker/worker.js`
- Create: `infra/caleo-landing-worker/README.md` (deploy + rollback runbook)
- Test: `npx wrangler dev` local + `curl -I` header check

**Interfaces:**
- Consumes: `public/` directory (built by Tasks 1-5)
- Produces: production Worker serving `caleo.id/*`

- [ ] **Step 1: Verify `wrangler` CLI available**

```bash
npx wrangler --version
```

Expected: prints `wrangler X.Y.Z`. If not installed, `npm install -g wrangler` OR use `npx wrangler@latest` throughout.

- [ ] **Step 2: Write `infra/caleo-landing-worker/wrangler.toml`**

```toml
name = "caleo-landing"
main = "worker.js"
compatibility_date = "2026-07-19"

[assets]
directory = "../../public"
binding = "ASSETS"

[observability]
enabled = true

# Staging: deploy to auto-generated *.workers.dev URL for pre-production
# testing. No caleo.id route binding. Deploy via:
#   npx wrangler deploy --env staging
[env.staging]
name = "caleo-landing-staging"

# Production: binds caleo.id/* route. Deploy via:
#   npx wrangler deploy --env production
# ONLY after staging has passed the full test matrix in Task 9.
[env.production]
name = "caleo-landing"

[[env.production.routes]]
pattern = "caleo.id/*"
zone_name = "caleo.id"
```

Note: `[assets]` at top level is inherited by both env.staging and
env.production. Only `name` + `routes` differ between envs.

Save to `infra/caleo-landing-worker/wrangler.toml`.

- [ ] **Step 3: Write `infra/caleo-landing-worker/worker.js`**

```javascript
// Caleo Landing Worker — serves public/ with security headers per spec §5.5.
// Phase 3.0 (pure static). Phase 3.1 will add `connect-src <backend>` to CSP.

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https://www.google.com https://maps.google.com",
  "frame-src https://www.google.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri https://garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/security/csp-report",
].join("; ");

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": CSP,
};

// Extensionless routes → serve the .html version.
const REWRITES = {
  "/case-study": "/case-study.html",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    // Apply rewrites (extensionless routes → .html).
    if (REWRITES[pathname]) {
      pathname = REWRITES[pathname];
      url.pathname = pathname;
    }

    // Default document for `/`.
    if (pathname === "/") {
      pathname = "/index.html";
      url.pathname = pathname;
    }

    // Fetch from assets binding.
    const assetRequest = new Request(url.toString(), request);
    const response = await env.ASSETS.fetch(assetRequest);

    // Clone response so we can mutate headers.
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      newHeaders.set(key, value);
    }

    // Correct content-type for sitemap.xml (Cloudflare Assets may serve as octet-stream).
    if (pathname.endsWith(".xml")) {
      newHeaders.set("Content-Type", "application/xml; charset=utf-8");
    }
    if (pathname.endsWith(".txt")) {
      newHeaders.set("Content-Type", "text/plain; charset=utf-8");
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
```

Save to `infra/caleo-landing-worker/worker.js`.

- [ ] **Step 4: Write `infra/caleo-landing-worker/README.md` (runbook)**

```markdown
# Caleo Landing Worker

Cloudflare Worker serving `caleo.id/*` with static assets from `../../public/`.

## Deploy (staging → production two-step)

**ALWAYS deploy to staging first**, run full test matrix (Task 9), only
then promote to production.

Step 1 — deploy to staging:

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env staging
```

Output includes the auto-generated staging URL, e.g.
`https://caleo-landing-staging.<your-sub>.workers.dev`. Note this URL —
it's your test surface.

Step 2 — after Task 9 test matrix passes green, promote to production:

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env production
```

Verify:

```bash
npx wrangler deployments list --env production --name caleo-landing | head -20
curl -sI https://caleo.id/ | head -20
```

## Rollback

Production rollback — revert to previous deployment:

```bash
npx wrangler rollback --env production --name caleo-landing
```

Or via git + redeploy:

```bash
git revert <deploy-commit>
cd infra/caleo-landing-worker && npx wrangler deploy
```

## Local dev

```bash
npx wrangler dev --local
# opens http://localhost:8787 serving public/ (uses base config, no env)
```

## Cloudflare Email Routing (halo@caleo.id)

Configure in CF dashboard → Email → Email Routing → Routes:

- Custom address: `halo@caleo.id` → Forward to: `tonywei.office@gmail.com`
- Verification: send test email to `halo@caleo.id`, check destination inbox

No code — dashboard-only setup. Free tier covers unlimited routes on caleo.id.
```

Save to `infra/caleo-landing-worker/README.md`.

- [ ] **Step 5: Local wrangler dev — verify CSP + all routes**

```bash
kill $(lsof -ti:8765) 2>/dev/null; sleep 1
cd infra/caleo-landing-worker
npx wrangler dev --local &
WRANGLER_PID=$!
sleep 5
cd -
```

Then verify CSP header + rewrites:

```bash
curl -sI http://localhost:8787/ | grep -iE "content-security-policy|strict-transport|x-frame"
curl -sI http://localhost:8787/case-study | head -3
curl -sI http://localhost:8787/privacy.html | head -3
curl -sI http://localhost:8787/robots.txt | grep -iE "content-type"
curl -sI http://localhost:8787/sitemap.xml | grep -iE "content-type"
```

Expected:
- CSP header present with `script-src 'self'`
- HSTS present
- X-Frame-Options: DENY
- `/case-study` returns 200 (rewritten to case-study.html)
- `/privacy.html` returns 200
- robots.txt content-type = `text/plain; charset=utf-8`
- sitemap.xml content-type = `application/xml; charset=utf-8`

Kill wrangler dev:

```bash
kill $WRANGLER_PID 2>/dev/null
```

- [ ] **Step 6: Commit**

```bash
git add infra/caleo-landing-worker/
git commit -m "feat(infra): Cloudflare Worker for caleo.id landing

wrangler.toml + worker.js serve public/ with enforcing CSP per spec
§5.5 (script-src 'self' — inline scripts extracted in Task 2). Includes
extensionless /case-study rewrite + content-type fixups for
robots.txt / sitemap.xml. Runbook at infra/caleo-landing-worker/README.md."
```

- [ ] **Step 7: Rollback**

`git revert <this-commit>` removes Worker code. Current placeholder Worker at caleo.id remains until step 10 deploys the new one.

---

## Task 7: Playwright smoke tests in `tests/e2e/tests/landing-smoke.spec.ts`

**Files:**
- Create: `tests/e2e/tests/landing-smoke.spec.ts`
- Test: `npx playwright test tests/e2e/tests/landing-smoke.spec.ts`

**Interfaces:**
- Consumes: production `https://caleo.id/*` (after Task 9 deploy) OR local wrangler dev URL
- Produces: automated smoke suite for future regressions

- [ ] **Step 1: Verify Playwright config exists**

```bash
ls tests/e2e/ | grep -E "playwright|package"
```

Expected: `playwright.config.ts` or `playwright.config.js` present. If missing, this project doesn't have Playwright wired — abort this task and use manual `curl` checks in Task 9 (staging matrix) + Task 12 (post-deploy) instead.

Assume playwright is configured. Check base URL config:

```bash
grep -E "baseURL|use:" tests/e2e/playwright.config.* 2>/dev/null | head -5
```

Note the base URL pattern (if any). Tests below use full URLs so they work regardless.

- [ ] **Step 2: Write `tests/e2e/tests/landing-smoke.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

const BASE = process.env.CALEO_LANDING_BASE || 'https://caleo.id';
const WA_NUMBER = '6285264787775';

test.describe('Caleo landing — smoke suite', () => {
  test('home page loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Toko makin rapi');
    await expect(page.locator('nav .nav-cta').first()).toBeVisible();
  });

  test('all WA links contain the correct number', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const waLinks = await page.locator('.js-wa-link').all();
    expect(waLinks.length).toBeGreaterThanOrEqual(10);
    for (const link of waLinks) {
      const href = await link.getAttribute('href');
      expect(href, `WA link href missing: ${href}`).toContain(`wa.me/${WA_NUMBER}`);
    }
  });

  test('case-study page loads with back link to /', async ({ page }) => {
    const response = await page.goto(`${BASE}/case-study`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    const backLink = page.locator('a.back-link');
    await expect(backLink).toHaveAttribute('href', '/');
  });

  test('privacy.html loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/privacy.html`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('Kebijakan Privasi');
    await expect(page.getByText(/TL;DR untuk pemilik toko/i)).toBeVisible();
  });

  test('terms.html loads with expected structure', async ({ page }) => {
    const response = await page.goto(`${BASE}/terms.html`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText(/Syarat.*Ketentuan/);
    await expect(page.getByText(/TL;DR untuk pemilik toko/i)).toBeVisible();
  });

  test('robots.txt served with Sitemap directive', async ({ request }) => {
    const response = await request.get(`${BASE}/robots.txt`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(`Sitemap: ${BASE.replace(/\/$/, '')}/sitemap.xml`);
  });

  test('sitemap.xml served as valid XML', async ({ request }) => {
    const response = await request.get(`${BASE}/sitemap.xml`);
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toMatch(/xml/);
    const body = await response.text();
    expect(body).toContain('<urlset');
    expect(body).toContain(`${BASE.replace(/\/$/, '')}/case-study`);
  });

  test('CSP header present + script-src is self only', async ({ request }) => {
    const response = await request.get(`${BASE}/`);
    const csp = response.headers()['content-security-policy'] || '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  test('landing.js loads (external, not inline)', async ({ request }) => {
    const response = await request.get(`${BASE}/assets/landing.js`);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('roi-staff');
    expect(body).toContain('pricing');
  });

  test('OG image is served', async ({ request }) => {
    const response = await request.get(`${BASE}/assets/og-image.png`);
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toMatch(/image\/png/);
  });

  test('Phase 3.1 semantic markers preserved on home', async ({ page }) => {
    await page.goto(`${BASE}/`);
    // .js-wa-link — all WhatsApp CTA anchors
    const waLinks = await page.locator('.js-wa-link').count();
    expect(waLinks, 'expected >=10 WhatsApp CTA anchors').toBeGreaterThanOrEqual(10);
    // #js-slot-counter — slot counter div in pricing hero
    await expect(page.locator('#js-slot-counter')).toBeVisible();
    // .js-testi-card — testimonial cards (5 unique + 5 marquee duplicates = 10)
    const testiCards = await page.locator('.js-testi-card').count();
    expect(testiCards, 'expected >=10 testimonial cards').toBeGreaterThanOrEqual(10);
    // .js-stat-card — 4 stat cards (SKU / Supplier / Pergerakan / Uptime)
    const statCards = await page.locator('.js-stat-card').count();
    expect(statCards, 'expected exactly 4 stat cards').toBe(4);
    // .js-promo-item — 10 marquee items in top promo bar (5 unique + 5 duplicates)
    const promoItems = await page.locator('.js-promo-item').count();
    expect(promoItems, 'expected exactly 10 promo ticker items').toBe(10);
  });

  test('all Phase 3.0 sections render on home', async ({ page }) => {
    await page.goto(`${BASE}/`);
    // Sections we shipped in Phase 3.0 — regression guard for CSS/JS loading
    await expect(page.locator('#hero')).toBeVisible();
    await expect(page.locator('#stats')).toBeVisible();
    await expect(page.locator('#modul')).toBeVisible();
    await expect(page.locator('#modul-deep')).toBeVisible();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#fleksibel')).toBeVisible();
    await expect(page.locator('#untuk-siapa')).toBeVisible();
    await expect(page.locator('#cerita')).toBeVisible();
    await expect(page.locator('#testimonials')).toBeVisible();
    await expect(page.locator('#solusi')).toBeVisible();
    await expect(page.locator('#growth')).toBeVisible();
    await expect(page.locator('#roi')).toBeVisible();
    await expect(page.locator('#promos')).toBeVisible();
    await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#faq')).toBeVisible();
    await expect(page.locator('#cta')).toBeVisible();
    // Audience count check — must have 8 aud-card (including pabrik)
    const audienceCards = await page.locator('.aud-card').count();
    expect(audienceCards, 'expected 8 audience cards including pabrik').toBe(8);
    // Modules count check — must have 10 mod-icon-card
    const moduleCards = await page.locator('.mod-icon-card').count();
    expect(moduleCards, 'expected 10 module cards').toBe(10);
    // Onboarding steps — 4 steps
    const onbSteps = await page.locator('.onb-step').count();
    expect(onbSteps, 'expected 4 onboarding steps').toBe(4);
  });
});
```

Save to `tests/e2e/tests/landing-smoke.spec.ts`.

- [ ] **Step 3: Run tests against local wrangler dev**

Start wrangler dev in background:

```bash
cd infra/caleo-landing-worker
npx wrangler dev --local --port 8787 &
WRANGLER_PID=$!
sleep 5
cd -
```

Run smoke suite against localhost:

```bash
CALEO_LANDING_BASE=http://localhost:8787 npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: **all 10 tests pass**. If a test fails, read the error — most common issues:
- 404 on a route: check wrangler dev is serving; check rewrite map in worker.js
- CSP header missing: check worker.js applies headers to every response
- Wrong content-type: check .xml/.txt content-type overrides in worker.js

Kill wrangler dev:

```bash
kill $WRANGLER_PID 2>/dev/null
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/tests/landing-smoke.spec.ts
git commit -m "test(landing): Playwright smoke suite for caleo.id landing

10 tests covering routes (/, /case-study, /privacy.html, /terms.html,
/robots.txt, /sitemap.xml), asset serving (/assets/landing.js,
/assets/og-image.png), security header (CSP script-src 'self'),
and content assertions (h1, TL;DR, WA number in js-wa-link anchors).
Runnable against local wrangler dev or production via CALEO_LANDING_BASE
env var."
```

- [ ] **Step 5: Rollback**

`git revert <this-commit>` — removes test file. No production impact.

---

## Task 8: Ops runbook `docs/runbooks/caleo-id-landing-ops.md`

**Files:**
- Create: `docs/runbooks/caleo-id-landing-ops.md`

**Interfaces:** documentation-only

- [ ] **Step 1: Write runbook**

```markdown
# Caleo Landing Ops Runbook

## Deploy landing to production

```bash
cd infra/caleo-landing-worker
npx wrangler deploy
```

Wait for "Success!" then verify:

```bash
curl -sI https://caleo.id/ | head -20
```

Expected: HTTP/2 200 + Content-Security-Policy + Strict-Transport-Security headers.

## Rollback

**Fast path — Wrangler:**

```bash
cd infra/caleo-landing-worker
npx wrangler rollback --name caleo-landing
```

**Full path — Git + redeploy:**

```bash
git log --oneline -5   # find the offending commit
git revert <commit>
cd infra/caleo-landing-worker && npx wrangler deploy
```

## Post-deploy smoke test

```bash
CALEO_LANDING_BASE=https://caleo.id npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: all 10 tests pass.

Manual checks:
- Chrome desktop → open https://caleo.id → click all CTAs → verify WA opens with pre-filled message
- Chrome mobile emulation (375×667) → sticky mobile CTA bar + floating WA visible → layout responsive
- DevTools Console → zero CSP violations

## Cloudflare Email Routing setup — halo@caleo.id

One-time dashboard config:

1. CF dashboard → caleo.id zone → Email → Email Routing
2. Enable Email Routing (adds MX records automatically)
3. Add route: Custom address `halo@caleo.id` → Forward to `tonywei.office@gmail.com`
4. Verify destination email (CF sends confirmation to tonywei.office@gmail.com)
5. Test: send email to `halo@caleo.id`, confirm receipt at destination

Cost: free tier covers unlimited routes on caleo.id.

## Content edits (Phase 3.0 static)

Content changes require code + redeploy:

1. Edit `docs/design-mockups/caleo-landing-v1.html` (source of truth)
2. Sync change into `public/index.html`: rerun path-rewrite sed from Task 1 Step 2, then JS-extract from Task 2 Step 3
3. Commit + `npx wrangler deploy`

Turnaround: ~2 minutes. Phase 3.1 will make WA number, slot counter, testimonials, promo ticker, stats editable via Caleo Admin sidebar (no redeploy — see spec §12 and §16).

## Lighthouse check

```bash
npx lighthouse https://caleo.id/ --preset=desktop --output=json --quiet | jq '.categories.performance.score'
npx lighthouse https://caleo.id/ --emulated-form-factor=mobile --output=json --quiet | jq '.categories.performance.score'
```

Expected: desktop ≥ 0.95, mobile ≥ 0.85.

## OG preview check

Manual — after deploy, paste `https://caleo.id/` into:

- Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/
- Twitter Card Validator (X): https://cards-dev.twitter.com/validator
- WhatsApp: paste link in any chat → verify preview card renders with og-image + title + description

If og-image fails to render: verify Content-Type header on `/assets/og-image.png` = `image/png` (not `application/octet-stream`).

## Incident log

Landing-side incidents (broken links, missing assets, CSP violations, deploy failures) are logged at `docs/incidents/YYYY-MM-DD-<slug>.md` per CLAUDE.md incident logging protocol.
```

Save to `docs/runbooks/caleo-id-landing-ops.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/caleo-id-landing-ops.md
git commit -m "docs(runbook): caleo.id landing ops runbook

Deploy, rollback (wrangler + git paths), post-deploy smoke, email
routing setup, content edit workflow (Phase 3.0 static → Phase 3.1
config), Lighthouse checks, OG preview verification, incident logging
reference."
```

- [ ] **Step 3: Rollback**

`git revert <this-commit>`.

---

## Task 9: Deploy to staging + comprehensive test matrix

**Purpose:** catch all issues on staging (auto-generated `*.workers.dev` URL) BEFORE binding to production `caleo.id/*` route. If green on staging, Task 10 promotes to production confidently.

**Files:** none created; staging Cloudflare Worker deploys.

**Interfaces:**
- Consumes: `infra/caleo-landing-worker/*` (built by Task 6, with env.staging in wrangler.toml)
- Produces: staging Worker at `caleo-landing-staging.<sub>.workers.dev`

**Prerequisite:** `wrangler login` has been run — confirm with `npx wrangler whoami`.

- [ ] **Step 1: Confirm Wrangler auth**

```bash
npx wrangler whoami
```

Expected: prints your Cloudflare account email + account ID. If not, run `npx wrangler login`.

- [ ] **Step 2: Deploy to staging environment**

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env staging
```

Expected output: `Success!` + Worker version ID + a URL like:
```
https://caleo-landing-staging.<your-subdomain>.workers.dev
```

Save this URL — reference as `$STAGING_URL` below. Example:

```bash
export STAGING_URL="https://caleo-landing-staging.tonywei.workers.dev"
# replace <your-subdomain> with actual subdomain from deploy output
```

- [ ] **Step 3: Sanity check — HTTP 200 + new landing content on staging**

```bash
curl -sI "$STAGING_URL/" | head -3
curl -s "$STAGING_URL/" | grep -oE 'Toko makin rapi|Segera Hadir' | head -1
```

Expected: `HTTP/2 200` + prints `Toko makin rapi`. If not, redeploy staging (Step 2) and retry.

### Test Matrix A: Routes + HTTP headers (automated)

- [ ] **Step 4: All routes return expected status codes**

```bash
for path in / /case-study /privacy.html /terms.html /robots.txt /sitemap.xml /favicon.ico; do
  code=$(curl -so /dev/null -w "%{http_code}" "$STAGING_URL$path")
  echo "$code  $path"
done
```

Expected: every line starts with `200`.

- [ ] **Step 5: Security headers on all HTML routes**

```bash
for path in / /case-study /privacy.html /terms.html; do
  echo "=== $path ==="
  curl -sI "$STAGING_URL$path" | grep -iE "content-security-policy|strict-transport|x-frame-options|x-content-type|referrer-policy|permissions-policy"
done
```

Expected per route:
- `content-security-policy: default-src 'self'; script-src 'self'; ...` (enforcing, no `Report-Only`)
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`
- `x-content-type-options: nosniff`
- `x-frame-options: DENY`
- `referrer-policy: strict-origin-when-cross-origin`
- `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()`

- [ ] **Step 6: Content-type overrides for robots.txt + sitemap.xml**

```bash
curl -sI "$STAGING_URL/robots.txt" | grep -i content-type
curl -sI "$STAGING_URL/sitemap.xml" | grep -i content-type
```

Expected:
- robots: `content-type: text/plain; charset=utf-8`
- sitemap: `content-type: application/xml; charset=utf-8`

### Test Matrix B: Full automated Playwright smoke suite

- [ ] **Step 7: Playwright suite against staging (all 12 tests)**

```bash
cd - # back to repo root
CALEO_LANDING_BASE="$STAGING_URL" npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: **12/12 tests pass**. Includes:
- Home structure + h1
- All WA links contain 6285264787775
- /case-study loads + back link is `/`
- privacy.html + terms.html load with TL;DR visible
- robots.txt has Sitemap directive
- sitemap.xml valid XML with case-study URL
- CSP header script-src 'self' + default-src 'self'
- /assets/landing.js loads with roi-staff + pricing markers
- /assets/og-image.png loads with image/png content-type
- Semantic markers preserved (.js-wa-link ≥10, #js-slot-counter, .js-testi-card ≥10, .js-stat-card =4, .js-promo-item =10)
- All Phase 3.0 sections present (16 section IDs + 8 audience cards + 10 modules + 4 onboarding steps)

If ANY test fails: read the assertion + inspect staging → fix code → redeploy staging (Step 2) → rerun tests. Do NOT proceed to Task 10 with any red test.

### Test Matrix C: SEO + structured data validation

- [ ] **Step 8: Googlebot fetch — verify meta + JSON-LD**

```bash
curl -sA "Googlebot/2.1 (+http://www.google.com/bot.html)" "$STAGING_URL/" \
  | grep -oE 'property="og:[a-z]+"|name="twitter:[a-z]+"|application/ld\+json' \
  | sort -u
```

Expected output includes:
- `application/ld+json` (Schema.org SoftwareApplication + LocalBusiness)
- `property="og:image"`, `property="og:title"`, `property="og:description"`, `property="og:url"`, `property="og:type"`, `property="og:locale"`
- `name="twitter:card"`, `name="twitter:title"`, `name="twitter:description"`, `name="twitter:image"`

- [ ] **Step 9: Schema.org JSON-LD validation (manual)**

Open Google Rich Results Test:
- https://search.google.com/test/rich-results
- Paste `$STAGING_URL/` → Test URL

Expected: parses SoftwareApplication + LocalBusiness (Organization) markup. Zero errors, zero warnings on required fields.

Repeat for `$STAGING_URL/case-study` — should parse Article schema.

- [ ] **Step 10: Sitemap XML validation**

```bash
curl -s "$STAGING_URL/sitemap.xml" > /tmp/caleo-sitemap.xml
xmllint --noout /tmp/caleo-sitemap.xml && echo "XML valid"
grep -c '<loc>' /tmp/caleo-sitemap.xml
```

Expected: `XML valid` + prints `4` (four URL entries).

### Test Matrix D: OpenGraph + social preview validation (manual)

- [ ] **Step 11: Facebook Sharing Debugger**

Open https://developers.facebook.com/tools/debug/ → paste `$STAGING_URL/` → Debug.

Verify preview card renders with:
- OG image (1200×630, Caleo branding)
- OG title: "Caleo — Toko Rapi, Untung Jelas"
- OG description contains "toko, distributor, & pabrik UMKM"
- Zero warnings on required og properties

Repeat for `$STAGING_URL/case-study` — Article card renders with og-case-study.png.

- [ ] **Step 12: WhatsApp link preview**

Copy `$STAGING_URL/` to a WA chat with yourself. Wait ~5 seconds. Verify preview card renders with logo/title/description. Repeat for `$STAGING_URL/case-study`.

- [ ] **Step 13: Twitter/X Card Validator (if accessible)**

Open https://cards-dev.twitter.com/validator → paste `$STAGING_URL/`.

Expected: "Summary with large image" card renders correctly.

### Test Matrix E: Lighthouse — desktop + mobile

- [ ] **Step 14: Lighthouse desktop against staging**

```bash
npx lighthouse "$STAGING_URL/" \
  --preset=desktop \
  --output=json \
  --output-path=/tmp/caleo-staging-desktop.json \
  --quiet --chrome-flags="--headless"

jq '.categories | to_entries | map({(.key): .value.score}) | add' /tmp/caleo-staging-desktop.json
```

Expected scores:
- performance ≥ 0.95
- accessibility ≥ 0.90
- best-practices ≥ 0.90
- seo ≥ 0.95

- [ ] **Step 15: Lighthouse mobile against staging**

```bash
npx lighthouse "$STAGING_URL/" \
  --emulated-form-factor=mobile \
  --output=json \
  --output-path=/tmp/caleo-staging-mobile.json \
  --quiet --chrome-flags="--headless"

jq '.categories | to_entries | map({(.key): .value.score}) | add' /tmp/caleo-staging-mobile.json
```

Expected:
- performance ≥ 0.85 (target from spec §4)
- accessibility ≥ 0.90
- best-practices ≥ 0.90
- seo ≥ 0.95

Common failure modes:
- **performance < 0.85 mobile**: check landing.js has `defer` attr, check OG image size < 200KB, verify Google Fonts preconnect present
- **accessibility < 0.90**: usually contrast issue — check emoji-heavy sections in dark mode emulation
- **best-practices < 0.90**: HTTPS/HSTS/CSP header issues — should be auto-passing via Task 6 Worker

### Test Matrix F: Cross-browser + responsive walkthrough

- [ ] **Step 16: Chrome desktop full walkthrough**

Open `$STAGING_URL/` in Chrome (fresh incognito to avoid cache).

Section-by-section visual verification (regression guard for CSS/JS load):
- [ ] Promo ticker marquee scrolls at top
- [ ] Nav renders (CALEO logo left + 5 nav links + WA CTA + "Tenant Login" subtle grey right)
- [ ] Hero: h1 + pill "🏪 Dipakai distributor UMKM di jantung Glodok" + WA CTA + rating row + mockup dashboard on right
- [ ] Stats section: 4 stat cards (474 SKU / 290+ Supplier / 1.500+ / 99.9%) with case-study link
- [ ] Modules: 10 icons in **5×2 grid** (desktop) with expanded descriptions
- [ ] Modul deep-dive: 5 rows with visual demos (KASIR/WA+AI/AI Manajer/Tukar-Faktur/Pembukuan)
- [ ] Product tour: Pembelian dashboard mockup with case-study button
- [ ] Compare table: 4 cols (Excel / Software Akuntansi / WA Bot / Caleo) x 11 rows
- [ ] Fleksibel section: eyebrow "Fleksibel" + h2 "Toko-mu punya alur unik? Sistemnya yang ikutin" + before/after comparison (red/green) + 4 flex-cards + WA CTA
- [ ] Untuk siapa: 8 audience cards (Alat Listrik / Alat Bangunan / CCTV / **Distributor Sembako & FMCG** / Bengkel / Grosir / Toko Online / **Pabrik & Produksi**)
- [ ] Cerita: founder proof card (badges + quote + author)
- [ ] Testimonials: marquee of 5 testimonials (Pak B / Ibu S / Pak A / Pak H / Pak R)
- [ ] Solusi: 5 pain SEBELUM + 5 gain SESUDAH scenarios
- [ ] Growth "Bukan Cuma Hemat": 4 growth cards + green WA CTA button
- [ ] ROI calculator: 2 dropdowns + result numbers update on change
- [ ] Pricing: 3 tier cards (Starter no ribbon / **Pro with gold "PALING POPULER" ribbon** / **Premium with purple "🤖 INCLUDE AI · BONUS WEBSITE GRATIS" ribbon + purple accent card**)
- [ ] Onboarding: 4 steps in **timeline layout with arrows** — Step 1 says "Chat WA + Demo Gratis" (15-30 menit) — boxes uniform height
- [ ] FAQ: 15 collapsible items — FAQ #10 mentions "CSV/Excel" (not JSON), FAQ #15 mentions "sesuai paket kamu (Starter/Pro/Premium)"
- [ ] Kantor: address + hours + embedded Google Maps
- [ ] Final CTA: QR code + h2 + WA button
- [ ] Footer: logo + WA + `halo@caleo.id` mailto + 3 legal links (Privasi, Syarat & Ketentuan, Login Tenant)
- [ ] Sticky mobile CTA bar hidden on desktop (>720px)
- [ ] Floating WA FAB visible bottom-right

- [ ] **Step 17: DevTools Console clean**

Open DevTools Console tab on `$STAGING_URL/`. Verify:
- Zero JS errors
- Zero CSP violations
- Zero broken image warnings (404 on any asset)
- Zero blocked network requests

- [ ] **Step 18: Interactive JS smoke — ROI calc + pricing toggle**

Still on `$STAGING_URL/`:

- Scroll to `#roi` section
- Change "Jumlah Karyawan/Kasir" dropdown to "5 orang" → total Rp updates larger
- Change "Transaksi per hari" to "200" → total Rp updates even larger
- Scroll to `#promos` (pricing)
- Click "6 Bulan" toggle button
- Verify: all 3 tier prices flip (Starter Rp 509K, Pro Rp 807K, Premium Rp 3.229K)
- Verify callout text below CTA says: **"Komit 6 bulan · GRATIS setup · 💡 Pilih 12-bulan hemat 50% dari harga normal (ekstra Rp X/tahun vs 6-bulan)"** — NOT the old misleading "hemat 50%" without qualifier
- Click "12 Bulan" toggle → prices flip back + callout says "hemat Rp X/tahun vs pilih 6-bulan"

- [ ] **Step 19: Firefox smoke (desktop)**

Open `$STAGING_URL/` in Firefox. Same walkthrough as Step 16 abbreviated:
- Hero renders
- Modules 5×2 grid renders (Firefox CSS Grid parity check)
- Emoji rendering acceptable (some emoji look different but not broken)
- Pricing toggle works
- No console errors

- [ ] **Step 20: Safari smoke (desktop, if on macOS)**

Open `$STAGING_URL/` in Safari. Same abbreviated walkthrough:
- Inter font loads (or fallback if fonts.gstatic.com blocked)
- CSS gradient backgrounds render (some Safari-specific rendering)
- Backdrop-filter blur on sticky nav (Safari has full support)
- No console errors

### Test Matrix G: Mobile viewport regression

- [ ] **Step 21: Chrome DevTools mobile emulation — iPhone SE (375×667)**

DevTools → Toggle device toolbar → iPhone SE. Verify:
- Nav-links row hidden (only brand + WA CTA)
- Nav "Tenant Login" text hidden (only nav-links styling applies)
- Hero stacks vertically (visual on top or bottom of text)
- Modules grid: **2 columns × 5 rows** (per CSS breakpoint at max-width 900px)
- Audience cards: 1 column (per grid auto-fit min 240px)
- Onboarding: 1 column, arrows hidden (per CSS max-width 560px + display:none)
- Fleksibel comparison stacks vertically, arrow rotates 90deg
- Growth 4 cards: 1 column (per CSS max-width 720px)
- Pricing 3 tiers: 1 column
- Sticky mobile CTA bar visible at bottom
- Floating WA FAB hidden on mobile (per CSS 720px hide)
- Testimonial marquee still scrolls horizontally

- [ ] **Step 22: iPhone XR (414×896) + iPad (768×1024)**

DevTools → emulate iPhone XR: same as SE with slightly wider cards.
DevTools → emulate iPad: tablet layout — modules 2×5, audience 2×4, pricing 2×2 (per CSS breakpoints).

### Test Matrix H: Accessibility + reduced motion

- [ ] **Step 23: Keyboard navigation**

On `$STAGING_URL/` desktop, use only keyboard:
- Press Tab repeatedly → focus indicator visible on nav links, then hero CTA, then WA CTA
- Enter on nav link → smooth scrolls to section
- Tab through pricing toggle buttons → they're focusable + Enter/Space activates

Verify: focus outline visible (default browser or CSS `focus-visible` styles). No focus traps (nowhere Tab gets stuck).

- [ ] **Step 24: Reduced-motion preference**

DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion: reduce`. Refresh page.

Verify:
- Promo bar marquee **stops animating** (`.marquee-track` animation halted per CSS `@media (prefers-reduced-motion: reduce)`)
- Testimonials marquee stops
- Scroll reveal `.fade-in` animations disabled (elements appear without fade)
- Hover transforms still work (not motion-based)

- [ ] **Step 25: Lighthouse accessibility audit deep-dive**

```bash
jq '.audits | to_entries | map(select(.value.score != null and .value.score < 1) | {id: .key, score: .value.score, title: .value.title}) | sort_by(.score)' /tmp/caleo-staging-mobile.json | head -30
```

Expected: any audit below 1.0 is a warning. Common findings + actions:
- `color-contrast` — some emoji + slate-text combos may flag. Manually verify contrast is acceptable.
- `image-alt` — all `<img>` should have `alt=""` or descriptive alt. Verify with `curl -s "$STAGING_URL/" | grep -oE '<img[^>]*>' | head -10`.
- `link-name` — WA CTAs with only SVG icon need `aria-label`. Verify floating WA has `aria-label="Chat WhatsApp"`.

If any audit fails critically (score 0), fix in HTML/CSS + redeploy staging.

### Test Matrix I: Rollback drill on staging

- [ ] **Step 26: Rollback drill — verify wrangler rollback works**

Purpose: prove we can rollback before we ever need to in production.

Deploy a deliberately broken version to staging:

```bash
cd infra/caleo-landing-worker
# Corrupt a copy of index.html
cp ../../public/index.html /tmp/index-backup.html
echo "<!-- broken -->" > ../../public/index.html
npx wrangler deploy --env staging
sleep 5
curl -s "$STAGING_URL/" | head -1
```

Expected: prints `<!-- broken -->` (broken version live on staging).

Rollback:

```bash
npx wrangler rollback --env staging --name caleo-landing-staging
sleep 5
curl -s "$STAGING_URL/" | grep -o 'Toko makin rapi' | head -1
```

Expected: prints `Toko makin rapi` (previous version restored).

Restore working copy + redeploy staging:

```bash
cp /tmp/index-backup.html ../../public/index.html
npx wrangler deploy --env staging
```

Rollback verified. This same command pattern works in production (Task 10 fallback).

### Test Matrix J: Sign-off checklist

- [ ] **Step 27: Sign-off — all test matrix items green**

Verify every step from 4 through 26 has a checkmark. Missing any → do NOT proceed to Task 10.

Post to team / self: "Staging test matrix green ✓ · $STAGING_URL · ready to promote to caleo.id"

- [ ] **Step 28: No commit needed — deploy is ops action**

Continue to Task 10.

---

## Task 10: Promote to production — deploy Worker to `caleo.id/*`

**Files:** none created; production Cloudflare Worker state changes.

**Interfaces:**
- Consumes: `infra/caleo-landing-worker/*` (staging tested green in Task 9)
- Produces: production `caleo.id/*` serving new static landing (was placeholder)

**Prerequisite:** Task 9 test matrix passed FULLY green. If any test failed, resolve first.

- [ ] **Step 1: List current production deployments (baseline for rollback)**

```bash
cd infra/caleo-landing-worker
npx wrangler deployments list --env production --name caleo-landing 2>&1 | head -20
```

Note the current deployment ID. If Worker doesn't exist yet (first deploy), output says "No deployments" — that's fine.

- [ ] **Step 2: Deploy to production**

```bash
cd infra/caleo-landing-worker
npx wrangler deploy --env production
```

Expected output: `Success!` + Worker version ID + route `caleo.id/*` bound to `caleo-landing`.

If deploy fails with "route conflict" — the existing placeholder Worker holds the `caleo.id/*` route. Options:
1. Delete old placeholder Worker via CF dashboard first, then redeploy
2. Reassign route via CF dashboard → Workers Routes → move caleo.id/* to new Worker

If deploy fails with "assets not found" — verify assets binding path in `wrangler.toml` (`../../public`) resolves; run `ls -la ../../public/index.html` from `infra/caleo-landing-worker/`.

- [ ] **Step 3: Wait for propagation + verify HTTP 200 on caleo.id**

```bash
sleep 10
curl -sI https://caleo.id/ | head -20
```

Expected:
- `HTTP/2 200`
- `content-security-policy: default-src 'self'; script-src 'self'; ...`
- `strict-transport-security: max-age=63072000; ...`
- `x-frame-options: DENY`

- [ ] **Step 4: Verify content body is new landing (not old placeholder)**

```bash
curl -s https://caleo.id/ | grep -oE 'Toko makin rapi|Segera Hadir' | head -1
```

Expected: prints `Toko makin rapi`. If prints `Segera Hadir` — routing didn't take effect yet; wait 30s and retry.

- [ ] **Step 5: Run smoke suite against production**

```bash
cd -
CALEO_LANDING_BASE=https://caleo.id npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: **all 12 tests pass**. If any fail, rollback immediately (Step 7).

- [ ] **Step 6: SEO + all-route production check**

```bash
for path in / /case-study /privacy.html /terms.html /robots.txt /sitemap.xml /favicon.ico /assets/landing.js; do
  code=$(curl -so /dev/null -w "%{http_code}" "https://caleo.id$path")
  echo "$code  $path"
done
```

Expected: every line starts with `200`.

- [ ] **Step 7: (Only if production smoke fails) Rollback**

```bash
cd infra/caleo-landing-worker
npx wrangler rollback --env production --name caleo-landing
sleep 10
curl -sI https://caleo.id/ | head -3
```

Expected: reverts to previous placeholder Worker. Investigate + fix + redeploy.

- [ ] **Step 8: No commit needed — deploy is ops action. Continue to Task 11.**

---

## Task 11: Setup Cloudflare Email Routing for `halo@caleo.id`

**Files:** none — CF dashboard config only.

**Interfaces:**
- Produces: working `halo@caleo.id` inbox forwarding to founder's Gmail

- [ ] **Step 1: Enable Email Routing on caleo.id zone**

Open CF dashboard → `caleo.id` zone → Email → Email Routing.

- [ ] **Step 2: Enable + accept auto-added MX records**

Click "Enable Email Routing". CF adds MX records automatically. Do NOT reject.

- [ ] **Step 3: Add custom address route**

Under "Routing rules" → "Add address":
- Custom address: `halo@caleo.id`
- Action: Send to an email
- Destination address: `tonywei.office@gmail.com`

Save.

- [ ] **Step 4: Verify destination email**

CF sends a verification email to `tonywei.office@gmail.com`. Open + click the confirmation link.

- [ ] **Step 5: Send a test email**

From any other email account, send an email to `halo@caleo.id`. Confirm receipt at destination inbox within ~1 minute. Reply to confirm two-way isn't set up (Email Routing is one-way forward only; replies go from destination, not from halo@caleo.id).

- [ ] **Step 6: (Optional, if time) Add fallback catch-all**

Under "Catch-all address":
- Action: Send to an email
- Destination: `tonywei.office@gmail.com`

Save. Now any email to `*@caleo.id` forwards to destination — safety net against typos.

- [ ] **Step 7: No commit needed — dashboard config only**

Document in `docs/runbooks/caleo-id-landing-ops.md` (already done in Task 8) that this setup is complete.

---

## Task 12: Post-deploy Lighthouse + OG debugger + browser smoke

**Files:** none created; verification-only.

- [ ] **Step 1: Run Lighthouse desktop**

```bash
npx lighthouse https://caleo.id/ \
  --preset=desktop \
  --output=json \
  --output-path=/tmp/caleo-lighthouse-desktop.json \
  --quiet \
  --chrome-flags="--headless"

jq '.categories.performance.score, .categories.accessibility.score, .categories["best-practices"].score, .categories.seo.score' /tmp/caleo-lighthouse-desktop.json
```

Expected: `performance ≥ 0.95`, other scores ≥ 0.90.

- [ ] **Step 2: Run Lighthouse mobile**

```bash
npx lighthouse https://caleo.id/ \
  --emulated-form-factor=mobile \
  --output=json \
  --output-path=/tmp/caleo-lighthouse-mobile.json \
  --quiet \
  --chrome-flags="--headless"

jq '.categories.performance.score, .categories.accessibility.score, .categories["best-practices"].score, .categories.seo.score' /tmp/caleo-lighthouse-mobile.json
```

Expected: `performance ≥ 0.85`.

If mobile performance < 0.85, likely culprits:
- Google Fonts render-blocking → verify `preconnect` and `preload` hints present
- Large OG image (>200KB) → recompress with `convert public/assets/og-image.png -quality 85 public/assets/og-image.png` + redeploy
- Landing.js not `defer` → verify `<script defer src="/assets/landing.js">`

- [ ] **Step 3: OG preview debuggers (manual)**

Open in browser and paste `https://caleo.id/`:
- https://developers.facebook.com/tools/debug/ — verify og-image + title + description all render
- https://cards-dev.twitter.com/validator (if accessible) — verify Summary Large Image card

Paste `https://caleo.id/case-study` in Facebook debugger too — verify Article card renders with og-case-study.png.

If og-image fails to load in debugger:
- Verify content-type: `curl -sI https://caleo.id/assets/og-image.png | grep -i content-type` — should be `image/png`
- Verify Facebook can reach it (some Cloudflare bot protection may block scraper) — check CF firewall logs

- [ ] **Step 4: WhatsApp link preview (manual)**

Send yourself a WA message with `https://caleo.id/` in it. Verify preview card renders with logo + title within 5 seconds.

- [ ] **Step 5: Chrome desktop full walkthrough**

Open https://caleo.id/ in Chrome:
- Click "Ngobrol WA" nav CTA → WhatsApp opens with pre-filled message "Halo Caleo, saya mau tanya"
- Click "Ngobrol 15 Menit via WA" hero CTA → WhatsApp opens with "Halo Caleo, saya mau ngobrol soal toko saya"
- Toggle pricing to "6 Bulan" → prices update, callout text says "Pilih 12-bulan hemat 50% dari harga normal (ekstra Rp X/tahun vs 6-bulan)"
- Click case-study link (in Product Tour section) → `/case-study` loads
- Click "Kembali ke Beranda" → returns to `/`
- Click footer legal links → `/privacy.html` and `/terms.html` render with TL;DR + tables

DevTools Console: **zero errors**, zero CSP violations.

- [ ] **Step 6: Chrome mobile emulation (375×667 iPhone SE)**

DevTools → Toggle device toolbar → iPhone SE:
- Nav collapses (no nav-links row) — brand + WA CTA only
- Hero renders vertically (image below text or stacked)
- Sticky mobile CTA bar at bottom (💰 Lihat Harga + Chat WA)
- Marquee ticker readable at top
- Modules section shows 2-column grid (per CSS breakpoint at 900px)
- Pricing tier cards stack vertically

- [ ] **Step 7: No commit needed — verification only. Proceed to Task 13.**

---

## Task 13: Update `progress.md` + close Phase 3 loop

**Files:**
- Modify: `progress.md` (append Phase 3 ship line)

- [ ] **Step 1: Read current `progress.md` header structure**

```bash
head -50 progress.md
```

Note the format used for shipped phase entries (dates, headers, bullet style).

- [ ] **Step 2: Append Phase 3 ship entry**

Following the observed format (adapt to actual pattern in file), add a new entry near the top of the "shipped" section:

```markdown
## 2026-07-19 · Phase 3 landing shipped

- Public landing at `caleo.id/` (was placeholder "Segera Hadir")
- Case study at `caleo.id/case-study`
- Legal pages at `caleo.id/privacy.html` + `terms.html`
- Cloudflare Worker `caleo-landing` deployed; `wrangler rollback` runbook at `docs/runbooks/caleo-id-landing-ops.md`
- Email routing `halo@caleo.id` → `tonywei.office@gmail.com` live via CF free tier
- Playwright smoke suite `tests/e2e/tests/landing-smoke.spec.ts` (10 tests)
- Phase 3.1 (config-driven via Caleo Admin sidebar) queued per spec §12 + §16 — additive, no rebuild
- Cost impact: Rp 0/mo added (CF Workers + Email Routing free tier)
```

- [ ] **Step 3: Verify update**

```bash
head -30 progress.md
```

Expected: new entry visible near top.

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Phase 3 landing shipped to caleo.id

- Public landing + case-study + legal (privacy + terms) live
- Cloudflare Worker caleo-landing deployed; wrangler rollback ready
- halo@caleo.id forwarding via CF Email Routing
- Playwright smoke suite (10 tests)
- Cost impact: Rp 0/mo
- Phase 3.1 (config-driven, Caleo Admin sidebar) queued — additive"
```

- [ ] **Step 5: Rollback for progress.md**

`git revert <this-commit>` — but if the ship itself is good, leaving the progress entry stands is fine.

---

## Task 14: Final validation checklist (all-green gate before declaring done)

**Files:** none — validation only.

Run through this checklist. Any FAIL = do NOT declare Phase 3 shipped; investigate + fix.

- [ ] **Step 1: All Playwright smoke tests pass against production**

```bash
CALEO_LANDING_BASE=https://caleo.id npx playwright test tests/e2e/tests/landing-smoke.spec.ts
```

Expected: 10/10 pass.

- [ ] **Step 2: Lighthouse desktop ≥ 95, mobile ≥ 85 (Task 12)**

- [ ] **Step 3: OG preview validated in FB debugger + WA (Task 12)**

- [ ] **Step 4: All footer legal links resolve (200 + expected content)**

```bash
curl -sI https://caleo.id/privacy.html | head -1
curl -sI https://caleo.id/terms.html | head -1
```

Expected: both `HTTP/2 200`.

- [ ] **Step 5: DevTools Console clean on production (manual)**

Open https://caleo.id/ in Chrome incognito → DevTools Console tab. Verify:
- Zero errors
- Zero CSP violations
- Zero broken image warnings
- Zero blocked network requests

- [ ] **Step 6: Rollback drill (dry-run, don't actually rollback)**

Confirm rollback command available:

```bash
cd infra/caleo-landing-worker
npx wrangler deployments list --name caleo-landing | head -10
```

Expected: at least 2 deployments listed (current + previous placeholder). `wrangler rollback` would revert to previous.

- [ ] **Step 7: Announce shipped**

Post to founder / team: "Phase 3 landing live at caleo.id ✓ · smoke 10/10 · Lighthouse desktop <score> / mobile <score> · rollback ready"

- [ ] **Step 8: Update task tracker (if applicable)**

Mark all Phase 3 tasks as done in whatever project tracker is in use. Reference spec `docs/superpowers/specs/2026-07-18-caleo-landing-phase-3-design.md` + this plan for closure.

---

## Post-ship (out of this plan's scope)

- **Phase 3.1** — config-driven via Caleo Admin sidebar per spec §12 + §16. Additive, no rebuild.
- **Real testimonial pipeline** — collect written consent from onboarded tenants, feed to config layer or hardcode via redeploy (per spec §12).
- **Multi-language / English** — expat SME target, defer.
- **Video demo embed** — needs recorded video first.
- **A/B testing framework** — CF Worker splits traffic by cookie once Phase 3.1 config exists.

## Rollback summary (one place, all commands)

| Scenario | Command |
|---|---|
| Bad Worker deploy | `cd infra/caleo-landing-worker && npx wrangler rollback --name caleo-landing` |
| Bad code change | `git revert <commit> && cd infra/caleo-landing-worker && npx wrangler deploy` |
| Bad content in HTML | Same as bad code change |
| Bad Email Routing rule | CF dashboard → Email Routing → delete/edit rule |
| Full disaster | `wrangler rollback` + rollback Email Routing DNS (revert MX in CF DNS) |

All rollbacks documented in `docs/runbooks/caleo-id-landing-ops.md`.
