# PENDING FIX P1-07 — DOMPurify CVE via jspdf upgrade

**Origin:** `docs/qa-week/2026-07-19-session3-findings.md` P1-07.
**Author:** QA Session 4 (plan, not applied).
**Reviewer:** founder.

---

## The vulnerability

`dompurify <= 3.4.10` has 14 CVEs (XSS via multiple mechanisms, prototype pollution, FORBID_TAGS bypass, IN_PLACE sanitization bypass, cross-realm bypass, shadow root bypass).

We depend on it transitively:
- `jspdf@^2.5.2` → depends on vulnerable dompurify
- `jspdf-autotable@^3.8.4` → depends on vulnerable jspdf

## Exploitability

**Low in prod.** PDFs are generated client-side and downloaded. Most PDF viewers don't execute JavaScript. Attack requires: (1) tenant inserts XSS payload in a text field that gets rendered in PDF, (2) another user views PDF in a JS-enabled viewer. Realistic threat: near-zero on desktop; possibly non-zero on mobile in-browser PDF viewers.

But: fix is available. CVE surface reduction = good hygiene regardless.

## The fix

```bash
npm audit fix --force
```

Per npm audit output, this bumps `jspdf` to `4.2.1` — a MAJOR version bump. Breaking changes likely.

### jspdf 2.x → 4.x breaking-change candidates

- API shape changes (constructor options, method signatures)
- Font loading behavior may differ
- Text rendering + auto-wrapping may differ pixel-perfect
- autoTable plugin compatibility (jspdf-autotable versioning must align)

Full changelog: https://github.com/parallax/jsPDF/releases

## Impacted PDF generators (8+)

All must be regression-tested after upgrade:

1. `src/lib/pdf/warehouseTransferPDF.ts` — warehouse transfer receipt A5
2. `src/lib/pdf/belanjaNumpangLewatPdf.ts` — BNL A6
3. `src/lib/pdf/purchaseOrderPdf.ts` — Purchase Order
4. `src/lib/sales/pdf/suratJalanPdf.ts` — Surat Jalan (delivery note) A4
5. `src/lib/sales/pdf/invoiceDpPdf.ts` — DP invoice
6. `src/lib/sales/pdf/invoiceLunasPdf.ts` — Paid invoice
7. `src/lib/sales/pdf/invoicePelunasanPdf.ts` — Settlement invoice
8. `src/lib/sales/pdf/catatanPembatalanPdf.ts` — Cancellation note
9. `src/lib/tandaTerimaPdf.ts` — Receipt of receiving
10. `src/lib/akuntansi/pdfExport.ts` — Accounting export
11. `src/components/penjualan/SalesInvoicePDF.tsx` — React sales invoice PDF component
12. `src/components/pengaturan/saldoAwal/SaldoAwalPDF.tsx` — Opening balance PDF

## Rollout plan

### Step 1 — Local dev

```bash
# On a feature branch
npm audit fix --force
git diff package.json package-lock.json  # verify jspdf → 4.2.1
npm install
npm run lint  # check for TS errors from API changes
npx vitest run src/lib/sales/pdf/  # PDF tests exist here — must pass
npx vitest run src/  # full suite
```

### Step 2 — Local visual smoke

Run `npm run dev`, then generate each PDF via chrome-devtools MCP:
- Login as test tenant
- Trigger each of 12 PDF generators via the UI
- Save each PDF locally
- Compare with pre-upgrade version (git stash / branch swap for old bundle)
- Check: layout not broken, text present, IDR format intact, tables render, page breaks correct

### Step 3 — Staging deploy

Push to staging Cloud Run. Repeat Step 2 via `staging.caleo.id`.

### Step 4 — Production deploy

Standard Ship & verify staged flow per CLAUDE.md:
- Stage 1: lint + audit + vitest --changed clean
- Stage 2: `git push main` → verify `gcloud builds list --limit=2` STATUS != FAILURE
- Stage 3: chrome-devtools MCP smoke on `Toko Jaya Makmur` — generate 3 different PDFs, verify

## Rollback plan

If any PDF breaks after upgrade:
```bash
# Revert package.json
git revert HEAD  # if upgrade is a single commit
# OR pin back
npm install jspdf@2.5.2 jspdf-autotable@3.8.4
```

Then investigate the specific PDF file for API adaptation needed.

## Alternative approach considered

**Manual dompurify override via package.json `overrides`:**
```json
{
  "overrides": {
    "dompurify": "3.4.11-secure-fork"  // hypothetical
  }
}
```
Rejected: no maintained secure fork of dompurify exists at expected minor. Wait for upstream to publish a patched 3.x if we want to avoid jspdf major bump. **Recommended: bite the bullet on major bump — cleaner long-term.**

## Advisor gate

- Diff spans package.json + package-lock.json + potentially FE code adaptations → advisor per CLAUDE.md diff-size rule
- Not a database change, not a RLS change → normal advisor
- Regression risk: HIGH on PDF layout. Extensive manual test required
- Cost impact: none (npm free)
