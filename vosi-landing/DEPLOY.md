# Vosi Landing Page — Deployment Guide

## Pre-launch Checklist

Complete all items before running `firebase deploy`.

### Content (required)
- [ ] **WA number** — replace `62812XXXXXXXX` and `0812-XXXX-XXXX` in `index.html` with your real Vosi WhatsApp number (E.164 format for the URL, readable format for the display text)
- [ ] **Social proof** — replace the 3 placeholder testimonials in `index.html` (search for "Budi S.", "Rina A.", "Hendra W.") with real beta client names, business types, and quotes

### Analytics
- [ ] **GA4 Measurement ID** — create a property at analytics.google.com, then replace `G-XXXXXXXXXX` (2 occurrences) in `index.html` with your real ID (format: `G-XXXXXXXXXX`)

### SEO / Social sharing
- [ ] **og-image.png** — design a 1200×630px social share image (use Figma or Canva), save it as `vosi-landing/og-image.png`. This shows up when the link is shared on WhatsApp/Twitter/LinkedIn.
- [ ] **Domain** — replace `https://vosi.id` with your actual domain in `index.html` meta tags and `sitemap.xml`

### Firebase
- [ ] **Firebase project** — create project at console.firebase.google.com, update `.firebaserc` with your actual project ID
- [ ] **Custom domain** — point your domain to Firebase Hosting (Firebase Console → Hosting → Add custom domain)

---

## Prerequisites
- Node.js installed
- Google account with access to Firebase/GCloud

## First-time setup

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```

2. Login:
   ```bash
   firebase login
   ```

3. Create Firebase project (if not done yet):
   ```bash
   firebase projects:create vosi-landing --display-name "Vosi Landing Page"
   ```
   Then update `.firebaserc` with your actual project ID.

## Before deploying

Replace these placeholders in `index.html`:
- `G-XXXXXXXXXX` → your GA4 Measurement ID (from analytics.google.com)
- `62812XXXXXXXX` → your Vosi WA number in E.164 format (e.g. 6281234567890)
- `0812-XXXX-XXXX` → same number in readable format (e.g. 0812-3456-7890)
- `https://vosi.id` → your actual domain in meta tags and sitemap.xml

## Deploy

Preview channel (test before going live):
```bash
firebase hosting:channel:deploy preview --expires 7d
```

Production:
```bash
firebase deploy --only hosting
```

## Custom domain

In Firebase Console → Hosting → Add custom domain → follow instructions.
Firebase auto-provisions SSL certificate.

## Future: Adding backend API

When you need a backend (lead capture, WA notifications), create a separate Cloud Run service.
The landing page stays on Firebase Hosting — no migration needed.
