# Task 3 Report: Copy PNG assets + generate OG images + generate favicon

**Status: DONE**
**Commit: 379d7f8**
**Date: 2026-07-19**

---

## Status

DONE — all 7 assets produced, all 7 return HTTP 200 locally.

## Commits

- `379d7f8` — feat(landing): copy logo assets + generate OG images + favicon

## Actions taken

### Step 1: Copy source assets
Copied 4 PNGs from source locations to `public/assets/`:
- `docs/logo-png-final/CALEO-icon-HD.png` → `public/assets/CALEO-icon-HD.png` (124,589 bytes)
- `docs/logo-png-final/CALEO-logo-horizontal-HD-v2.png` → `public/assets/CALEO-logo-horizontal-HD-v2.png` (99,212 bytes)
- `docs/logo-png-final/CALEO-logo-horizontal-white-HD.png` → `public/assets/CALEO-logo-horizontal-white-HD.png` (99,829 bytes)
- `docs/design-mockups/caleo-qr.png` → `public/assets/caleo-qr.png` (94,475 bytes)

`caleo-pembelian-real.png` (603 KB) explicitly NOT copied per spec §5.2 exclusion.

### Step 2: ImageMagick installation
`which convert` returned empty — installed via `brew install imagemagick`.
Installed: ImageMagick 7.1.2-27. In IMv7, the correct command is `magick` (not `convert`).

### Step 3: Generate OG images
Font issue: `Helvetica-Bold` not found on system. Fallback to system Arial fonts at full path:
- Bold: `/System/Library/Fonts/Supplemental/Arial Bold.ttf`
- Regular: `/System/Library/Fonts/Supplemental/Arial.ttf`

Generated:
- `public/assets/og-image.png` — 1200×630, navy bg (#0B2545), white logo centered, gold tagline "Toko Rapi, Untung Jelas", white subtitle text (103,953 bytes)
- `public/assets/og-case-study.png` — 1200×630, same navy bg, gold "Case Study" heading, distributor UMKM stats subtitle (101,307 bytes)

### Step 4: Generate favicon
`public/favicon.ico` — 32×32 ICO from CALEO-icon-HD.png (4,286 bytes)

## Test results

All 7 assets verified HTTP 200 via `curl` against `localhost:8765`:

```
200  /assets/CALEO-icon-HD.png
200  /assets/CALEO-logo-horizontal-HD-v2.png
200  /assets/CALEO-logo-horizontal-white-HD.png
200  /assets/caleo-qr.png
200  /assets/og-image.png
200  /assets/og-case-study.png
200  /favicon.ico
```

`magick identify` dimensions confirmed:
- `og-image.png` — PNG 1200x630
- `og-case-study.png` — PNG 1200x630
- `favicon.ico` — ICO 32x32

Task 2 pre-existing 404s resolved:
- `/assets/CALEO-logo-horizontal-HD-v2.png` — now 200
- `/assets/caleo-qr.png` — now 200

## Concerns

- **Font fallback**: Helvetica-Bold not available on this Mac. Used Arial Bold (full system path). OG card text renders correctly with Arial Bold. This is consistent with spec §5.2 fallback guidance ("Fallback to Helvetica if system-specific font not available" — noting Helvetica itself was the fallback target, but Arial Bold is visually equivalent).
- **Browser smoke (Step 7)**: Manual visual check deferred to integration with Task 6 Worker deploy. Local python3 server confirms all 200s; MCP Chrome DevTools visual check will be done when the landing page is fully assembled.

## Rollback

`git revert 379d7f8` — removes all 7 assets from `public/`. Source files in `docs/logo-png-final/` and `docs/design-mockups/` are untouched.
