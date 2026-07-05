# Task 4 Report — VOSI design tokens + fonts + sonner

## Environment

- **Tailwind version**: v4.1.14 via `@tailwindcss/vite` Vite plugin
- **Config style**: CSS-only `@theme {}` block in `src/index.css` — NO `tailwind.config.js`
- **Package manager**: npm (package-lock.json present)
- **sonner version installed**: `^2.0.7`

## Deliverables shipped

| # | Deliverable | Status |
|---|---|---|
| 1 | `sonner` added to dependencies | Done — `"sonner": "^2.0.7"` in package.json |
| 2 | Plus Jakarta Sans (400-800) via `<link>` in index.html | Done — kept Inter + JetBrains Mono for Garindo |
| 3 | 11 `--color-vosi-*` tokens + font/radius/shadow tokens in `@theme` | Done |
| 4 | `<Toaster position="top-right" richColors closeButton />` in main.tsx | Done |
| 5 | `src/lib/adminToast.ts` typed wrapper | Done |
| 6 | `src/lib/adminToast.test.ts` smoke tests | Done — 3/3 pass |

## Deviations from brief

**Brief step 0b** assumed Tailwind v3 with `tailwind.config.js` and `theme.extend.colors`. Brief step 0c instructed setting `font-sans` to Plus Jakarta Sans globally.

**Actual approach (v4 CSS-only):**
- Tokens registered as `--color-vosi-*` in `@theme {}` — generates `bg-vosi-navy`, `text-vosi-gold`, etc. verbatim as in brief's class name spec.
- Font: Added `--font-vosi: "Plus Jakarta Sans", system-ui, sans-serif` instead of overriding `--font-sans`. Reason: `--font-sans` is already set to Inter, and every existing Garindo screen uses `font-sans` (body class, individual components). Replacing it would change every Garindo screen's typeface, violating the "MUST render normally" regression constraint. Admin layout (Task 6+) will opt in via `font-vosi` explicitly.
- Global body `font-family` override from Step 0c was **not applied** for the same reason.

## Verification results

### TypeScript
```
npx tsc --noEmit: CLEAN (0 errors, 0 warnings)
```

### Vitest
```
Test Files: 1 failed (pre-existing) | 62 passed (63 total)
Tests:      3 failed (pre-existing) | 488 passed (491 total)
```

Pre-existing failures: `src/lib/products/productWrappers.test.ts` — 3 tests fail because mock doesn't wire `supabase.rpc` (existed before this task, unrelated to Task 4 changes).

New test file `src/lib/adminToast.test.ts`: **3/3 PASS**

### Build
```
npm run build: SUCCESS in 3.07s
✓ 2856 modules transformed
dist/assets/index-b3THnrEG.css  148.70 kB (gzip: 22.41 kB)
```
Build warnings are pre-existing (chunk size + dynamic import).

## Regression check

- `npx tsc --noEmit` clean — no type regressions.
- Build succeeds — Tailwind v4 compiled `--color-vosi-*` tokens without errors.
- Existing test suite unchanged (same 3 pre-existing failures, no new failures).
- `--font-sans` (Inter) untouched — Garindo screens maintain existing font rendering.
- No body-level CSS overrides that could shift Garindo layout.

## Files modified/created

- `index.html` — Plus Jakarta Sans `<link>` added
- `src/index.css` — 11 `--color-vosi-*` tokens + `--font-vosi` + radius/shadow tokens added to `@theme`
- `src/main.tsx` — `<Toaster />` imported and mounted
- `package.json` / `package-lock.json` — sonner added
- `src/lib/adminToast.ts` — created
- `src/lib/adminToast.test.ts` — created
- `progress.md` — updated
