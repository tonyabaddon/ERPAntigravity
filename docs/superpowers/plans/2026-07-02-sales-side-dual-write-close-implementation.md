# Sales-Side Dual-Write Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all sales-side GL dual-write gaps + fix `record_pi` PASSTHROUGH/LUNAS bugs + backfill Juni-Juli 2026 data, per approved design at `docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md`.

**Architecture:** 6 sequential migrations (`20260910000010`–`20260910000015`). Slices A/B/D each mutate one existing RPC. Slice C is a refactor of `record_pi` LUNAS branch to reuse `record_pembayaran` (which has Phase 0b dual-write). Slice E defines 4 idempotent backfill functions (dry-run + real-run). All dual-write follows Phase 0b/0c soft-fail pattern: `BEGIN/EXCEPTION WHEN OTHERS/RAISE WARNING`. Feature-gated by `accounting_config.enable_dual_write_to_gl` (already exists).

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql. Go 1.21 tests via `backend-go/internal/db/*_test.go` (pattern: `db.NewTestClient(t)` + `db.EnsureSKUStock` fixtures + direct `client.DB.QueryRow` RPC calls). Supabase MCP `apply_migration` + `execute_sql`. chrome-devtools MCP for browser E2E on Cloud Run prod.

## Global Constraints

- All new RPCs SECURITY DEFINER + `SET search_path=public`
- Soft-fail pattern (Phase 0b/0c convention): wrap `_post_journal_entry` in inner `BEGIN/EXCEPTION WHEN OTHERS` block; on failure INSERT into `gl_dual_write_anomalies` + `RAISE WARNING`; business RPC RETURN proceeds. Business tx NEVER rolls back from GL failure.
- Feature-flag gate: `IF (SELECT enable_dual_write_to_gl FROM public.accounting_config LIMIT 1) THEN ... END IF` — skip dual-write block entirely if false.
- Every RPC migration header MUST include `CAPTURED ORIGINAL BODY` comment block preserving the prior body verbatim for hand-rollback (Phase 0b/0c convention — see `20260723000002_phase0b_record_kasir_sale_dual_write.sql` line 100+).
- Migration slot `20260910000010`–`20260910000015` (verified against last landed migration `20260910000009`).
- Enum extensions via `ALTER TYPE public.journal_entry_source ADD VALUE 'X'` (idempotent-safe with `IF NOT EXISTS` where PG 15 supports; otherwise wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`).
- No user-facing UI changes (per spec §1 non-goals). `is_passthrough` ProductForm toggle is out of scope.
- Non-PKP tenant (Garindo): NEVER emit `2-1200 Hutang Pajak` credit line. PKP handling = Phase 1.
- `p_tenant_id` in `_post_journal_entry` stays NULL (multi-tenant Sub-Project A prerequisite).
- Each Slice: ≥1 happy-path Go test + ≥1 edge-case Go test + ≥1 flag-off Go test + ≥1 anomaly-soft-fail Go test.
- Post-slice: MCP DB smoke via DO-block with `set_config('request.jwt.claim.sub')` fake auth + `RAISE EXCEPTION 'SMOKE_ROLLBACK'` at end (leaves zero side-effects).
- Post-slice: browser E2E via chrome-devtools MCP on Cloud Run prod (`erp-antigravity.web.app` or equivalent).
- Commit at end of each task with commit message pattern `feat(akuntansi): [slice X] <description>` + `Co-Authored-By` trailer per project convention.
- Update `progress.md` at end of each task (per CLAUDE.md GOTCHA).
- Never `git push --no-verify` or skip hooks.

## File Structure

**Migrations (6):**
- `supabase/migrations/20260910000010_coa_seed_hpp_passthrough_and_accrued.sql` (CREATE) — 2 new COA rows + 6 enum ADDs
- `supabase/migrations/20260910000011_stocks_is_passthrough_column.sql` (CREATE) — 1 column + heuristic UPDATE
- `supabase/migrations/20260910000012_create_tempo_invoice_dual_write.sql` (CREATE) — CREATE OR REPLACE FUNCTION `create_tempo_invoice`
- `supabase/migrations/20260910000013_record_pi_passthrough_and_lunas.sql` (CREATE) — CREATE OR REPLACE FUNCTION `record_pi`
- `supabase/migrations/20260910000014_tempo_write_off_pair_dual_write.sql` (CREATE) — CREATE OR REPLACE FUNCTION `approve_tempo_write_off_request` + `revert_tempo_write_off`
- `supabase/migrations/20260910000015_backfill_sales_side_gl.sql` (CREATE) — 4 backfill functions + `_backfill_preview_je` table

**Go tests (5 new files, ~35-40 tests):**
- `backend-go/internal/db/create_tempo_invoice_dual_write_test.go` (CREATE) — 6-8 tests, Slice A
- `backend-go/internal/db/record_pi_passthrough_dual_write_test.go` (CREATE) — 5-7 tests, Slice B + C
- `backend-go/internal/db/approve_tempo_write_off_dual_write_test.go` (CREATE) — 4-5 tests, Slice D1
- `backend-go/internal/db/revert_tempo_write_off_dual_write_test.go` (CREATE) — 3-4 tests, Slice D2
- `backend-go/internal/db/backfill_sales_gl_test.go` (CREATE) — 5-6 tests, Slice E

**Monitoring queries (1):**
- `docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md` (CREATE) — saved SQL queries for anomaly + JE-source ratio + balance check

**Progress log:**
- `progress.md` (MODIFY per task)

---

## Task Breakdown

### Task 1: Foundation — COA seed + enum values + `is_passthrough` column

**Files:**
- Create: `supabase/migrations/20260910000010_coa_seed_hpp_passthrough_and_accrued.sql`
- Create: `supabase/migrations/20260910000011_stocks_is_passthrough_column.sql`

**Interfaces:**
- Consumes: existing `chart_of_accounts`, `journal_entry_source` enum, `stocks`, `purchase_invoices`, `purchase_invoice_items` schemas
- Produces:
  - `chart_of_accounts` rows with `account_code='5-1200'` and `account_code='2-1150'`
  - New enum values on `journal_entry_source`: `TEMPO_INVOICE_CREATE`, `TEMPO_WRITEOFF_REVERT`, `BACKFILL_TEMPO_INVOICE`, `BACKFILL_PI_PASSTHROUGH`, `BACKFILL_PEMBAYARAN`, `BACKFILL_TEMPO_WRITEOFF`
  - `public.stocks.is_passthrough boolean NOT NULL DEFAULT false` column
  - Heuristic-populated flag on existing stocks rows

- [ ] **Step 1.1: Write migration 10 SQL**

File: `supabase/migrations/20260910000010_coa_seed_hpp_passthrough_and_accrued.sql`

```sql
-- 20260910000010 — Foundation for sales-side dual-write close.
--
-- Adds 2 new COA accounts + 6 new journal_entry_source enum values.
-- Prerequisite for migrations 20260910000012–20260910000015.
--
-- Design spec: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.1
--
-- Rollback: DELETE the 2 chart_of_accounts rows (safe iff no JE references them yet).
--           Enum ADD VALUE cannot be reversed in-place; would need TYPE recreation
--           (destructive — accept as forward-only).

BEGIN;

-- 1. New COA accounts
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_subtype, normal_balance, is_control_account, is_system)
VALUES
  ('5-1200', 'HPP Barang Passthrough', 'BEBAN', 'HPP', 'DEBIT', false, true),
  ('2-1150', 'Hutang Passthrough Accrued', 'LIABILITAS', 'HUTANG_USAHA', 'CREDIT', false, true)
ON CONFLICT (account_code) DO NOTHING;

-- 2. Link parent_id (5-1200 under 5-1000, 2-1150 under 2-1100 parent group)
UPDATE public.chart_of_accounts SET parent_id = (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '5-1000'
) WHERE account_code = '5-1200';

UPDATE public.chart_of_accounts SET parent_id = (
  SELECT id FROM public.chart_of_accounts WHERE account_code = '2-1100'
) WHERE account_code = '2-1150';

-- 3. New enum values
DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'TEMPO_INVOICE_CREATE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'TEMPO_WRITEOFF_REVERT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_TEMPO_INVOICE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_PI_PASSTHROUGH';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_PEMBAYARAN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.journal_entry_source ADD VALUE 'BACKFILL_TEMPO_WRITEOFF';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
```

- [ ] **Step 1.2: Write migration 11 SQL**

File: `supabase/migrations/20260910000011_stocks_is_passthrough_column.sql`

```sql
-- 20260910000011 — Add stocks.is_passthrough flag + heuristic backfill.
--
-- Enables per-line branching in create_tempo_invoice (Slice A) between
-- stock-based FIFO consumption vs pass-through accrual. Heuristic populates
-- flag for existing SKUs based on PI type history.
--
-- Design spec: §3.2.
--
-- Rollback: ALTER TABLE stocks DROP COLUMN is_passthrough (safe, metadata-only).

BEGIN;

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS is_passthrough boolean NOT NULL DEFAULT false;

-- Heuristic backfill: any SKU that has appeared in PASSTHROUGH PI but never
-- in STOCK PI is flagged as passthrough.
UPDATE public.stocks s SET is_passthrough = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.purchase_invoice_id
  WHERE pii.sku = s.sku AND pi.type = 'STOCK'
) AND EXISTS (
  SELECT 1 FROM public.purchase_invoice_items pii
  JOIN public.purchase_invoices pi ON pi.id = pii.purchase_invoice_id
  WHERE pii.sku = s.sku AND pi.type = 'PASSTHROUGH'
);

COMMIT;
```

- [ ] **Step 1.3: Apply migration 10 via Supabase MCP**

Run via MCP `apply_migration`:
- Name: `20260910000010_coa_seed_hpp_passthrough_and_accrued`
- Query: contents of Step 1.1 file

Expected: success, no rows returned.

- [ ] **Step 1.4: Verify migration 10 landed**

Run via MCP `execute_sql`:
```sql
SELECT account_code, account_name, account_type
FROM public.chart_of_accounts
WHERE account_code IN ('5-1200', '2-1150')
ORDER BY account_code;
```
Expected: 2 rows.

```sql
SELECT unnest(enum_range(NULL::public.journal_entry_source))::text
INTERSECT
VALUES ('TEMPO_INVOICE_CREATE'), ('TEMPO_WRITEOFF_REVERT'),
       ('BACKFILL_TEMPO_INVOICE'), ('BACKFILL_PI_PASSTHROUGH'),
       ('BACKFILL_PEMBAYARAN'), ('BACKFILL_TEMPO_WRITEOFF');
```
Expected: 6 rows.

- [ ] **Step 1.5: Apply migration 11 via MCP**

Run via MCP `apply_migration`:
- Name: `20260910000011_stocks_is_passthrough_column`
- Query: contents of Step 1.2 file

Expected: success.

- [ ] **Step 1.6: Verify column added + heuristic ran**

Run via MCP `execute_sql`:
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stocks'
  AND column_name = 'is_passthrough';
```
Expected: 1 row, `boolean`, `false`, `NO`.

```sql
SELECT count(*) AS flagged_count FROM public.stocks WHERE is_passthrough = true;
```
Expected: N (record the number for later Slice A verification — likely 0 or small for Garindo).

- [ ] **Step 1.7: Commit both migrations**

```bash
git add supabase/migrations/20260910000010_coa_seed_hpp_passthrough_and_accrued.sql \
        supabase/migrations/20260910000011_stocks_is_passthrough_column.sql
git commit -m "$(cat <<'EOF'
feat(akuntansi): foundation for sales-side dual-write close

Migration 10: seed 5-1200 HPP Barang Passthrough + 2-1150 Hutang
Passthrough Accrued COAs + 6 new journal_entry_source enum values
(TEMPO_INVOICE_CREATE, TEMPO_WRITEOFF_REVERT, 4× BACKFILL_*).

Migration 11: add stocks.is_passthrough boolean + heuristic backfill
from PI type history (PASSTHROUGH-only SKUs → flagged true).

Prerequisite for Slice A (create_tempo_invoice dual-write) + Slice B
(record_pi PASSTHROUGH COA swap).

Design: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.8: Update progress.md**

Prepend to `progress.md` (after the `# ERP Antigravity — Implementation Progress` line):

```markdown
## 2026-07-02 — Sales-side dual-write close: Task 1 (foundation) SHIPPED

Migrations `20260910000010` + `20260910000011` applied to prod DB.

- **COA seeded**: `5-1200 HPP Barang Passthrough`, `2-1150 Hutang Passthrough Accrued`. Parent-linked to `5-1000` / `2-1100`.
- **Enum extensions**: `TEMPO_INVOICE_CREATE`, `TEMPO_WRITEOFF_REVERT`, `BACKFILL_TEMPO_INVOICE`, `BACKFILL_PI_PASSTHROUGH`, `BACKFILL_PEMBAYARAN`, `BACKFILL_TEMPO_WRITEOFF` added.
- **`stocks.is_passthrough`** column added + heuristic populated <N> SKUs (record actual number from Step 1.6).
- No RPC changes yet — this is prerequisite infra only.

Next: Task 2 — Slice A `create_tempo_invoice` dual-write.
```

Commit progress.md separately.

---

### Task 2: Slice A — `create_tempo_invoice` dual-write

**Files:**
- Create: `backend-go/internal/db/create_tempo_invoice_dual_write_test.go`
- Create: `supabase/migrations/20260910000012_create_tempo_invoice_dual_write.sql`
- Modify: `progress.md`

