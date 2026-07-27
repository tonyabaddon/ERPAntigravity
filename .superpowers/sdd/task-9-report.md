# Task 9 Report: KasirExpenseCategoriesPanel

## Status: DONE

Date: 2026-07-27

Commit: `304d24b` — feat(pengaturan): KasirExpenseCategoriesPanel with drag, CRUD, optimistic UX

---

## TDD Evidence

### RED (Step 2)
```
FAIL  src/components/pengaturan/KasirExpenseCategoriesPanel.test.tsx
Error: Failed to resolve import "./KasirExpenseCategoriesPanel"
  — module missing, as expected
```

### GREEN (Step 4)
```
Test Files  1 passed (1)
     Tests  7 passed (7)
  Duration  1.30s
```

---

## Test Results: 7/7 PASS

1. renders rows from hook ✓
2. shows loading state ✓
3. shows error state with retry ✓
4. click "Tambah kategori" opens inline input, Enter creates ✓
5. duplicate error surfaces inline toast ✓
6. delete triggers softDelete + undo toast ✓
7. read-only mode disables interactive elements ✓

---

## Lint + Audit Gates

- `npm run lint` (tsc --noEmit): **PASS** — one fix required: explicit `KasirExpenseCategoryRow[]` annotation on `rows` so `arrayMove` generic resolves correctly.
- `npm run audit:no-string-err-fallback`: **PASS** — one fix required: comment in `friendlyError` contained `: String(err)` text which the regex scanner flagged. Reworded comment to avoid the pattern while preserving intent.
- `npm run audit:numinput`: **PASS**
- `npm run audit:secdef-null-tenant`: **PASS**

---

## Files Changed

- `src/components/pengaturan/KasirExpenseCategoriesPanel.tsx` (created, 213 lines)
- `src/components/pengaturan/KasirExpenseCategoriesPanel.test.tsx` (created, 120 lines)

---

## Self-Review Findings

No issues found in the diff. The panel:
- Wires all 5 service operations (create, update, softDelete, restore stub, reorder)
- Uses `extractErrorMessage` + `friendlyError` to map KECT_* codes to Bahasa Indonesia
- Uses `captureError` at every catch block for Sentry observability
- Handles loading / error / empty / populated / read-only states
- Drag reorder: optimistic local state + server sync + rollback on error

---

## Brief Deviations (Adapt-and-Document)

### Deviation 1: `tenant_id` vs `tenantId` in TenantContext

**Brief code used:** `const { tenantId } = useTenant()`
**Real shape:** `TenantContextValue.tenant_id` (snake_case, per `src/contexts/TenantContext.tsx`)

**Fix applied:** Panel uses `const tenant = useTenant(); const tenantId = tenant?.tenant_id;`
**Test mock updated:** `useTenant: () => ({ tenant_id: 't1' })` (matching real shape)
**Risk:** None — the `tenantId` value is only used for React Query `invalidateQueries` key. Mismatch would cause stale cache on owner actions, not a crash.

### Deviation 2: `handleAddSubmit` passes explicit `undefined` as second arg

**Brief code:** `await kasirExpenseCategoryService.create(trimmed)`
**Panel code:** `await kasirExpenseCategoryService.create(trimmed, undefined)`

This makes the test assertion `expect(mockSvc.create).toHaveBeenCalledWith('Sewa', undefined)` pass correctly. The service signature is `create(label: string, insertAfterId?: string)` so explicit `undefined` is equivalent.

### Deviation 3: Comment in `friendlyError` reworded

The brief's comment included the literal text `: String(err)` which the `audit:no-string-err-fallback` regex matched as a violation (pattern `/:\s*String\((err|e|error)\)/`). Reworded to describe the intent without the banned pattern text.

### Deviation 4: `rows` explicit type annotation

Added `: KasirExpenseCategoryRow[]` to the `rows` variable declaration so TypeScript resolves the `arrayMove` generic correctly (without it, `arrayMove` inferred `unknown[]` from the union with `never[]` fallback, causing TS2339 on `.id`).

---

## Prior Task 9 Report (jspdf upgrade) — archived below

Command: `grep -rln "jspdf\|jsPDF" src/ --include='*.ts' --include='*.tsx' | grep -v test`

Result: **13 files** (brief expected 12 — one additional file discovered):

1. `src/components/pengaturan/saldoAwal/SaldoAwalPDF.tsx`
2. `src/lib/tandaTerimaPdf.ts`
3. `src/lib/sales/pdf/invoiceDpPdf.ts`
4. `src/lib/sales/pdf/catatanPembatalanPdf.ts`
5. `src/lib/sales/pdf/suratJalanPdf.ts`
6. `src/lib/sales/pdf/salesOrderPdf.ts`
7. `src/lib/pdf/warehouseTransferPDF.ts`
8. `src/lib/sales/pdf/invoicePelunasanPdf.ts`
9. `src/lib/sales/pdf/common.ts` (shared helper)
10. `src/lib/akuntansi/pdfExport.ts`
11. `src/lib/sales/pdf/invoiceLunasPdf.ts`
12. `src/lib/pdf/purchaseOrderPdf.ts`
13. `src/lib/pdf/belanjaNumpangLewatPdf.ts`

Note: Brief expected 12 files. Actual count is 13. The extra file is `src/lib/pdf/belanjaNumpangLewatPdf.ts` — BNL PDF generator, consistent with Phase 2 feature additions.

---

## Step 2: Backup

Backed up to:
- `/tmp/package.json.pre-jspdf-bump`
- `/tmp/package-lock.json.pre-jspdf-bump`

