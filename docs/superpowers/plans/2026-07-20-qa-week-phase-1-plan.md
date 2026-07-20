# QA Week Phase 1 Implementation Plan — Coordinated Architectural Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 coordinated architectural fixes (F5-05 Option A tenant-aware customer ID, P2-03 composite PK on audit_log + pembayaran, P1-07 jspdf 4.x CVE upgrade) with full impact analysis + regression tests + observability + Ship & verify per CLAUDE.md.

**Architecture:**
- **F5-05:** rewrite `GetOrCreateCustomer` (backend Go) → accept explicit `tenantID`, use `gen_random_uuid()`, `ON CONFLICT (tenant_id, wa_number) DO UPDATE`. Migration swaps unique constraint to composite `(tenant_id, wa_number)`.
- **P2-03:** migration replaces `audit_log_pkey (id)` + `pembayaran_pkey (id)` with composite `(tenant_id, id)`. **CRITICAL:** pembayaran has FK from pembayaran_items → must DROP FK first, add composite PK, re-add FK as composite `(tenant_id, pembayaran_id)`.
- **P1-07:** `npm audit fix --force` → jspdf@4.2.1 (breaking bump). Manual visual regression on 12 PDF generators.

**Tech Stack:** Go 1.25 (backend), TypeScript/React (FE), Postgres 15 (Supabase), psql for migrations, Cloud Build for deploy, chrome-devtools MCP for Stage 3 smoke.

**Time estimate:** 6-9h total execution + ~1h founder Stage 3 verify time.

## Global Constraints

- All migrations idempotent (`DROP IF EXISTS`, `CREATE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`) per CLAUDE.md.
- Every non-trivial change: **impact analysis + regression test + observability preservation + Ship & Verify Stage 1-3**.
- `$0/tenant/month` cost impact. HALT if change surfaces cost per memory `cost_upgrade_approval`.
- Migrations claim slots **501-502** per spec migration slot allocation table.
- All commits tagged `[qa-week-followup]` for later audit.
- After each schema/RLS/SECDEF change → re-run 3-tenant matrix (Garindo × Toko Jaya × Warung) from Task 12.
- SECDEF changes → **advisor()** call before commit.
- Stage 3 smoke target: **Toko Jaya Makmur** (prod-testing tenant per memory `production-testing-tenant`).
- **After psql-direct apply of any migration:** INSERT into `supabase_migrations.schema_migrations` so fresh DB bootstrap doesn't re-run.

---

## Advisor consulted

Consulted advisor twice during Phase 1 planning:
1. **2026-07-20 (spec review):** Advisor caught 3 revisions to my original 9 recommendations — reclassified F5-05 to P1 (not P0), warned about npm overrides not being feasible without verifying dompurify v2 vs v3 API break, pushed back on "full refactor" bias for P2-04. Advisor's guidance is why F5-05 memo included impact grep + why P1-07 recommendation is "bump OR accept CVE" not "just bump".
2. **2026-07-20 (plan gap review):** Founder asked "cek lagi tidak ada yang miss" → surfaced 10 gaps. Fact-check invalidated 3 gaps (test mocks = zero, PDF count = 12 not 13, html2canvas = transitive). Kept 7 gaps as real. Gap 5 (pembayaran FK) was CRITICAL and would have failed migration if unaddressed.

Both advisor calls documented in this session's git log. Plan reflects advisor guidance throughout.

## I verified

Concrete evidence for every claim in this plan (fresh checks 2026-07-20):

- **F5-05 backend impact:** `grep -rn "GetOrCreateCustomer" backend-go/` = 4 refs (customers.go:8 def + handler.go:176,431,463 callers). No test mocks (`grep + _test.go` = 0).
- **F5-05 gjp_cust_seq refs:** `grep -rn "gjp_cust_seq" backend-go/ src/ supabase/migrations/` = 2 refs (customers.go:13 usage + 20260601000001 schema definition). No FE refs. Safe to deprecate.
- **F5-05 FE breakage:** `grep -rn "GJP-CUST" src/` = 0 refs. FE doesn't assume any ID format.
- **F5-05 data safety:** `SELECT COUNT(*) FROM (SELECT tenant_id, wa_number, COUNT(*) FROM customers GROUP BY 1,2 HAVING COUNT(*) > 1)` = 0. Existing data satisfies new constraint.
- **P2-03 audit_log FKs:** `SELECT conrelid FROM pg_constraint WHERE contype='f' AND confrelid='audit_log'::regclass` = 0. audit_log is leaf. Migration safe as simple DROP + ADD.
- **P2-03 pembayaran FKs:** `SELECT conrelid FROM pg_constraint WHERE contype='f' AND confrelid='pembayaran'::regclass` = 1 (`pembayaran_items_pembayaran_id_fkey`). **Migration must DROP FK first** (tested: naked DROP PK fails with "cannot drop because other objects depend on it").
- **P2-03 pembayaran_items schema:** `pembayaran_items` has `tenant_id` column → composite FK `(tenant_id, pembayaran_id)` viable.
- **P2-03 data consistency:** `SELECT COUNT(*) FROM pembayaran_items pi LEFT JOIN pembayaran p ON p.id=pi.pembayaran_id WHERE pi.tenant_id IS DISTINCT FROM p.tenant_id` = 0. Safe to migrate to composite FK.
- **P2-03 row counts:** audit_log 292 rows, pembayaran 0 rows → migration seconds.
- **P1-07 npm overrides:** `npm view jspdf@2.5.2 dependencies` + `npm ls dompurify` = jspdf 2.x uses dompurify **v2.5.9**. Forcing v3.x would break jspdf (v2→v3 API-breaking). Only path = jspdf 4.x major bump.
- **P1-07 PDF generator count:** `grep -rln "jspdf\|jsPDF" src/` = 13 files (12 generators + 1 shared common.ts). SalesInvoicePDF.tsx does NOT use jsPDF (browser print API). SaldoAwalPDF.tsx uses jsPDF (confirmed).
- **P1-07 dompurify installed version:** `cat node_modules/dompurify/package.json` = 2.5.9. Fixable via jspdf 4.x bump.

