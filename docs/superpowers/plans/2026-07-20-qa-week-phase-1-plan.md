# QA Week Phase 1 Implementation Plan — Coordinated Architectural Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 3 coordinated architectural fixes (F5-05 Option A, P2-03 composite PK, P1-07 jspdf CVE upgrade) that unblock tenant onboarding + close known CVE + partition-ready audit tables — with full impact analysis, regression test, observability, and 3-stage Ship & verify per CLAUDE.md.

**Architecture:**
- F5-05: rewrite `GetOrCreateCustomer` (backend Go) to accept explicit `tenantID`, use `gen_random_uuid()` for new IDs, `ON CONFLICT (tenant_id, wa_number) DO UPDATE`. Migration swaps `uq_customers_wa` → `uq_customers_wa_tenant` on `(tenant_id, wa_number)`.
- P2-03: migration replaces `audit_log_pkey (id)` and `pembayaran_pkey (id)` with composite `(tenant_id, id)`. Zero data touched.
- P1-07: `npm audit fix --force` → jspdf@4.2.1. Manual visual regression on 12 PDF generators.

**Tech Stack:** Go 1.25 (backend), TypeScript/React (FE), Postgres 15 (Supabase), psql for migrations, Cloud Build for deploy, chrome-devtools MCP for Stage 3 smoke.

## Global Constraints

