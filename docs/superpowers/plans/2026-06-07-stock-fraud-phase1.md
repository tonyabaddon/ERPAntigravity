# Stock Fraud Phase 1 — Immutable Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an append-only `stock_movements` ledger that records every change to `stocks.stock_atas` / `stock_bawah`, then wrap every existing stock-mutating RPC (`receive_purchase_order`, `deduct_stock_fifo`, `transfer_warehouse`, `decrement_stock`) to write to the ledger inside the same transaction. Zero user-visible UI.

**Architecture:** New `stock_movements` table with REVOKE column-level grants + `BEFORE UPDATE OR DELETE` triggers that always RAISE EXCEPTION (belt + suspenders against service_role bypass). One `SECURITY DEFINER` helper `_log_stock_movement` is the single insertion point. Each existing RPC gets new params (`p_actor_user_id`, `p_reason_note`, `p_evidence_urls`) and calls the helper. Go-side read helpers added for Phase 4 to consume later.

**Tech Stack:** Postgres 15 (Supabase), Go 1.25 with existing `dbClient` pattern, TDD via Go integration tests against a real Supabase test database.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 1 section)

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000001_stock_movements.sql` | Create | Enum + table + indexes + REVOKE/triggers + `_log_stock_movement` helper |
| `supabase/migrations/20260607000002_wrap_receive_po.sql` | Create | Replace `receive_purchase_order` body to call helper per line |
| `supabase/migrations/20260607000003_wrap_deduct_stock_fifo.sql` | Create | Replace `deduct_stock_fifo` body to call helper |
| `supabase/migrations/20260607000004_wrap_transfer_warehouse.sql` | Create | Replace `transfer_warehouse` body to log out+in pair |
| `supabase/migrations/20260607000005_wrap_decrement_stock.sql` | Create | Replace `decrement_stock` body to call helper |
| `backend-go/internal/db/stock_movements.go` | Create | Go query helpers (`InsertMovement`, `ListMovementsBySKU`) used by tests + future Phase 4 |
| `backend-go/internal/db/stock_movements_test.go` | Create | Integration tests against Supabase test DB |
| `backend-go/internal/db/stock_movements_immutability_test.go` | Create | Service-role attempts UPDATE/DELETE → expect error |

**Migration numbering note:** Phase 2's spec used `20260607000002`-`20260607000008` placeholders. After Phase 1, Phase 2's migrations renumber to `20260607000006`+ to avoid collision. Update the Phase 2 plan accordingly when it runs.

---

## Task 1: Stock movements schema + immutability

**Files:**
- Create: `supabase/migrations/20260607000001_stock_movements.sql`
- Create: `backend-go/internal/db/stock_movements_test.go` (skeleton + first test)

- [ ] **Step 1: Write failing test for table existence**

`backend-go/internal/db/stock_movements_test.go`:
```go
package db_test