## Adversarial critique

Asked myself "what could invalidate this plan?" and handled:

- **"What if handler.go conv.TenantID doesn't exist?"** — Task 3 Step 1 explicitly verifies. Fallback SQL provided if missing.
- **"What if pembayaran FK cascade breaks pembayaran_items during migration?"** — Verified via test migration in sub-transaction. Migration order handles: DROP FK → DROP PK → ADD composite PK → RE-ADD composite FK. Data pre-checked for consistency.
- **"What if npm audit fix --force cascades to other broken deps?"** — Task 8 does full `npm install` + `npm run lint` + `npx vitest run src` before commit. Any transitive break caught.
- **"What if jspdf 4.x has different Text API breaking existing calls?"** — Task 9 visual regression on all 12 PDFs catches. Rollback plan (Step 6) if any fail.
- **"What if Cloud Build deploys backend BEFORE migration applied?"** — Task ordering: Task 5 applies migration before Task 6 pushes backend. Explicitly documented.
- **"What if `_backfill_preview_je` non-RLS table has hidden FK to audit_log/pembayaran?"** — Verified via `pg_constraint` query. Zero FK to audit_log; only pembayaran_items → pembayaran.
- **"What if founder cancels P1-07 mid-way?"** — Task 8 backup step allows revert. Task 9 has explicit rollback command.
- **"What if schema_migrations table gets out of sync?"** — Each psql-direct apply followed by explicit INSERT into schema_migrations (new step added).

---

## Files

**Created:**
- `supabase/migrations/20261115000501_uq_customers_wa_tenant.sql` — F5-05 schema swap
- `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql` — P2-03 composite PK + FK re-add
- `tests/sql/qa-week/f5-05-regression.sql` — F5-05 cross-tenant regression
- `tests/sql/qa-week/p2-03-regression.sql` — P2-03 PK + FK migration regression
- `docs/qa-week/phase-1-report.md` — phase completion report
- `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md` — P1-07 visual regression log

**Modified:**
- `backend-go/internal/db/customers.go:8-26` — F5-05 GetOrCreateCustomer signature + body
- `backend-go/internal/models/customer.go` — add TenantID field if missing
- `backend-go/internal/whatsapp/handler.go:176, 431, 463` — F5-05 pass tenant_id to callers
- `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` — friendly error mapping for uq_customers_wa_tenant violation
- `package.json` + `package-lock.json` — P1-07 jspdf 2.5.2 → 4.2.1
- `progress.md` — session ledger

---

## Task 1: F5-05 impact analysis + prep (~20 min)

**Files:**
- Read: `backend-go/internal/db/customers.go`, `backend-go/internal/whatsapp/handler.go`, `backend-go/internal/models/customer.go`
- Create: `docs/qa-week/phase-1-report.md`

**Interfaces:**
- Consumes: existing `Client.GetOrCreateCustomer(waNumber string) (*models.Customer, error)`
- Produces: impact analysis document

- [ ] **Step 1: Grep all callers of GetOrCreateCustomer**

```bash
grep -rn "GetOrCreateCustomer" backend-go/ --include='*.go' | grep -v _test
```

Expected: 4 refs (1 def customers.go:8 + 3 callers handler.go:176, 431, 463). **Verified 2026-07-20: matches expected.**

- [ ] **Step 2: Grep test mocks of GetOrCreateCustomer**

```bash
grep -rn "GetOrCreateCustomer" backend-go/ | grep _test
```

Expected: 0 test mocks. **Verified 2026-07-20: 0 matches. Signature change is safe from test regression.**

- [ ] **Step 3: Grep gjp_cust_seq usage (deprecation safety check)**

```bash
grep -rn "gjp_cust_seq" backend-go/ src/ supabase/migrations/
```

Expected: 2 refs (customers.go:13 + schema migration). **Verified 2026-07-20: only 2 refs, no other code path uses. Safe to deprecate (leave sequence in DB, remove reference from customers.go).**

- [ ] **Step 4: Grep FE GJP-CUST assumptions**

```bash
grep -rn "GJP-CUST\|startsWith.*GJP\|customer.id.startsWith" src/ --include='*.ts' --include='*.tsx' | grep -v test
```

Expected: 0 refs. **Verified 2026-07-20: 0 matches. FE has no ID-format assumption.**

- [ ] **Step 5: Verify handler.go conv.TenantID field exists**

```bash
grep -n "TenantID\|tenant_id" backend-go/internal/whatsapp/handler.go | head -20
```

Expected: conv struct has `TenantID` field. If NOT present → use fallback (Task 3 Step 1a).

- [ ] **Step 6: Verify data satisfies new constraint**

```bash
DB_CONN=$(python3 -c "
with open('backend-go/.env') as f:
    for line in f:
        if line.startswith('SUPABASE_DB_CONNECTION='):
            print(line.rstrip('\n').split('=', 1)[1]); break
")
psql "$DB_CONN" -tAc "SELECT COUNT(*) FROM (SELECT tenant_id, wa_number, COUNT(*) FROM customers GROUP BY 1,2 HAVING COUNT(*) > 1) x"
```

Expected: `0`. **Verified 2026-07-20: 0 duplicates. Migration safe.**

- [ ] **Step 7: Write impact analysis to phase-1-report.md**

Create `docs/qa-week/phase-1-report.md`:

