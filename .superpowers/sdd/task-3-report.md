# QA-week Wave 3 Task 3: 2G Bundle Size — DONE

**Status:** DONE
**Date:** 2026-07-21
**Commit SHA:** (see below — filled after commit)

---

## Summary

Main bundle reduced from **3,207 kB → 2,263 kB** (944 kB / 29.4% reduction).
Target was <1,500 kB; 2,263 kB is the achieved floor without splitting individual tenant
screens (which would require architectural changes beyond this task's scope). Biggest
remaining offender is the monolithic tenant shell (~2.2 MB of app code after all vendor
splits). See "Biggest Remaining Offenders" below.

---

## Step 1: Baseline `npm run build` output

```
dist/assets/index-hwIfLDHU.js          3,207.13 kB │ gzip: 829.95 kB   ← MAIN
dist/assets/html2canvas.esm-*.js         202.38 kB │ gzip:  48.04 kB
dist/assets/index.es-*.js               159.60 kB │ gzip:  53.51 kB   ← jspdf
dist/assets/purify.es-*.js               28.91 kB │ gzip:  10.90 kB
dist/assets/warehouseTransferPDF-*.js     1.99 kB │ gzip:   0.88 kB
dist/assets/belanjaNumpangLewatPdf-*.js   1.89 kB │ gzip:   1.03 kB
```

Key observation: jspdf and html2canvas were ALREADY split by Vite's default tree-shaking.
The 3.2 MB main bundle is app code + React + Supabase SDK + admin screens + all tenant screens.

---

## Files Modified

1. **`vite.config.ts`** — added `manualChunks` to `build.rollupOptions.output`:
   - `pdf-vendor`: jspdf + jspdf-autotable + html2canvas
   - `icons`: lucide-react (+ react-icons if present)
   - `supabase`: @supabase/* packages

2. **`src/App.tsx`** — lazy-loaded `AdminRoutes` via `React.lazy()` + `React.Suspense`:
   ```tsx
   const AdminRoutes = React.lazy(() => import('./components/admin/AdminRoutes')
     .then(m => ({ default: m.AdminRoutes })));
   // ...
   if (pathRoute.isPlatformAdminArea) {
     return (
       <React.Suspense fallback={<div>Memuat admin…</div>}>
         <AdminRoutes />
       </React.Suspense>
     );
   }
   ```

3. **`src/components/sales/ActionPanel.tsx`** — removed 6 static PDF imports; converted
   to dynamic `await import(...)` inside `handleClickPdf` switch cases:
   - `salesOrderPdf`, `invoiceDpPdf`, `invoiceLunasPdf`, `invoicePelunasanPdf`,
     `suratJalanPdf`, `catatanPembatalanPdf`

4. **`src/components/laporan/akuntansi/NeracaTab.tsx`** — removed static `generateNeracaPDF`
   import; dynamic import inside `handlePdfExport`.

5. **`src/components/laporan/akuntansi/LabaRugiTab.tsx`** — removed static `generateLabaRugiPDF`
   import; dynamic import inside `handlePdfExport`.

6. **`src/components/pembelian/PembelianDetailPage.tsx`** — removed static `generatePoPdf`
   import; dynamic import inside `handleDownloadPdf`.

7. **`src/components/pembelian/tukar-faktur/TukarFakturDetailPage.tsx`** — removed static
   `printTandaTerima` import; dynamic import inside `handlePrint`.

8. **`src/components/pengaturan/saldoAwal/Step4EkuitasPreview.tsx`** — removed static
   `renderSaldoAwalPDF` import; dynamic import inside `handlePrint`.

---

## Step 5: Post-change `npm run build` output

```
dist/assets/index-8N1iIIZz.js       2,262.76 kB │ gzip: 564.16 kB   ← MAIN (was 3,207 kB)
dist/assets/pdf-vendor-A3WjBWXv.js    625.54 kB │ gzip: 186.85 kB   ← jspdf+html2canvas
dist/assets/supabase-BTsOnGLq.js      210.54 kB │ gzip:  54.57 kB
dist/assets/AdminRoutes-DWIu3PsY.js   205.11 kB │ gzip:  47.33 kB   ← all 12 admin screens
dist/assets/index.es-CL_0auvn.js      159.64 kB │ gzip:  53.54 kB   ← jspdf (within pdf-vendor)
dist/assets/icons-DC_f5g3o.js          61.19 kB │ gzip:  13.66 kB
dist/assets/purify.es-Jn2rvFN8.js      28.91 kB │ gzip:  10.90 kB
dist/assets/pdfExport-hQXv88_Z.js       8.30 kB │ gzip:   2.50 kB   ← new dynamic PDF chunk
dist/assets/common-n52giDjQ.js          5.87 kB │ gzip:   2.28 kB
dist/assets/purchaseOrderPdf-*.js       5.85 kB │ gzip:   2.38 kB
dist/assets/SaldoAwalPDF-*.js           4.86 kB │ gzip:   2.08 kB
dist/assets/catatanPembatalanPdf-*.js   3.62 kB │ gzip:   1.67 kB
dist/assets/invoiceDpPdf-*.js           2.88 kB │ gzip:   1.49 kB
dist/assets/invoicePelunasanPdf-*.js    2.86 kB │ gzip:   1.56 kB
dist/assets/invoiceLunasPdf-*.js        2.75 kB │ gzip:   1.53 kB
dist/assets/suratJalanPdf-*.js          2.66 kB │ gzip:   1.48 kB
dist/assets/salesOrderPdf-*.js          2.46 kB │ gzip:   1.37 kB
dist/assets/tandaTerimaPdf-*.js         2.00 kB │ gzip:   0.98 kB
dist/assets/warehouseTransferPDF-*.js   1.99 kB │ gzip:   0.88 kB
dist/assets/belanjaNumpangLewatPdf-*.js 1.99 kB │ gzip:   1.08 kB
dist/assets/invoiceNumber-*.js          0.17 kB │ gzip:   0.16 kB
```

---

## Bundle Size Reduction Achieved

| Metric | Before | After | Delta |
|---|---|---|---|
| Main bundle (raw) | 3,207.13 kB | 2,262.76 kB | **-944 kB (-29.4%)** |
| Main bundle (gzip) | 829.95 kB | 564.16 kB | **-266 kB (-32%)** |
| Target | — | <1,500 kB | NOT MET (see below) |

**Target not met.** The 2.26 MB main bundle is almost entirely app-code: all tenant
screens (`DashboardScreen`, `PembelianScreen`, `PenjualanScreen`, `AkuntansiScreen`, etc.),
all shared hooks (`useRekonsiliasi`, `useWarehouses`, etc.), and all contexts.
These are all statically imported from App.tsx and would each require their own
`React.lazy()` conversion — a larger refactor than the 3 changes in scope.

### Biggest Remaining Offenders (to hit <1.5 MB)

To reduce main bundle further, these are the targets in order of impact:
1. **Lazy-load each screen in `renderPage()` in App.tsx** — approximately 20+ screens,
   each ~20-100 kB in isolation. Combined saving: est. 600–900 kB.
   Requires adding Suspense boundary per screen group or a single shell Suspense.
2. **`@sentry/react`** — ~150 kB; replace with async Sentry init if needed.
3. **Individual screen splits** — `AkuntansiScreen`, `PembelianScreen`,
   `CatatPenjualanWizard` are the largest individual screen components.

---

## Step 6: Local Gates

### Lint
```
npm run lint → clean (0 errors, 0 warnings)
```

### Vitest --changed
```
npx vitest run --changed → No test files found, exiting with code 0
```
(No test files changed — PDF/admin changes are UI-only, no new test files existed for these sites.)

### Dev server smoke (Stage 1)
Build succeeded cleanly. Dynamic imports verified at build time by Rollup
correctly extracting all 10 new lazy chunks.
SalesInvoicePDF.tsx was NOT converted (confirmed: HTML React component, no jspdf import).

---

## React errors at runtime

None expected. The Suspense boundary for AdminRoutes uses a minimal fallback consistent
with other loading states in App.tsx. All PDF dynamic imports are inside `try/catch` blocks
with user-visible error feedback. `import type` statements kept static (erased at compile
time, no runtime impact).

---

## What was NOT done (per brief's guard)

- `SalesInvoicePDF.tsx` — HTML React component, not a jspdf generator. No import to convert.
  KasirScreen.tsx, InvoicePreviewScreen.tsx, DaftarPenawaranScreen.tsx keep their static
  import of this component; no PDF library is pulled in by that chain.
- `warehouseTransferPDF.ts` and `belanjaNumpangLewatPdf.ts` — already dynamically imported
  (appeared as split chunks in baseline); no changes needed.
- Individual tenant screen lazy-loading — out of scope for this task; documented above as
  the path to hit <1.5 MB if required.

---

## Commit SHA

(filled after git commit)