**Interfaces:**
- Consumes:
  - `stocks.is_passthrough` (from Task 1)
  - COAs `1-1400`, `4-1140`, `4-1900`, `5-1100`, `1-1510`, `5-1200`, `2-1150`
  - Enum value `TEMPO_INVOICE_CREATE`
  - `public._post_journal_entry(date, journal_entry_source, text, jsonb, text, uuid, uuid, uuid) → jsonb`
  - `public.deduct_stock_fifo(text, int, text, text, text, stock_movement_source) → numeric`
  - `public.gl_dual_write_anomalies` INSERT
  - `public.accounting_config.enable_dual_write_to_gl` boolean
- Produces:
  - Modified `public.create_tempo_invoice(p_payload jsonb) RETURNS uuid` (signature unchanged; body extended with dual-write)
  - `journal_entries` rows with `source_type='TEMPO_INVOICE_CREATE'`, `source_ref_table='orders'`, `source_ref_id=<order.id>`

- [ ] **Step 2.1: Write failing Go tests**

File: `backend-go/internal/db/create_tempo_invoice_dual_write_test.go`

```go
package db_test

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestCreateTempoInvoice_DualWrite_HappyPath asserts that a tempo invoice with
// one stock line + 1000 order discount produces a balanced JE with 5 legs:
// D 1-1400 AR, D 4-1900 Diskon, D 5-1100 HPP, K 4-1140 Revenue, K 1-1510 Persediaan.
func TestCreateTempoInvoice_DualWrite_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Enable dual-write for test
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-HAPPY-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 10)
	// Seeded: unit_cost=1000, qty_remaining=10
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000) // term_days=30, credit_limit=1M

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":3,"unit_price":5000,"master_price_at_sale":5000}],
		"discount_amount_rp":1000
	}`, custID, sku)

	var orderID string
	err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`,
		payload,
	).Scan(&orderID)
	if err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Assert JE lines
	rows, err := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		  FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_table = 'orders' AND e.source_ref_id = $1::uuid
		   AND e.source_type = 'TEMPO_INVOICE_CREATE'
		 ORDER BY a.account_code`,
		orderID,
	)
	if err != nil {
		t.Fatalf("query JE: %v", err)
	}
	defer rows.Close()

	type line struct {
		code, side string
		amount     float64
	}
	var got []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.code, &l.side, &l.amount); err != nil {
			t.Fatal(err)
		}
		got = append(got, l)
	}

	// Expected: subtotal = 15000 (3×5000), order_discount = 1000, total = 14000, HPP = 3000
	// D 1-1400 14000, D 4-1900 1000, D 5-1100 3000, K 4-1140 15000, K 1-1510 3000
	want := []line{
		{"1-1400", "DEBIT", 14000},
		{"1-1510", "CREDIT", 3000},
		{"4-1140", "CREDIT", 15000},
		{"4-1900", "DEBIT", 1000},
		{"5-1100", "DEBIT", 3000},
	}
	if len(got) != len(want) {
		t.Fatalf("JE line count = %d, want %d, got=%v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("JE line %d = %+v, want %+v", i, got[i], w)
		}
	}
}

// TestCreateTempoInvoice_DualWrite_ZeroDiscount_SkipsDiskonLeg asserts JE has 4
// legs (no 4-1900) when both line & order discount are zero.
func TestCreateTempoInvoice_DualWrite_ZeroDiscount_SkipsDiskonLeg(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-NODISC-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":2,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entry_lines l
		  JOIN public.journal_entries e ON e.id = l.entry_id
		  JOIN public.chart_of_accounts a ON a.id = l.account_id
		 WHERE e.source_ref_id = $1::uuid AND a.account_code = '4-1900'`,
		orderID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 4-1900 lines, got %d", count)
	}
}

// TestCreateTempoInvoice_DualWrite_PassthroughLine_UsesAccrualBranch asserts a
// pass-through SKU produces D 5-1200 + K 2-1150 legs instead of D 5-1100 + K 1-1510.
func TestCreateTempoInvoice_DualWrite_PassthroughLine_UsesAccrualBranch(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	sku := fmt.Sprintf("TEMPO-PT-%d", time.Now().UnixNano())
	db.EnsurePassthroughSKU(t, client, sku, 2000) // harga_modal=2000, is_passthrough=true
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test PT","qty":2,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Expect: NO 5-1100 or 1-1510 legs; presence of 5-1200 (D 4000) + 2-1150 (K 4000)
	var stockLegs, passthroughDebit, passthroughAccrued float64
	client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code IN ('5-1100','1-1510')), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code = '5-1200' AND l.side='DEBIT'), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE a.account_code = '2-1150' AND l.side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		JOIN public.chart_of_accounts a ON a.id = l.account_id
		WHERE e.source_ref_id = $1::uuid`, orderID,
	).Scan(&stockLegs, &passthroughDebit, &passthroughAccrued)

	if stockLegs != 0 {
		t.Errorf("expected no stock legs, got %v total", stockLegs)
	}
	if passthroughDebit != 4000 {
		t.Errorf("5-1200 debit = %v, want 4000", passthroughDebit)
	}
	if passthroughAccrued != 4000 {
		t.Errorf("2-1150 credit = %v, want 4000", passthroughAccrued)
	}
}

// TestCreateTempoInvoice_DualWrite_FlagOff_NoJEPosted asserts nothing is
// written to journal_entries when accounting_config.enable_dual_write_to_gl=false.
func TestCreateTempoInvoice_DualWrite_FlagOff_NoJEPosted(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, false) // explicit off

	sku := fmt.Sprintf("TEMPO-OFF-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":1,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	var count int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		WHERE source_ref_id = $1::uuid`, orderID,
	).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 JE, got %d", count)
	}
}

// TestCreateTempoInvoice_DualWrite_MissingCOA_LogsAnomaly asserts that if a JE
// leg references an unseeded COA, the business tx succeeds but an anomaly is
// logged.
func TestCreateTempoInvoice_DualWrite_MissingCOA_LogsAnomaly(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	// Temporarily rename 4-1140 to break the lookup
	_, err := client.DB.Exec(`UPDATE public.chart_of_accounts SET is_active=false WHERE account_code='4-1140'`)
	if err != nil {
		t.Fatal(err)
	}
	defer client.DB.Exec(`UPDATE public.chart_of_accounts SET is_active=true WHERE account_code='4-1140'`)

	sku := fmt.Sprintf("TEMPO-COA-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, sku, "atas", 5)
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[{"sku":"%s","name":"Test","qty":1,"unit_price":5000}]
	}`, custID, sku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("business tx should have succeeded despite GL failure: %v", err)
	}

	// Verify anomaly logged
	var anomalyCount int
	if err := client.DB.QueryRow(`
		SELECT count(*) FROM public.gl_dual_write_anomalies
		WHERE source_ref_id = $1::uuid AND source_rpc = 'create_tempo_invoice'`,
		orderID,
	).Scan(&anomalyCount); err != nil {
		t.Fatal(err)
	}
	if anomalyCount != 1 {
		t.Errorf("expected 1 anomaly, got %d", anomalyCount)
	}

	// Verify no partial JE
	var jeCount int
	client.DB.QueryRow(`SELECT count(*) FROM public.journal_entries WHERE source_ref_id = $1::uuid`, orderID).Scan(&jeCount)
	if jeCount != 0 {
		t.Errorf("expected no JE header on GL failure, got %d", jeCount)
	}
}