```markdown
# QA Week Phase 1 Report

## F5-05 Impact Analysis (2026-07-20)

**Direct importers of GetOrCreateCustomer:**
- backend-go/internal/whatsapp/handler.go (3 call sites: 176, 431, 463)

**Indirect callers:** none (helper is package-scoped, only handler consumes)

**Tests exercised:** 0 (no test mocks reference GetOrCreateCustomer)

**DB touchpoints:** `customers` table (INSERT), reads `gjp_cust_seq` sequence (to be deprecated)

**FE ID-format assumptions:** 0 grep matches for `GJP-CUST` or prefix startsWith

**Data safety:** 0 existing customer duplicates on (tenant_id, wa_number)

**Verdict:** 3 call sites, 0 tests, 1 DB touchpoint. Plan updates 3 handlers to pass tenantID from conv.TenantID. Sequence gjp_cust_seq left intact (deprecated, not dropped). FE unaffected. Data safe.

## P2-03 Impact Analysis (2026-07-20)

**audit_log FKs referencing it:** 0
**pembayaran FKs referencing it:** 1 (`pembayaran_items_pembayaran_id_fkey`)
**pembayaran_items has tenant_id column:** YES (composite FK viable)
**pembayaran_items data consistency:** 0 mismatched tenant_id vs parent pembayaran

**Verdict:** audit_log migration = simple DROP + ADD (leaf table). pembayaran migration MUST drop FK first, add composite PK, re-add FK as composite `(tenant_id, pembayaran_id)`.
```

- [ ] **Step 8: Commit impact analysis**

```bash
git add docs/qa-week/phase-1-report.md
git commit -m "[qa-week-followup] docs: Phase 1 impact analysis (F5-05 + P2-03)"
```

---

## Task 2: F5-05 Backend refactor — GetOrCreateCustomer signature + body (~30 min)

**Files:**
- Modify: `backend-go/internal/db/customers.go`
- Modify: `backend-go/internal/models/customer.go` (add TenantID if missing)

**Interfaces:**
- Produces: `func (c *Client) GetOrCreateCustomer(tenantID uuid.UUID, waNumber string) (*models.Customer, error)`

- [ ] **Step 1: Verify + ensure models.Customer has TenantID field**

Read `backend-go/internal/models/customer.go`. If `TenantID uuid.UUID` field not present, add:

```go
package models

import (
	"time"

	"github.com/google/uuid"
)

type Customer struct {
	ID        string    `db:"id"`
	TenantID  uuid.UUID `db:"tenant_id"`
	WANumber  string    `db:"wa_number"`
	Name      string    `db:"name"`
	Company   string    `db:"company"`
	CreatedAt time.Time `db:"created_at"`
}
```

- [ ] **Step 2: Rewrite GetOrCreateCustomer**

Replace `backend-go/internal/db/customers.go`:

```go
package db

import (
	"github.com/google/uuid"
	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetOrCreateCustomer finds the customer by (tenant_id, wa_number) or creates
// a new one with a random UUID. Uses INSERT ... ON CONFLICT DO UPDATE so
// RETURNING always returns a row.
//
// F5-05 (2026-07-20): tenant-scoped uniqueness. Previously used
// gjp_cust_seq (Garindo-hardcoded) + ON CONFLICT (wa_number) alone which
// blocked legitimate customer creation across tenants. Now uses
// gen_random_uuid() + composite (tenant_id, wa_number) conflict target.
//
// gjp_cust_seq deprecated; sequence remains in DB for backward safety but
// no code path calls it.
func (c *Client) GetOrCreateCustomer(tenantID uuid.UUID, waNumber string) (*models.Customer, error) {
	var cust models.Customer
	err := c.DB.QueryRow(`
		INSERT INTO customers (id, tenant_id, wa_number)
		VALUES (gen_random_uuid()::text, $1, $2)
		ON CONFLICT (tenant_id, wa_number) DO UPDATE
			SET wa_number = EXCLUDED.wa_number
		RETURNING id, tenant_id, wa_number, name, company, created_at
	`, tenantID, waNumber).Scan(
		&cust.ID, &cust.TenantID, &cust.WANumber, &cust.Name, &cust.Company, &cust.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cust, nil
}
```

- [ ] **Step 3: Verify Go build**

```bash
cd backend-go && go build ./internal/db/...
```

Expected: no errors.

- [ ] **Step 4: DO NOT commit yet — caller updates in Task 3 must land together**

---

## Task 3: F5-05 Update handler.go callers (~20 min)

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (3 call sites)

**Interfaces:**
- Consumes: `conv.TenantID` (verified in Task 1 Step 5)

- [ ] **Step 1: Verify conv struct has TenantID field**

If Task 1 Step 5 confirmed `conv.TenantID` present → proceed with Step 2.

**Fallback if conv.TenantID MISSING (from Task 1 Step 5 result):**

Add helper function in handler.go before the 3 call sites:

```go
// resolveTenantID looks up the tenant for a conversation via the wa_numbers
// table. Used when the conv struct doesn't expose TenantID directly.
func (h *Handler) resolveTenantID(ctx context.Context, conversationID string) (uuid.UUID, error) {
	var tid uuid.UUID
	err := h.db.DB.QueryRowContext(ctx, `
		SELECT wan.tenant_id FROM public.wa_numbers wan
		JOIN public.conversations c ON c.wa_number_id = wan.id
		WHERE c.id = $1
	`, conversationID).Scan(&tid)
	return tid, err
}
```

Then Steps 2-4 use `resolveTenantID(ctx, conv.ID)` instead of `conv.TenantID`.

- [ ] **Step 2: Update handler.go:176 — main message flow**

Replace `customer, err := h.db.GetOrCreateCustomer(senderPhone)` with:

```go
customer, err := h.db.GetOrCreateCustomer(conv.TenantID, senderPhone)
```

