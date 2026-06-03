# Vosi Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved HTML prototype into a production-ready standalone landing page, deployed on its own domain.

**Architecture:** Single-file static HTML site (`index.html`) — no framework, no build step. The prototype at `.superpowers/brainstorm/19476-1780503711/content/landing-final.html` is ~95% complete. Production work covers: extracting to a clean project folder, filling placeholders, adding SEO meta tags, adding analytics, and deploying to Firebase Hosting (Google Cloud). Future backend API (lead capture, notifications) akan di Cloud Run sebagai service terpisah — landing page tetap di Firebase Hosting.

**Tech Stack:** Vanilla HTML5 + CSS3 + JavaScript (no framework — YAGNI for a marketing page). Google Fonts (Inter). Hosted on **Firebase Hosting** (Google Cloud ecosystem, global CDN, HTTPS otomatis).

**Design spec:** `docs/vosi-landing/2026-06-04-vosi-landing-page-design.md`

---

## File Structure

```
vosi-landing/               ← standalone project root (can be separate repo later)
├── index.html              ← production landing page (from prototype)
├── favicon.svg             ← Vosi logomark as SVG favicon
├── og-image.png            ← 1200×630 Open Graph image for social sharing
├── robots.txt              ← allow all crawlers
├── sitemap.xml             ← single-URL sitemap
└── .gitignore              ← node_modules, .DS_Store, etc.
```

---

## Task 1: Scaffold the project folder

**Files:**
- Create: `vosi-landing/index.html`
- Create: `vosi-landing/.gitignore`
- Create: `vosi-landing/robots.txt`
- Create: `vosi-landing/sitemap.xml`

- [ ] **Step 1.1: Create the project folder**

```bash
mkdir -p vosi-landing
```

- [ ] **Step 1.2: Copy the prototype as index.html**

```bash
cp .superpowers/brainstorm/19476-1780503711/content/landing-final.html vosi-landing/index.html
```

- [ ] **Step 1.3: Create .gitignore**

Create `vosi-landing/.gitignore`:

```
.DS_Store
node_modules/
*.log
```

- [ ] **Step 1.4: Create robots.txt**

Create `vosi-landing/robots.txt`:

```
User-agent: *
Allow: /
```

- [ ] **Step 1.5: Create sitemap.xml**

Create `vosi-landing/sitemap.xml` (replace `https://vosi.id` with actual domain once decided):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://vosi.id/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

- [ ] **Step 1.6: Verify file opened correctly in browser**

Open `vosi-landing/index.html` in browser directly (File → Open). All sections should render — nav, hero with chat animation, social proof, comparison, use cases, benefits, FAQ, konsultasi form, footer.

- [ ] **Step 1.7: Commit**

```bash
git add vosi-landing/
git commit -m "feat(vosi-landing): scaffold production project from prototype"
```

---

## Task 2: Fill WA number placeholder

**Files:**
- Modify: `vosi-landing/index.html` (2 occurrences of placeholder)

- [ ] **Step 2.1: Locate both placeholder occurrences**

```bash
grep -n "XXXX\|62812XXXXXXXX" vosi-landing/index.html
```

Expected output: 2 lines — the JS constant and the display text in the form footer.

- [ ] **Step 2.2: Replace JS constant with real number**

Find in `index.html`:
```js
const VOSI_WA_NUMBER = '62812XXXXXXXX';
```

Replace with your actual number in E.164 format (62 = Indonesia country code, no leading 0, no dashes):
```js
const VOSI_WA_NUMBER = '628XXXXXXXXXX'; // e.g. 6281234567890
```

- [ ] **Step 2.3: Replace display text in form**

Find:
```html
Atau langsung WA kami di <strong style="color:rgba(255,255,255,.7)">0812-XXXX-XXXX</strong>
```

Replace with formatted display number:
```html
Atau langsung WA kami di <strong style="color:rgba(255,255,255,.7)">0812-XXXX-XXXX</strong>
```
(update `0812-XXXX-XXXX` to match your real number in human-readable format, e.g. `0812-3456-7890`)

- [ ] **Step 2.4: Test WA redirect end-to-end**

1. Open `vosi-landing/index.html` in browser
2. Scroll to Konsultasi section
3. Fill all 4 form fields
4. Click "Kirim & Jadwalkan Konsultasi →"
5. Verify: new tab opens to `wa.me/628XXXXXXXXXX?text=...` with pre-filled message containing all 4 form values
6. Also verify: clicking with empty fields shows alert "Mohon lengkapi semua isian sebelum mengirim."

- [ ] **Step 2.5: Commit**

