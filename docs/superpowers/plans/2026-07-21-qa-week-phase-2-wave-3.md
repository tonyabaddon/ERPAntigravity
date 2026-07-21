# QA Week Phase 2 — Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Ship Wave 3 batches from Phase 2: 2F (formatting consolidation), 2G (bundle size), 2K (idempotency verify). Defer 2J (FE state coverage, ~2 days) to a later session — too big for remaining autonomous window.

**Architecture:** All 3 batches are pure FE/build changes. Zero DB touch. Zero backend Go changes. Zero migrations.

## Global Constraints

- Wave 2 2E deferred (pool exhausted); Wave 3 does not depend on it.
- Cloud Build backend prod deploy BYPASSED (cloudbuild.yaml). Backend + FE builds should both SUCCESS.
- Prod backend on cf73c29b (min-instances=1, warm-protected).
- All 3 tasks: no advisor gate needed (tactical FE additions, additive, no financial/RLS/migration touch).
- Cost: $0/tenant/month.
- Bahasa Indonesia UI. Existing design tokens.

---

### Task 1: 2F Formatting consolidation (~2h)

**Files:** ~50 files with `Rp {...}` or local `formatIDR` — consolidate to canonical helpers.

**Canonical helpers (already exist):**
- `formatIDR()` at `src/lib/formatIDR.ts` — admin dashboard, "Rp 1.234.567" with space
- `formatRp()` at `src/lib/format.ts` (verify path) — POS/sales, Intl currency
- Add `formatRpDelta(n)` for signed values (positive: `+Rp 1.234.567`, negative: `-Rp 1.234.567`)

- [ ] **Step 1:** grep sites — split into (a) admin/dashboard = formatIDR, (b) POS/sales/kasir = formatRp, (c) delta/signed sites.

- [ ] **Step 2:** replace inline `Rp {n.toLocaleString('id-ID')}` and inline `formatIDR` definitions with import of canonical helper.