- [ ] **Step 3: Update handler.go:431 — wiring escalation**

Same replacement.

- [ ] **Step 4: Update handler.go:463 — admin escalation**

Same replacement.

- [ ] **Step 5: Verify go build after all edits**

```bash
cd backend-go && go build ./internal/whatsapp/
```

Expected: no errors.

- [ ] **Step 6: Run whatsapp package tests**

```bash
cd backend-go && go test -count=1 ./internal/whatsapp/ 2>&1 | tail -5
```

Expected: PASS or SKIP (integration tests skip without DB). Any FAIL = investigate before commit.

- [ ] **Step 7: Commit backend refactor (tasks 2+3 together)**

```bash
git add backend-go/internal/db/customers.go backend-go/internal/models/customer.go backend-go/internal/whatsapp/handler.go
git commit -m "$(cat <<'EOF'
[qa-week-followup] fix(f5-05): tenant-aware GetOrCreateCustomer

Backend refactor:
- customers.go: signature (tenantID uuid.UUID, waNumber string) + gen_random_uuid()
  + ON CONFLICT (tenant_id, wa_number) DO UPDATE
- customer.go: TenantID field on models.Customer struct
- handler.go: pass conv.TenantID at 3 call sites (176, 431, 463)

Fixes F5-05 cross-tenant customer creation. Deprecates gjp_cust_seq
(Garindo-hardcoded) — sequence retained in DB for safety, no code path
references it.

Companion migration: 20261115000501_uq_customers_wa_tenant.sql
Impact analysis: docs/qa-week/phase-1-report.md
EOF
)"
```

---

## Task 4: F5-05 FE friendly error message mapping (~15 min)

**Files:**
- Modify: `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`

**Interfaces:**
- Consumes: error string from Supabase INSERT
- Produces: user-friendly Bahasa Indonesia message on same-tenant duplicate

**Purpose:** Post-migration, cross-tenant duplicates succeed (fix). But same-tenant duplicates still 409 with new constraint name `uq_customers_wa_tenant` — technical PG message hidden by extractErrorMessage. Need friendly mapping.

- [ ] **Step 1: Read current error handling in NewCustomerInlineForm**

```bash
sed -n '50,60p' src/components/penjualan/wizard/NewCustomerInlineForm.tsx
```

Verify pattern: `catch (e) { showToast(...extractErrorMessage(e)) }`.

- [ ] **Step 2: Add friendly mapper before showToast**

Modify catch block:

```typescript
} catch (e) {
  const rawMsg = extractErrorMessage(e);
  // F5-05: map unique constraint violation to Bahasa-friendly message
  const friendlyMsg = rawMsg.includes('uq_customers_wa_tenant')
    ? 'Nomor HP sudah terdaftar untuk customer lain di toko ini. Cek dulu di daftar Pelanggan.'
    : rawMsg;
  showToast(`Gagal simpan customer: ${friendlyMsg}`, 'warning');
}
```

- [ ] **Step 3: Run vitest for this file**

```bash
npx vitest run src/components/penjualan/wizard/
```

Expected: pass (no test for this file exists; smoke test via lint).

- [ ] **Step 4: Verify lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit FE friendly error**

```bash
git add src/components/penjualan/wizard/NewCustomerInlineForm.tsx
git commit -m "[qa-week-followup] fix(f5-05): friendly BID error for same-tenant duplicate phone"
```

---

## Task 5: F5-05 Regression test SQL (~15 min)

**Files:**
- Create: `tests/sql/qa-week/f5-05-regression.sql`

- [ ] **Step 1: Write regression SQL**

Create `tests/sql/qa-week/f5-05-regression.sql`:

```sql
-- F5-05 regression: cross-tenant customer create + same-tenant conflict
-- Runs against prod DB. Wrapped in RAISE EXCEPTION rollback = zero side effects.
-- Precondition: migration 20261115000501 applied.

\echo === F5-05 regression: 3 scenarios ===

DO $t$
DECLARE
  v_tenant_a uuid := '11111111-1111-1111-1111-111111111111';  -- Garindo
  v_tenant_b uuid := '22222222-2222-2222-2222-222222222222';  -- Toko Jaya
  v_test_phone text := 'F5-05-TEST-' || extract(epoch from now())::text;
  v_a_id text; v_b_id text; v_a_id2 text;
BEGIN
  -- Scenario 1: tenant A creates customer with phone X → succeeds
  INSERT INTO customers (id, tenant_id, wa_number)
  VALUES (gen_random_uuid()::text, v_tenant_a, v_test_phone)
  RETURNING id INTO v_a_id;
  RAISE NOTICE 'PASS S1: tenant A created id=%', v_a_id;

  -- Scenario 2: tenant B creates customer with SAME phone → succeeds (was blocked pre-fix)
  INSERT INTO customers (id, tenant_id, wa_number)
  VALUES (gen_random_uuid()::text, v_tenant_b, v_test_phone)
  RETURNING id INTO v_b_id;
  RAISE NOTICE 'PASS S2: tenant B created id=% with same phone', v_b_id;

  -- Scenario 3: tenant A same phone again → conflicts (per-tenant uniqueness holds)
  BEGIN
    INSERT INTO customers (id, tenant_id, wa_number)
    VALUES (gen_random_uuid()::text, v_tenant_a, v_test_phone);
    RAISE NOTICE 'FAIL S3: same tenant same phone should have raised unique violation';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS S3: same tenant same phone correctly blocked';
  END;

  RAISE EXCEPTION 'rollback smoke';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'DONE: %', SQLERRM;
END $t$;
```

- [ ] **Step 2: Commit regression SQL (before migration so Task 6 can run it)**

```bash
git add tests/sql/qa-week/f5-05-regression.sql
git commit -m "[qa-week-followup] test(f5-05): SQL regression for cross-tenant customer create"
```