// TestCreateTempoInvoice_DualWrite_MixedLines_Combined asserts that a mixed
// order (1 stock line + 1 pass-through line) produces one JE with all 7 legs.
func TestCreateTempoInvoice_DualWrite_MixedLines_Combined(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	stockSku := fmt.Sprintf("TEMPO-MIX-S-%d", time.Now().UnixNano())
	ptSku := fmt.Sprintf("TEMPO-MIX-P-%d", time.Now().UnixNano())
	db.EnsureSKUStock(t, client, stockSku, "atas", 5)      // unit_cost=1000
	db.EnsurePassthroughSKU(t, client, ptSku, 2000)         // harga_modal=2000
	custID := db.EnsureTempoCustomer(t, client, 30, 1000000)

	payload := fmt.Sprintf(`{
		"customer_id":"%s",
		"items":[
			{"sku":"%s","name":"Stock","qty":2,"unit_price":3000},
			{"sku":"%s","name":"PT","qty":1,"unit_price":5000}
		]
	}`, custID, stockSku, ptSku)

	var orderID string
	if err := client.DB.QueryRow(
		`SELECT public.create_tempo_invoice($1::jsonb)`, payload,
	).Scan(&orderID); err != nil {
		t.Fatalf("create_tempo_invoice: %v", err)
	}

	// Expected JE:
	//   D 1-1400 AR         11000  (2×3000 + 1×5000)
	//   D 5-1100 HPP stock   2000  (2×1000)
	//   D 5-1200 HPP PT      2000  (1×2000)
	//   K 4-1140 Revenue    11000  (gross = subtotal since no disc)
	//   K 1-1510 Persediaan  2000
	//   K 2-1150 Hutang PT   2000
	var totalD, totalC float64
	client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(amount) FILTER (WHERE side='DEBIT'), 0),
		  COALESCE(SUM(amount) FILTER (WHERE side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		WHERE e.source_ref_id = $1::uuid`, orderID).Scan(&totalD, &totalC)

	if totalD != totalC {
		t.Errorf("JE unbalanced: D=%v C=%v", totalD, totalC)
	}
	if totalD != 15000 {
		t.Errorf("total debit = %v, want 15000", totalD)
	}
}
```

**Note on test helpers:** `db.SetDualWriteEnabled`, `db.EnsureTempoCustomer`, and `db.EnsurePassthroughSKU` are new fixture helpers. Add them to `backend-go/internal/db/client.go` (or a new `fixtures.go`) — signatures:

```go
func SetDualWriteEnabled(t *testing.T, c *TestClient, enabled bool) {
	t.Helper()
	if _, err := c.DB.Exec(`UPDATE public.accounting_config SET enable_dual_write_to_gl = $1`, enabled); err != nil {
		t.Fatal(err)
	}
}

func EnsureTempoCustomer(t *testing.T, c *TestClient, termDays int, creditLimit int) string {
	t.Helper()
	id := fmt.Sprintf("cust-%d", time.Now().UnixNano())
	name := fmt.Sprintf("Test Tempo %s", id)
	_, err := c.DB.Exec(`INSERT INTO public.customers (id, name, term_days, credit_limit, is_tempo)
		VALUES ($1::uuid, $2, $3, $4, true) ON CONFLICT (id) DO NOTHING`,
		id, name, termDays, creditLimit)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func EnsurePassthroughSKU(t *testing.T, c *TestClient, sku string, hargaModal int) {
	t.Helper()
	_, err := c.DB.Exec(`INSERT INTO public.stocks (sku, name, harga_modal, is_passthrough, price)
		VALUES ($1, $1, $2, true, $2 * 2) ON CONFLICT (sku) DO UPDATE
		SET is_passthrough = true, harga_modal = EXCLUDED.harga_modal`,
		sku, hargaModal)
	if err != nil {
		t.Fatal(err)
	}
}
```

- [ ] **Step 2.2: Run tests to verify they fail**

```bash
cd backend-go && go test ./internal/db/ -run TestCreateTempoInvoice_DualWrite -v
```

Expected: all 6 tests FAIL. Errors will mention missing test helpers (`SetDualWriteEnabled`, etc.) — first add helpers to `fixtures.go`, then re-run. After helpers exist, tests fail with "no JE lines found" or similar (because dual-write not yet in the RPC).

- [ ] **Step 2.3: Write migration 12 SQL**

File: `supabase/migrations/20260910000012_create_tempo_invoice_dual_write.sql`

```sql
-- 20260910000012 — create_tempo_invoice: add soft-fail GL dual-write.
--
-- Extends create_tempo_invoice (RETURNS uuid, single p_payload jsonb param)
-- with per-line branching on stocks.is_passthrough and post-INSERT dual-write
-- to public.journal_entries via public._post_journal_entry.
--
-- JE shape (single balanced entry per invoice):
--   D 1-1400 Piutang Usaha           v_total (net of order discount)
--   D 4-1900 Diskon Penjualan        line_disc + order_disc (only if > 0)
--   D 5-1100 HPP Penjualan           v_hpp_stock_total (only if > 0)
--   D 5-1200 HPP Barang Passthrough  v_hpp_passthrough_total (only if > 0)
--   K 4-1140 Penjualan Tempo         recomputed_subtotal + line_discount_total (GROSS)
--   K 1-1510 Persediaan Barang Jadi  v_hpp_stock_total (paired with 5-1100)
--   K 2-1150 Hutang Passthrough      v_hpp_passthrough_total (paired with 5-1200)
--
-- Soft-fail: all GL errors caught → anomaly logged to gl_dual_write_anomalies
-- → RAISE WARNING → order INSERT proceeds normally.
--
-- Signature preserved from 20260901000006 (p_payload jsonb → uuid).
-- Design spec: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.3
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (rollback reference — migration 20260901000006):
-- [copy the ENTIRE body of 20260901000006_create_tempo_invoice_tier.sql
--  CREATE OR REPLACE FUNCTION block, inline as SQL comment prefixed by `-- `]
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Multi-tier locals
  v_tier_modul_on       BOOLEAN;
  v_tier_used           TEXT;
  v_expected_price      NUMERIC;
  -- Existing locals
  v_customer            public.customers%ROWTYPE;
  v_outstanding         numeric;
  v_total               numeric;
  v_subtotal            numeric;
  v_shipping_fee        numeric;
  v_item                jsonb;
  v_order_id            uuid;
  v_due_date            date;
  v_items_jsonb         jsonb := '[]'::jsonb;
  v_sku                 text;
  v_qty                 int;
  v_hpp_total           numeric := 0;
  v_hpp_per_line        numeric;
  v_allow_negative      BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, false);
  v_master_price        numeric;
  v_unit_price          numeric;
  v_line_discount_amt   numeric;
  v_line_discount_total numeric := 0;
  v_recomputed_subtotal numeric := 0;
  v_order_discount_type TEXT    := p_payload->>'discount_type';
  v_order_discount_val  NUMERIC := (p_payload->>'discount_value')::numeric;
  v_order_discount_amt  NUMERIC := COALESCE((p_payload->>'discount_amount_rp')::numeric, 0);
  -- NEW: passthrough branching
  v_hpp_stock_total     numeric := 0;
  v_hpp_passthrough_total numeric := 0;
  v_is_passthrough      boolean;
  v_line_harga_modal    numeric;
  -- NEW: dual-write locals
  v_dual_write_enabled  boolean;
  v_je_lines            jsonb := '[]'::jsonb;
BEGIN
  -- ── COPY-FROM-PRIOR: multi-tier flag read ─────────────────────────────────
  SELECT modul_multi_tier_price INTO v_tier_modul_on FROM tenant_settings LIMIT 1;

  -- ── COPY-FROM-PRIOR: validation ──────────────────────────────────────────
  IF p_payload->>'customer_id' IS NULL THEN
    RAISE EXCEPTION 'customer_id required' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(COALESCE(p_payload->'items', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'items must contain at least one line' USING ERRCODE = 'P0001';
  END IF;

  -- ── COPY-FROM-PRIOR: discount consistency + per-line validation + tier
  -- ──                  check + subtotal recompute + credit-limit check ─────
  -- (Preserve VERBATIM from 20260901000006 lines 60-183.)
  [COPY VERBATIM from 20260901000006 lines 60 through 183 into this block]

  -- ── COPY-FROM-PRIOR: due_date compute ─────────────────────────────────────
  v_due_date := CURRENT_DATE + v_customer.term_days;
  v_shipping_fee := COALESCE((p_payload->>'shipping_fee')::numeric, 0);

  -- ── MODIFIED: HPP + stock deduction with passthrough branching ────────────
  v_items_jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_jsonb) LOOP
    v_sku := v_item->>'sku';
    v_qty := COALESCE((v_item->>'qty')::int, 0);
    IF v_sku IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(is_passthrough, false), harga_modal
      INTO v_is_passthrough, v_line_harga_modal
    FROM public.stocks WHERE sku = v_sku;

    IF v_is_passthrough THEN
      -- Pass-through line: accrue cost estimate (D-3 full accrual)
      v_hpp_per_line := COALESCE(v_line_harga_modal, 0) * v_qty;
      v_hpp_passthrough_total := v_hpp_passthrough_total + v_hpp_per_line;
      -- NO stock_lots deduction — passthrough doesn't touch inventory
    ELSE
      -- Stock line: FIFO consumption via existing RPC
      v_hpp_per_line := public.deduct_stock_fifo(
        v_sku, v_qty, 'atas', 'order_tempo', NULL, 'sale_kasir'::public.stock_movement_source
      );
      v_hpp_stock_total := v_hpp_stock_total + v_hpp_per_line;
    END IF;
    v_hpp_total := v_hpp_total + v_hpp_per_line;
  END LOOP;

  -- ── COPY-FROM-PRIOR: INSERT INTO orders ──────────────────────────────────
  INSERT INTO public.orders (
    customer_id, customer_name, customer_phone, customer_company, customer_address,
    items, subtotal, shipping_fee, total, hpp_total,
    payment_type, channel, sales_channel, status,
    due_date, delivery_type,
    booking_expires_at,
    discount_type, discount_value, discount_amount_rp,
    created_at, updated_at
  ) VALUES (
    v_customer.id::text,
    COALESCE(p_payload->>'customer_name', v_customer.name, ''),
    COALESCE(p_payload->>'customer_phone', v_customer.wa_number, ''),
    COALESCE(p_payload->>'customer_company', v_customer.company, ''),
    COALESCE(p_payload->>'delivery_address', ''),
    v_items_jsonb,
    v_subtotal, v_shipping_fee, v_total, v_hpp_total,
    'TEMPO',
    COALESCE(p_payload->>'channel', 'walkin')::public.sales_channel,
    COALESCE(p_payload->>'sales_channel', p_payload->>'channel', 'walkin')::public.sales_channel,
    'INVOICE_TEMPO',
    v_due_date,
    COALESCE(p_payload->>'delivery_type', 'PICKUP'),
    (now() + interval '90 days'),
    v_order_discount_type, v_order_discount_val, v_order_discount_amt,
    now(), now()
  ) RETURNING id INTO v_order_id;

  -- ── NEW: dual-write to GL (soft-fail) ─────────────────────────────────────
  SELECT COALESCE(enable_dual_write_to_gl, false) INTO v_dual_write_enabled
    FROM public.accounting_config LIMIT 1;

  IF v_dual_write_enabled THEN
    BEGIN
      -- Build JE lines conditionally
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '1-1400', 'side', 'DEBIT', 'amount', v_total,
          'description', 'AR Tempo ' || COALESCE(v_customer.name, '')
        ),
        jsonb_build_object(
          'account_code', '4-1140', 'side', 'CREDIT',
          'amount', v_recomputed_subtotal + v_line_discount_total,
          'description', 'Revenue Tempo ' || COALESCE(v_customer.name, '')
        )
      );

      -- Diskon leg (only if > 0)
      IF (v_line_discount_total + v_order_discount_amt) > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_object(
          'account_code', '4-1900', 'side', 'DEBIT',
          'amount', v_line_discount_total + v_order_discount_amt,
          'description', 'Diskon Penjualan Tempo'
        );
      END IF;

      -- HPP stock pair (only if > 0)
      IF v_hpp_stock_total > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_object(
          'account_code', '5-1100', 'side', 'DEBIT', 'amount', v_hpp_stock_total,
          'description', 'HPP Penjualan Tempo (stock)'
        );
        v_je_lines := v_je_lines || jsonb_build_object(
          'account_code', '1-1510', 'side', 'CREDIT', 'amount', v_hpp_stock_total,
          'description', 'Persediaan Tempo'
        );
      END IF;

      -- HPP passthrough pair (only if > 0)
      IF v_hpp_passthrough_total > 0 THEN
        v_je_lines := v_je_lines || jsonb_build_object(
          'account_code', '5-1200', 'side', 'DEBIT', 'amount', v_hpp_passthrough_total,
          'description', 'HPP Passthrough Tempo (accrual)'
        );
        v_je_lines := v_je_lines || jsonb_build_object(
          'account_code', '2-1150', 'side', 'CREDIT', 'amount', v_hpp_passthrough_total,
          'description', 'Accrued Hutang Passthrough'
        );
      END IF;

      PERFORM public._post_journal_entry(
        p_entry_date       := CURRENT_DATE,
        p_source_type      := 'TEMPO_INVOICE_CREATE'::public.journal_entry_source,
        p_description      := 'Tempo Invoice ' || v_order_id::text,
        p_lines            := v_je_lines,
        p_source_ref_table := 'orders',
        p_source_ref_id    := v_order_id
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        'create_tempo_invoice', 'orders', v_order_id,
        SQLSTATE, SQLERRM, v_je_lines
      );
      RAISE WARNING 'GL dual-write failed for create_tempo_invoice %: [%] %',
        v_order_id, SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;

COMMIT;
```

**Note:** The `[COPY VERBATIM ...]` placeholder in the ── COPY-FROM-PRIOR block must be replaced with the actual body from `20260901000006` lines 60–183. This is the multi-tier validation + discount recompute + credit-limit check. Reading these lines with `Read` tool during implementation is required.

- [ ] **Step 2.4: Apply migration 12 via MCP**

Run via MCP `apply_migration`:
- Name: `20260910000012_create_tempo_invoice_dual_write`
- Query: full contents of Step 2.3 file (after COPY-FROM-PRIOR expansion)

Expected: success, function replaced.

- [ ] **Step 2.5: Run Go tests — verify all pass**

```bash
cd backend-go && go test ./internal/db/ -run TestCreateTempoInvoice_DualWrite -v
```

Expected: 6/6 PASS.

If any test fails, do NOT proceed. Debug (usually: JE balance mismatch = check line composition; anomaly not logged = check EXCEPTION block).

- [ ] **Step 2.6: DB smoke via Supabase MCP execute_sql**

Run:
```sql
DO $$
DECLARE
  v_order uuid;
  v_je    jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users WHERE email = 'tonywei.office@gmail.com' LIMIT 1),
    true);

  UPDATE public.accounting_config SET enable_dual_write_to_gl = true;

  v_order := public.create_tempo_invoice(jsonb_build_object(
    'customer_id',
      (SELECT id FROM public.customers WHERE is_tempo = true LIMIT 1),
    'items', jsonb_build_array(jsonb_build_object(
      'sku', (SELECT sku FROM public.stocks WHERE stock_atas > 0 AND is_passthrough = false LIMIT 1),
      'qty', 1,
      'unit_price', 10000
    )),
    'discount_amount_rp', 1000
  ));

  SELECT jsonb_agg(jsonb_build_object(
    'code', a.account_code, 'side', l.side, 'amount', l.amount
  ) ORDER BY a.account_code)
    INTO v_je
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE e.source_ref_id = v_order AND e.source_type = 'TEMPO_INVOICE_CREATE';

  RAISE NOTICE 'ORDER: %', v_order;
  RAISE NOTICE 'JE LINES: %', v_je;

  RAISE EXCEPTION 'SMOKE_ROLLBACK';
END $$;
```

Expected NOTICE output: JE lines array with 5 legs (D 1-1400 9000, K 4-1140 10000, D 4-1900 1000, D 5-1100 <cost>, K 1-1510 <cost>). Balance: D total = C total. Then `SMOKE_ROLLBACK` exception → all state reverted.

- [ ] **Step 2.7: Browser E2E via chrome-devtools MCP**

Navigate to Cloud Run prod URL (find via `git grep -h 'erp-antigravity' scripts/ | head -1`). Do the following manually via MCP tools:

1. `chrome-devtools:navigate_page` to `?screen=catat-penjualan`
2. `chrome-devtools:list_console_messages` — expect no errors
3. Click customer picker, select a tempo customer, click next
4. Add 1 line item (SKU with stock), set qty 1 + unit_price
5. Set order discount Rp 1000
6. Click Simpan (final wizard step)
7. Verify success toast
8. Query via MCP `execute_sql`:
```sql
SELECT count(*) FROM public.journal_entries
WHERE source_type = 'TEMPO_INVOICE_CREATE'
  AND created_at > now() - interval '5 minutes';
```
Expected: ≥ 1.

9. `chrome-devtools:list_console_messages` — expect no errors post-submit.

- [ ] **Step 2.8: Anomaly log check**

Run via MCP `execute_sql`:
```sql
SELECT count(*), array_agg(DISTINCT error_code)
FROM public.gl_dual_write_anomalies
WHERE source_rpc = 'create_tempo_invoice'
  AND created_at > now() - interval '2 hours';
```
Expected: 0 (or only expected test-injected ones from Step 2.5 if a test row leaked).

- [ ] **Step 2.9: Commit**

```bash
git add supabase/migrations/20260910000012_create_tempo_invoice_dual_write.sql \
        backend-go/internal/db/create_tempo_invoice_dual_write_test.go \
        backend-go/internal/db/fixtures.go
git commit -m "$(cat <<'EOF'
feat(akuntansi): Slice A — create_tempo_invoice dual-write

Extend create_tempo_invoice with per-line passthrough branching + post-INSERT
soft-fail dual-write to journal_entries. JE shape:

  D 1-1400 Piutang Usaha           v_total
  D 4-1900 Diskon Penjualan        line_disc + order_disc (if > 0)
  D 5-1100 HPP Penjualan (stock)   v_hpp_stock_total (if > 0)
  D 5-1200 HPP Passthrough (accr)  v_hpp_passthrough_total (if > 0)
  K 4-1140 Penjualan Tempo         recomputed_subtotal + line_disc (GROSS)
  K 1-1510 Persediaan              paired w/ 5-1100
  K 2-1150 Hutang Passthrough      paired w/ 5-1200

Source type: TEMPO_INVOICE_CREATE. Soft-fail via BEGIN/EXCEPTION per Phase
0b/0c convention. 6 new Go tests cover happy path, zero-diskon, passthrough
branch, flag-off, missing-COA anomaly, mixed lines.

Prod smoke via MCP + browser E2E via chrome-devtools MCP: PASS.

Design: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2.10: Update progress.md**

Prepend:
```markdown
## 2026-07-02 — Sales-side dual-write close: Task 2 (Slice A) SHIPPED

`create_tempo_invoice` now books balanced JE with source_type=TEMPO_INVOICE_CREATE.
Per-line branching on `stocks.is_passthrough` routes stock lines to
5-1100/1-1510 and pass-through lines to 5-1200/2-1150 accrual pair.

- Migration `20260910000012` applied to prod.
- 6/6 Go tests green.
- DB smoke via DO-block: JE 5 legs printed + SMOKE_ROLLBACK OK.
- Browser E2E via chrome-devtools MCP: order created via `?screen=catat-penjualan`,
  1 TEMPO_INVOICE_CREATE JE landed with no console errors.
- Anomaly log: 0 unexpected rows.

Next: Task 3 — Slice B+C `record_pi` PASSTHROUGH swap + LUNAS refactor.
```

Commit progress.md separately.

---

### Task 3: Slices B + C — `record_pi` PASSTHROUGH COA swap + LUNAS-at-create refactor

**Files:**
- Create: `backend-go/internal/db/record_pi_passthrough_dual_write_test.go`
- Create: `supabase/migrations/20260910000013_record_pi_passthrough_and_lunas.sql`
- Modify: `progress.md`

**Interfaces:**
- Consumes: COAs `5-1200`, `2-1150`, `2-1100`, `1-1510`; `journal_entries` from Task 2 (for accrual balance lookup); `public.record_pembayaran(payload jsonb) → jsonb` (Phase 0b dual-write payment leg)
- Produces: modified `public.record_pi(payload jsonb) → jsonb` with:
  - PASSTHROUGH branch: books `D 5-1200 K 2-1100` OR reclass `D 2-1150 K 2-1100` when accrual outstanding for the linked customer order
  - LUNAS-at-create: replaces inline `INSERT INTO pembayaran` with `PERFORM public.record_pembayaran(...)` call

- [ ] **Step 3.1: Write failing Go tests**

File: `backend-go/internal/db/record_pi_passthrough_dual_write_test.go`

Include tests:
- `TestRecordPi_Passthrough_NoAccrualHistory_BooksNonAccrual` — new PASSTHROUGH PI without prior sale-time accrual → `D 5-1200 K 2-1100`
- `TestRecordPi_Passthrough_WithAccrualHistory_BooksReclass` — after Slice A booked accrual for the order, PASSTHROUGH PI → `D 2-1150 K 2-1100` (reclass)
- `TestRecordPi_Stock_Unchanged` — STOCK type still uses `D 1-1510 K 2-1100` per Phase 0c
- `TestRecordPi_Lunas_Passthrough_TriggersPembayaran` — LUNAS-at-create routes through `record_pembayaran`; payment leg `D 2-1100 K <cash>` present
- `TestRecordPi_Lunas_MissingAccountId_RaisesException` — LUNAS without `account_id` → `LUNAS_REQUIRES_CASH_ACCOUNT`
- `TestRecordPi_Passthrough_FlagOff_NoJE` — flag false → no JE
- `TestRecordPi_Passthrough_BrokenCoa_LogsAnomaly` — is_active=false on `5-1200` → anomaly logged, PI succeeds

Test bodies follow the same pattern as Task 2 (see Step 2.1 for template). Assertions inspect `journal_entry_lines` for `source_ref_table='purchase_invoices'` with correct account_code + side + amount.

Test helper additions to `backend-go/internal/db/fixtures.go`:
```go
func EnsureSupplier(t *testing.T, c *TestClient) string {
	t.Helper()
	id := fmt.Sprintf("supp-%d", time.Now().UnixNano())
	_, err := c.DB.Exec(`INSERT INTO public.suppliers (id, name) VALUES ($1::uuid, $2)
		ON CONFLICT (id) DO NOTHING`, id, "Test Supplier "+id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func EnsureCashAccount(t *testing.T, c *TestClient) string {
	t.Helper()
	var id string
	c.DB.QueryRow(`SELECT id FROM public.cash_accounts WHERE account_type='KAS' AND is_active=true LIMIT 1`).Scan(&id)
	if id == "" {
		t.Fatal("no active KAS cash_account seeded")
	}
	return id
}
```

- [ ] **Step 3.2: Run tests to verify failure**

```bash
cd backend-go && go test ./internal/db/ -run TestRecordPi_Passthrough -v
```

Expected: all fail (dual-write not yet swapped).

- [ ] **Step 3.3: Write migration 13 SQL**

File: `supabase/migrations/20260910000013_record_pi_passthrough_and_lunas.sql`

The migration:
1. Includes CAPTURED ORIGINAL BODY comment block from `20260724000002_phase0c_record_pi_dual_write.sql`
2. CREATE OR REPLACE FUNCTION `record_pi` with:
   - **Slice B change**: PASSTHROUGH GL block swaps `1-1510` → `5-1200`, adds accrual balance query + reclass branch
   - **Slice C change**: LUNAS-at-create branch replaces inline `INSERT INTO pembayaran + pembayaran_items` with `PERFORM public.record_pembayaran(...)` call; add `RAISE EXCEPTION 'LUNAS_REQUIRES_CASH_ACCOUNT'` gate

Key delta blocks (rest of function body preserved verbatim from `20260724000002`):

**Slice B — PASSTHROUGH GL block (was ~line 313 in Phase 0c):**
```sql
-- ── Slice B: PASSTHROUGH GL with accrual reclass ─────────────────────────
IF v_type = 'PASSTHROUGH' AND v_dual_write_enabled THEN
  BEGIN
    -- Check for outstanding accrual on this customer order
    SELECT
      COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'CREDIT'), 0) -
      COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'DEBIT'), 0)
    INTO v_accrual_balance
    FROM public.journal_entries e
    JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    WHERE e.source_ref_table = 'orders'
      AND e.source_ref_id    = v_order_id
      AND a.account_code     = '2-1150';

    IF v_accrual_balance >= v_subtotal THEN
      -- Reclass: interim accrual → real AP
      v_je_lines := jsonb_build_array(
        jsonb_build_object('account_code','2-1150','side','DEBIT','amount',v_subtotal,
          'description','Reclass PASSTHROUGH accrual '||v_pi_number),
        jsonb_build_object('account_code','2-1100','side','CREDIT','amount',v_subtotal,
          'description','Hutang Usaha '||v_pi_number)
      );
    ELSE
      -- No prior accrual (historical / cash-based): direct HPP debit
      v_je_lines := jsonb_build_array(
        jsonb_build_object('account_code','5-1200','side','DEBIT','amount',v_subtotal,
          'description','HPP PASSTHROUGH '||v_pi_number),
        jsonb_build_object('account_code','2-1100','side','CREDIT','amount',v_subtotal,
          'description','Hutang Usaha '||v_pi_number)
      );
    END IF;

    PERFORM public._post_journal_entry(
      p_entry_date       := v_purchase_date,
      p_source_type      := 'PI_TAGIHAN'::public.journal_entry_source,
      p_description      := 'PASSTHROUGH PI '||v_pi_number,
      p_lines            := v_je_lines,
      p_source_ref_table := 'purchase_invoices',
      p_source_ref_id    := v_pi_id
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.gl_dual_write_anomalies (
      source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
    ) VALUES (
      'record_pi', 'purchase_invoices', v_pi_id, SQLSTATE, SQLERRM, v_je_lines
    );
    RAISE WARNING 'GL dual-write failed for record_pi PASSTHROUGH %: [%] %', v_pi_id, SQLSTATE, SQLERRM;
  END;
END IF;
```

Also add new local declarations at DECLARE block: `v_accrual_balance numeric := 0;` `v_je_lines jsonb := '[]'::jsonb;` `v_dual_write_enabled boolean;` (if not already present) — check the CAPTURED ORIGINAL BODY.

**Slice C — LUNAS-at-create refactor (replaces the inline pembayaran block in Phase 0c body):**
```sql
-- ── Slice C: LUNAS-at-create routes through record_pembayaran ────────────
IF v_initial_status = 'LUNAS' THEN
  IF payload->>'account_id' IS NULL OR payload->>'payment_method' IS NULL THEN
    RAISE EXCEPTION 'LUNAS_REQUIRES_CASH_ACCOUNT: LUNAS-at-create requires payment_method + account_id';
  END IF;

  -- Delegate to record_pembayaran (Phase 0b dual-write present)
  PERFORM public.record_pembayaran(
    jsonb_build_object(
      'supplier_id',      v_supplier_id,
      'payment_method',   payload->>'payment_method',
      'account_id',       payload->>'account_id',
      'account_label',    payload->>'account_label',
      'paid_at',          COALESCE((payload->>'paid_at')::timestamptz, now()),
      'items', jsonb_build_array(jsonb_build_object(
        'tagihan_id', v_pi_id,
        'amount',     v_subtotal
      ))
    )
  );

  -- Update PI status locally
  UPDATE public.purchase_invoices
    SET status = 'LUNAS', paid_at = COALESCE((payload->>'paid_at')::timestamptz, now())
    WHERE id = v_pi_id;
END IF;
```

Replace the prior `INSERT INTO pembayaran (...) VALUES (...); INSERT INTO pembayaran_items (...)` block with the above.

**Migration file skeleton:**
```sql
-- 20260910000013 — record_pi: Slice B PASSTHROUGH COA swap + accrual reclass
-- + Slice C LUNAS-at-create refactored to reuse record_pembayaran.
--
-- Design spec: §3.4, §3.5.
-- Rollback: RPC-only (see design §6.3 — shared PI_TAGIHAN enum with Phase 0c
-- prevents clean JE cleanup).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (rollback reference — from 20260724000002):
-- [copy the ENTIRE 20260724000002_phase0c_record_pi_dual_write.sql body
--  as SQL comment prefixed by `-- `]
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  [COPY VERBATIM 20260724000002 DECLARE block]
  -- Add new locals:
  v_accrual_balance numeric := 0;
BEGIN
  [COPY VERBATIM 20260724000002 body from BEGIN through the point where
   v_pi_id is populated, purchase_date captured, and LUNAS-at-create block starts]

  -- Slice C: LUNAS-at-create refactor (REPLACES old inline pembayaran INSERT)
  [SLICE C BLOCK from above]

  [COPY VERBATIM Phase 0c preorder_fulfilled audit + return-value building]

  -- Slice B: PASSTHROUGH GL with accrual reclass (REPLACES Phase 0c
  -- PASSTHROUGH GL block that debited 1-1510)
  [SLICE B BLOCK from above]

  -- ── COPY-FROM-PRIOR: STOCK-type GL block (unchanged) ────────────────────
  [COPY VERBATIM Phase 0c STOCK GL block — D 1-1510 K 2-1100]

  RETURN jsonb_build_object(...);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;

COMMIT;
```

**Implementation note:** Read `supabase/migrations/20260724000002_phase0c_record_pi_dual_write.sql` in full during Step 3.3. Use its DECLARE block + body as base; edit LUNAS block + PASSTHROUGH GL block per above.

- [ ] **Step 3.4: Apply migration 13 via MCP**

Run via MCP `apply_migration`:
- Name: `20260910000013_record_pi_passthrough_and_lunas`
- Query: expanded contents of Step 3.3

Expected: success.

- [ ] **Step 3.5: Run Go tests — verify all pass**

```bash
cd backend-go && go test ./internal/db/ -run TestRecordPi_Passthrough -v
```

Expected: 7/7 PASS.

- [ ] **Step 3.6: DB smoke via MCP**

Run 2 DO-blocks:

**Smoke 1 — PASSTHROUGH PI with prior accrual (create order first via create_tempo_invoice, then record_pi):**
```sql
DO $$
DECLARE
  v_order uuid;
  v_pi jsonb;
  v_je jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users WHERE email='tonywei.office@gmail.com' LIMIT 1), true);
  UPDATE public.accounting_config SET enable_dual_write_to_gl = true;

  -- Step A: create tempo order with passthrough SKU (produces 2-1150 accrual)
  v_order := public.create_tempo_invoice(jsonb_build_object(
    'customer_id', (SELECT id FROM public.customers WHERE is_tempo=true LIMIT 1),
    'items', jsonb_build_array(jsonb_build_object(
      'sku', (SELECT sku FROM public.stocks WHERE is_passthrough=true LIMIT 1),
      'qty', 1, 'unit_price', 10000
    ))
  ));

  -- Step B: record PASSTHROUGH PI linked to that order
  v_pi := public.record_pi(jsonb_build_object(
    'type', 'PASSTHROUGH',
    'supplier_id', (SELECT id FROM public.suppliers LIMIT 1),
    'order_id', v_order,
    'purchase_date', CURRENT_DATE,
    'items', jsonb_build_array(jsonb_build_object(
      'sku', (SELECT sku FROM public.stocks WHERE is_passthrough=true LIMIT 1),
      'qty', 1, 'unit_cost', 8000
    ))
  ));

  SELECT jsonb_agg(jsonb_build_object('code', a.account_code, 'side', l.side, 'amount', l.amount))
    INTO v_je
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE e.source_ref_table = 'purchase_invoices'
    AND e.source_ref_id = (v_pi->>'pi_id')::uuid;

  RAISE NOTICE 'PASSTHROUGH PI JE: %', v_je;
  RAISE EXCEPTION 'SMOKE_ROLLBACK';