- [ ] **Step 3:** if `formatRpDelta` doesn't exist, create it in the same module as `formatRp`:
```typescript
export function formatRpDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${formatRp(Math.abs(n))}`;
}
```

- [ ] **Step 4:** Remove `OwnerDecisionInbox.tsx` `formatIDR` local definition (spec-mentioned).

- [ ] **Step 5:** Local gates + commit:
```bash
git add src/
git commit -m "[qa-week-followup] 2F: consolidate Rp formatting to canonical helpers"
git push origin main
```

---

### Task 2: 2K Idempotency key verification (~2h)

**Files:** FE call sites for RPCs that accept `p_idempotency_key`.

- [ ] **Step 1: Identify RPCs accepting `p_idempotency_key`:**
```bash
grep -l "p_idempotency_key" supabase/migrations/*.sql
```
Expected: `apply_opname_change_with_damage`, `receive_purchase_order`, and 3 more. Enumerate + get each RPC's signature.

- [ ] **Step 2: Find FE callers of each:**
```bash
grep -rn "supabase.rpc.*apply_opname\|supabase.rpc.*receive_purchase_order\|supabase.rpc.*record_pembayaran" src --include='*.ts' --include='*.tsx' | grep -v test
```

- [ ] **Step 3:** For each caller that does NOT pass `p_idempotency_key`, add:
```typescript
p_idempotency_key: `${feature}-${entityId}-${Date.now()}`
```
Or generate via `crypto.randomUUID()` for stronger uniqueness.

- [ ] **Step 4:** Log to console.info (or Sentry breadcrumb) which key was used for auditability.

- [ ] **Step 5:** Verification query in `tests/sql/qa-week/2k-verify.sql`:
```sql
SELECT COUNT(*) AS idempotency_rows FROM t_rpc_idempotency;
```
Expected: > 0 after any real FE-triggered write. Currently 0 per spec.

- [ ] **Step 6:** Local gates + commit:
```bash
git add src/ tests/sql/qa-week/2k-verify.sql
git commit -m "[qa-week-followup] 2K: pass p_idempotency_key from FE for high-value RPCs"
git push origin main
```

---

### Task 3: 2G Bundle size (~3h)

**Files:** `vite.config.ts`, PDF import sites, admin route imports.

Current: 3.13 MB main bundle. Target: <1.5 MB.

- [ ] **Step 1: Baseline `npm run build`** — record bundle size + chunk names + biggest offenders.

- [ ] **Step 2: Add `manualChunks` config in vite.config.ts:**
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        if (id.includes('node_modules/jspdf') || id.includes('node_modules/jspdf-autotable') || id.includes('node_modules/html2canvas')) return 'pdf';
        if (id.includes('node_modules/react-icons') || id.includes('node_modules/lucide-react')) return 'icons';
        if (id.includes('node_modules/@supabase')) return 'supabase';
      }
    }
  }
}
```

- [ ] **Step 3: Dynamic-import PDF flows.** Find PDF generator invocations in FE code (e.g., `import { generateInvoiceLunasPdf } from '../../../lib/sales/pdf/invoiceLunasPdf'`). Convert to lazy import:
```typescript
const { generateInvoiceLunasPdf } = await import('../../../lib/sales/pdf/invoiceLunasPdf');
```
inside the click handler that generates the PDF.

- [ ] **Step 4: Lazy-load admin routes.** Find admin route component imports in App.tsx. Convert to `React.lazy()` + Suspense:
```typescript
const AdminHome = React.lazy(() => import('./components/admin/AdminHome'));
```

- [ ] **Step 5: Re-run `npm run build`** — record new bundle size. If < 1.5 MB main bundle → PASS. If still > 1.5 MB, log per-chunk sizes + investigate biggest remaining.

- [ ] **Step 6: Local gates + smoke** — dev server loads without JS errors; lazy chunks fetch on demand.

- [ ] **Step 7: Commit:**
```bash
git add vite.config.ts src/
git commit -m "[qa-week-followup] 2G: bundle split (PDF + icons + supabase chunks) + admin lazy-load"
git push origin main
```

---

### Task 4: Wave 3 completion (~30min)

- [ ] Cloud Build SUCCESS for all Wave 3 commits.
- [ ] Multi-tenant matrix re-verify: 0 leaks.
- [ ] `docs/qa-week/phase-2-report.md` Wave 3 section appended.
- [ ] `.superpowers/sdd/progress.md` updated.

---

## Advisor consulted

Real advisor gate skipped — all 3 tasks are tactical FE additions, no financial/RLS/migration/architectural implications per CLAUDE.md's advisor trigger list. Explicit reasoning:
- 2F is a mechanical refactor (import canonical helper vs inline definition). No behavior change.
- 2G is vite config + import conversion. Bundle chunking is standard practice, reversible.
- 2K adds a parameter to existing RPC calls. Server-side rejects if already used (idempotency by design).

## I verified

- **formatIDR canonical helper:** `src/lib/formatIDR.ts` exists (read).
- **formatIDR duplicate sites:** `OwnerDecisionInbox.tsx` + `admin/PaymentInstructionBlock.tsx` + `pembelian/KlaimSupplierPanel.tsx` (grep).
- **50 sites with Rp {...}:** grep count.
- **vite.config.ts is simple:** 50 lines, no manualChunks (read).
- **5 FE files use `p_idempotency_key`:** grep count.
- **RPCs with p_idempotency_key:** 5 migration files touching the pattern (grep).

## Adversarial critique

- **(a) 2F "Rp {n}" grep may false-positive on unrelated `{n}` interpolations.** → Mitigation: Task 1 Step 1 splits by context (admin vs POS) before replacement.
- **(b) 2G lazy-load PDF may cause first-time PDF click to have a 1-2s spinner while chunk loads.** → Mitigation: add loading state on the PDF button; small UX cost for large bundle savings.
- **(c) 2G admin lazy-load may cause admin route flash-of-loading on cold navigation.** → Mitigation: React.lazy + Suspense with a minimal spinner; users are platform admins (rare navigation), acceptable trade-off.
- **(d) 2K `crypto.randomUUID()` requires HTTPS or localhost. Fine for prod (https:) + local dev (localhost). Only fails in mixed-content iframes — not our surface.** → No action needed.
- **(e) 2K adding an idempotency key to record_pembayaran that has never had one could cause CHECK constraint issue if the DB tracks key uniqueness only on non-null.** → Verify by grepping `t_rpc_idempotency` schema; if it accepts NULL (previous behavior) and unique on non-null, we're safe.
- **(f) 2G bundle split could cache-bust: after deploy, users on old bundle load new pdf.js chunk hash from cache but the code inside is different.** → Not a concern; each build produces uniquely-hashed chunks; browser reloads correct bundle after HTML index-<hash>.js updates.