---

## Task 6: F5-05 Migration 501 + advisor + apply (~30 min)

**Files:**
- Create: `supabase/migrations/20261115000501_uq_customers_wa_tenant.sql`

- [ ] **Step 1: Advisor gate — schema change on t_* table**

Call `advisor()` in this session. Present:
- Migration content (below)
- Rollback plan
- Verification: Task 1 Step 6 confirmed 0 existing duplicates

Wait for advisor OK before Step 2.

- [ ] **Step 2: Write migration file**

Create `supabase/migrations/20261115000501_uq_customers_wa_tenant.sql`:

```sql
-- F5-05 (2026-07-20): swap customers unique constraint from (wa_number) alone
-- to composite (tenant_id, wa_number). Enables cross-tenant customer creation
-- when different tenants have customers with the same phone.
--
-- Safe by construction: existing constraint was STRONGER than new constraint,
-- so existing data satisfies new constraint automatically.
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS + guard on new constraint add.

BEGIN;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS uq_customers_wa;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_customers_wa_tenant'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT uq_customers_wa_tenant UNIQUE (tenant_id, wa_number);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 3: Apply migration to prod DB**

```bash
psql "$DB_CONN" -f supabase/migrations/20261115000501_uq_customers_wa_tenant.sql
```

Expected output: `BEGIN`, `ALTER TABLE`, `DO`, `COMMIT`.

- [ ] **Step 4: INSERT into schema_migrations (bootstrap safety)**

```bash
psql "$DB_CONN" -c "INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('20261115000501', ARRAY['-- see supabase/migrations/20261115000501_uq_customers_wa_tenant.sql'], 'uq_customers_wa_tenant') ON CONFLICT (version) DO NOTHING"
```

Expected: `INSERT 0 1` (or `0 0` if already tracked).

- [ ] **Step 5: Verify new constraint present**

```bash
psql "$DB_CONN" -tAc "SELECT conname FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname LIKE 'uq_customers%'"
```

Expected: `uq_customers_wa_tenant`.

- [ ] **Step 6: Run F5-05 regression test**

```bash
psql "$DB_CONN" -f tests/sql/qa-week/f5-05-regression.sql
```

Expected: `PASS S1`, `PASS S2`, `PASS S3` notices.

- [ ] **Step 7: Run get_advisors sweep**

Via MCP: `mcp__plugin_supabase_supabase__get_advisors`. Expected: no new perf/security findings.

- [ ] **Step 8: Commit migration**

```bash
git add supabase/migrations/20261115000501_uq_customers_wa_tenant.sql
git commit -m "[qa-week-followup] migrate(f5-05): swap uq_customers_wa → uq_customers_wa_tenant"
```

---

## Task 7: F5-05 Ship & verify Stage 2-3 (~30 min)

- [ ] **Step 1: Push backend + FE commits**

```bash
git push origin main
```

- [ ] **Step 2: Verify Cloud Build not FAILURE**

```bash
sleep 30
gcloud builds list --limit=5 --format='table(substitutions.SHORT_SHA,status,startTime.date())'
```

Watch until commits show SUCCESS (5-10 min typical). Per memory `deploy_verify_after_push`, verify explicitly.

- [ ] **Step 3: Stage 3 smoke — chrome-devtools MCP on Toko Jaya**

Login pattern from Session 5 (localStorage Supabase session inject for `playwright-toko-owner@caleo.id`). Navigate: Kasir → Catat Penjualan wizard → `+ Customer Baru`. Fill Nama `F5-05-Stage3-<ts>`, WA `08123450001<ts>`. Click Simpan & Pilih.

Expected: success toast "Customer baru tersimpan." (previously would 409 if any other tenant had same phone).

Also test: fill duplicate phone within Toko Jaya (create another customer with same phone). Expected: friendly toast "Nomor HP sudah terdaftar untuk customer lain di toko ini..."

Cleanup:
```bash
psql "$DB_CONN" -c "DELETE FROM customers WHERE name LIKE 'F5-05-Stage3%'"
```

- [ ] **Step 4: Update progress.md**

Append:
```markdown
## F5-05 SHIPPED — Phase 1 Task 7 (2026-07-20)

Backend GetOrCreateCustomer tenant-aware. Migration 501 applied + tracked.
Regression 3 scenarios PASS. Cloud Build SUCCESS. Stage 3 chrome-devtools smoke
on Toko Jaya: cross-tenant + same-tenant both behave correctly.

Related commits: [backend SHA], [migration SHA], [FE friendly-error SHA]
```

Commit:
```bash
git add progress.md
git commit -m "[qa-week-followup] docs: progress — F5-05 shipped"
git push origin main
```

---

## Task 8: P2-03 Advisor + memo + migration 502 (~45 min)

**Files:**
- Create: `docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md`
- Create: `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql`
- Create: `tests/sql/qa-week/p2-03-regression.sql`

**CRITICAL:** pembayaran has FK from pembayaran_items. Migration MUST handle:
1. DROP `pembayaran_items_pembayaran_id_fkey`
2. DROP `pembayaran_pkey`
3. ADD composite `pembayaran_pkey (tenant_id, id)`
4. RE-ADD FK as composite `(tenant_id, pembayaran_id) REFERENCES pembayaran(tenant_id, id)`

audit_log is simpler (no FKs referencing it) → simple DROP + ADD.

- [ ] **Step 1: Write decision memo (CLAUDE.md irreversible-decision template)**

Create `docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md`:

```markdown
# Composite PK on audit_log + pembayaran — decision memo

## Context
audit_log currently PK `(id)`, pembayaran currently PK `(id)`. CLAUDE.md
scale-forward names both as high-volume. At 10M+ rows, altering PK requires
hours of exclusive lock. Cheap now (audit_log 292 rows, pembayaran 0).