END $$;
```
Expected NOTICE: array with 2 legs: `[{code:2-1150,side:DEBIT,amount:8000},{code:2-1100,side:CREDIT,amount:8000}]` (reclass branch).

**Smoke 2 — LUNAS-at-create → payment leg via record_pembayaran:**
```sql
DO $$
DECLARE
  v_pi jsonb;
  v_pi_id uuid;
  v_pembayaran_je jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users WHERE email='tonywei.office@gmail.com' LIMIT 1), true);
  UPDATE public.accounting_config SET enable_dual_write_to_gl = true;

  v_pi := public.record_pi(jsonb_build_object(
    'type', 'STOCK',
    'supplier_id', (SELECT id FROM public.suppliers LIMIT 1),
    'pesanan_id', (SELECT id FROM public.pesanan WHERE status='OPEN' LIMIT 1),
    'purchase_date', CURRENT_DATE,
    'supplier_invoice_number', 'SMOKE-' || extract(epoch from now())::text,
    'initial_status', 'LUNAS',
    'payment_method', 'cash',
    'account_id', (SELECT id FROM public.cash_accounts WHERE account_type='KAS' LIMIT 1),
    'items', jsonb_build_array(jsonb_build_object(
      'sku', (SELECT sku FROM public.stocks WHERE is_passthrough=false LIMIT 1),
      'qty', 1, 'unit_cost', 5000
    ))
  ));
  v_pi_id := (v_pi->>'pi_id')::uuid;

  -- Verify a PEMBAYARAN JE landed via record_pembayaran (Phase 0b path)
  SELECT jsonb_agg(jsonb_build_object('code', a.account_code, 'side', l.side, 'amount', l.amount))
    INTO v_pembayaran_je
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.entry_id
  JOIN public.chart_of_accounts a ON a.id = l.account_id
  WHERE e.source_type = 'PEMBAYARAN'
    AND e.posted_at > now() - interval '10 seconds';

  RAISE NOTICE 'LUNAS Payment JE: %', v_pembayaran_je;
  RAISE EXCEPTION 'SMOKE_ROLLBACK';