```bash
git add vosi-landing/index.html
git commit -m "feat(vosi-landing): configure Vosi WA contact number"
```

---

## Task 3: SEO meta tags & Open Graph

**Files:**
- Modify: `vosi-landing/index.html` (`<head>` section)
- Create: `vosi-landing/og-image.png`

- [ ] **Step 3.1: Add meta tags to `<head>`**

Open `vosi-landing/index.html`. After the `<title>` tag, add:

```html
<!-- SEO -->
<meta name="description" content="Vosi otomasi balasan WhatsApp bisnis kamu 24 jam — terima order, cek stok, dan kirim invoice secara otomatis. Aktif dalam 3 hari kerja.">
<meta name="keywords" content="whatsapp bot bisnis, ai whatsapp indonesia, otomasi whatsapp, chatbot toko, vosi">
<link rel="canonical" href="https://vosi.id/">

<!-- Open Graph (WhatsApp, Facebook, LinkedIn preview) -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://vosi.id/">
<meta property="og:title" content="Vosi — AI WhatsApp untuk Bisnis Indonesia">
<meta property="og:description" content="Setiap chat jadi peluang, bukan beban. Bot AI yang balas customer 24 jam, update stok otomatis, dan kirim invoice langsung ke WA.">
<meta property="og:image" content="https://vosi.id/og-image.png">
<meta property="og:locale" content="id_ID">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Vosi — AI WhatsApp untuk Bisnis Indonesia">
<meta name="twitter:description" content="Bot AI yang balas customer 24 jam, update stok otomatis, dan kirim invoice langsung ke WA.">
<meta name="twitter:image" content="https://vosi.id/og-image.png">
```

Replace `https://vosi.id` with actual domain once decided.

- [ ] **Step 3.2: Add favicon link**

In `<head>`, after the meta tags, add:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
```

- [ ] **Step 3.3: Create favicon.svg**

Create `vosi-landing/favicon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e3d60"/>
      <stop offset="100%" stop-color="#2d8a4e"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#g)"/>
  <path d="M18 5L8 17h9l-1 10 11-14h-9l1-8z" fill="white"/>
</svg>
```

- [ ] **Step 3.4: Create og-image.png**

Create a 1200×630px image for social sharing. Options:
- Use Figma/Canva to design a simple branded card showing the Vosi logo, tagline "Setiap Chat Jadi Peluang. Bukan Beban.", and a phone mockup or the chat illustration
- Minimum viable: navy `#1e3d60` background, white "Vosi" wordmark centered, tagline below
- Export as PNG and save to `vosi-landing/og-image.png`

- [ ] **Step 3.5: Verify meta tags**

Open `https://developers.facebook.com/tools/debug/` (or `https://metatags.io`) after deploying and paste the URL to verify OG image and description render correctly.

Locally, inspect `<head>` in DevTools to confirm all tags are present.

- [ ] **Step 3.6: Commit**

```bash
git add vosi-landing/
git commit -m "feat(vosi-landing): add SEO meta tags, OG image, and favicon"
```

---

## Task 4: Analytics (Google Analytics 4)

**Files:**
- Modify: `vosi-landing/index.html` (`<head>` section)

- [ ] **Step 4.1: Create GA4 property**