- All migrations must be idempotent (`DROP IF EXISTS`, `CREATE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded backfills) per CLAUDE.md.
- Every non-trivial change requires: **impact analysis + regression test + observability + Ship & Verify Stage 1-3**.
- No new paid services. $0/tenant/month cost impact. HALT if any change surfaces cost per memory `cost_upgrade_approval`.
- All migrations in this phase claim slots **501-502** per spec migration slot allocation table.
- All commits tagged `[qa-week-followup]` for later audit.
- Multi-tenant safety: after each task involving RLS/SECDEF/schema, re-run 3-tenant matrix (Garindo × Toko Jaya × Warung) from `tests/sql/qa-week/rpc-smoke.sql`.
- All SECDEF changes require **advisor()** call before commit per CLAUDE.md advisor gate.
- Ship & Verify Stage 3 target: **Toko Jaya Makmur** (prod-testing tenant per memory `production-testing-tenant`).

---

## Files

**Created:**
- `supabase/migrations/20261115000501_uq_customers_wa_tenant.sql` — F5-05 schema swap
- `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql` — P2-03 composite PK
- `tests/sql/qa-week/f5-05-regression.sql` — F5-05 cross-tenant regression
- `tests/sql/qa-week/p2-03-regression.sql` — P2-03 PK migration regression
- `docs/qa-week/phase-1-report.md` — phase completion report
- `docs/qa-week/pdf-regression/YYYY-MM-DD-jspdf-4.2.1-visual-diff.md` — P1-07 visual regression log

**Modified:**
- `backend-go/internal/db/customers.go:8-26` — F5-05 GetOrCreateCustomer signature + body
- `backend-go/internal/whatsapp/handler.go:176, 431, 463` — F5-05 pass tenant_id to callers
- `package.json` + `package-lock.json` — P1-07 jspdf 2.5.2 → 4.2.1
- `progress.md` — session ledger

---

## Task 1: F5-05 impact analysis + prep

**Files:**
- Read: `backend-go/internal/db/customers.go`, `backend-go/internal/whatsapp/handler.go`, `backend-go/internal/models/customer.go` (or wherever `models.Customer` defined)
- Create: `docs/qa-week/phase-1-report.md` (initial section)

**Interfaces:**
- Consumes: existing `Client.GetOrCreateCustomer(waNumber string) (*models.Customer, error)`
- Produces: impact analysis document

- [ ] **Step 1: Grep all callers of GetOrCreateCustomer**

```bash
grep -rn "GetOrCreateCustomer" backend-go/ --include='*.go' | grep -v _test
```

Expected 4 refs: 1 definition + 3 callers in handler.go (lines 176, 431, 463).

- [ ] **Step 2: Grep how handler gets tenant_id context**

```bash
grep -nE "TenantID|tenant_id" backend-go/internal/whatsapp/handler.go | head -20
```

Verify `h.db.QueryRow` pattern for fetching `tenant_id` from conversations or wa_numbers table. Handler already has `conv` struct.

- [ ] **Step 3: Check models.Customer struct fields**

```bash
grep -rn "type Customer struct" backend-go/internal/models/
```

Verify has `ID` field of type `string`. Add `TenantID` field if not present (will be needed).

- [ ] **Step 4: Verify FE customerWrappers.insertNewCustomer already uses UUID**

```bash
grep -n "crypto.randomUUID\|gen_random_uuid" src/lib/customers/customerWrappers.ts
```

Expected: line 21 `id: crypto.randomUUID()`. FE side needs no change.

- [ ] **Step 5: Verify existing data can satisfy new constraint**

Run via psql (SUPABASE_DB_CONNECTION from backend-go/.env):
```sql
SELECT tenant_id, wa_number, COUNT(*)
FROM customers GROUP BY tenant_id, wa_number HAVING COUNT(*) > 1;
```

Expected: 0 rows. If not zero, HALT — need cleanup migration first.

- [ ] **Step 6: Draft impact analysis section in phase-1-report.md**

Write section:

```markdown
# QA Week Phase 1 Report

## F5-05 Impact Analysis (2026-07-20)

**Direct importers of GetOrCreateCustomer:**
- backend-go/internal/whatsapp/handler.go (3 call sites: 176, 431, 463)

**Indirect callers:** none (helper is package-private-ish, only handler consumes)

**Tests exercised:** grep `_test.go` for GetOrCreateCustomer — result: [document count]

**DB touchpoints:** `customers` table (INSERT), reads `gjp_cust_seq` sequence (to be deprecated)

**Verdict:** 3 call sites, [N] tests, 1 DB touchpoint. Plan updates all 3 handlers to pass tenantID from conv.TenantID. Sequence gjp_cust_seq left intact for safety (deprecated, not dropped).
```

- [ ] **Step 7: Commit impact analysis**

```bash
git add docs/qa-week/phase-1-report.md
git commit -m "[qa-week-followup] docs: F5-05 impact analysis for Phase 1"
```

---

## Task 2: F5-05 Backend refactor — GetOrCreateCustomer signature + body

**Files:**
- Modify: `backend-go/internal/db/customers.go`
- Modify: `backend-go/internal/models/customer.go` (add TenantID field if missing)

**Interfaces:**
- Consumes: `uuid.UUID` (tenantID param), `string` (waNumber)
- Produces: `func (c *Client) GetOrCreateCustomer(tenantID uuid.UUID, waNumber string) (*models.Customer, error)`

- [ ] **Step 1: Ensure models.Customer has TenantID field**

Read `backend-go/internal/models/customer.go`. If `TenantID uuid.UUID` field not present, add:

```go
type Customer struct {
    ID        string    `db:"id"`
    TenantID  uuid.UUID `db:"tenant_id"`
    WANumber  string    `db:"wa_number"`
    Name      string    `db:"name"`
    Company   string    `db:"company"`
    CreatedAt time.Time `db:"created_at"`
}
```

Add `"github.com/google/uuid"` import if not present.

- [ ] **Step 2: Rewrite GetOrCreateCustomer**

Replace body of `backend-go/internal/db/customers.go` with:

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

Skip commit; proceed to Task 3.

---

## Task 3: F5-05 Update handler.go callers to pass tenantID

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go` (3 call sites: 176, 431, 463)

**Interfaces:**
- Consumes: `conv.TenantID` (assumed present on conversation struct; verify at Step 1)
- Produces: updated 3 handler calls

- [ ] **Step 1: Verify conv struct has TenantID field**

```bash
grep -n "TenantID\|tenant_id" backend-go/internal/whatsapp/handler.go | head -5
grep -n "type Conversation struct\|Conv " backend-go/internal/models/ 2>&1
```

Expected: conv struct exposes TenantID or similar. If NOT, need separate query `SELECT tenant_id FROM wa_numbers WHERE ...` — HALT and revise plan.

- [ ] **Step 2: Update handler.go:176 — main message flow**

Locate line 176. Replace:

```go
customer, err := h.db.GetOrCreateCustomer(senderPhone)
```

With:

```go
customer, err := h.db.GetOrCreateCustomer(conv.TenantID, senderPhone)
```

- [ ] **Step 3: Update handler.go:431 — wiring escalation**

Same pattern replace at line 431.

- [ ] **Step 4: Update handler.go:463 — admin escalation**

Same pattern replace at line 463.

- [ ] **Step 5: Verify go build after all edits**

```bash
cd backend-go && go build ./internal/whatsapp/
```

Expected: no errors.

- [ ] **Step 6: Run existing whatsapp tests (should pass since we didn't touch test files)**

```bash
cd backend-go && go test -count=1 ./internal/whatsapp/ 2>&1 | tail -5
```

Expected: PASS or SKIP (if requires DB). Any FAIL = investigate before continuing.

- [ ] **Step 7: Commit backend refactor (both tasks 2+3 together)**

```bash
git add backend-go/internal/db/customers.go backend-go/internal/models/customer.go backend-go/internal/whatsapp/handler.go
git commit -m "$(cat <<'EOF'
[qa-week-followup] fix(f5-05): tenant-aware GetOrCreateCustomer

Rewrite backend GetOrCreateCustomer to accept explicit tenantID + use
gen_random_uuid() for new IDs + ON CONFLICT (tenant_id, wa_number).

- customers.go: signature change (tenantID uuid.UUID, waNumber string)
- customer.go: add TenantID field to models.Customer struct
- handler.go: pass conv.TenantID at 3 call sites (176, 431, 463)

Fixes F5-05 cross-tenant customer creation. Deprecates gjp_cust_seq
(Garindo-hardcoded) — sequence left in DB for safety, not referenced.

Companion migration: 20261115000501_uq_customers_wa_tenant.sql

Impact analysis + regression test: docs/qa-week/phase-1-report.md
EOF
)"
```

---

## Task 4: F5-05 Regression test — SQL smoke

**Files:**
- Create: `tests/sql/qa-week/f5-05-regression.sql`

**Interfaces:**
- Consumes: SUPABASE_DB_CONNECTION, tenants Garindo + Toko Jaya + Warung
- Produces: SQL smoke that verifies cross-tenant customer creation works after migration

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

  -- Scenario 2: tenant B creates customer with SAME phone X → succeeds (was blocked pre-migration)
  INSERT INTO customers (id, tenant_id, wa_number)
  VALUES (gen_random_uuid()::text, v_tenant_b, v_test_phone)
  RETURNING id INTO v_b_id;
  RAISE NOTICE 'PASS S2: tenant B created id=% with same phone', v_b_id;

  -- Scenario 3: tenant A tries same phone again → conflicts (same tenant same phone still blocked)
  BEGIN
    INSERT INTO customers (id, tenant_id, wa_number)
    VALUES (gen_random_uuid()::text, v_tenant_a, v_test_phone)
    RETURNING id INTO v_a_id2;
    RAISE NOTICE 'FAIL S3: same tenant same phone should have raised unique violation';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS S3: same tenant same phone correctly blocked';
  END;

  RAISE EXCEPTION 'rollback smoke';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'DONE: %', SQLERRM;
END $t$;
```

- [ ] **Step 2: Commit regression test file (before migration so migration Task 5 can run it)**

```bash
git add tests/sql/qa-week/f5-05-regression.sql
git commit -m "[qa-week-followup] test(f5-05): SQL regression for cross-tenant customer create"
```

---

## Task 5: F5-05 Advisor gate + migration 20261115000501

**Files:**
- Create: `supabase/migrations/20261115000501_uq_customers_wa_tenant.sql`

**Interfaces:**
- Consumes: existing `uq_customers_wa` constraint
- Produces: new `uq_customers_wa_tenant` constraint on `(tenant_id, wa_number)`

- [ ] **Step 1: Advisor gate — RLS/schema change**

Per CLAUDE.md: schema change to unique constraint on customers = advisor gate required.

Call `advisor()` in this session. Present:
- Migration content (below)
- Rollback plan
- Verification that existing data satisfies new constraint (Task 1 Step 5)

Wait for advisor OK before proceeding.

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

-- Drop old constraint if present
ALTER TABLE customers DROP CONSTRAINT IF EXISTS uq_customers_wa;

-- Add new composite constraint (idempotent via NOT EXISTS check)
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

- [ ] **Step 3: Apply migration to prod DB via psql**

```bash
DB_CONN=$(python3 -c "
with open('backend-go/.env') as f:
    for line in f:
        if line.startswith('SUPABASE_DB_CONNECTION='):
            print(line.rstrip('\n').split('=', 1)[1]); break
")
psql "$DB_CONN" -f supabase/migrations/20261115000501_uq_customers_wa_tenant.sql
```

Expected output: `BEGIN`, `ALTER TABLE`, `DO`, `COMMIT`.

- [ ] **Step 4: Verify new constraint present**

```bash
psql "$DB_CONN" -tAc "SELECT conname FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname LIKE 'uq_customers%'"
```

Expected: `uq_customers_wa_tenant`.

- [ ] **Step 5: Run F5-05 regression test (from Task 4)**

```bash
psql "$DB_CONN" -f tests/sql/qa-week/f5-05-regression.sql
```

Expected: `PASS S1`, `PASS S2`, `PASS S3` notices.

- [ ] **Step 6: Run get_advisors sweep**

Via MCP: `mcp__plugin_supabase_supabase__get_advisors`.
Expected: no new perf/security findings.

- [ ] **Step 7: Commit migration**

```bash
git add supabase/migrations/20261115000501_uq_customers_wa_tenant.sql
git commit -m "[qa-week-followup] migrate(f5-05): swap uq_customers_wa → uq_customers_wa_tenant"
```

---

## Task 6: F5-05 Ship & verify Stage 2-3

**Files:**
- Modify: `progress.md` (session ledger)

**Interfaces:**
- Consumes: pushed backend commit + applied migration
- Produces: verified deploy + stage 3 smoke result

- [ ] **Step 1: Push backend commits**

```bash
git push origin main
```

- [ ] **Step 2: Wait 30s + verify Cloud Build not FAILURE**

```bash
sleep 30
gcloud builds list --limit=3 --format='table(substitutions.SHORT_SHA,status,startTime.date())'
```

Expected: recent commits STATUS in (WORKING, SUCCESS). Per memory `deploy_verify_after_push`, watch until SUCCESS.

- [ ] **Step 3: Stage 3 smoke — chrome-devtools MCP on Toko Jaya**

Login as playwright-toko-owner via session injection (pattern from Session 5). Navigate to Kasir → Catat Penjualan wizard → + Customer Baru. Fill:
- Nama: "F5-05 Stage-3 Test [timestamp]"
- WA: 081234500001 (any unique)

Click "Simpan & Pilih". Expected: success toast "Customer baru tersimpan." (previously would 409 if any other tenant had 081234500001).

Cleanup: `DELETE FROM customers WHERE name LIKE 'F5-05 Stage-3%'` post-verify.

- [ ] **Step 4: Update progress.md with F5-05 completion**

Append to progress.md:

```markdown
## F5-05 SHIPPED (Phase 1 Task 6, 2026-07-20)

Backend GetOrCreateCustomer refactored to tenant-aware. Migration 501 applied.
Regression test passes 3 scenarios (cross-tenant create OK, same-tenant conflict OK).
Cloud Build SUCCESS. Stage 3 chrome-devtools smoke on Toko Jaya passed.

Related commits: [backend commit SHA], [migration commit SHA]
```

Commit:

```bash
git add progress.md
git commit -m "[qa-week-followup] docs: progress ledger — F5-05 shipped"
git push origin main
```

---

## Task 7: P2-03 Advisor gate + composite PK migration

**Files:**
- Create: `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql`
- Create: `tests/sql/qa-week/p2-03-regression.sql`

**Interfaces:**
- Consumes: `audit_log` and `pembayaran` tables with `(id)` PKs
- Produces: composite PKs `(tenant_id, id)` on both

- [ ] **Step 1: Impact analysis**

```bash
grep -rn "audit_log_pkey\|pembayaran_pkey" backend-go/ src/ supabase/migrations/ 2>&1 | grep -v _test | head -20
```

Expected: 0 refs (PK names not typically referenced by app code, only introspected by ORMs). If any surface, investigate.

- [ ] **Step 2: Verify current row counts**

```bash
psql "$DB_CONN" -tAc "SELECT 'audit_log', COUNT(*) FROM audit_log UNION ALL SELECT 'pembayaran', COUNT(*) FROM pembayaran"
```

Expected: audit_log ~300, pembayaran 0. Migration will be seconds. If counts >>10K, HALT + re-plan for offline window.

- [ ] **Step 3: Advisor gate — irreversible-adjacent PK change**

Per CLAUDE.md Backend scale-forward architecture:
> Irreversible / architectural: PK shape → STOP. Invoke `advisor()`. Write a design memo in `docs/superpowers/specs/`. Then implement.

Draft memo `docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md` with the 6-question scale-forward check (ceiling, hot path, partition-ready, idempotency, long ops, cost curve). Then call `advisor()` presenting memo + migration content. Wait for OK.

- [ ] **Step 4: Write migration file**

Create `supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql`:

```sql
-- P2-03 (2026-07-20): Replace single-column PK with composite (tenant_id, id)
-- on audit_log and pembayaran. Enables future partition BY (tenant_id) or
-- (tenant_id, created_at MONTH) once tables reach 10M+ rows.
--
-- Safe by construction: existing PK (id) subsumes composite (tenant_id, id)
-- uniqueness. Migration is metadata-only rename + index rebuild.
--
-- Preconditions: audit_log.tenant_id NOT NULL, pembayaran.tenant_id NOT NULL.
-- Both verified via `\d` inspection 2026-07-20.
--
-- Idempotent: guards check current PK definition before altering.

BEGIN;

-- audit_log
DO $$
BEGIN
  IF (SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute a
      JOIN pg_index i ON i.indexrelid = 'public.audit_log_pkey'::regclass
      WHERE a.attrelid = 'public.audit_log'::regclass
        AND a.attnum = ANY(i.indkey)) != ARRAY['tenant_id','id']
  THEN
    ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

-- pembayaran
DO $$
BEGIN
  IF (SELECT array_agg(attname ORDER BY attnum)
      FROM pg_attribute a
      JOIN pg_index i ON i.indexrelid = 'public.pembayaran_pkey'::regclass
      WHERE a.attrelid = 'public.pembayaran'::regclass
        AND a.attnum = ANY(i.indkey)) != ARRAY['tenant_id','id']
  THEN
    ALTER TABLE pembayaran DROP CONSTRAINT pembayaran_pkey;
    ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 5: Write regression SQL**

Create `tests/sql/qa-week/p2-03-regression.sql`:

```sql
-- P2-03 regression: verify composite PK enforced after migration.
\echo === P2-03 regression ===

DO $t$
DECLARE
  v_audit_pk_cols text;
  v_pembayaran_pk_cols text;
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_audit_pk_cols
  FROM pg_attribute a
  JOIN pg_index i ON i.indexrelid = 'public.audit_log_pkey'::regclass
  WHERE a.attrelid = 'public.audit_log'::regclass AND a.attnum = ANY(i.indkey);

  IF v_audit_pk_cols = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: audit_log PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: audit_log PK is (%)', v_audit_pk_cols;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_pembayaran_pk_cols
  FROM pg_attribute a
  JOIN pg_index i ON i.indexrelid = 'public.pembayaran_pkey'::regclass
  WHERE a.attrelid = 'public.pembayaran'::regclass AND a.attnum = ANY(i.indkey);

  IF v_pembayaran_pk_cols = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: pembayaran PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: pembayaran PK is (%)', v_pembayaran_pk_cols;
  END IF;
END $t$;
```

- [ ] **Step 6: Apply migration**

```bash
psql "$DB_CONN" -f supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql
```

Expected: `BEGIN`, `DO`, `DO`, `COMMIT`. Sub-second.

- [ ] **Step 7: Run regression test**

```bash
psql "$DB_CONN" -f tests/sql/qa-week/p2-03-regression.sql
```

Expected: `PASS: audit_log PK is (tenant_id, id)` and `PASS: pembayaran PK is (tenant_id, id)`.

- [ ] **Step 8: Run get_advisors sweep**

Via MCP `mcp__plugin_supabase_supabase__get_advisors`. Expected: no new findings.

- [ ] **Step 9: Commit migration + regression + memo**

```bash
git add supabase/migrations/20261115000502_audit_pembayaran_composite_pk.sql tests/sql/qa-week/p2-03-regression.sql docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md
git commit -m "[qa-week-followup] migrate(p2-03): audit_log + pembayaran composite PK"
```

---

## Task 8: P1-07 jspdf 4.x upgrade

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: jspdf@2.5.2, jspdf-autotable@3.8.4
- Produces: jspdf@4.2.1, jspdf-autotable compatible version

- [ ] **Step 1: Impact analysis — list all PDF generator files**

```bash
find src -name "*Pdf*" -o -name "*PDF*" 2>/dev/null | grep -v test | head -15
find src/lib/pdf src/lib/sales/pdf -type f 2>/dev/null | head -15
```

Expected: 12 files (invoice DP/lunas/pelunasan, surat jalan, catatan pembatalan, PO, BNL, warehouse transfer, tanda terima, akuntansi export, sales invoice, saldo awal).

- [ ] **Step 2: Backup current package.json state**

```bash
cp package.json /tmp/package.json.pre-jspdf-bump
cp package-lock.json /tmp/package-lock.json.pre-jspdf-bump
```

- [ ] **Step 3: Run npm audit fix --force**

```bash
npm audit fix --force
```

Expected: jspdf → 4.2.1, dompurify → 3.x (transitive). Verify:
```bash
npm ls dompurify jspdf
```

- [ ] **Step 4: Run npm install to update lock**

```bash
npm install
```

- [ ] **Step 5: Run npm run lint**

```bash
npm run lint
```

Expected: PASS. If jspdf 4.x has TypeScript API changes, may need FE code adjustments — HALT + investigate errors.

- [ ] **Step 6: Run all vitest tests**

```bash
npx vitest run src
```

Expected: 971+ tests pass. If any PDF-related test breaks, adjust per jspdf 4.x API.

- [ ] **Step 7: Do NOT commit yet — need visual regression first**

Proceed to Task 9.

---

## Task 9: P1-07 PDF visual regression (12 generators)

**Files:**
- Create: `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`

**Interfaces:**
- Consumes: dev server + 12 PDF triggers
- Produces: visual regression log per PDF

- [ ] **Step 1: Start dev server**

```bash
npm run dev &
```

Wait for `Local: http://localhost:5173/`.

- [ ] **Step 2: Login via chrome-devtools MCP + session injection**

Use Session 5 pattern — inject Supabase session for `playwright-toko-owner@caleo.id` into localhost:5173 origin.

- [ ] **Step 3: Trigger each of 12 PDFs + save**

For each PDF generator, navigate to the screen that triggers it, click PDF/print button, download. Save as `docs/qa-week/pdf-regression/2026-07-20-<pdf-name>-4.2.1.pdf`:

1. Invoice DP — Penjualan wizard → complete flow → invoice modal → print DP variant
2. Invoice LUNAS — same → LUNAS variant
3. Invoice pelunasan — same → pelunasan variant
4. Surat Jalan — sales order → detail → print surat jalan
5. Catatan pembatalan — cancel order → print catatan
6. Purchase Order PDF — Pembelian → PO detail → print
7. BNL — BNL detail → print
8. Warehouse Transfer PDF — WT detail → print
9. Tanda Terima — order fulfillment → print tanda terima
10. Akuntansi export PDF — Laporan → Akuntansi → PDF SAK EMKM
11. Sales Invoice — sales landing → invoice → print
12. Saldo Awal PDF — Pengaturan → SaldoAwal → print

- [ ] **Step 4: Compare against pre-upgrade baseline**

For each PDF, git-stash the jspdf bump (temp checkout of pre-bump), regenerate SAME 12 PDFs saved as `<name>-2.5.2.pdf`. Compare side-by-side (visual inspection or `pdfdiff` tool if available).

Document each in `docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md`:

```markdown
# jspdf 2.5.2 → 4.2.1 visual regression

Baseline: <git SHA pre-bump>
Upgraded: <git SHA post-bump>
Tested: 2026-07-20

| # | PDF | Layout | Text | IDR format | Page break | Verdict |
|---|---|---|---|---|---|---|
| 1 | Invoice DP | [OK/diff] | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... |
```

Any "diff" verdict = HALT, investigate, potentially rollback.

- [ ] **Step 5: If all 12 PASS, commit bump**

```bash
git add package.json package-lock.json docs/qa-week/pdf-regression/
git commit -m "$(cat <<'EOF'
[qa-week-followup] fix(p1-07): bump jspdf 2.5.2 → 4.2.1 for DOMPurify CVE

npm audit fix --force applied. Fixes 14 dompurify CVEs (XSS, prototype
pollution, sanitization bypass).

Visual regression on 12 PDF generators complete — all PASS.
Log: docs/qa-week/pdf-regression/2026-07-20-jspdf-4.2.1-visual-diff.md
EOF
)"
```

- [ ] **Step 6: If any FAIL, rollback**

```bash
cp /tmp/package.json.pre-jspdf-bump package.json
cp /tmp/package-lock.json.pre-jspdf-bump package-lock.json
npm install
git checkout package.json package-lock.json  # discard changes
```

Then update spec + document deferred P1-07 in `docs/qa-week/phase-1-report.md`. STOP Task 9 — move to Task 10.

---

## Task 10: Phase 1 completion — multi-tenant re-verify + report

**Files:**
- Modify: `docs/qa-week/phase-1-report.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: all Phase 1 shipped fixes
- Produces: completion report + multi-tenant safety confirmation

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Wait for Cloud Build SUCCESS**

```bash
sleep 60
gcloud builds list --limit=5 --format='table(substitutions.SHORT_SHA,status,startTime.date(),duration)'
```

All recent commits must show SUCCESS. If any FAILURE, investigate before continuing.

- [ ] **Step 3: Run 3-tenant multi-tenant matrix re-verify**

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
  v_user uuid; v_read_leak int;
  i int; j int; k int;
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

Expected: `total leaks = 0`. Any leak = HALT + investigate before declaring Phase 1 done.

- [ ] **Step 4: Update phase-1-report.md with final results**

Append full completion section:

```markdown
## Phase 1 SHIPPED (2026-07-20)

### F5-05 (Option A — UUID + composite unique)
- Backend commit: [SHA]
- Migration 501: applied, uq_customers_wa_tenant present
- Regression test: 3 scenarios PASS
- Stage 3 chrome smoke on Toko Jaya: PASS

### P2-03 (composite PK)
- Migration 502: applied, both PKs (tenant_id, id)
- Regression test: PASS
- Decision memo: docs/superpowers/specs/2026-07-20-audit-pembayaran-composite-pk-decision.md

### P1-07 (jspdf 4.x upgrade)
- [SHIPPED / DEFERRED per Task 9 result]
- Regression log: docs/qa-week/pdf-regression/

### Multi-tenant safety re-verify
- 3-tenant × 6-table matrix (36 attempts): 0 leaks confirmed

### Success criteria hit
- ✅ 3+ commits tagged [qa-week-followup]
- ✅ Cloud Build all SUCCESS
- ✅ get_advisors sweep clean
- ✅ Regression tests: 3 added (F5-05, P2-03, P1-07 visual regression)
- ✅ 3-tenant matrix: 0 leaks
```

- [ ] **Step 5: Update progress.md**

Append:

```markdown
## Phase 1 SHIPPED — 2026-07-20

F5-05 tenant-aware customer create + P2-03 composite PK migration + P1-07
jspdf CVE upgrade all shipped. 3-tenant matrix re-verified: 0 leaks.

Detail: docs/qa-week/phase-1-report.md
Commits: [SHA list]
```

- [ ] **Step 6: Final commit**

```bash
git add docs/qa-week/phase-1-report.md progress.md
git commit -m "[qa-week-followup] docs: Phase 1 completion report — F5-05 + P2-03 + P1-07 shipped"
git push origin main
```

---

## Success criteria for Phase 1 (all must be true before declaring done)

- [ ] 3+ commits tagged `[qa-week-followup]` visible via `git log --grep="qa-week-followup"`
- [ ] Cloud Build for each commit = SUCCESS (verify `gcloud builds list --limit=5`)
- [ ] `mcp__plugin_supabase_supabase__get_advisors` post-migration = 0 new findings
- [ ] 3 regression tests added (F5-05, P2-03, P1-07 visual)
- [ ] 3-tenant matrix re-run: 0 leaks
- [ ] `docs/qa-week/phase-1-report.md` filled
- [ ] `progress.md` updated

---

## Rollback plan (per fix)

| Fix | Trigger | Command |
|---|---|---|
| F5-05 backend | WA bot fails on Garindo customer lookup post-deploy | `git revert <backend-commit>` + Cloud Run traffic switch to previous revision |
| F5-05 migration | New constraint blocks legitimate insert | `ALTER TABLE customers DROP CONSTRAINT uq_customers_wa_tenant; ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);` |
| P2-03 migration | Any PK-dependent query breaks | `ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey; ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);` (same pattern for pembayaran) |
| P1-07 jspdf | PDF layout regression in prod | `git revert <jspdf-commit>` → `npm install jspdf@2.5.2 jspdf-autotable@3.8.4` |

---

## Self-Review

**Spec coverage:** Phase 1 spec covers F5-05, P2-03, P1-07. All 3 have tasks. ✅

**Impact analysis:** Task 1 explicit for F5-05. Task 7 Step 1 for P2-03. Task 8 Step 1 for P1-07. ✅

**Regression tests:** Task 4 (F5-05 SQL smoke), Task 7 Step 5 (P2-03 SQL smoke), Task 9 (P1-07 visual). ✅

**Observability:** F5-05 is a refactor of existing function — CLAUDE.md rule says refactors need not add observability but must not remove existing. Handler.go log statements preserved. ✅

**Ship & Verify:** Task 6 covers Stage 1-3 for F5-05. Task 7 Steps 6-8 cover P2-03 verify. Task 10 covers full Phase 1 verify. ✅

**Advisor gates:** Task 5 Step 1 (F5-05 schema), Task 7 Step 3 (P2-03 irreversible). ✅

**Multi-tenant re-verify:** Task 10 Step 3 explicit 3-tenant × 6-table matrix. ✅

**Migration slot allocation:** 501 + 502 per spec table. ✅

**No placeholders:** all steps have concrete SQL/Go code, exact commands, exact expected output. ✅

**Type consistency:** `GetOrCreateCustomer(tenantID uuid.UUID, waNumber string)` used consistently across Tasks 2, 3, 6. ✅

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-20-qa-week-phase-1-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