## Decision
Migrate to composite PK `(tenant_id, id)` on both. Enables future partition
BY `(tenant_id)` or `(tenant_id, created_at MONTH)` without further PK changes.

## Alternatives considered
- Do nothing → paint into corner at 10M rows. Rejected.
- Partition now → over-engineering at current scale. Deferred to 10M+ row event.
- Change only audit_log (skip pembayaran) → inconsistent, pembayaran also needs partition-ready. Rejected.

## Consequences
- Reversibility: fully reversible (DROP composite + ADD single-col PK). Backup FK definition first.
- Blast radius: pembayaran has FK from pembayaran_items → migration must handle.
- Migration path: DROP FK → DROP PK → ADD composite PK → RE-ADD composite FK.

## Scale ceiling check
1. **Ceiling at 10×**: composite PK btree grows linearly. 100M rows = ~5GB index. Acceptable.
2. **Hot path**: reads by (tenant_id, id) — composite PK ideal. Reads by id alone RARE (usually joined with tenant context).
3. **Partition-ready**: yes — composite PK enables `PARTITION BY (tenant_id)` or `(tenant_id, created_at)`.
4. **Idempotency**: migration guarded with pg_index shape check. Safe re-run.
5. **Long ops**: sub-second at current data volume. Non-issue.
6. **Cost curve**: flat per-tenant.

## Follow-up work
- At 10M+ audit_log rows: add PARTITION BY RANGE (created_at monthly). Separate design memo.
- At 10M+ pembayaran rows: consider PARTITION BY (tenant_id) hash. Separate memo.
```

- [ ] **Step 2: Advisor gate — irreversible PK change**

Call `advisor()` presenting memo + migration content. Wait for OK.

- [ ] **Step 3: Write migration file**

Create `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql`:

```sql
-- P2-03 (2026-07-20): composite PK (tenant_id, id) on audit_log + pembayaran.
-- audit_log has 0 FKs referencing it → simple DROP + ADD.
-- pembayaran has 1 FK (pembayaran_items_pembayaran_id_fkey) → must handle:
--   DROP FK → DROP PK → ADD composite PK → RE-ADD composite FK.
-- Composite FK uses pembayaran_items.tenant_id (verified present with 0 mismatches).
--
-- Idempotent via pg_index shape check.

BEGIN;

-- audit_log: simple PK swap
DO $$
BEGIN
  IF (SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute a
      JOIN pg_index i ON i.indexrelid = 'public.audit_log_pkey'::regclass
      WHERE a.attrelid = 'public.audit_log'::regclass
        AND a.attnum = ANY(i.indkey)) IS DISTINCT FROM ARRAY['tenant_id','id']
  THEN
    ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