1. Go to [analytics.google.com](https://analytics.google.com)
2. Create new property → name: "Vosi Landing Page", timezone: Indonesia (WIB), currency: IDR
3. Choose Web platform → enter URL `https://vosi.id`
4. Copy the **Measurement ID** (format: `G-XXXXXXXXXX`)

- [ ] **Step 4.2: Add GA4 snippet to `<head>`**

In `vosi-landing/index.html`, paste immediately before `</head>`, replacing `G-XXXXXXXXXX` with your real Measurement ID:

```html
<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

- [ ] **Step 4.3: Track WA redirect as conversion event**

In `vosi-landing/index.html`, find the `submitKonsultasi()` function and add GA event tracking before `window.open(...)`:

```js
function submitKonsultasi() {
  const nama   = document.getElementById('f-nama').value.trim();
  const bisnis = document.getElementById('f-bisnis').value.trim();
  const wa     = document.getElementById('f-wa').value.trim();
  const jenis  = document.getElementById('f-jenis').value;

  if (!nama || !bisnis || !wa || !jenis) {
    alert('Mohon lengkapi semua isian sebelum mengirim.');
    return;
  }

  // Track conversion
  if (typeof gtag !== 'undefined') {
    gtag('event', 'konsultasi_submit', {
      'event_category': 'lead',
      'event_label': jenis,
    });
  }

  const pesan =
    `Halo Vosi! Saya ingin jadwalkan konsultasi gratis 🙏\n\n` +
    `Nama: ${nama}\n` +
    `Bisnis: ${bisnis}\n` +
    `WA saya: ${wa}\n` +
    `Jenis bisnis: ${jenis}`;

  const url = `https://wa.me/${VOSI_WA_NUMBER}?text=${encodeURIComponent(pesan)}`;
  window.open(url, '_blank');
}
```

- [ ] **Step 4.4: Verify analytics fires**

1. Open `index.html` in browser
2. Open DevTools → Network tab → filter by "google"
3. Fill and submit the konsultasi form
4. Confirm network request to `google-analytics.com` fires on submit

- [ ] **Step 4.5: Commit**

```bash
git add vosi-landing/index.html
git commit -m "feat(vosi-landing): add GA4 analytics with konsultasi conversion event"
```

---

## Task 5: Replace social proof placeholders

**Files:**
- Modify: `vosi-landing/index.html` (social proof section)

*Complete this task once you have real beta client testimonials. Do not launch with fake names if the market can verify them.*

- [ ] **Step 5.1: Update stats**

Find the stats row in the social proof section and update with real numbers:

```html
<div class="sp-num">3+</div><div class="sp-lbl">Bisnis aktif</div>
<div class="sp-num">98%</div><div class="sp-lbl">Chat terbalas otomatis</div>
<div class="sp-num">&lt;5 dtk</div><div class="sp-lbl">Rata-rata respon</div>
```

Replace `3+`, `98%`, `<5 dtk` with actual data from your production system.

- [ ] **Step 5.2: Update testimonial cards**

Replace each of the 3 `.sp-card` blocks with real client details:
- `sp-quote`: actual quote from client (with their permission)
- `sp-name`: real first name + last initial (e.g. "Budi S.")
- `sp-biz`: business type · city

- [ ] **Step 5.3: Commit**

```bash
git add vosi-landing/index.html
git commit -m "feat(vosi-landing): update social proof with real client testimonials"
```

---

## Task 6: Pre-launch checklist

**Files:**
- Read: `vosi-landing/index.html` (final review)

- [ ] **Step 6.1: Mobile test on real device**

Open `index.html` on an Android or iOS phone via local network:

```bash
# Find your local IP
ipconfig getifaddr en0   # macOS
# Open http://192.168.x.x/vosi-landing/index.html on phone
```

Check each section:
- [ ] Nav: links hidden, logo + CTA visible
- [ ] Hero: single column, animation runs, CTA button full width
- [ ] Social proof: cards stack vertically
- [ ] Comparison: cards stack (bad chatbot → Vosi)
- [ ] Use cases: 2 columns on phone, 1 column on small phone
- [ ] Benefits: 2 columns on phone
- [ ] Timeline: stacks vertically
- [ ] Konsultasi: single column form
- [ ] FAQ: accordion opens/closes correctly
- [ ] Footer: stacks vertically

- [ ] **Step 6.2: Test all CTAs**

- [ ] Nav "Jadwalkan Konsultasi Gratis" → scrolls to `#konsultasi`
- [ ] Hero "Jadwalkan Konsultasi Gratis" → scrolls to `#konsultasi`
- [ ] Comparison "Jadwalkan Konsultasi →" → scrolls to `#konsultasi`
- [ ] Final CTA button → scrolls to `#konsultasi`
- [ ] Form submit (empty) → shows alert
- [ ] Form submit (filled) → opens `wa.me` with correct pre-filled message

- [ ] **Step 6.3: Run Lighthouse audit**

In Chrome DevTools → Lighthouse tab → check Desktop and Mobile:

Target scores:
- Performance: > 85
- SEO: > 95
- Accessibility: > 80
- Best Practices: > 90

Fix any issues flagged before deploying.

- [ ] **Step 6.4: Validate HTML**

```bash
# Install html-validate if not present
npx html-validate vosi-landing/index.html
```

Fix any errors (warnings are OK).

- [ ] **Step 6.5: Commit**

```bash
git add vosi-landing/
git commit -m "chore(vosi-landing): pre-launch review and fixes"
```

---

## Task 7: Deploy ke Firebase Hosting (Google Cloud)

**Files:**
- Create: `vosi-landing/.firebaserc`
- Create: `vosi-landing/firebase.json`

Firebase Hosting dipilih karena: bagian dari Google Cloud ecosystem, global CDN, HTTPS + custom domain otomatis, dan upgrade path bersih ke Cloud Functions/Cloud Run saat backend dibutuhkan nanti.

- [ ] **Step 7.1: Install Firebase CLI**

```bash
npm install -g firebase-tools
```

- [ ] **Step 7.2: Login ke Google Cloud**

```bash
firebase login
```

Browser akan terbuka untuk autentikasi Google account yang punya akses ke GCloud project kamu.

- [ ] **Step 7.3: Buat Firebase project**

Jika belum ada Firebase project:
```bash
firebase projects:create vosi-landing --display-name "Vosi Landing Page"
```

Atau pakai project yang sudah ada:
```bash
firebase projects:list  # lihat project yang tersedia
```

- [ ] **Step 7.4: Buat `.firebaserc`**

Create `vosi-landing/.firebaserc` (ganti `vosi-landing` dengan Firebase project ID kamu):

```json
{
  "projects": {
    "default": "vosi-landing"
  }
}
```

- [ ] **Step 7.5: Buat `firebase.json`**

Create `vosi-landing/firebase.json`:

```json
{
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      ".firebaserc",
      ".gitignore",
      "**/.*"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(jpg|jpeg|gif|png|svg|ico)",
        "headers": [{ "key": "Cache-Control", "value": "max-age=604800" }]
      },
      {
        "source": "**/*.html",
        "headers": [{ "key": "Cache-Control", "value": "max-age=300" }]
      }
    ]
  }
}
```

- [ ] **Step 7.6: Deploy preview channel**

```bash
cd vosi-landing
firebase hosting:channel:deploy preview --expires 7d
```

Output akan berikan URL preview seperti `https://vosi-landing--preview-abc123.web.app`. Buka dan ulangi checklist Step 6.2 (semua CTA, form → WA redirect, mobile).

- [ ] **Step 7.7: Verify OG image di preview URL**

Paste preview URL ke `https://metatags.io` dan pastikan OG title, description, dan image muncul dengan benar.

- [ ] **Step 7.8: Deploy ke production**

```bash
firebase deploy --only hosting
```

Output:
```
✔  Deploy complete!
Project Console: https://console.firebase.google.com/project/vosi-landing/overview
Hosting URL: https://vosi-landing.web.app
```

- [ ] **Step 7.9: Connect custom domain**

Di Firebase Console → Hosting → Add custom domain:
1. Masukkan domain kamu (e.g. `vosi.id`)
2. Ikuti instruksi verifikasi domain (tambah TXT record di DNS registrar)
3. Setelah verified, tambah A records yang diberikan Firebase ke DNS:
   ```
   A    @    151.101.1.195
   A    @    151.101.65.195
   ```
4. Tunggu propagasi DNS (5–60 menit)
5. Firebase otomatis provision SSL certificate — HTTPS aktif tanpa konfigurasi tambahan

- [ ] **Step 7.10: Update domain di meta tags dan sitemap**

Setelah domain aktif, replace placeholder domain di `vosi-landing/index.html` dan `sitemap.xml`:

```bash
# Cek semua occurrence domain placeholder
grep -n "vosi.id\|DOMAIN" vosi-landing/index.html vosi-landing/sitemap.xml
```

Ganti semua `https://vosi.id` dengan domain aktual, lalu redeploy:

```bash
firebase deploy --only hosting
```

- [ ] **Step 7.11: Commit konfigurasi**

```bash
git add vosi-landing/
git commit -m "feat(vosi-landing): deploy to Firebase Hosting on Google Cloud"
```

---

> **Upgrade path ke Cloud Run (masa depan):** Jika nanti butuh backend API (misal endpoint untuk simpan leads ke Supabase atau kirim notifikasi WA), buat Cloud Run service terpisah. Landing page tetap di Firebase Hosting — hanya `VOSI_WA_NUMBER` atau endpoint URL yang perlu diupdate di `index.html`. Tidak perlu migrate hosting.

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task |
|---|---|
| Page structure (9 sections) | Task 1 (copied from prototype, all sections present) |
| Design system | Task 1 (prototype uses correct design system) |
| WA redirect lead flow | Task 2 |
| Chat animations | Task 1 (already in prototype) |
| Social proof placeholders | Task 5 |
| FAQ content accuracy | Task 1 (already fixed in prototype) |
| Mobile responsiveness | Task 1 + Task 6 verification |
| SEO meta tags | Task 3 |
| Analytics | Task 4 |
| Deployment | Task 7 |
| WA number placeholder | Task 2 |
| OG image | Task 3 |
| Favicon | Task 3 |

**Placeholder scan:** No TBDs in plan. Task 5 explicitly notes "do not launch with fake names" — this is intentional guidance, not a gap. og-image.png creation in Task 3 requires human design work (noted explicitly).

**Type consistency:** `submitKonsultasi()`, `VOSI_WA_NUMBER`, `toggleFaq()`, `runHeroChat()`, `runVosiChat()` — all function names consistent with prototype.