END $$;
```
Expected NOTICE: array containing `D 2-1100 5000` + `K 1-11xx 5000` (cash account).

- [ ] **Step 3.7: Browser E2E via chrome-devtools MCP**

1. `navigate_page` to `?screen=pembelian`
2. Click "Buat Tagihan Baru" (PI create button)
3. Select supplier + PASSTHROUGH type + link to customer order
4. Add 1 line
5. Set initial_status = BELUM_LUNAS first, submit
6. Verify success, verify JE via `execute_sql`:
```sql
SELECT count(*) FROM public.journal_entries
WHERE source_type='PI_TAGIHAN' AND created_at > now() - interval '5 minutes';
```
Expected: ≥ 1.

7. Repeat with LUNAS + cash account selection.
8. Verify 2 JEs land (PI_TAGIHAN + PEMBAYARAN).

- [ ] **Step 3.8: Anomaly log check**

```sql
SELECT count(*), array_agg(DISTINCT error_code)
FROM public.gl_dual_write_anomalies
WHERE source_rpc = 'record_pi' AND created_at > now() - interval '2 hours';
```
Expected: 0.

- [ ] **Step 3.9: Commit**

```bash
git add supabase/migrations/20260910000013_record_pi_passthrough_and_lunas.sql \
        backend-go/internal/db/record_pi_passthrough_dual_write_test.go \
        backend-go/internal/db/fixtures.go
git commit -m "$(cat <<'EOF'
feat(akuntansi): Slice B+C — record_pi PASSTHROUGH swap + LUNAS refactor

Slice B: PASSTHROUGH GL now books to 5-1200 (was: incorrectly 1-1510).
Auto-reclass when sale-time accrual on 2-1150 outstanding for the linked
order — books D 2-1150 K 2-1100 instead of D 5-1200 K 2-1100.

Slice C: LUNAS-at-create refactored to PERFORM record_pembayaran (inherits
Phase 0b dual-write payment leg) instead of inline INSERT into pembayaran.
Gates missing account_id/payment_method with LUNAS_REQUIRES_CASH_ACCOUNT.

Historical PI_TAGIHAN entries booking 1-1510 remain untouched (spec §6.3
rollback note — shared source_type prevents clean cleanup).

7 new Go tests. Prod smoke + browser E2E: PASS.

Design: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.4, §3.5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3.10: Update progress.md**

Prepend:
```markdown
## 2026-07-02 — Sales-side dual-write close: Task 3 (Slice B+C) SHIPPED

`record_pi` PASSTHROUGH branch now books to 5-1200 with auto-reclass via
2-1150 balance lookup. LUNAS-at-create refactored to reuse
`record_pembayaran` — payment leg (D 2-1100 K <cash>) inherits Phase 0b's
existing dual-write.

- Migration `20260910000013` applied to prod.
- 7/7 Go tests green.
- DB smoke: PASSTHROUGH reclass JE printed; LUNAS PI payment JE landed.
- Browser E2E via chrome-devtools MCP: 2 PIs created (BELUM_LUNAS then
  LUNAS variant); JE counts confirmed.
- Anomaly log: 0.

Next: Task 4 — Slice D tempo write-off pair.
```

Commit progress.md separately.

---

### Task 4: Slice D — Tempo write-off pair (D1 approve + D2 revert)

**Files:**
- Create: `backend-go/internal/db/approve_tempo_write_off_dual_write_test.go`
- Create: `backend-go/internal/db/revert_tempo_write_off_dual_write_test.go`
- Create: `supabase/migrations/20260910000014_tempo_write_off_pair_dual_write.sql`
- Modify: `progress.md`

**Interfaces:**
- Consumes: COAs `5-3100` Kerugian Piutang, `1-1400` Piutang Usaha; enum values `TEMPO_WRITEOFF` (existing) + `TEMPO_WRITEOFF_REVERT` (from Task 1)
- Produces:
  - modified `public.approve_tempo_write_off_request(p_request_id uuid, ...) → jsonb` with dual-write JE post
  - modified `public.revert_tempo_write_off(p_request_id uuid, ...) → jsonb` with manually-composed reversed JE
  - `journal_entries` rows: `source_type='TEMPO_WRITEOFF'` at approve, `source_type='TEMPO_WRITEOFF_REVERT'` at revert with `reverses_entry_id` linked

- [ ] **Step 4.1: Write failing Go tests — approve**

File: `backend-go/internal/db/approve_tempo_write_off_dual_write_test.go`

Tests:
- `TestApproveTempoWriteOff_HappyPath` — approval books `D 5-3100 K 1-1400` for `outstanding_amount`
- `TestApproveTempoWriteOff_ZeroOutstanding_SkipsJE` — `outstanding_amount=0` → no JE row
- `TestApproveTempoWriteOff_Idempotent_NoDoubleJE` — second approve attempt does not double-post
- `TestApproveTempoWriteOff_FlagOff_NoJE` — flag off → business succeeds, no JE
- `TestApproveTempoWriteOff_MissingCoa_LogsAnomaly` — 5-3100 inactive → business tx succeeds, anomaly logged

Sample body for happy path:
```go
func TestApproveTempoWriteOff_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	requestID := db.SeedTempoWriteOffRequest(t, client, 50000) // outstanding=50000
	_, err := client.DB.Exec(
		`SELECT public.approve_tempo_write_off_request($1::uuid, $2::uuid)`,
		requestID, db.OwnerUUID(t, client),
	)
	if err != nil {
		t.Fatal(err)
	}

	rows, _ := client.DB.Query(`
		SELECT a.account_code, l.side, l.amount
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		JOIN public.chart_of_accounts a ON a.id = l.account_id
		WHERE e.source_ref_id = $1::uuid AND e.source_type='TEMPO_WRITEOFF'
		ORDER BY l.side, a.account_code`, requestID)
	defer rows.Close()

	// Expected 2 rows: D 5-3100 50000 + K 1-1400 50000
	// ... assertion code
}
```

Test helpers to add to `fixtures.go`:
```go
func SeedTempoWriteOffRequest(t *testing.T, c *TestClient, outstanding int) string {
	t.Helper()
	// Create an order + tempo customer + approval_request with PIUTANG_WRITE_OFF type
	// ... (implementation depends on approval_requests schema — see existing tempo tests)
}

func OwnerUUID(t *testing.T, c *TestClient) string {
	t.Helper()
	var id string
	c.DB.QueryRow(`SELECT user_id FROM public.admin_users WHERE role='Owner' LIMIT 1`).Scan(&id)
	return id
}
```

- [ ] **Step 4.2: Write failing Go tests — revert**

File: `backend-go/internal/db/revert_tempo_write_off_dual_write_test.go`

Tests:
- `TestRevertTempoWriteOff_HappyPath` — revert composes swapped lines `D 1-1400 K 5-3100`; `reversed_by_entry_id` populated
- `TestRevertTempoWriteOff_NoPriorApproval_RaisesException` — cannot revert what wasn't approved
- `TestRevertTempoWriteOff_AlreadyReverted_RaisesException` — double revert
- `TestRevertTempoWriteOff_FlagOff_NoJE` — flag off → business tx succeeds, no JE

Sample body for happy path:
```go
func TestRevertTempoWriteOff_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	requestID := db.SeedApprovedTempoWriteOff(t, client, 40000) // outstanding=40000
	_, err := client.DB.Exec(
		`SELECT public.revert_tempo_write_off($1::uuid, $2::uuid, 'user error')`,
		requestID, db.OwnerUUID(t, client),
	)
	if err != nil {
		t.Fatal(err)
	}

	// Verify revert JE
	var d, c float64
	client.DB.QueryRow(`
		SELECT
		  COALESCE(SUM(l.amount) FILTER (WHERE l.side='DEBIT'), 0),
		  COALESCE(SUM(l.amount) FILTER (WHERE l.side='CREDIT'), 0)
		FROM public.journal_entry_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		WHERE e.source_ref_id = $1::uuid AND e.source_type='TEMPO_WRITEOFF_REVERT'`,
		requestID).Scan(&d, &c)
	if d != 40000 || c != 40000 {
		t.Errorf("revert JE totals D=%v C=%v, want both 40000", d, c)
	}

	// Verify reverses_entry_id link
	var linkedCount int
	client.DB.QueryRow(`
		SELECT count(*) FROM public.journal_entries
		WHERE source_type='TEMPO_WRITEOFF' AND source_ref_id=$1::uuid
		  AND reversed_by_entry_id IS NOT NULL`, requestID).Scan(&linkedCount)
	if linkedCount != 1 {
		t.Errorf("expected 1 linked original entry, got %d", linkedCount)
	}
}
```

Test helper additions:
```go
func SeedApprovedTempoWriteOff(t *testing.T, c *TestClient, outstanding int) string {
	t.Helper()
	id := SeedTempoWriteOffRequest(t, c, outstanding)
	// Approve immediately
	_, err := c.DB.Exec(
		`SELECT public.approve_tempo_write_off_request($1::uuid, $2::uuid)`,
		id, OwnerUUID(t, c),
	)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
```

- [ ] **Step 4.3: Run tests to verify failure**

```bash
cd backend-go && go test ./internal/db/ -run "TestApproveTempoWriteOff|TestRevertTempoWriteOff" -v
```

Expected: 9/9 FAIL.

- [ ] **Step 4.4: Write migration 14 SQL**

File: `supabase/migrations/20260910000014_tempo_write_off_pair_dual_write.sql`

```sql
-- 20260910000014 — Slice D: tempo write-off pair (approve + revert) with
-- soft-fail GL dual-write.
--
-- Approve books:      D 5-3100 Kerugian Piutang K 1-1400 Piutang Usaha
-- Revert books:       D 1-1400 K 5-3100 (manually composed — _post_journal_entry
--                     does NOT auto-swap D/C; only links reversed_by_entry_id).
--
-- Design spec: §3.6, §3.7.
-- Rollback: DELETE FROM journal_entries WHERE source_type IN
--   ('TEMPO_WRITEOFF','TEMPO_WRITEOFF_REVERT') — safe (first-writer, no legacy).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (approve_tempo_write_off_request from 20260626000022):
-- [copy from 20260626000022_approve_reject_tempo_write_off_rpcs.sql]
--
-- CAPTURED ORIGINAL BODY (revert_tempo_write_off from 20260626000023):
-- [copy from 20260626000023_revert_tempo_write_off_rpc.sql]
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── approve_tempo_write_off_request with dual-write ──────────────────────────
CREATE OR REPLACE FUNCTION public.approve_tempo_write_off_request(
  [copy signature verbatim from 20260626000022]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  [copy DECLARE block verbatim, add:]
  v_outstanding numeric;
  v_dual_write_enabled boolean;
  v_je_lines jsonb;
  v_order_id uuid;
BEGIN
  [copy existing body — approval status check, request lookup, mark APPROVED, order.outstanding_amount capture]

  -- After request is marked APPROVED and outstanding captured:
  IF v_outstanding > 0 THEN
    SELECT COALESCE(enable_dual_write_to_gl, false)
      INTO v_dual_write_enabled FROM public.accounting_config LIMIT 1;

    IF v_dual_write_enabled THEN
      BEGIN
        v_je_lines := jsonb_build_array(
          jsonb_build_object('account_code','5-3100','side','DEBIT','amount',v_outstanding,
            'description','Piutang Tak Tertagih (write-off)'),
          jsonb_build_object('account_code','1-1400','side','CREDIT','amount',v_outstanding,
            'description','Retire AR '||v_order_id::text)
        );
        PERFORM public._post_journal_entry(
          p_entry_date       := CURRENT_DATE,
          p_source_type      := 'TEMPO_WRITEOFF'::public.journal_entry_source,
          p_description      := 'Tempo Write-Off approved '||p_request_id::text,
          p_lines            := v_je_lines,
          p_source_ref_table := 'approval_requests',
          p_source_ref_id    := p_request_id
        );
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          'approve_tempo_write_off_request', 'approval_requests', p_request_id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'GL dual-write failed for approve_tempo_write_off_request %: [%] %',
          p_request_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN [existing return value];
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_tempo_write_off_request(
  [signature]
) TO authenticated;

-- ── revert_tempo_write_off with manual reversal ──────────────────────────────
CREATE OR REPLACE FUNCTION public.revert_tempo_write_off(
  [copy signature verbatim from 20260626000023]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  [copy existing DECLARE + add:]
  v_orig_entry_id uuid;
  v_orig_entry_number text;
  v_outstanding numeric;
  v_je_lines jsonb;
  v_dual_write_enabled boolean;
BEGIN
  [copy existing body — status check, mark REVERTED]

  -- Find matching original TEMPO_WRITEOFF entry
  SELECT id, entry_number
    INTO v_orig_entry_id, v_orig_entry_number
  FROM public.journal_entries
  WHERE source_ref_table = 'approval_requests'
    AND source_ref_id    = p_request_id
    AND source_type      = 'TEMPO_WRITEOFF'
    AND reversed_by_entry_id IS NULL
  LIMIT 1;

  IF v_orig_entry_id IS NOT NULL THEN
    SELECT COALESCE(enable_dual_write_to_gl, false)
      INTO v_dual_write_enabled FROM public.accounting_config LIMIT 1;

    IF v_dual_write_enabled THEN
      BEGIN
        v_je_lines := jsonb_build_array(
          jsonb_build_object('account_code','1-1400','side','DEBIT','amount',v_outstanding,
            'description','Revert write-off (restore AR)'),
          jsonb_build_object('account_code','5-3100','side','CREDIT','amount',v_outstanding,
            'description','Revert Kerugian Piutang '||v_orig_entry_number)
        );
        PERFORM public._post_journal_entry(
          p_entry_date         := CURRENT_DATE,
          p_source_type        := 'TEMPO_WRITEOFF_REVERT'::public.journal_entry_source,
          p_description        := 'Revert write-off '||v_orig_entry_number,
          p_lines              := v_je_lines,
          p_source_ref_table   := 'approval_requests',
          p_source_ref_id      := p_request_id,
          p_reverses_entry_id  := v_orig_entry_id
        );
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          'revert_tempo_write_off', 'approval_requests', p_request_id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'GL dual-write failed for revert_tempo_write_off %: [%] %',
          p_request_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;

  RETURN [existing return value];
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_tempo_write_off(
  [signature]
) TO authenticated;

COMMIT;
```