-- pembayaran: FK-drop-first pattern
DO $$
BEGIN
  IF (SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute a
      JOIN pg_index i ON i.indexrelid = 'public.pembayaran_pkey'::regclass
      WHERE a.attrelid = 'public.pembayaran'::regclass
        AND a.attnum = ANY(i.indkey)) IS DISTINCT FROM ARRAY['tenant_id','id']
  THEN
    -- Drop dependent FK
    ALTER TABLE pembayaran_items DROP CONSTRAINT IF EXISTS pembayaran_items_pembayaran_id_fkey;

    -- Swap PK
    ALTER TABLE pembayaran DROP CONSTRAINT pembayaran_pkey;
    ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_pkey PRIMARY KEY (tenant_id, id);

    -- Re-add FK as composite (tenant_id column exists on pembayaran_items, verified consistent)
    ALTER TABLE pembayaran_items
      ADD CONSTRAINT pembayaran_items_pembayaran_id_fkey
      FOREIGN KEY (tenant_id, pembayaran_id) REFERENCES pembayaran(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 4: Write regression SQL**

Create `tests/sql/qa-week/p2-03-regression.sql`:

```sql
-- P2-03 regression: verify composite PK enforced + FK survives.

DO $t$
DECLARE
  v_audit_pk text; v_pembayaran_pk text; v_fk_def text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_audit_pk
  FROM pg_attribute a
  JOIN pg_index i ON i.indexrelid = 'public.audit_log_pkey'::regclass
  WHERE a.attrelid = 'public.audit_log'::regclass AND a.attnum = ANY(i.indkey);
  IF v_audit_pk = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: audit_log PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: audit_log PK is (%)', v_audit_pk;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_pembayaran_pk
  FROM pg_attribute a
  JOIN pg_index i ON i.indexrelid = 'public.pembayaran_pkey'::regclass
  WHERE a.attrelid = 'public.pembayaran'::regclass AND a.attnum = ANY(i.indkey);
  IF v_pembayaran_pk = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: pembayaran PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: pembayaran PK is (%)', v_pembayaran_pk;
  END IF;

  -- Verify FK survived + is composite
  SELECT pg_get_constraintdef(oid) INTO v_fk_def
  FROM pg_constraint WHERE conname = 'pembayaran_items_pembayaran_id_fkey';
  IF v_fk_def ILIKE '%tenant_id%' THEN
    RAISE NOTICE 'PASS: pembayaran_items FK is composite';
  ELSE
    RAISE NOTICE 'FAIL: pembayaran_items FK definition = %', v_fk_def;
  END IF;
END $t$;
```

- [ ] **Step 5: Apply migration**

```bash
psql "$DB_CONN" -f supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql
```

Expected: `BEGIN`, `DO`, `DO`, `COMMIT`. Sub-second.

- [ ] **Step 6: INSERT into schema_migrations**

```bash
psql "$DB_CONN" -c "INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ('20261115000502', ARRAY['-- see supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql'], 'audit_pembayaran_composite_pk') ON CONFLICT (version) DO NOTHING"
```

- [ ] **Step 7: Run regression test**

```bash
psql "$DB_CONN" -f tests/sql/qa-week/p2-03-regression.sql
```

Expected: 3 PASS notices (audit_log PK, pembayaran PK, FK composite).

- [ ] **Step 8: Verify Realtime subscriptions still work**

Realtime uses PK to identify row events. Composite PK is supported by Supabase Realtime since v2.

Smoke test: as Toko Jaya owner in chrome-devtools MCP, watch console during a page that subscribes (e.g., SalesInboxScreen). Expected: no "unable to subscribe" errors, subscription active.

If Realtime errors surface → HALT, investigate, potentially rollback via inverse migration.

- [ ] **Step 9: Run get_advisors sweep**

Via MCP. Expected: no new findings.

- [ ] **Step 10: Commit migration + regression + memo**

```bash
git add supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql tests/sql/qa-week/p2-03-regression.sql docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md
git commit -m "[qa-week-followup] migrate(p2-03): audit_log + pembayaran composite PK + FK re-add"
git push origin main
```

---

## Task 9: P1-07 jspdf 4.x upgrade (~30 min)

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: List all 12 PDF generators (impact scope)**

```bash
grep -rln "jspdf\|jsPDF" src/ --include='*.ts' --include='*.tsx' | grep -v test
```

Expected: 12 files (11 generators + `src/lib/sales/pdf/common.ts` shared helper).

- [ ] **Step 2: Backup current package state**

```bash
cp package.json /tmp/package.json.pre-jspdf-bump
cp package-lock.json /tmp/package-lock.json.pre-jspdf-bump
```

- [ ] **Step 3: Run npm audit fix --force**

```bash
npm audit fix --force
```

Expected: jspdf → 4.2.1. Verify:
```bash
npm ls dompurify jspdf jspdf-autotable
```

- [ ] **Step 4: Run npm install to lock**

```bash
npm install
```

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: PASS. If jspdf 4.x has TypeScript API changes → HALT, fix TS errors before continuing.

- [ ] **Step 6: Run all vitest tests**

```bash
npx vitest run src
```

Expected: 971+ tests pass. Any PDF-related test failure → adjust per jspdf 4.x API before continuing.

- [ ] **Step 7: DO NOT commit yet — need visual regression (Task 10)**

---

## Task 10: P1-07 PDF visual regression (12 generators, ~2h)

**Files:**
- Create: `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`
- Create: `docs/qa-week/pdf-regression/*.pdf` (12 pre + 12 post)

- [ ] **Step 1: Start dev server**

```bash
npm run dev &
```

Wait for `Local: http://localhost:5173/`.

- [ ] **Step 2: Login via chrome-devtools MCP + session injection**

Use Session 5 pattern for playwright-toko-owner on localhost:5173.

- [ ] **Step 3: Generate + save each of 12 PDFs at 4.2.1**

For each generator (1-12 below), navigate to trigger UI, click print/download button, save to `docs/qa-week/pdf-regression/`:

1. **belanjaNumpangLewatPdf** — Pembelian → BNL → detail → print
2. **purchaseOrderPdf** — Pembelian → PO → detail → print
3. **warehouseTransferPDF** — WT → detail → print
4. **catatanPembatalanPdf** — Sales order → cancel → print catatan
5. **invoiceDpPdf** — Kasir → wizard complete → invoice modal → DP variant
6. **invoiceLunasPdf** — same → LUNAS variant
7. **invoicePelunasanPdf** — same → pelunasan variant
8. **salesOrderPdf** — Sales landing → SO detail → print SO
9. **suratJalanPdf** — Sales order → detail → print surat jalan
10. **tandaTerimaPdf** — Order fulfillment → print tanda terima
11. **akuntansi/pdfExport** — Laporan → Akuntansi → PDF SAK EMKM
12. **SaldoAwalPDF** — Pengaturan → SaldoAwal → print

Save as `<name>-4.2.1.pdf` in `docs/qa-week/pdf-regression/`.

- [ ] **Step 4: Git-stash bump + regenerate baselines**

```bash
git stash push -m "jspdf-bump-temp" package.json package-lock.json
npm install
```

Regenerate same 12 PDFs (steps as above). Save as `<name>-2.5.2.pdf`.

```bash
git stash pop
npm install
```

- [ ] **Step 5: Compare each pair + document verdict**

Visual side-by-side inspection. Check:
- Layout preserved (same page count, same margin, same table position)
- Text content identical
- IDR format `Rp 1.234.567` unchanged
- Page breaks in same place
- Unicode characters (customer names with é, ñ, etc) render same

Document in `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`:

```markdown
# jspdf 2.5.2 → 4.2.1 visual regression

Baseline: <git SHA pre-bump>
Upgraded: <git SHA post-bump>
Tested: 2026-07-20

| # | PDF | Layout | Text | IDR format | Page break | Unicode | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | belanjaNumpangLewatPdf | OK | OK | OK | OK | OK | PASS |
| 2 | purchaseOrderPdf | ... | ... | ... | ... | ... | ... |
| ... continuing 3-12 ... |
```

Any FAIL verdict → HALT, go to Step 6 rollback.

- [ ] **Step 6a: If all 12 PASS → commit bump**

```bash
git add package.json package-lock.json docs/qa-week/pdf-regression/
git commit -m "[qa-week-followup] fix(p1-07): bump jspdf 2.5.2 → 4.2.1 for DOMPurify CVE"
git push origin main
```

- [ ] **Step 6b: If any FAIL → rollback + document deferred**

```bash
cp /tmp/package.json.pre-jspdf-bump package.json
cp /tmp/package-lock.json.pre-jspdf-bump package-lock.json
npm install
git checkout package.json package-lock.json
```

Update `docs/qa-week/phase-1-report.md`: mark P1-07 DEFERRED with regression failure details. Note in report which PDFs regressed + suspected API change.

---

## Task 11: Multi-tenant matrix re-verify + Phase 1 completion (~30 min)

- [ ] **Step 1: Wait for Cloud Build SUCCESS for all commits**

```bash
gcloud builds list --limit=8 --format='table(substitutions.SHORT_SHA,status,startTime.date())'
```

All recent commits must show SUCCESS.

- [ ] **Step 2: Run 3-tenant multi-tenant matrix**

```bash
psql "$DB_CONN" -f - <<'SQL'
DO $t$
DECLARE
  v_tenants uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '49cbbc94-977c-4bc4-bf9b-0195342f1608'::uuid
  ];
  v_names text[] := ARRAY['Garindo','Toko Jaya','Warung'];
  v_tables text[] := ARRAY['customers','purchase_invoices','pembayaran','journal_entries','kasir_transactions','bank_accounts'];
  v_user uuid; v_read_leak int; i int; j int; k int;
  v_total_leaks int := 0;
BEGIN
  FOR i IN 1..3 LOOP
    SELECT tu.user_id INTO v_user FROM tenant_users tu WHERE tu.tenant_id = v_tenants[i] LIMIT 1;
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenants[i]::text, 'role', 'authenticated')::text, true);
    SET LOCAL role authenticated;
    FOR j IN 1..3 LOOP
      IF i = j THEN CONTINUE; END IF;
      FOR k IN 1..array_length(v_tables, 1) LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE tenant_id = %L', v_tables[k], v_tenants[j]) INTO v_read_leak;
        IF v_read_leak > 0 THEN
          v_total_leaks := v_total_leaks + 1;
          RAISE NOTICE 'LEAK: as % reading % on %: %', v_names[i], v_names[j], v_tables[k], v_read_leak;
        END IF;
      END LOOP;
    END LOOP;
    RESET role;
  END LOOP;
  RAISE NOTICE 'Post-Phase-1 3-tenant matrix: total leaks = % (0 = clean)', v_total_leaks;
END $t$;
SQL
```

Expected: `total leaks = 0`. Any leak → HALT + investigate.

- [ ] **Step 3: Update phase-1-report.md with completion**

Append:
```markdown
## Phase 1 SHIPPED (2026-07-20)

### F5-05 (Option A)
- Backend: commit [SHA]
- Migration 501: applied, uq_customers_wa_tenant present
- Regression: 3 scenarios PASS
- Stage 3 chrome smoke: cross-tenant OK, friendly error mapping working
- FE friendly error: commit [SHA]

### P2-03 (composite PK)
- Migration 502: applied, both PKs (tenant_id, id), pembayaran FK now composite
- Regression: 3 PASS (audit PK, pembayaran PK, FK composite)
- Realtime subscription smoke: no errors
- Decision memo: docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md

### P1-07 (jspdf 4.x)
- [SHIPPED / DEFERRED per Task 10 result]
- Regression log: docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md

### Multi-tenant re-verify
- 3-tenant × 6-table matrix (36 attempts): 0 leaks confirmed

### Success criteria hit
- ✅ 4+ commits tagged [qa-week-followup]
- ✅ Cloud Build all SUCCESS
- ✅ get_advisors sweep clean
- ✅ Regression tests: 3 added (F5-05, P2-03, P1-07 visual)
- ✅ 3-tenant matrix: 0 leaks
- ✅ schema_migrations tracked for 501 + 502

### Follow-ups
- Update memory `guard_expiry_write_broken_predicate` (Session 5 correction pending)
- Drop `gjp_cust_seq` sequence in Phase 3 cleanup migration
- 100M+ audit_log threshold → separate design memo for partition BY (created_at)
```

- [ ] **Step 4: Update progress.md**

Append:
```markdown
## Phase 1 SHIPPED — 2026-07-20

F5-05 tenant-aware customer + P2-03 composite PK migration + P1-07 jspdf CVE
upgrade all shipped. 3-tenant matrix re-verified: 0 leaks.

Detail: docs/qa-week/phase-1-report.md
```

- [ ] **Step 5: Final commit + push**

```bash
git add docs/qa-week/phase-1-report.md progress.md
git commit -m "[qa-week-followup] docs: Phase 1 completion report — all 3 fixes shipped + multi-tenant verified"
git push origin main
```

---

## Success criteria (all must be true before Phase 1 = DONE)

- [ ] 4+ commits tagged `[qa-week-followup]` in git log
- [ ] Cloud Build for each commit = SUCCESS
- [ ] `get_advisors` post-migration = 0 new findings
- [ ] 3 regression tests added (F5-05, P2-03, P1-07 visual) — all PASS
- [ ] 3-tenant matrix re-run: 0 leaks
- [ ] `docs/qa-week/phase-1-report.md` filled with all sections
- [ ] `progress.md` updated
- [ ] `supabase_migrations.schema_migrations` has entries for 501 + 502

---

## Rollback plan (per fix)

| Fix | Trigger | Command |
|---|---|---|
| F5-05 backend | WA bot fails on Garindo customer lookup post-deploy | Revert backend commit + Cloud Run traffic switch to previous revision |
| F5-05 migration | New constraint blocks legitimate insert | `ALTER TABLE customers DROP CONSTRAINT uq_customers_wa_tenant; ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);` |
| P2-03 migration | PK-dependent query breaks OR Realtime subscription fails | Inverse migration: drop composite FK on pembayaran_items → drop composite PK → add single-col PK → re-add single-col FK (see decision memo for exact SQL) |
| P1-07 jspdf | PDF layout regression in visual comparison | `cp /tmp/package.json.pre-jspdf-bump package.json; npm install` |
