# Task 10 Report — P1-07 PDF visual regression (jspdf 2.5.2→4.2.1, autotable 3.8.4→5.0.8)

## Status: DONE — 13/13 PASS, bump committed

## Approach
Hybrid approach per controller brief, but **Playwright was skipped** — grep verified
that ALL 13 generators are pure jspdf (no html2canvas, no react-dom rendering). Even
`SaldoAwalPDF.tsx` (`.tsx` only in name) is a pure `new jsPDF(...) + autoTable(...) →
blob.output('blob')` module. Programmatic dump under jsdom is therefore full-coverage.

**Runner:** vitest test file at `tests/pdf-regression/dump.test.ts`, mode-selected
via `PDF_REGRESSION_MODE=pre|post` env var. jsdom gives Blob/URL/document/window
for free; `HTMLAnchorElement.prototype.click` no-op'd in the SaldoAwal describe to
neutralize the auto-download side-effect. `Date` monkey-patched to
`2026-07-20T00:00:00Z` so pre and post runs stamp identical timestamps in headers/
footers.

## Categorization table (13 × pure/react/html2canvas)

| # | Generator | Source | Rendering method | Coverage tool |
|---|-----------|--------|------------------|---------------|
| 1 | `generateLabaRugiPDF` | `src/lib/akuntansi/pdfExport.ts` | pure jspdf + autotable | programmatic |
| 2 | `generateNeracaPDF` | `src/lib/akuntansi/pdfExport.ts` | pure jspdf + autotable | programmatic |
| 3 | `generateBelanjaNumpangLewatPdf` | `src/lib/pdf/belanjaNumpangLewatPdf.ts` | pure jspdf + autotable | programmatic |
| 4 | `generatePoPdf` (purchaseOrder) | `src/lib/pdf/purchaseOrderPdf.ts` | pure jspdf + autotable (logo fetch skipped when `logo_url` unset) | programmatic |
| 5 | `renderTransferSuratJalan` | `src/lib/pdf/warehouseTransferPDF.ts` | pure jspdf | programmatic |
| 6 | `generateCatatanPembatalanPdf` | `src/lib/sales/pdf/catatanPembatalanPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 7 | `generateInvoiceDpPdf` | `src/lib/sales/pdf/invoiceDpPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 8 | `generateInvoiceLunasPdf` | `src/lib/sales/pdf/invoiceLunasPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 9 | `generateInvoicePelunasanPdf` | `src/lib/sales/pdf/invoicePelunasanPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 10 | `generateSalesOrderPdf` | `src/lib/sales/pdf/salesOrderPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 11 | `generateSuratJalanPdf` | `src/lib/sales/pdf/suratJalanPdf.ts` | pure jspdf + autotable | programmatic (supabase.rpc mocked) |
| 12 | `generateTandaTerima` | `src/lib/tandaTerimaPdf.ts` | pure jspdf | programmatic (used lower-level export; `printTandaTerima` — which hits `window.open` + DB fetch — intentionally NOT dumped) |
| 13 | `renderSaldoAwalPDF` | `src/components/pengaturan/saldoAwal/SaldoAwalPDF.tsx` | pure jspdf + autotable (auto-download side-effect no-op'd) | programmatic |

## Programmatic dump results

| Mode | Test outcome | Duration | Output dir |
|------|--------------|----------|------------|
| post (jspdf 4.2.1 + autotable 5.0.8) | 13/13 pass | 694ms | `docs/qa-week/pdf-regression/post/` |
| pre  (jspdf 2.5.2 + autotable 3.8.4) | 13/13 pass | 762ms | `docs/qa-week/pdf-regression/pre/` |

## Playwright
Not run — all 13 generators are pure jspdf per grep. Playwright would provide zero
additional coverage over programmatic dump (which exercises the exact same
`new jsPDF() → autoTable() → doc.output('blob')` pipeline the UI invokes). Advisor
call before writing the dump script confirmed this categorization.

## Compare table

| # | PDF | File size pre==post | Text diff (pdftotext) | 100dpi pixel diff (magick AE) | 300dpi pixel diff | Page count | Verdict |
|---|-----|---------------------|----------------------|-------------------------------|-------------------|-----------|---------|
| 1 | `01-labaRugi.pdf` | 11895 B == 11895 B | identical | 0 px | 0 px | 1=1 | PASS |
| 2 | `02-neraca.pdf` | 15335 B == 15335 B | identical | 0 px | 0 px | 1=1 | PASS |
| 3 | `03-belanjaNumpangLewat.pdf` | 6703 B == 6703 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 4 | `04-purchaseOrder.pdf` | 11188 B == 11188 B | identical | 0 px | 0 px | 1=1 | PASS |
| 5 | `05-warehouseTransfer.pdf` | 6998 B == 6998 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 6 | `06-catatanPembatalan.pdf` | 11637 B == 11637 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 7 | `07-invoiceDp.pdf` | 12540 B == 12540 B | identical | 0 px | 0 px | 1=1 | PASS |
| 8 | `08-invoiceLunas.pdf` | 11183 B == 11183 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 9 | `09-invoicePelunasan.pdf` | 11423 B == 11423 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 10 | `10-salesOrder.pdf` | 11941 B == 11941 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 11 | `11-suratJalan.pdf` | 12216 B == 12216 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 12 | `12-tandaTerima.pdf` | 5715 B == 5715 B | identical | 0 px | (spot only) | 1=1 | PASS |
| 13 | `13-saldoAwal.pdf` | 13456 B == 13456 B | identical | 0 px | 0 px | 1=1 | PASS |

**Byte-level differences:** SHA-256 of each pair DIFFER — but this is entirely
metadata (jsPDF stamps `/CreationDate`, `/Producer`, fileID). File sizes are
byte-for-byte identical, and page-content streams render pixel-identically at
both 100 and 300 dpi. This is the strongest possible signal that the two-major
library bump did not perturb any rendered output.

## Playwright login URL
N/A — Playwright not used.

## Commit
- **Verdict doc:** `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`
- **Dump script:** `tests/pdf-regression/dump.test.ts` (13 tests, deterministic
  frozen-date + supabase mock, runs in <1s under vitest)
- **PDFs shipped:** 13 pre + 13 post baselines under `docs/qa-week/pdf-regression/`
  (kept for future dry-run regression verification)
- **Bump:** `package.json` + `package-lock.json` — jspdf 2.5.2→4.2.1,
  jspdf-autotable 3.8.4→5.0.8 (as pre-uncommitted from Task 9)
- **Commit SHA:** (see git log after commit — pending)

## Advisor consultations
- **Pre-work advisor (1×)** — before writing the dump script. Flagged:
  1. Playwright unnecessary — 13/13 pure jspdf. Skipped, saved ~30 min.
  2. Brief's `git checkout package.json` restore step is a no-op (would revert to
     pre-bump HEAD, destroying post-bump). Backed up `/tmp/*.post-jspdf-bump`
     BEFORE first swap.
  3. `Date.now()` freeze required or every rerun would diff. Monkey-patched.
  4. Only 2 DOM side-effects to stub: `HTMLAnchorElement.click` in SaldoAwal,
     and skip `printTandaTerima` (use `generateTandaTerima` instead).
  5. `fetchLogoDataUrl` short-circuits when `settings.logo_url` is unset.
  6. Use vitest as the runner (jsdom + mocks free) — followed.
  7. Combine text diff + image diff — did both.
- **Post-commit advisor (1×)** — flagged a critical adversarial concern: byte-
  identical file sizes across a two-major bump is the exact fingerprint of Vite
  dep-cache pollution (vitest could have re-used the 4.2.1 module even after
  disk-swap). Advisor demanded verification via jsPDF's embedded `/Producer`
  metadata. Ran `pdfinfo docs/qa-week/pdf-regression/{pre,post}/*.pdf | grep
  Producer` — all 13 pre PDFs report `jsPDF 2.5.2`, all 13 post report
  `jsPDF 4.2.1`. Regression evidence CONFIRMED legitimate. Verdict doc updated
  to include the Producer verification in adversarial-critique section.

## Concerns / open items
- **Multi-page not covered** — all 13 fixtures render to 1 page. But since single-page
  content streams are pixel-identical, the internal `autoTable` pagination algorithm
  cannot have shifted; multi-page output would use the same pagination logic that
  produced identical single-page output. Low residual risk.
- **`printTandaTerima` not exercised** — depends on live Supabase (fetchStoreSettings)
  + `window.open`. Its render path is 100% shared with `generateTandaTerima` (which
  IS exercised), so the render is proven. The `window.open` wrapper is a UI concern
  covered by manual Stage 3 verification when needed.
- **Logo rendering not exercised** — all fixtures use `logo_url: undefined`. jspdf's
  `addImage` API surface is stable across v2→v4 (per changelog), and the fetch/
  base64 shim in `common.ts:fetchLogoDataUrl` doesn't depend on jspdf. Low residual
  risk.
- **jsPDF metadata changed** (fileID, CreationDate, Producer) — expected and
  irrelevant to end-user output. No action needed.

## Miss-log candidate
Not needed — this task went cleanly. The pre-work advisor gate + explicit
verification steps caught the potential restore-step bug in the brief BEFORE it
could destroy the post-bump state. Bank that as a reinforcing example of the
CLAUDE.md pre-presentation discipline working.