Implementation notes: Read `20260626000022_approve_reject_tempo_write_off_rpcs.sql` + `20260626000023_revert_tempo_write_off_rpc.sql` during Step 4.4. Copy the existing bodies verbatim; add the dual-write block at the appropriate insertion point (post-approval / post-revert but before final RETURN).

- [ ] **Step 4.5: Apply migration 14 via MCP**

Run via MCP `apply_migration`:
- Name: `20260910000014_tempo_write_off_pair_dual_write`
- Query: expanded contents

Expected: success.

- [ ] **Step 4.6: Run Go tests — verify all pass**

```bash
cd backend-go && go test ./internal/db/ -run "TestApproveTempoWriteOff|TestRevertTempoWriteOff" -v
```

Expected: 9/9 PASS.

- [ ] **Step 4.7: DB smoke via MCP**

```sql
DO $$
DECLARE
  v_req uuid;
  v_je jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT id::text FROM auth.users WHERE email='tonywei.office@gmail.com' LIMIT 1), true);
  UPDATE public.accounting_config SET enable_dual_write_to_gl = true;

  -- Create a synthetic request. Look up an existing pending PIUTANG_WRITE_OFF
  -- approval and approve it. If none exists, create one via request_tempo_write_off.
  SELECT id INTO v_req
    FROM public.approval_requests
   WHERE type='PIUTANG_WRITE_OFF' AND status='PENDING' LIMIT 1;

  IF v_req IS NULL THEN
    RAISE NOTICE 'No pending write-off request to smoke — skip';
  ELSE
    PERFORM public.approve_tempo_write_off_request(v_req, auth.uid());
    SELECT jsonb_agg(jsonb_build_object('code', a.account_code, 'side', l.side, 'amount', l.amount))
      INTO v_je
    FROM public.journal_entry_lines l
    JOIN public.journal_entries e ON e.id = l.entry_id
    JOIN public.chart_of_accounts a ON a.id = l.account_id
    WHERE e.source_ref_id = v_req AND e.source_type='TEMPO_WRITEOFF';
    RAISE NOTICE 'Approve JE: %', v_je;
  END IF;

  RAISE EXCEPTION 'SMOKE_ROLLBACK';
END $$;
```

Expected NOTICE: `[{code:1-1400,side:CREDIT,amount:X},{code:5-3100,side:DEBIT,amount:X}]`.

- [ ] **Step 4.8: Browser E2E via chrome-devtools MCP**

1. `navigate_page` to `?screen=persetujuan`
2. Filter to PIUTANG_WRITE_OFF tab
3. If no rows: cannot smoke — record limitation and skip UI step (backend smoke via Step 4.7 is enough).
4. If rows present: click Approve on one; verify success toast.
5. `execute_sql`: check `TEMPO_WRITEOFF` JE for that request_id.

- [ ] **Step 4.9: Anomaly log check**

```sql
SELECT count(*)
FROM public.gl_dual_write_anomalies
WHERE source_rpc IN ('approve_tempo_write_off_request','revert_tempo_write_off')
  AND created_at > now() - interval '2 hours';
```
Expected: 0.

- [ ] **Step 4.10: Commit**

```bash
git add supabase/migrations/20260910000014_tempo_write_off_pair_dual_write.sql \
        backend-go/internal/db/approve_tempo_write_off_dual_write_test.go \
        backend-go/internal/db/revert_tempo_write_off_dual_write_test.go \
        backend-go/internal/db/fixtures.go
git commit -m "$(cat <<'EOF'
feat(akuntansi): Slice D — tempo write-off pair dual-write

approve_tempo_write_off_request books D 5-3100 Kerugian Piutang / K 1-1400
Piutang Usaha for outstanding_amount. Source type TEMPO_WRITEOFF (existing
enum spelling).

revert_tempo_write_off manually composes swapped lines (verified
_post_journal_entry.p_reverses_entry_id only links reversed_by_entry_id and
does NOT auto-swap D/C). Source type TEMPO_WRITEOFF_REVERT (new enum from
Task 1).

9 new Go tests. Soft-fail per Phase 0b/0c convention. Prod smoke +
browser E2E: PASS.

Design: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.6, §3.7

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4.11: Update progress.md**

Prepend:
```markdown
## 2026-07-02 — Sales-side dual-write close: Task 4 (Slice D) SHIPPED

Tempo write-off approve + revert both dual-write. Approve books
D 5-3100 / K 1-1400. Revert composes swap manually (D 1-1400 / K 5-3100)
with reverses_entry_id link.

- Migration `20260910000014` applied.
- 9/9 Go tests green.
- DB smoke via DO-block: approve JE lines printed correctly.
- Browser E2E via `?screen=persetujuan`: JE landed after approve click.
- Anomaly log: 0.

Next: Task 5 — Slice E historical backfill.
```

Commit progress.md separately.

---

### Task 5: Slice E — Historical backfill functions + dry-run + real run

**Files:**
- Create: `backend-go/internal/db/backfill_sales_gl_test.go`
- Create: `supabase/migrations/20260910000015_backfill_sales_side_gl.sql`
- Create: `docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: all COAs + enum values from Tasks 1-4; historical rows in `orders`, `purchase_invoices`, `approval_requests`
- Produces:
  - `_backfill_preview_je` table for dry-run inspection
  - 4 `_backfill_*` functions callable via MCP:
    - `_backfill_tempo_invoice_gl(date, date, int, boolean) → jsonb`
    - `_backfill_pi_passthrough_gl(date, date, int, boolean) → jsonb`
    - `_backfill_pi_lunas_payment_gl(date, date, int, boolean) → jsonb`
    - `_backfill_tempo_write_off_gl(date, date, int, boolean) → jsonb`
  - `journal_entries` rows with `source_type LIKE 'BACKFILL_%'`

- [ ] **Step 5.1: Write failing Go tests**

File: `backend-go/internal/db/backfill_sales_gl_test.go`

Tests:
- `TestBackfillTempoInvoice_DryRun_PopulatesPreview` — dry-run writes to `_backfill_preview_je`, not `journal_entries`
- `TestBackfillTempoInvoice_RealRun_PostsJEs` — real run posts entries with `source_type='BACKFILL_TEMPO_INVOICE'`
- `TestBackfillTempoInvoice_Idempotent_SecondRunZero` — second run posts 0 new entries
- `TestBackfillTempoInvoice_ClosedPeriod_Skipped` — targets a closed period → anomaly `BACKFILL_PERIOD_CLOSED`, entry skipped
- `TestBackfillPiLunas_SkipsBelumLunas` — only LUNAS-at-create rows get payment leg backfilled
- `TestBackfillTempoWriteOff_SkipsAlreadyJournaled` — rows with existing `TEMPO_WRITEOFF` JE are skipped

Body pattern:
```go
func TestBackfillTempoInvoice_DryRun_PopulatesPreview(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.SetDualWriteEnabled(t, client, true)
	defer db.SetDualWriteEnabled(t, client, false)

	// Seed a historical tempo order (pre-Slice-A, so no JE)
	orderID := db.SeedHistoricalTempoOrder(t, client, "2026-06-15")

	var result string
	if err := client.DB.QueryRow(
		`SELECT public._backfill_tempo_invoice_gl(
		   $1::date, $2::date, 500, true /* dry_run */
		 )::text`,
		"2026-06-01", "2026-06-30",
	).Scan(&result); err != nil {
		t.Fatal(err)
	}

	// Assert: preview table has 1 row, journal_entries has 0
	var previewCount, jeCount int
	client.DB.QueryRow(`SELECT count(*) FROM public._backfill_preview_je WHERE source_row_id=$1::uuid`, orderID).Scan(&previewCount)
	client.DB.QueryRow(`SELECT count(*) FROM public.journal_entries WHERE source_ref_id=$1::uuid`, orderID).Scan(&jeCount)

	if previewCount != 1 {
		t.Errorf("expected 1 preview row, got %d", previewCount)
	}
	if jeCount != 0 {
		t.Errorf("expected 0 JE rows in dry-run, got %d", jeCount)
	}
}
```

Test helpers to `fixtures.go`:
```go
func SeedHistoricalTempoOrder(t *testing.T, c *TestClient, dateISO string) string {
	t.Helper()
	// Directly INSERT INTO orders with payment_type='TEMPO', bypassing
	// create_tempo_invoice, with created_at set to dateISO. This simulates
	// pre-Slice-A data.
	// ... (implementation matches orders schema)
}
```

- [ ] **Step 5.2: Run tests to verify failure**

```bash
cd backend-go && go test ./internal/db/ -run TestBackfill -v
```

Expected: 6/6 FAIL.

- [ ] **Step 5.3: Write migration 15 SQL**

File: `supabase/migrations/20260910000015_backfill_sales_side_gl.sql`

Migration contents (skeleton with 4 functions + preview table):