import (
	"context"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestStockMovements_TableExists(t *testing.T) {
	client := db.NewTestClient(t) // existing helper that yields a service-role conn
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='stock_movements'`).Scan(&n)
	if err != nil {
		t.Fatalf("stock_movements table missing: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestStockMovements_TableExists -v`
Expected: FAIL — relation does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000001_stock_movements.sql`:
```sql
-- Enum of every legitimate reason stock can move
CREATE TYPE public.stock_movement_source AS ENUM (
  'purchase_receive',
  'sale_wa',
  'sale_kasir',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'opname_variance',
  'correction',
  'return_kasir',
  'seed'
);

CREATE TABLE public.stock_movements (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta           INTEGER NOT NULL,
  qty_before          INTEGER NOT NULL,
  qty_after           INTEGER NOT NULL,
  source              public.stock_movement_source NOT NULL,
  related_doc_type    TEXT,
  related_doc_id      TEXT,
  related_movement_id BIGINT REFERENCES public.stock_movements(id),
  reason_code         TEXT,
  reason_note         TEXT,
  actor_user_id       UUID NOT NULL,
  actor_role          TEXT NOT NULL,
  evidence_urls       TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_qty_math CHECK (qty_before + qty_delta = qty_after)
);

CREATE INDEX idx_sm_sku_created   ON public.stock_movements(sku, created_at DESC);
CREATE INDEX idx_sm_actor_created ON public.stock_movements(actor_user_id, created_at DESC);
CREATE INDEX idx_sm_source        ON public.stock_movements(source, created_at DESC);
CREATE INDEX idx_sm_related       ON public.stock_movements(related_doc_type, related_doc_id);

-- Immutability: REVOKE for human-callable roles (belt) + triggers (suspenders)
REVOKE UPDATE, DELETE ON public.stock_movements FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.stock_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_stock_movement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only — corrections must be a new compensating row';
END $$;

CREATE TRIGGER trg_deny_sm_update BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
CREATE TRIGGER trg_deny_sm_delete BEFORE DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
```

- [ ] **Step 4: Apply migration locally**

Run: `supabase db push --include-all` (or whatever the project's apply command is)
Expected: migration applied with no errors.

- [ ] **Step 5: Re-run the test to verify it passes**

Run: `cd backend-go && go test ./internal/db/ -run TestStockMovements_TableExists -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000001_stock_movements.sql backend-go/internal/db/stock_movements_test.go
git commit -m "feat(stocks): add immutable stock_movements ledger (Phase 1)"
```

---

## Task 2: Immutability triggers — verify even service_role cannot UPDATE/DELETE

**Files:**
- Create: `backend-go/internal/db/stock_movements_immutability_test.go`

- [ ] **Step 1: Write failing tests for UPDATE and DELETE denial**

`backend-go/internal/db/stock_movements_immutability_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// seedOneRow inserts directly via service_role for test setup, returning the id.
func seedOneRow(t *testing.T, client *db.Client) int64 {
	t.Helper()
	// Need an existing SKU; pick one from stocks or insert one in test setup.
	_, _ = client.Exec(context.Background(),
		`INSERT INTO public.stocks (sku, name, category, price, stock, status, specs)
		 VALUES ('TEST-IMM', 'Test SKU', 'Aksesori', 1000, 0, 'Sinkron', '{}'::jsonb)
		 ON CONFLICT (sku) DO NOTHING`)
	var id int64
	err := client.QueryRow(context.Background(),
		`INSERT INTO public.stock_movements
		   (sku, warehouse, qty_delta, qty_before, qty_after, source, actor_user_id, actor_role)
		 VALUES ('TEST-IMM','atas', 5, 0, 5, 'seed',
		         '00000000-0000-0000-0000-000000000000', 'system_test')
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed insert failed: %v", err)
	}
	return id
}

func TestStockMovements_UpdateRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	id := seedOneRow(t, client)

	_, err := client.Exec(context.Background(),
		`UPDATE public.stock_movements SET reason_note='hacked' WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected UPDATE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestStockMovements_DeleteRaises(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	id := seedOneRow(t, client)

	_, err := client.Exec(context.Background(),
		`DELETE FROM public.stock_movements WHERE id=$1`, id)
	if err == nil {
		t.Fatalf("expected DELETE to raise, got nil")
	}
	if !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they pass (triggers already installed in Task 1)**

Run: `cd backend-go && go test ./internal/db/ -run TestStockMovements_(Update|Delete)Raises -v`
Expected: PASS.

If a test fails, the triggers from Task 1 are not wired correctly — re-check Task 1 migration.

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/stock_movements_immutability_test.go
git commit -m "test(stocks): verify stock_movements UPDATE/DELETE raise even as service_role"
```

---

## Task 3: `_log_stock_movement` helper RPC

**Files:**
- Modify: `supabase/migrations/20260607000001_stock_movements.sql` (append the function)
- Modify: `backend-go/internal/db/stock_movements_test.go` (add helper test)

- [ ] **Step 1: Write failing test for helper RPC**

Append to `backend-go/internal/db/stock_movements_test.go`:
```go
func TestLogStockMovement_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	// SKU 'TEST-IMM' already seeded by Task 2 setup; reuse.

	var id int64
	err := client.QueryRow(context.Background(),
		`SELECT public._log_stock_movement(
		   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>3,
		   p_qty_before=>5, p_source=>'adjustment',
		   p_related_doc_type=>'test', p_related_doc_id=>'test-1',
		   p_reason_code=>'koreksi_input', p_reason_note=>'unit test',
		   p_actor_user_id=>'00000000-0000-0000-0000-000000000001',
		   p_actor_role=>'system_test')`).Scan(&id)
	if err != nil {
		t.Fatalf("helper failed: %v", err)
	}

	var qtyAfter int
	err = client.QueryRow(context.Background(),
		`SELECT qty_after FROM public.stock_movements WHERE id=$1`, id).Scan(&qtyAfter)
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if qtyAfter != 8 {
		t.Fatalf("qty_after = %d, want 8", qtyAfter)
	}
}

func TestLogStockMovement_QtyMathViolation(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Direct INSERT with broken math — must be rejected by chk_qty_math
	_, err := client.Exec(context.Background(),
		`INSERT INTO public.stock_movements
		   (sku, warehouse, qty_delta, qty_before, qty_after, source, actor_user_id, actor_role)
		 VALUES ('TEST-IMM','atas', 3, 5, 99, 'adjustment',
		         '00000000-0000-0000-0000-000000000001', 'system_test')`)
	if err == nil {
		t.Fatalf("expected CHECK violation, got nil")
	}
	if !strings.Contains(err.Error(), "chk_qty_math") {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestLogStockMovement -v`
Expected: FAIL — `function _log_stock_movement does not exist` for the first test.

- [ ] **Step 3: Add the helper to the migration**

Append to `supabase/migrations/20260607000001_stock_movements.sql`:
```sql
CREATE OR REPLACE FUNCTION public._log_stock_movement(
  p_sku TEXT, p_warehouse TEXT, p_qty_delta INT,
  p_qty_before INT, p_source public.stock_movement_source,
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_reason_code      TEXT DEFAULT NULL,
  p_reason_note      TEXT DEFAULT NULL,
  p_actor_user_id    UUID DEFAULT NULL,
  p_actor_role       TEXT DEFAULT NULL,
  p_evidence_urls    TEXT[] DEFAULT '{}'
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.stock_movements
    (sku, warehouse, qty_delta, qty_before, qty_after, source,
     related_doc_type, related_doc_id, reason_code, reason_note,
     actor_user_id, actor_role, evidence_urls)
  VALUES
    (p_sku, p_warehouse, p_qty_delta, p_qty_before,
     p_qty_before + p_qty_delta, p_source,
     p_related_doc_type, p_related_doc_id, p_reason_code, p_reason_note,
     COALESCE(p_actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
     COALESCE(p_actor_role, 'system'),
     p_evidence_urls)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._log_stock_movement(
  TEXT, TEXT, INT, INT, public.stock_movement_source,
  TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT[]
) FROM PUBLIC, anon, authenticated;
-- Only invoked from inside other SECURITY DEFINER RPCs in this codebase.
```

- [ ] **Step 4: Apply migration & re-run test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestLogStockMovement -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000001_stock_movements.sql backend-go/internal/db/stock_movements_test.go
git commit -m "feat(stocks): add _log_stock_movement helper RPC"
```

---

## Task 4: Wrap `receive_purchase_order` to write ledger rows

**Files:**
- Read first: `supabase/migrations/20260604000015_fifo_rpcs.sql` (current `receive_purchase_order` body)
- Read first: `supabase/migrations/20260605000002_warehouse_columns.sql` (warehouse-aware version)
- Create: `supabase/migrations/20260607000002_wrap_receive_po.sql`
- Modify: `backend-go/internal/db/stock_movements_test.go` (add test)

- [ ] **Step 1: Write failing test**

Append to `backend-go/internal/db/stock_movements_test.go`:
```go
func TestReceivePO_WritesLedgerRowPerLine(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-IMM", OrderedQty: 7, UnitPrice: 1000},
	})
	beforeRows := db.CountStockMovements(t, client, "TEST-IMM")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order($1, 'atas', 0::numeric, 'cash')`, po.ID)
	if err != nil {
		t.Fatalf("receive_purchase_order failed: %v", err)
	}

	afterRows := db.CountStockMovements(t, client, "TEST-IMM")
	if afterRows-beforeRows != 1 {
		t.Fatalf("expected 1 new ledger row, got %d", afterRows-beforeRows)
	}

	var source, warehouse string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, warehouse, qty_delta
		 FROM public.stock_movements
		 WHERE related_doc_type='purchase_order' AND related_doc_id=$1
		 ORDER BY id DESC LIMIT 1`, po.ID).Scan(&source, &warehouse, &delta)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if source != "purchase_receive" || warehouse != "atas" || delta != 7 {
		t.Fatalf("ledger row wrong: source=%s warehouse=%s delta=%d", source, warehouse, delta)
	}
}
```

(Add the `SeedPurchaseOrder`, `POLine`, `CountStockMovements` helpers to `backend-go/internal/db/testhelpers.go` if not present — use existing test patterns from `internal/heartbeat/poller_test.go` as reference.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestReceivePO_WritesLedgerRowPerLine -v`
Expected: FAIL — `expected 1 new ledger row, got 0`.

- [ ] **Step 3: Write the wrapping migration**

`supabase/migrations/20260607000002_wrap_receive_po.sql`:
```sql
-- Replace receive_purchase_order to log one stock_movements row per item
-- inside the same transaction. The existing body (from migrations
-- 20260604000015_fifo_rpcs.sql and 20260605000002_warehouse_columns.sql)
-- already validates status, updates stocks, inserts stock_lots; we add
-- one INSERT into stock_movements per line item.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id        TEXT,
  p_warehouse    TEXT DEFAULT 'atas',
  p_payment_amount NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_qty_before INT;
  v_actor UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  -- (Copy the existing function body here verbatim — load order validation,
  --  status check, stock_lots insert. Just inside the per-line loop, after
  --  updating stocks, add the ledger insert.)

  FOR r IN
    SELECT poi.sku, poi.qty, poi.unit_price
    FROM public.purchase_order_items poi
    WHERE poi.po_id = p_po_id
  LOOP
    -- Read qty_before
    EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_warehouse)
      INTO v_qty_before USING r.sku;

    -- Existing UPDATE: increment warehouse column + insert stock_lots row
    -- (omitted here; copy from current migration)
    EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1', p_warehouse, p_warehouse)
      USING r.sku, r.qty;
    INSERT INTO public.stock_lots (sku, qty_received, qty_remaining, unit_cost, po_id)
      VALUES (r.sku, r.qty, r.qty, r.unit_price, p_po_id);

    -- NEW: ledger row
    PERFORM public._log_stock_movement(
      p_sku=>r.sku, p_warehouse=>p_warehouse, p_qty_delta=>r.qty,
      p_qty_before=>v_qty_before, p_source=>'purchase_receive',
      p_related_doc_type=>'purchase_order', p_related_doc_id=>p_po_id,
      p_actor_user_id=>v_actor, p_actor_role=>'system_receive'
    );
  END LOOP;

  -- Existing post-loop: mark PO RECEIVED, record payment, etc. (copy from current)
  UPDATE public.purchase_orders SET status='RECEIVED', received_at=now() WHERE id=p_po_id;
END $$;
```

**Important:** before submitting, copy the full body of the current `receive_purchase_order` from migrations `20260604000015` and `20260605000002` into the new file so no existing behavior is lost. Only the per-line ledger insert is new.

- [ ] **Step 4: Apply migration & re-run test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestReceivePO_WritesLedgerRowPerLine -v`
Expected: PASS.

- [ ] **Step 5: Run the full receive PO existing test suite to ensure no regression**

Run: `cd backend-go && go test ./... -run TestReceivePO -v`
Expected: all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000002_wrap_receive_po.sql backend-go/internal/db/stock_movements_test.go backend-go/internal/db/testhelpers.go
git commit -m "feat(stocks): receive_purchase_order writes stock_movements ledger row per line"
```

---

## Task 5: Wrap `deduct_stock_fifo`

**Files:**
- Read first: `supabase/migrations/20260604000015_fifo_rpcs.sql` (deduct_stock_fifo body)
- Read first: `supabase/migrations/20260605000002_warehouse_columns.sql` (warehouse-aware version)
- Create: `supabase/migrations/20260607000003_wrap_deduct_stock_fifo.sql`
- Modify: `backend-go/internal/db/stock_movements_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestDeductFIFO_WritesLedgerRow(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	// Seed stock + lot via PO receive (from Task 4) before deducting
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 10) // helper

	beforeRows := db.CountStockMovements(t, client, "TEST-IMM")
	_, err := client.Exec(context.Background(),
		`SELECT public.deduct_stock_fifo('TEST-IMM', 3, 'atas',
		         'order'::text, 'ORD-TEST'::text, 'sale_wa'::text)`)
	if err != nil {
		t.Fatalf("deduct_stock_fifo: %v", err)
	}
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-beforeRows != 1 {
		t.Fatalf("expected 1 ledger row, got %d", got-beforeRows)
	}

	var source string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, qty_delta FROM public.stock_movements
		 WHERE related_doc_id='ORD-TEST' ORDER BY id DESC LIMIT 1`).Scan(&source, &delta)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if source != "sale_wa" || delta != -3 {
		t.Fatalf("ledger row wrong: source=%s delta=%d", source, delta)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL because `deduct_stock_fifo` does not yet accept the 4-/5-/6-th args (related_doc_type, related_doc_id, source).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000003_wrap_deduct_stock_fifo.sql`:
```sql
CREATE OR REPLACE FUNCTION public.deduct_stock_fifo(
  p_sku       TEXT,
  p_qty       INT,
  p_warehouse TEXT DEFAULT 'atas',
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_source    public.stock_movement_source DEFAULT 'sale_kasir'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty_before INT;
  v_actor      UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  -- (Copy the existing deduct_stock_fifo body — FIFO consumption from
  --  stock_lots, update remaining qty, decrement stocks.stock_<warehouse>.)
  --
  -- Insert the ledger row exactly once, AFTER the warehouse column is updated.

  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_warehouse)
    INTO v_qty_before USING p_sku;

  -- (existing FIFO logic that walks stock_lots and decrements; copy verbatim)
  EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I - $2 WHERE sku=$1', p_warehouse, p_warehouse)
    USING p_sku, p_qty;

  PERFORM public._log_stock_movement(
    p_sku=>p_sku, p_warehouse=>p_warehouse, p_qty_delta=>-p_qty,
    p_qty_before=>v_qty_before, p_source=>p_source,
    p_related_doc_type=>p_related_doc_type, p_related_doc_id=>p_related_doc_id,
    p_actor_user_id=>v_actor, p_actor_role=>'system_sale'
  );
END $$;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestDeductFIFO_WritesLedgerRow -v`
Expected: PASS.

- [ ] **Step 5: Run existing kasir / WA-order tests for regression**

Run: `cd backend-go && go test ./... -run '(Kasir|WAOrder|PaymentVerified)' -v`
Expected: PASS (the new optional params default backward-compatibly).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000003_wrap_deduct_stock_fifo.sql backend-go/internal/db/stock_movements_test.go
git commit -m "feat(stocks): deduct_stock_fifo writes stock_movements ledger row"
```

---

## Task 6: Wrap `transfer_warehouse` to write transfer_out + transfer_in pair

**Files:**
- Read first: `supabase/migrations/20260605000002_warehouse_columns.sql` (transfer_warehouse body)
- Create: `supabase/migrations/20260607000004_wrap_transfer_warehouse.sql`
- Modify: `backend-go/internal/db/stock_movements_test.go`

This wrap is interim — Phase 3d replaces `transfer_warehouse` with a two-step state machine. For Phase 1, we just need both halves of the move logged so the ledger stays consistent during the transition window.

- [ ] **Step 1: Write failing test**

Append:
```go
func TestTransferWarehouse_WritesOutAndInPair(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 5)

	beforeRows := db.CountStockMovements(t, client, "TEST-IMM")
	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_warehouse('TEST-IMM','atas','bawah', 2)`)
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-beforeRows != 2 {
		t.Fatalf("expected 2 ledger rows (out+in), got %d", got-beforeRows)
	}

	var outDelta, inDelta int
	err = client.QueryRow(context.Background(),
		`SELECT
		   (SELECT qty_delta FROM public.stock_movements
		     WHERE sku='TEST-IMM' AND source='transfer_out' ORDER BY id DESC LIMIT 1),
		   (SELECT qty_delta FROM public.stock_movements
		     WHERE sku='TEST-IMM' AND source='transfer_in' ORDER BY id DESC LIMIT 1)`).
		Scan(&outDelta, &inDelta)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if outDelta != -2 || inDelta != 2 {
		t.Fatalf("pair wrong: out=%d in=%d", outDelta, inDelta)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — only 0 new rows (no ledger writes yet).

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000004_wrap_transfer_warehouse.sql`:
```sql
CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku TEXT, p_from TEXT, p_to TEXT, p_qty INT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_before INT;
  v_to_before   INT;
  v_actor       UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'transfer source and destination must differ';
  END IF;

  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_from)
    INTO v_from_before USING p_sku;
  IF v_from_before < p_qty THEN
    RAISE EXCEPTION 'Stok Gudang % tidak cukup: tersedia %, diminta %', p_from, v_from_before, p_qty;
  END IF;
  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_to)
    INTO v_to_before USING p_sku;

  EXECUTE format('UPDATE public.stocks
                  SET stock_%I = stock_%I - $2, stock_%I = stock_%I + $2
                  WHERE sku=$1', p_from, p_from, p_to, p_to)
    USING p_sku, p_qty;

  PERFORM public._log_stock_movement(
    p_sku=>p_sku, p_warehouse=>p_from, p_qty_delta=>-p_qty,
    p_qty_before=>v_from_before, p_source=>'transfer_out',
    p_related_doc_type=>'transfer_legacy', p_related_doc_id=>NULL,
    p_actor_user_id=>v_actor, p_actor_role=>'system_transfer'
  );
  PERFORM public._log_stock_movement(
    p_sku=>p_sku, p_warehouse=>p_to, p_qty_delta=>p_qty,
    p_qty_before=>v_to_before, p_source=>'transfer_in',
    p_related_doc_type=>'transfer_legacy', p_related_doc_id=>NULL,
    p_actor_user_id=>v_actor, p_actor_role=>'system_transfer'
  );
END $$;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestTransferWarehouse_WritesOutAndInPair -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000004_wrap_transfer_warehouse.sql backend-go/internal/db/stock_movements_test.go
git commit -m "feat(stocks): transfer_warehouse writes transfer_out + transfer_in ledger pair"
```

---

## Task 7: Wrap `decrement_stock`

**Files:**
- Read first: any migration that defines `decrement_stock` (`grep -l decrement_stock supabase/migrations/`)
- Create: `supabase/migrations/20260607000005_wrap_decrement_stock.sql`
- Modify: `backend-go/internal/db/stock_movements_test.go`

`decrement_stock` is used by the Go daemon's WhatsApp payment-verified path (see `handler.go:HandlePaymentVerified`). It needs the same wrap.

- [ ] **Step 1: Write failing test**

Append:
```go
func TestDecrementStock_WritesLedgerRow(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 6)

	before := db.CountStockMovements(t, client, "TEST-IMM")
	_, err := client.Exec(context.Background(),
		`SELECT public.decrement_stock('TEST-IMM', 4, 'atas',
		         'order'::text, 'ORD-DEC-1'::text, 'sale_wa'::text)`)
	if err != nil {
		t.Fatalf("decrement_stock: %v", err)
	}
	if got := db.CountStockMovements(t, client, "TEST-IMM"); got-before != 1 {
		t.Fatalf("expected 1 ledger row, got %d", got-before)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — extra params not accepted.

- [ ] **Step 3: Write migration**

`supabase/migrations/20260607000005_wrap_decrement_stock.sql`:
```sql
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku TEXT, p_qty INT, p_warehouse TEXT DEFAULT 'atas',
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_source           public.stock_movement_source DEFAULT 'sale_kasir'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before INT;
  v_actor  UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_warehouse)
    INTO v_before USING p_sku;
  IF v_before < p_qty THEN
    RAISE EXCEPTION 'Stok % di gudang % tidak cukup', p_sku, p_warehouse;
  END IF;
  EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I - $2 WHERE sku=$1', p_warehouse, p_warehouse)
    USING p_sku, p_qty;
  PERFORM public._log_stock_movement(
    p_sku=>p_sku, p_warehouse=>p_warehouse, p_qty_delta=>-p_qty,
    p_qty_before=>v_before, p_source=>p_source,
    p_related_doc_type=>p_related_doc_type, p_related_doc_id=>p_related_doc_id,
    p_actor_user_id=>v_actor, p_actor_role=>'system_decrement'
  );
END $$;
```

- [ ] **Step 4: Apply & test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestDecrementStock_WritesLedgerRow -v`
Expected: PASS.

- [ ] **Step 5: Update Go caller in `handler.go`**

Go file: `backend-go/internal/whatsapp/handler.go` — `HandlePaymentVerified` currently calls `decrement_stock(sku, qty, warehouse)`. Add the three new params (`'order'`, `orderID`, `'sale_wa'`) so the ledger row has proper provenance:

```go
// inside HandlePaymentVerified, replace the existing decrement call:
_, err := h.db.Exec(ctx,
    `SELECT public.decrement_stock($1, $2, $3, $4, $5, $6)`,
    sku, qty, warehouse, "order", orderID, "sale_wa")
```

- [ ] **Step 6: Run end-to-end WA payment-verified test**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestHandlePaymentVerified -v`
Expected: PASS, with ledger row now present.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260607000005_wrap_decrement_stock.sql backend-go/internal/whatsapp/handler.go backend-go/internal/db/stock_movements_test.go
git commit -m "feat(stocks): decrement_stock writes stock_movements + WA handler passes provenance"
```

---

## Task 8: Atomicity smoke test — wrapped RPC failure rolls back ledger

**Files:**
- Modify: `backend-go/internal/db/stock_movements_test.go`

- [ ] **Step 1: Write test that forces a failure mid-RPC**

```go
func TestWrappedRPC_RollsBackLedgerOnFailure(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-IMM", "atas", 2)

	before := db.CountStockMovements(t, client, "TEST-IMM")

	// transfer_warehouse with qty > stock_atas → RAISE EXCEPTION
	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_warehouse('TEST-IMM','atas','bawah', 999)`)
	if err == nil {
		t.Fatalf("expected over-transfer to fail, got nil")
	}

	if got := db.CountStockMovements(t, client, "TEST-IMM"); got != before {
		t.Fatalf("ledger row written despite RPC failure: %d new rows", got-before)
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd backend-go && go test ./internal/db/ -run TestWrappedRPC_RollsBackLedgerOnFailure -v`
Expected: PASS (Postgres transactionality already guarantees this; the test is a regression guard).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/stock_movements_test.go
git commit -m "test(stocks): assert wrapped RPC failure rolls back ledger insert"
```

---

## Task 9: Performance smoke — ledger overhead ≤ 5 ms p95

**Files:**
- Create: `backend-go/internal/db/stock_movements_bench_test.go`

- [ ] **Step 1: Write benchmark**

```go
package db_test

import (
	"context"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func BenchmarkLogStockMovement(b *testing.B) {
	client := db.NewBenchClient(b)
	defer client.Close()
	db.EnsureSKUStock(b, client, "TEST-IMM", "atas", 1_000_000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := client.Exec(context.Background(),
			`SELECT public._log_stock_movement(
			   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>0,
			   p_qty_before=>0, p_source=>'adjustment',
			   p_actor_user_id=>'00000000-0000-0000-0000-000000000001',
			   p_actor_role=>'bench')`)
		if err != nil {
			b.Fatal(err)
		}
	}
}
```

- [ ] **Step 2: Run benchmark and capture baseline**

Run: `cd backend-go && go test ./internal/db/ -bench BenchmarkLogStockMovement -benchtime=2s -run ^$`
Note the ns/op. Document in commit message. Acceptance: ≤ 5_000_000 ns/op (5 ms) at p99 (estimate from the avg; if avg > 1 ms investigate).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/stock_movements_bench_test.go
git commit -m "test(stocks): benchmark _log_stock_movement overhead"
```

---

## Task 10: Manual integration smoke through the running app

**Files:** none (manual verification).

- [ ] **Step 1: Bring up local dev environment**

Run: `npm run dev` (frontend) + Go daemon as documented in README.

- [ ] **Step 2: Trigger one of each entrypoint and verify ledger**

For each:
1. **PO receive:** create a PO in Pembelian screen, mark received → `SELECT * FROM stock_movements WHERE source='purchase_receive' ORDER BY id DESC LIMIT 1` → row present.
2. **Kasir sale:** create a walk-in kasir transaction → `WHERE source='sale_kasir'` row present.
3. **WA order payment-verified:** simulate via existing test fixture in the daemon → `WHERE source='sale_wa'` row present.
4. **Transfer:** open Stok Manager → Transfer button → 1 unit → `WHERE source='transfer_out'` AND `WHERE source='transfer_in'` rows present.

- [ ] **Step 3: Final commit (no files, but bump progress.md)**

```bash
# Edit progress.md with a Phase 1 — DONE entry
git add progress.md
git commit -m "docs(progress): Phase 1 stock_movements ledger shipped"
```

---

## Self-Review Checklist

Run through this before declaring Phase 1 done:

- [ ] All five migrations applied cleanly on a fresh database.
- [ ] All Go tests in `internal/db/` pass.
- [ ] Existing tests in `internal/whatsapp/` and `internal/engine/` still pass (no regression).
- [ ] Service-role direct UPDATE/DELETE on `stock_movements` raises exception (manual psql test).
- [ ] Every one of the four wrapped RPCs produces exactly one ledger row per stock change.
- [ ] Benchmark shows acceptable overhead.
- [ ] `progress.md` updated with Phase 1 DONE entry.

## Out of Scope (Phase 1)

- Backfill of historical stock movements.
- Any UI to display the ledger (Phase 4).
- Per-stock-lot ledger entries (`stock_lots` remains the FIFO source for COGS).
- Action permissions on read access (Phase 2 adds `can_view_pengawasan`).
- Removing the deprecated `transfer_warehouse` single-shot path (Phase 3d removes it).