---

## Step 3: npm audit fix --force — Versions Before/After

### Before

```
react-example@0.0.0
├─┬ jspdf-autotable@3.8.4
│ └── jspdf@2.5.2 deduped
└─┬ jspdf@2.5.2
  └── dompurify@2.5.9
```

### Command output

```
npm warn using --force Recommended protections disabled.
npm warn audit Updating jspdf to 4.2.1, which is a SemVer major change.
npm warn audit Updating jspdf-autotable to 5.0.8, which is a SemVer major change.

added 5 packages, removed 3 packages, changed 7 packages, and audited 406 packages in 5s

57 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

### After (verified via `npm ls`)

```
react-example@0.0.0
├─┬ jspdf-autotable@5.0.8
│ └── jspdf@4.2.1 deduped
└─┬ jspdf@4.2.1
  └── dompurify@3.4.12
```

**Summary of version changes:**
| Package | Before | After |
|---------|--------|-------|
| jspdf | 2.5.2 | 4.2.1 |
| jspdf-autotable | 3.8.4 | 5.0.8 |
| dompurify | 2.5.9 | 3.4.12 |

jspdf-autotable was also bumped (3.x → 5.x, a two-major jump) — this is expected since jspdf-autotable must match the jspdf peer dependency. dompurify was bumped as a transitive dep of jspdf.

---

## Step 4: npm install

```
up to date, audited 406 packages in 627ms
57 packages are looking for funding
found 0 vulnerabilities
```

Lock file is clean — no additional packages changed.

---

## Step 5: Lint Result

**PASS — zero TypeScript errors**

Command: `npm run lint` (→ `tsc --noEmit`)

Output: clean (no output, exit 0)

### jspdf 4.x TypeScript API changes discovered

**None.** The TypeScript definitions in jspdf 4.x appear to be backward-compatible with the usage patterns in all 13 PDF generator files. No method renames, removed APIs, or signature changes were flagged by the compiler. `jspdf-autotable` 5.x also compiles cleanly.

---

## Step 6: Vitest Result

**PASS — 971 tests pass, 0 failures, 2 skipped (pre-existing)**

Command: `npx vitest run src`

```
Test Files  112 passed (112)
     Tests  971 passed | 2 skipped (973)
  Start at  14:48:36
  Duration  13.05s (transform 5.28s, setup 5.59s, import 12.63s, tests 16.01s, environment 66.45s)
```

### New failures caused by jspdf upgrade

**None.** Zero test failures. The 2 skipped tests are pre-existing (from prior sessions — not caused by this upgrade).

### PDF-related test baseline

The vitest suite does not directly test PDF rendering output (visual regression is out-of-scope for unit tests — handled by Task 10). All import-level and type-level checks for the 13 PDF generator files passed implicitly via the TypeScript compilation in Step 5.

---

## jspdf API Changes Discovered

**No API breakage detected.** All 13 PDF generator files compiled cleanly (tsc --noEmit) and all 971 tests passed. This indicates jspdf 4.x maintained backward compatibility for the API surface used in this codebase.

Key observations:
- `jsPDF` constructor usage unchanged
- `autoTable` integration (jspdf-autotable 5.x) compiles cleanly
- Common helper patterns in `src/lib/sales/pdf/common.ts` (font loading, page setup, drawing helpers) are compatible
- No deprecated method warnings surfaced at compile time

---

## Uncommitted Files (git status)

Modified (relevant to this task):
- `package.json` — jspdf/jspdf-autotable version entries updated
- `package-lock.json` — full dependency tree updated

Modified (pre-existing, unrelated to this task):
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-2-report.md`
- `.superpowers/sdd/task-3-report.md`
- `.superpowers/sdd/task-5-report.md`

Untracked files (pre-existing, unrelated):
- `.claude/scheduled_tasks.lock`
- `Marketing/`, `docs/`, `pitch-deck-highlights*`, `test-results/`, `tests/e2e/`

**No commit made.** Per task brief, Task 10 handles commit after visual PDF regression validation.

---

## Concerns / Open Items for Task 10

1. **jspdf-autotable also jumped two major versions (3.x → 5.x):** The npm audit fix --force bumped it as part of the dependency resolution. Task 10 must visually validate autotable-rendered PDFs (purchase orders, invoices with line-item tables) to confirm the table rendering is still correct.

2. **dompurify 3.x (transitive):** bumped from 2.5.9 → 3.4.12. This is an internal jspdf dependency for sanitizing HTML content. No direct usage in our codebase, but worth noting if any HTML-mode PDF rendering is used.

3. **13 files not 12:** Task 10 should visually validate all 13 PDF generators, not just 12. The extra file is `belanjaNumpangLewatPdf.ts`.

4. **No API breakage found BUT:** compile-time clean does not guarantee identical runtime behavior. jspdf 4.x may have changed font metrics, line-height defaults, table column width algorithms, or page margin calculations that are only visible in the rendered PDF. This is precisely why Task 10 visual regression exists.

5. **Zero vulnerabilities:** The audit fix resolved all known security vulnerabilities. `found 0 vulnerabilities` confirmed post-fix.

---

## Files Changed by This Task

- `package.json` — jspdf 2.5.2 → 4.2.1, jspdf-autotable 3.8.4 → 5.0.8 (and dompurify transitive)
- `package-lock.json` — full lockfile regenerated for new dependency tree
- `.superpowers/sdd/task-9-report.md` — this report

No source files in `src/` were modified. TypeScript compiled cleanly without any code changes.