```sql
-- 20260910000015 — Historical backfill functions for sales-side GL.
--
-- Defines (does NOT execute) 4 idempotent backfill functions targeting
-- pre-Slice-A/B/C/D historical rows. Each function accepts p_dry_run
-- boolean — when true, writes to _backfill_preview_je instead of
-- journal_entries.
--
-- Execution order (see design spec §4.3):
--   1. _backfill_tempo_invoice_gl
--   2. _backfill_pi_passthrough_gl  (finds accruals from step 1)
--   3. _backfill_pi_lunas_payment_gl
--   4. _backfill_tempo_write_off_gl
--
-- Anomaly codes (via gl_dual_write_anomalies.error_code):
--   BACKFILL_PERIOD_CLOSED      — target period closed
--   BACKFILL_COA_MISSING        — COA not seeded (should not happen)
--   BACKFILL_UNBALANCED         — computed JE fails balance
--   BACKFILL_ALREADY_JOURNALED  — INFO benign skip
--   BACKFILL_PASSTHROUGH_AMBIGUOUS — SKU flag heuristic uncertain
--
-- Design spec: §4.

BEGIN;

-- Preview table for dry-run
CREATE TABLE IF NOT EXISTS public._backfill_preview_je (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  source_fn      text NOT NULL,
  source_row_id  uuid NOT NULL,
  planned_date   date NOT NULL,
  planned_lines  jsonb NOT NULL,
  reason         text
);
CREATE INDEX IF NOT EXISTS idx_backfill_preview_row ON public._backfill_preview_je (source_row_id);

-- ── Function 1: _backfill_tempo_invoice_gl ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._backfill_tempo_invoice_gl(
  p_from_date date    DEFAULT '2026-06-01',
  p_to_date   date    DEFAULT CURRENT_DATE,
  p_batch     int     DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order record;
  v_eligible int := 0;
  v_skipped_closed int := 0;
  v_skipped_journaled int := 0;
  v_posted int := 0;
  v_je_lines jsonb;
  v_ar numeric;
  v_hpp_stock numeric;
  v_hpp_pt numeric;
BEGIN
  FOR v_order IN
    SELECT o.id, o.total, o.subtotal, o.hpp_total,
           o.discount_amount_rp, o.customer_name, o.items,
           o.created_at::date AS order_date
    FROM public.orders o
    WHERE o.payment_type = 'TEMPO'
      AND o.created_at::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table='orders' AND e.source_ref_id = o.id
          AND e.source_type IN ('TEMPO_INVOICE_CREATE','BACKFILL_TEMPO_INVOICE')
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    -- Period-closed check
    IF EXISTS (SELECT 1 FROM public.accounting_periods
               WHERE period_year = EXTRACT(YEAR FROM v_order.order_date)::int
                 AND period_month = EXTRACT(MONTH FROM v_order.order_date)::int
                 AND status = 'CLOSED') THEN
      v_skipped_closed := v_skipped_closed + 1;
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
      ) VALUES (
        '_backfill_tempo_invoice_gl', 'orders', v_order.id,
        'BACKFILL_PERIOD_CLOSED', 'Target period closed', '{}'::jsonb
      );
      CONTINUE;
    END IF;

    -- Compute per-line HPP split (stock vs passthrough) from items JSONB
    -- (uses is_passthrough on stocks; falls back to non-passthrough if SKU
    --  not found)
    SELECT
      COALESCE(SUM((line->>'qty')::numeric * COALESCE(s.harga_modal, 0))
        FILTER (WHERE COALESCE(s.is_passthrough, false) = false), 0),
      COALESCE(SUM((line->>'qty')::numeric * COALESCE(s.harga_modal, 0))
        FILTER (WHERE COALESCE(s.is_passthrough, false) = true), 0)
    INTO v_hpp_stock, v_hpp_pt
    FROM jsonb_array_elements(v_order.items) line
    LEFT JOIN public.stocks s ON s.sku = line->>'sku';

    v_ar := v_order.total;
    -- Build JE lines
    v_je_lines := jsonb_build_array(
      jsonb_build_object('account_code','1-1400','side','DEBIT','amount',v_ar,'description','Backfill AR'),
      jsonb_build_object('account_code','4-1140','side','CREDIT','amount',v_order.subtotal,'description','Backfill revenue')
    );
    IF COALESCE(v_order.discount_amount_rp, 0) > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_object(
        'account_code','4-1900','side','DEBIT','amount',v_order.discount_amount_rp,'description','Backfill diskon');
    END IF;
    IF v_hpp_stock > 0 THEN
      v_je_lines := v_je_lines
        || jsonb_build_object('account_code','5-1100','side','DEBIT','amount',v_hpp_stock,'description','Backfill HPP stock')
        || jsonb_build_object('account_code','1-1510','side','CREDIT','amount',v_hpp_stock,'description','Backfill persediaan');
    END IF;
    IF v_hpp_pt > 0 THEN
      v_je_lines := v_je_lines
        || jsonb_build_object('account_code','5-1200','side','DEBIT','amount',v_hpp_pt,'description','Backfill HPP passthrough')
        || jsonb_build_object('account_code','2-1150','side','CREDIT','amount',v_hpp_pt,'description','Backfill accrued PT');
    END IF;

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES ('_backfill_tempo_invoice_gl', v_order.id, v_order.order_date, v_je_lines, 'eligible');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_order.order_date,
          p_source_type      := 'BACKFILL_TEMPO_INVOICE'::public.journal_entry_source,
          p_description      := 'Backfill Tempo Invoice '||v_order.id::text,
          p_lines            := v_je_lines,
          p_source_ref_table := 'orders',
          p_source_ref_id    := v_order.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_tempo_invoice_gl', 'orders', v_order.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'Backfill JE failed for order %: [%] %', v_order.id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'skipped_period_closed', v_skipped_closed,
    'skipped_already_journaled', v_skipped_journaled,
    'posted', v_posted,
    'dry_run', p_dry_run
  );
END;
$$;

-- ── Function 2: _backfill_pi_passthrough_gl ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._backfill_pi_passthrough_gl(
  p_from_date date DEFAULT '2026-06-01',
  p_to_date   date DEFAULT CURRENT_DATE,
  p_batch     int  DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pi record;
  v_eligible int := 0;
  v_posted int := 0;
  v_je_lines jsonb;
  v_accrual_balance numeric;
BEGIN
  FOR v_pi IN
    SELECT pi.id, pi.pi_number, pi.subtotal, pi.order_id, pi.purchase_date
    FROM public.purchase_invoices pi
    WHERE pi.type = 'PASSTHROUGH'
      AND pi.purchase_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table='purchase_invoices' AND e.source_ref_id = pi.id
          AND e.source_type IN ('PI_TAGIHAN','BACKFILL_PI_PASSTHROUGH')
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    -- Check accrual outstanding on the linked order (from _backfill_tempo_invoice_gl)
    SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.side='CREDIT'),0)
         - COALESCE(SUM(l.amount) FILTER (WHERE l.side='DEBIT'),0)
      INTO v_accrual_balance
    FROM public.journal_entries e
    JOIN public.journal_entry_lines l ON l.entry_id=e.id
    JOIN public.chart_of_accounts a ON a.id=l.account_id
    WHERE e.source_ref_table='orders' AND e.source_ref_id = v_pi.order_id
      AND a.account_code='2-1150';

    IF v_accrual_balance >= v_pi.subtotal THEN
      v_je_lines := jsonb_build_array(
        jsonb_build_object('account_code','2-1150','side','DEBIT','amount',v_pi.subtotal,'description','Backfill reclass'),
        jsonb_build_object('account_code','2-1100','side','CREDIT','amount',v_pi.subtotal,'description','Backfill AP')
      );
    ELSE
      v_je_lines := jsonb_build_array(
        jsonb_build_object('account_code','5-1200','side','DEBIT','amount',v_pi.subtotal,'description','Backfill HPP PT'),
        jsonb_build_object('account_code','2-1100','side','CREDIT','amount',v_pi.subtotal,'description','Backfill AP')
      );
    END IF;

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES ('_backfill_pi_passthrough_gl', v_pi.id, v_pi.purchase_date, v_je_lines,
              CASE WHEN v_accrual_balance >= v_pi.subtotal THEN 'reclass' ELSE 'non-accrual' END);
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_pi.purchase_date,
          p_source_type      := 'BACKFILL_PI_PASSTHROUGH'::public.journal_entry_source,
          p_description      := 'Backfill PASSTHROUGH PI '||v_pi.pi_number,
          p_lines            := v_je_lines,
          p_source_ref_table := 'purchase_invoices',
          p_source_ref_id    := v_pi.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_pi_passthrough_gl', 'purchase_invoices', v_pi.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible', v_eligible, 'posted', v_posted, 'dry_run', p_dry_run
  );
END;
$$;

-- ── Function 3: _backfill_pi_lunas_payment_gl ───────────────────────────────
CREATE OR REPLACE FUNCTION public._backfill_pi_lunas_payment_gl(
  p_from_date date DEFAULT '2026-06-01',
  p_to_date   date DEFAULT CURRENT_DATE,
  p_batch     int  DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pi record;
  v_pembayaran record;
  v_eligible int := 0;
  v_posted int := 0;
  v_je_lines jsonb;
  v_cash_coa text;
BEGIN
  FOR v_pi IN
    SELECT pi.id, pi.pi_number, pi.subtotal, pi.purchase_date
    FROM public.purchase_invoices pi
    WHERE pi.initial_status_at_create = 'LUNAS'
      AND pi.status = 'LUNAS'
      AND pi.purchase_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_type IN ('PEMBAYARAN','BACKFILL_PEMBAYARAN')
          AND e.source_ref_id = pi.id
          -- (approximation — pembayaran source_ref is on pembayaran table normally)
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    -- Look up the synthesized pembayaran + resolve cash COA from account_id
    SELECT pmt.account_id, ca.parent_account_code
      INTO v_pembayaran
    FROM public.pembayaran pmt
    LEFT JOIN public.cash_accounts ca ON ca.id = pmt.account_id
    WHERE pmt.supplier_id = (SELECT supplier_id FROM public.purchase_invoices WHERE id=v_pi.id)
      AND EXISTS (SELECT 1 FROM public.pembayaran_items pi_i
                  WHERE pi_i.pembayaran_id = pmt.id AND pi_i.tagihan_id = v_pi.id)
    ORDER BY pmt.paid_at DESC LIMIT 1;

    v_cash_coa := COALESCE(v_pembayaran.parent_account_code, '1-1110'); -- fallback

    v_je_lines := jsonb_build_array(
      jsonb_build_object('account_code','2-1100','side','DEBIT','amount',v_pi.subtotal,'description','Backfill LUNAS AP retire'),
      jsonb_build_object('account_code', v_cash_coa,'side','CREDIT','amount',v_pi.subtotal,'description','Backfill LUNAS cash')
    );

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES ('_backfill_pi_lunas_payment_gl', v_pi.id, v_pi.purchase_date, v_je_lines, 'lunas');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_pi.purchase_date,
          p_source_type      := 'BACKFILL_PEMBAYARAN'::public.journal_entry_source,
          p_description      := 'Backfill LUNAS payment '||v_pi.pi_number,
          p_lines            := v_je_lines,
          p_source_ref_table := 'purchase_invoices',
          p_source_ref_id    := v_pi.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_pi_lunas_payment_gl', 'purchase_invoices', v_pi.id, SQLSTATE, SQLERRM, v_je_lines
        );
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('eligible', v_eligible, 'posted', v_posted, 'dry_run', p_dry_run);
END;
$$;

-- ── Function 4: _backfill_tempo_write_off_gl ────────────────────────────────
CREATE OR REPLACE FUNCTION public._backfill_tempo_write_off_gl(
  p_from_date date DEFAULT '2026-06-01',
  p_to_date   date DEFAULT CURRENT_DATE,
  p_batch     int  DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_req record;
  v_eligible int := 0;
  v_posted int := 0;
  v_je_lines jsonb;
BEGIN
  FOR v_req IN
    SELECT ar.id, ar.updated_at::date AS approve_date, ar.payload
    FROM public.approval_requests ar
    WHERE ar.type = 'PIUTANG_WRITE_OFF' AND ar.status = 'APPROVED'
      AND ar.updated_at::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table='approval_requests' AND e.source_ref_id = ar.id
          AND e.source_type IN ('TEMPO_WRITEOFF','BACKFILL_TEMPO_WRITEOFF')
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    v_je_lines := jsonb_build_array(
      jsonb_build_object('account_code','5-3100','side','DEBIT','amount',(v_req.payload->>'outstanding_amount')::numeric,
        'description','Backfill Kerugian Piutang'),
      jsonb_build_object('account_code','1-1400','side','CREDIT','amount',(v_req.payload->>'outstanding_amount')::numeric,
        'description','Backfill retire AR')
    );

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES ('_backfill_tempo_write_off_gl', v_req.id, v_req.approve_date, v_je_lines, 'approved');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_req.approve_date,
          p_source_type      := 'BACKFILL_TEMPO_WRITEOFF'::public.journal_entry_source,
          p_description      := 'Backfill write-off '||v_req.id::text,
          p_lines            := v_je_lines,
          p_source_ref_table := 'approval_requests',
          p_source_ref_id    := v_req.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id, error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_tempo_write_off_gl', 'approval_requests', v_req.id, SQLSTATE, SQLERRM, v_je_lines
        );
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('eligible', v_eligible, 'posted', v_posted, 'dry_run', p_dry_run);
END;
$$;

-- Grants (backfill triggered by owner via MCP — no user execute needed)
REVOKE ALL ON FUNCTION public._backfill_tempo_invoice_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_pi_passthrough_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_pi_lunas_payment_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_tempo_write_off_gl(date, date, int, boolean) FROM PUBLIC;

COMMIT;
```

- [ ] **Step 5.4: Apply migration 15 via MCP**

Run via MCP `apply_migration`:
- Name: `20260910000015_backfill_sales_side_gl`
- Query: full contents

Expected: success, 4 functions + 1 table + 1 index created.

- [ ] **Step 5.5: Run Go tests — verify pass**

```bash
cd backend-go && go test ./internal/db/ -run TestBackfill -v
```

Expected: 6/6 PASS.

- [ ] **Step 5.6: Dry-run all 4 functions via MCP**

Run each in sequence:
```sql
SELECT public._backfill_tempo_invoice_gl('2026-06-01', CURRENT_DATE, 500, true);
SELECT public._backfill_pi_passthrough_gl('2026-06-01', CURRENT_DATE, 500, true);
SELECT public._backfill_pi_lunas_payment_gl('2026-06-01', CURRENT_DATE, 500, true);
SELECT public._backfill_tempo_write_off_gl('2026-06-01', CURRENT_DATE, 500, true);
```

Expected: JSONB summaries with `dry_run: true`, `eligible: N` for each. Record eligible counts.

- [ ] **Step 5.7: Review preview table**

```sql
SELECT source_fn, count(*), min(planned_date), max(planned_date)
FROM public._backfill_preview_je
GROUP BY source_fn;
```

Expected: 4 rows (one per function). Cross-check counts against Step 5.6 summaries.

Spot-check a preview row's `planned_lines`:
```sql
SELECT source_fn, planned_date, jsonb_pretty(planned_lines)
FROM public._backfill_preview_je
LIMIT 5;
```

Expected: legible balanced JE lines. Eye-check math.

- [ ] **Step 5.8: STOP — get user approval before real run**

The next step will post JEs to production `journal_entries`. Confirm with user:
- "Dry-run summaries: <counts>. Preview table shows <sample>. OK to execute real backfill? Will apply in same order as dry-run."

Wait for user 'yes' before proceeding to Step 5.9.

- [ ] **Step 5.9: Real run — execute all 4 functions in order**

```sql
-- Reopen any 2026-06 periods that might be closed (verify none first!):
SELECT period_year, period_month, status FROM public.accounting_periods
WHERE period_year=2026 AND period_month IN (6,7);
-- If any 'CLOSED' → user decides: reopen or accept skip.

-- Then execute in order:
SELECT public._backfill_tempo_invoice_gl('2026-06-01', CURRENT_DATE, 500, false);
SELECT public._backfill_pi_passthrough_gl('2026-06-01', CURRENT_DATE, 500, false);
SELECT public._backfill_pi_lunas_payment_gl('2026-06-01', CURRENT_DATE, 500, false);
SELECT public._backfill_tempo_write_off_gl('2026-06-01', CURRENT_DATE, 500, false);
```

Expected: `dry_run: false, posted: N` for each. `posted` should match `eligible - skipped_*`.

- [ ] **Step 5.10: Validation queries**

Run these 5 queries via MCP:

**Q1: Every tempo order has exactly 1 AR-creation JE**
```sql
SELECT count(*) AS missing_je_orders FROM public.orders o
WHERE o.payment_type = 'TEMPO' AND o.created_at >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_ref_table='orders' AND e.source_ref_id=o.id
      AND e.source_type IN ('TEMPO_INVOICE_CREATE','BACKFILL_TEMPO_INVOICE')
  );
```
Expected: 0.

**Q2: Every PASSTHROUGH PI has exactly 1 GL entry**
```sql
SELECT count(*) FROM public.purchase_invoices pi
WHERE pi.type='PASSTHROUGH' AND pi.purchase_date >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_ref_table='purchase_invoices' AND e.source_ref_id=pi.id
      AND e.source_type IN ('PI_TAGIHAN','BACKFILL_PI_PASSTHROUGH')
  );
```
Expected: 0.

**Q3: Every LUNAS-at-create PI has a payment JE**
```sql
SELECT count(*) FROM public.purchase_invoices pi
WHERE pi.initial_status_at_create='LUNAS' AND pi.purchase_date >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_type IN ('PEMBAYARAN','BACKFILL_PEMBAYARAN')
      AND (e.source_ref_id = pi.id OR e.source_ref_id IN
        (SELECT id FROM public.pembayaran WHERE supplier_id=pi.supplier_id))
  );
```
Expected: 0 (approximate — cross-source_ref makes this a heuristic check).

**Q4: Every approved tempo write-off has 1 JE**
```sql
SELECT count(*) FROM public.approval_requests ar
WHERE ar.type='PIUTANG_WRITE_OFF' AND ar.status='APPROVED'
  AND ar.updated_at >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_ref_table='approval_requests' AND e.source_ref_id=ar.id
      AND e.source_type IN ('TEMPO_WRITEOFF','BACKFILL_TEMPO_WRITEOFF')
  );
```
Expected: 0.

**Q5: All backfilled JEs balance**
```sql
SELECT e.id, e.total_debit, e.total_credit
FROM public.journal_entries e
WHERE e.source_type LIKE 'BACKFILL_%' AND e.total_debit <> e.total_credit;
```
Expected: 0 rows.

- [ ] **Step 5.11: Write monitoring queries doc**

File: `docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md`

```markdown
# Sales-Side Dual-Write — Monitoring Queries

Saved from 2026-07-02 implementation. Run daily for first week post-deploy.

## 1. Anomaly rate per RPC per day
```sql
SELECT date_trunc('day', created_at) AS d, source_rpc, count(*)
FROM public.gl_dual_write_anomalies
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
```
Investigate any RPC with ≥ 5 anomalies/day.

## 2. JE-to-source ratio (target 1:1 for post-backfill data)
```sql
-- Orders vs Tempo JE count
SELECT count(DISTINCT o.id) AS orders,
       count(DISTINCT e.source_ref_id) AS je_orders
FROM public.orders o
LEFT JOIN public.journal_entries e
  ON e.source_ref_table='orders' AND e.source_ref_id=o.id
  AND e.source_type IN ('TEMPO_INVOICE_CREATE','BACKFILL_TEMPO_INVOICE')
WHERE o.payment_type='TEMPO' AND o.created_at >= '2026-06-01';
```
Investigate if orders != je_orders.

## 3. Per-source balance check
```sql
SELECT e.source_type, count(*) AS unbalanced_count
FROM public.journal_entries e
WHERE e.total_debit <> e.total_credit
GROUP BY 1;
```
Expected: 0 rows.

## 4. Recent JE per source_type breakdown
```sql
SELECT source_type, count(*), min(posted_at), max(posted_at)
FROM public.journal_entries
WHERE posted_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 2 DESC;
```
Look for missing types (e.g., zero TEMPO_INVOICE_CREATE despite tempo sales happening).
```

- [ ] **Step 5.12: Commit**

```bash
git add supabase/migrations/20260910000015_backfill_sales_side_gl.sql \
        backend-go/internal/db/backfill_sales_gl_test.go \
        docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md
git commit -m "$(cat <<'EOF'
feat(akuntansi): Slice E — historical backfill functions + real run

4 idempotent backfill functions defined in migration 20260910000015:
- _backfill_tempo_invoice_gl (Slice A shape, source_type=BACKFILL_TEMPO_INVOICE)
- _backfill_pi_passthrough_gl (Slice B shape, includes reclass branch)
- _backfill_pi_lunas_payment_gl (Slice C shape)
- _backfill_tempo_write_off_gl (Slice D1 shape)

Each supports p_dry_run mode via _backfill_preview_je table for inspection
without touching journal_entries.

Executed dry-run → user-approved counts → real run for 2026-06-01 to
CURRENT_DATE. Validation queries returned 0 for missing-JE and 0 for
unbalanced entries.

6 new Go tests. Monitoring queries saved to
docs/superpowers/plans/2026-07-02-sales-dual-write-monitoring-queries.md.

Design: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5.13: Update progress.md — reconciliation summary**

Prepend:
```markdown
## 2026-07-02 — Sales-side dual-write close: Task 5 (Slice E backfill) SHIPPED

Historical backfill for 2026-06-01 → today executed. 4 functions ran in
order, dry-run counts approved by user, real run posted <N> total JE
across TEMPO_INVOICE / PI_PASSTHROUGH / PEMBAYARAN / TEMPO_WRITEOFF
backfill variants.

- Migration `20260910000015` applied.
- 6/6 Go tests green.
- Dry-run summaries: <copy actual counts from Step 5.6>
- Real run posted: <copy actual counts from Step 5.9>
- Validation Q1-Q5: all returned 0 (no missing JE, no unbalanced entries).
- Monitoring queries saved for daily first-week review.

Pre-fix vs post-fix Neraca / L-R 2026-06 comparison:
- Pendapatan 4-1140 Tempo: was Rp 0 → now Rp <N>
- HPP 5-1100 stock (tempo portion): was Rp 0 → now Rp <N>
- HPP 5-1200 passthrough: was Rp 0 → now Rp <N>
- Kerugian Piutang 5-3100: was Rp 0 → now Rp <N>
- Persediaan 1-1510 reduction (tempo HPP-driven): now Rp -<N>
- Hutang Passthrough Accrued 2-1150: outstanding Rp <N>

Next: Task 6 — post-launch cleanup + follow-ups.
```

Fill `<N>` values from actual query results. Commit progress.md separately.

---

### Task 6: Post-launch cleanup + follow-up tracking

**Files:**
- Modify: `supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql` (remove `TODO(Phase 0c sales dual-write)` markers)
- Modify: `supabase/migrations/20260901000006_create_tempo_invoice_tier.sql` (remove TODO markers)
- Modify: `supabase/migrations/20260901000008_review_fixes_i4_rpc_tier_default.sql` (remove TODO markers)
- Modify: `docs/product/PRD.md` (add one-line accounting completeness note)
- Modify: `progress.md` (final wrap-up entry)

**Interfaces:** none (documentation cleanup only)

- [ ] **Step 6.1: Verify no stale TODO markers remain**

```bash
grep -rn "TODO(Phase 0c sales dual-write)" supabase/migrations/ | wc -l
```

Note the count. Any file where the RPC has been superseded by our migrations 12/13 — remove the TODO markers as PR hygiene.

- [ ] **Step 6.2: Edit migration TODOs**

For each of the 3 migration files listed, use `Edit` to remove the block:

Before:
```sql
-- TODO(Phase 0c sales dual-write): when create_tempo_invoice gains GL dual-write,
--   append a debit line to 4-1900 (Diskon Penjualan) for
--   (v_line_discount_total + v_order_discount_amt) so the journal entry
--   balances: D AR + D 4-1900 = C Pendapatan (gross). Tracked as Phase 0c
--   sales dual-write follow-up — dual-write is NOT present in this RPC yet.
```

After:
```sql
-- (Dual-write closed 2026-07-02 in migration 20260910000012 — Slice A.)
```

Do NOT modify the CREATE OR REPLACE FUNCTION body — only the comments.

- [ ] **Step 6.3: Update PRD accounting completeness note**

Read `docs/product/PRD.md`. Find the accounting section (likely a subheading like "Akuntansi" or "GL / Accounting"). Add one line:

> Sales-side GL dual-write: complete as of 2026-07-02 (spec: `docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md`). AR-creation, HPP, discount, tempo write-off, and PASSTHROUGH accrual all book to journal_entries with SAK EMKM–aligned COA. Multi-tenant + PKP handling deferred to Phase 1.

Position it under the "Akuntansi" heading. Do not restructure other content.

- [ ] **Step 6.4: Commit cleanup**

```bash
git add supabase/migrations/20260801000005_create_tempo_invoice_with_discount.sql \
        supabase/migrations/20260901000006_create_tempo_invoice_tier.sql \
        supabase/migrations/20260901000008_review_fixes_i4_rpc_tier_default.sql \
        docs/product/PRD.md
git commit -m "$(cat <<'EOF'
docs(akuntansi): retire Phase 0c sales dual-write TODO markers

All TODOs in create_tempo_invoice-related migrations superseded by
2026-07-02 slice-A shipment (migration 20260910000012). Replace TODO
blocks with a single-line pointer to the closing migration.

PRD accounting section updated: sales-side GL dual-write flagged
complete per SAK EMKM. Multi-tenant + PKP deferred to Phase 1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6.5: Final progress.md wrap-up**

Prepend:
```markdown
## 2026-07-02 — Sales-side dual-write close: COMPLETE (all 5 slices + backfill shipped)

Wrap-up entry for the 2026-07-02 sales-side dual-write close initiative.

**Shipped:**
- Migration 10: COA seed (5-1200, 2-1150) + 6 new enum values
- Migration 11: stocks.is_passthrough + heuristic backfill
- Migration 12: Slice A — create_tempo_invoice dual-write
- Migration 13: Slice B+C — record_pi PASSTHROUGH swap + LUNAS refactor
- Migration 14: Slice D — tempo write-off pair
- Migration 15: Slice E — 4 backfill functions + real run

**Numbers:**
- Total Go tests: 33 (Slice A 6, B/C 7, D1 5, D2 4, E 6, plus helpers reused across)
- Total dual-write anomalies during rollout: <N>
- Total backfilled JE: <N>
- Wall-clock: <N> days

**Deferred (spec §8):**
- PKP tenants (2-1200 PPN Keluaran)
- Multi-tenant tenant_id filter (Sub-Project A dependency)
- Allowance method for bad debt (SAK ETAP tier only)
- Hard-fail dual-write upgrade
- admin_adjust_journal SD RPC for anomaly correction
- ProductForm UI toggle for is_passthrough

**Follow-ups tracked** in the design spec §8 for future retrieval.
```

Commit progress.md.

- [ ] **Step 6.6: Sanity — post-rollout anomaly sweep**

```sql
SELECT source_rpc, error_code, count(*)
FROM public.gl_dual_write_anomalies
WHERE created_at > '2026-07-02'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

If any high-count buckets (≥ 20 per RPC): investigate before declaring closure. If clean, done.

---

## Self-Review Summary

**Spec coverage:**
- §1 goals — Task 2/3/4/5 all book balanced JE via soft-fail (goals 1–3) ✓; PASSTHROUGH swap (goal 4) in Task 3 ✓; LUNAS refactor (goal 5) in Task 3 ✓; backfill (goal 6) in Task 5 ✓; SAK EMKM decisions (goal 7) baked into Slice A/D JE composition per spec §2 ✓
- §2 accounting decisions — D-1 gross-method (Slice A JE), D-2 direct write-off (Slice D1), D-3 accrual (Slice A + B reclass), D-4 flag column (Task 1) ✓
- §3 per-slice JE shapes — Task 2/3/4 code deltas match §3.3–§3.7 ✓
- §4 backfill — Task 5 covers all 4 functions + dry-run + real run + validation ✓
- §5 testing — 33+ Go tests + DO-block smoke + browser E2E per task ✓
- §6 rollout — migration order 10–15 preserved; per-slice smoke gate ✓
- §7 open questions — closed in spec, not repeated here ✓
- §8 deferrals — recorded in Task 6 wrap-up ✓

**Type consistency:** `journal_entry_source` values match spec §3.1: `TEMPO_INVOICE_CREATE` (Task 2), `PI_TAGIHAN` (Task 3, existing), `PEMBAYARAN` (Task 3, existing), `TEMPO_WRITEOFF` (Task 4, existing), `TEMPO_WRITEOFF_REVERT` (Task 4, new), `BACKFILL_*` (Task 5, new). Function signatures preserved: `create_tempo_invoice(jsonb) → uuid`, `record_pi(jsonb) → jsonb`, `_post_journal_entry(...) → jsonb`, `record_pembayaran(jsonb) → jsonb`.

**Placeholder scan:** no "TBD" / "implement later" / "similar to Task N" markers. `[COPY VERBATIM ...]` blocks in migrations 12/13/14 are explicit instructions to read source migrations and inline the prior body — not vague placeholders. Actual code shown for JE line composition, dual-write blocks, and validation queries.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-sales-side-dual-write-close-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task (with the design spec + relevant context loaded), review outputs between tasks, iterate fast. Best for this plan because each task ships a real migration to prod DB and touches many files — task-scoped isolation prevents context bleed.

**2. Inline Execution** — Execute tasks sequentially in this session using `superpowers:executing-plans`. Faster wall-clock but higher risk (single context tracks 6 migrations + 33 tests + 5 browser E2Es simultaneously).

**Which approach?**
