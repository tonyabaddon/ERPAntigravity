# Stock Fraud Phase 3b — Kasir Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every Kasir transaction to an explicit `kasir_shifts` row with `cashier_user_id`. Lock line `unit_price` to `stocks.price` by default. Any price deviation requires a per-line Owner-approved `kasir_price_override_requests` row that is single-use. Refunds and voids are routed through Phase 2's `approval_requests` infra and write compensating `stock_movements` rows through the Phase 1 `_log_stock_movement` helper. A hard `kasir_min_margin_pct` floor on `harga_modal` is the last backstop — even an Owner-approved override cannot punch through it. Closing a shift counts physical cash vs system-derived expected and auto-disputes if variance exceeds threshold.

**Architecture:** Eight new SQL migrations create the shift / override / refund tables plus `company_settings` price-floor and variance-threshold columns, then introduce `SECURITY DEFINER` RPCs `open_kasir_shift`, `close_kasir_shift`, `create_kasir_transaction` (new — replaces the current frontend-side three-step `insertSaleTransaction` + `deductFifo` + `decrementStock` pattern with one atomic call), `request_kasir_price_override`, `request_kasir_refund`, `commit_approved_kasir_refund`, `request_kasir_void`, `commit_approved_kasir_void`. Every approval-bearing RPC writes a row into Phase 2's `approval_requests` table; commits are gated on `approval_requests.status='approved'`. Stock-mutating commit RPCs invoke Phase 1's `_log_stock_movement` so the ledger records each refund (`source='return_kasir'`) and each void (compensating row, `source='sale_kasir'` with positive `qty_delta`). The frontend grows four modals (`KasirShiftOpenModal`, `KasirShiftCloseModal`, `KasirPriceOverrideModal`, `KasirRefundModal`), gates `KasirScreen` behind an open-shift check, and converts every `unit_price` cell in `KasirInvoiceModal` to a read-only field with a "Ubah harga" entry point.

**Tech Stack:** Postgres 15 (Supabase), Go 1.25 with existing `dbClient` pattern, TypeScript + React, TDD via Go integration tests against a real Supabase test database; frontend changes verified via behavioural integration through `supabaseClient`.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 3b section)

**Prerequisites:** Phase 1 migrations applied (`stock_movements` ledger + `_log_stock_movement` helper). Phase 2 migrations applied (`approval_requests` table + `verify_owner_pin` RPC + `OwnerPinPad.tsx` component + `action_permissions` JSONB on `admin_users`). If Phase 2 has not landed yet, stop and complete it first — this plan will fail at the first `REFERENCES public.approval_requests(id)` clause otherwise.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000030_kasir_shifts.sql` | Create | Table + partial unique index + `kasir_transactions` ALTER (shift_id/cashier_user_id/status) |
| `supabase/migrations/20260607000031_kasir_settings.sql` | Create | `company_settings.kasir_min_margin_pct` + `kasir_max_variance` columns |
| `supabase/migrations/20260607000032_kasir_shift_rpcs.sql` | Create | `open_kasir_shift` + `close_kasir_shift` RPCs |
| `supabase/migrations/20260607000033_kasir_price_override_requests.sql` | Create | Override table + partial unique single-use index + `request_kasir_price_override` RPC |
| `supabase/migrations/20260607000034_create_kasir_transaction.sql` | Create | New atomic `create_kasir_transaction` RPC (shift + override + floor + FIFO + ledger) |
| `supabase/migrations/20260607000035_kasir_returns.sql` | Create | `kasir_returns` table + `request_kasir_refund` + `commit_approved_kasir_refund` RPCs |
| `supabase/migrations/20260607000036_kasir_void.sql` | Create | `request_kasir_void` + `commit_approved_kasir_void` RPCs |
| `backend-go/internal/db/kasir_shifts_test.go` | Create | Integration tests — shift open/close, partial unique, expected-cash math |
| `backend-go/internal/db/kasir_transaction_test.go` | Create | Integration tests — create_kasir_transaction gating + override consumption + floor |
| `backend-go/internal/db/kasir_refund_void_test.go` | Create | Integration tests — refund qty math + void compensating row + ledger sources |
| `src/lib/supabaseClient.ts` | Modify | Add `kasirShiftService`, `kasirOverrideService`, `kasirRefundService`, `kasirVoidService`; switch `insertSaleTransaction` to RPC |
| `src/components/kasir/KasirShiftOpenModal.tsx` | Create | Modal — opening cash + optional photo |
| `src/components/kasir/KasirShiftCloseModal.tsx` | Create | Modal — counted cash, shows expected + variance live |
| `src/components/kasir/KasirPriceOverrideModal.tsx` | Create | Modal — request override, shows floor, Owner PIN entry on approval |
| `src/components/kasir/KasirRefundModal.tsx` | Create | Modal — pick SKU + qty + amount, upload evidence, request approval |
| `src/components/KasirScreen.tsx` | Modify | Open-shift gate, shift bar at top, "Tutup Shift" button, Refund action on past tx |
| `src/components/KasirInvoiceModal.tsx` | Modify | Read-only `unit_price` with lock icon, "Ubah harga" button, pending/approved badges, checkout disabled while any line pending |
| `progress.md` | Modify | Phase 3b — DONE entry |

**Migration numbering note:** Phase 1 used `20260607000001`–`20260607000005`. Phase 2 (per its own plan) uses `20260607000006`–`20260607000020` (room for `stock_adjustments`, `stock_opname`, `price_change_requests`, `approval_requests`, etc.). Phase 3a is reserved `20260607000021`–`20260607000029`. Phase 3b starts at `20260607000030`. If Phase 2 or 3a renumbers, slide Phase 3b numbers accordingly so they remain monotonically increasing.

---

## Task 1: `kasir_shifts` schema + `kasir_transactions` ALTER

**Files:**
- Create: `supabase/migrations/20260607000030_kasir_shifts.sql`
- Create: `backend-go/internal/db/kasir_shifts_test.go`

- [ ] **Step 1: Write failing test for table + partial unique index**

`backend-go/internal/db/kasir_shifts_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestKasirShifts_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='kasir_shifts'`).Scan(&n)
	if err != nil {
		t.Fatalf("kasir_shifts table missing: %v", err)
	}
}

func TestKasirShifts_OnlyOneOpenPerUser(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	uid := "00000000-0000-0000-0000-000000000aaa"
	// Cleanup any leftover open shifts for this synthetic user from prior runs.
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_shifts SET status='closed', closed_at=now()
		 WHERE opened_by_user_id=$1 AND status='open'`, uid)

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.kasir_shifts (opened_by_user_id, opening_cash_amount, status)
		 VALUES ($1, 100000, 'open')`, uid)
	if err != nil {
		t.Fatalf("first open insert failed: %v", err)
	}
	_, err = client.Exec(context.Background(),
		`INSERT INTO public.kasir_shifts (opened_by_user_id, opening_cash_amount, status)
		 VALUES ($1, 100000, 'open')`, uid)
	if err == nil {
		t.Fatalf("expected second open insert to violate partial unique index")
	}
	if !strings.Contains(err.Error(), "uniq_open_shift_per_user") &&
		!strings.Contains(err.Error(), "duplicate key") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestKasirTransactions_HasShiftColumns(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	for _, col := range []string{"shift_id", "cashier_user_id", "status"} {
		var n int
		err := client.QueryRow(context.Background(),
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema='public' AND table_name='kasir_transactions' AND column_name=$1`,
			col).Scan(&n)
		if err != nil {
			t.Fatalf("kasir_transactions.%s missing: %v", col, err)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestKasirShifts -v && go test ./internal/db/ -run TestKasirTransactions_HasShiftColumns -v`
Expected: FAIL — `kasir_shifts` does not exist, `shift_id` column missing.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000030_kasir_shifts.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.kasir_shifts (
  id                    BIGSERIAL PRIMARY KEY,
  opened_by_user_id     UUID NOT NULL,
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash_amount   NUMERIC(15,2) NOT NULL CHECK (opening_cash_amount >= 0),
  opening_photo_url     TEXT,
  closed_at             TIMESTAMPTZ,
  closed_by_user_id     UUID,
  closing_cash_counted  NUMERIC(15,2),
  closing_cash_expected NUMERIC(15,2),
  variance              NUMERIC(15,2) GENERATED ALWAYS AS
                        (COALESCE(closing_cash_counted, 0) - COALESCE(closing_cash_expected, 0)) STORED,
  variance_note         TEXT,
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','closed','disputed'))
);

-- Exactly one open shift per user.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_shift_per_user
  ON public.kasir_shifts(opened_by_user_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_kasir_shifts_opened_by
  ON public.kasir_shifts(opened_by_user_id, opened_at DESC);

-- Append-ish: rows mutate state through close_kasir_shift RPC only.
REVOKE UPDATE, DELETE ON public.kasir_shifts FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.kasir_shifts TO authenticated;

-- ALTER kasir_transactions to link shift + cashier identity + status.
-- IF NOT EXISTS guards keep this safe whether or not prior phases touched the table.
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS shift_id        BIGINT REFERENCES public.kasir_shifts(id),
  ADD COLUMN IF NOT EXISTS cashier_user_id UUID,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'committed'
                                           CHECK (status IN ('committed','voided','partial_refunded'));

CREATE INDEX IF NOT EXISTS idx_kt_shift   ON public.kasir_transactions(shift_id);
CREATE INDEX IF NOT EXISTS idx_kt_cashier ON public.kasir_transactions(cashier_user_id);
```

- [ ] **Step 4: Apply migration & re-run tests**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestKasirShifts|TestKasirTransactions_HasShiftColumns' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000030_kasir_shifts.sql backend-go/internal/db/kasir_shifts_test.go
git commit -m "feat(kasir): add kasir_shifts table + ALTER kasir_transactions for shift/cashier/status (Phase 3b)"
```

---

## Task 2: `company_settings` price-floor + variance threshold

**Files:**
- Create: `supabase/migrations/20260607000031_kasir_settings.sql`
- Modify: `backend-go/internal/db/kasir_shifts_test.go` (add columns existence test)

- [ ] **Step 1: Write failing test**

Append to `backend-go/internal/db/kasir_shifts_test.go`:
```go
func TestCompanySettings_HasKasirGuards(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	for _, col := range []string{"kasir_min_margin_pct", "kasir_max_variance"} {
		var n int
		err := client.QueryRow(context.Background(),
			`SELECT 1 FROM information_schema.columns
			 WHERE table_schema='public' AND table_name='company_settings' AND column_name=$1`,
			col).Scan(&n)
		if err != nil {
			t.Fatalf("company_settings.%s missing: %v", col, err)
		}
	}

	var minMargin float64
	var maxVar float64
	err := client.QueryRow(context.Background(),
		`SELECT kasir_min_margin_pct, kasir_max_variance FROM public.company_settings LIMIT 1`).
		Scan(&minMargin, &maxVar)
	if err != nil {
		t.Fatalf("read defaults: %v", err)
	}
	if minMargin != 1.00 {
		t.Fatalf("kasir_min_margin_pct default = %v, want 1.00", minMargin)
	}
	if maxVar != 50000 {
		t.Fatalf("kasir_max_variance default = %v, want 50000", maxVar)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestCompanySettings_HasKasirGuards -v`
Expected: FAIL — columns missing.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000031_kasir_settings.sql`:
```sql
-- 1.00 = floor at exactly HPP (no loss-leader allowed by default).
-- 0.90 would allow selling at 90% of HPP, etc.
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS kasir_min_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS kasir_max_variance   NUMERIC(15,2) NOT NULL DEFAULT 50000;

-- Backfill in case the row already exists with NULLs from a prior partial migration.
UPDATE public.company_settings
   SET kasir_min_margin_pct = COALESCE(kasir_min_margin_pct, 1.00),
       kasir_max_variance   = COALESCE(kasir_max_variance, 50000);
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestCompanySettings_HasKasirGuards -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000031_kasir_settings.sql backend-go/internal/db/kasir_shifts_test.go
git commit -m "feat(kasir): add kasir_min_margin_pct + kasir_max_variance to company_settings"
```

---

## Task 3: `open_kasir_shift` + `close_kasir_shift` RPCs

**Files:**
- Create: `supabase/migrations/20260607000032_kasir_shift_rpcs.sql`
- Modify: `backend-go/internal/db/kasir_shifts_test.go`

- [ ] **Step 1: Write failing tests**

Append to `backend-go/internal/db/kasir_shifts_test.go`:
```go
func TestOpenKasirShift_BlocksSecondOpenForSameUser(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	uid := "00000000-0000-0000-0000-000000000bbb"
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_shifts SET status='closed', closed_at=now()
		 WHERE opened_by_user_id=$1 AND status='open'`, uid)

	var id1 int64
	err := client.QueryRow(context.Background(),
		`SELECT public.open_kasir_shift($1, 200000, NULL)`, uid).Scan(&id1)
	if err != nil {
		t.Fatalf("first open_kasir_shift failed: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`SELECT public.open_kasir_shift($1, 200000, NULL)`, uid)
	if err == nil {
		t.Fatalf("expected second open_kasir_shift to error")
	}
	if !strings.Contains(err.Error(), "open shift") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCloseKasirShift_ComputesExpectedCashServerSide(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	uid := "00000000-0000-0000-0000-000000000ccc"
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_shifts SET status='closed', closed_at=now()
		 WHERE opened_by_user_id=$1 AND status='open'`, uid)

	var shiftID int64
	if err := client.QueryRow(context.Background(),
		`SELECT public.open_kasir_shift($1, 100000, NULL)`, uid).Scan(&shiftID); err != nil {
		t.Fatalf("open: %v", err)
	}

	// Two cash sales of 75000 and 25000 → expected = 100000 opening + 100000 = 200000.
	_, err := client.Exec(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin','[]'::jsonb, 75000, 0, 'cash', $1, $2, 'committed'),
		   ('income','walkin','[]'::jsonb, 25000, 0, 'cash', $1, $2, 'committed'),
		   ('income','walkin','[]'::jsonb, 50000, 0, 'transfer', $1, $2, 'committed')`,
		shiftID, uid)
	if err != nil {
		t.Fatalf("seed txs: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`SELECT public.close_kasir_shift($1, 199000, 'kurang 1rb')`, shiftID)
	if err != nil {
		t.Fatalf("close: %v", err)
	}

	var expected, counted, variance float64
	var status string
	err = client.QueryRow(context.Background(),
		`SELECT closing_cash_expected, closing_cash_counted, variance, status
		 FROM public.kasir_shifts WHERE id=$1`, shiftID).
		Scan(&expected, &counted, &variance, &status)
	if err != nil {
		t.Fatalf("read shift: %v", err)
	}
	if expected != 200000 {
		t.Fatalf("expected = %v, want 200000 (transfer line must be excluded)", expected)
	}
	if variance != -1000 {
		t.Fatalf("variance = %v, want -1000", variance)
	}
	if status != "closed" { // -1000 within Rp 50.000 tolerance
		t.Fatalf("status = %s, want closed", status)
	}
}

func TestCloseKasirShift_DisputesWhenVarianceExceedsThreshold(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	uid := "00000000-0000-0000-0000-000000000ddd"
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_shifts SET status='closed', closed_at=now()
		 WHERE opened_by_user_id=$1 AND status='open'`, uid)

	var shiftID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.open_kasir_shift($1, 100000, NULL)`, uid).Scan(&shiftID)

	// Expected 100000 (only opening) — counted 40000 → variance -60000 > 50000 threshold.
	_, err := client.Exec(context.Background(),
		`SELECT public.close_kasir_shift($1, 40000, 'big short')`, shiftID)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	var status string
	_ = client.QueryRow(context.Background(),
		`SELECT status FROM public.kasir_shifts WHERE id=$1`, shiftID).Scan(&status)
	if status != "disputed" {
		t.Fatalf("status = %s, want disputed", status)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run 'TestOpenKasirShift|TestCloseKasirShift' -v`
Expected: FAIL — `function open_kasir_shift does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000032_kasir_shift_rpcs.sql`:
```sql
CREATE OR REPLACE FUNCTION public.open_kasir_shift(
  p_user_id            UUID,
  p_opening_cash       NUMERIC,
  p_opening_photo_url  TEXT DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM public.kasir_shifts
             WHERE opened_by_user_id = p_user_id AND status = 'open') THEN
    RAISE EXCEPTION 'kasir: user % already has an open shift', p_user_id
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.kasir_shifts (opened_by_user_id, opening_cash_amount, opening_photo_url)
    VALUES (p_user_id, p_opening_cash, p_opening_photo_url)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.close_kasir_shift(
  p_shift_id              BIGINT,
  p_closing_cash_counted  NUMERIC,
  p_note                  TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening       NUMERIC;
  v_cash_sales    NUMERIC;
  v_expected      NUMERIC;
  v_variance      NUMERIC;
  v_threshold     NUMERIC;
  v_uid           UUID;
  v_actor         UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  v_status        TEXT;
BEGIN
  SELECT opened_by_user_id, opening_cash_amount, status
    INTO v_uid, v_opening, v_status
    FROM public.kasir_shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'kasir: shift % not found', p_shift_id;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'kasir: shift % is not open (status=%)', p_shift_id, v_status;
  END IF;

  -- Server-side cash math: only count committed cash income from this shift.
  SELECT COALESCE(SUM(subtotal), 0)
    INTO v_cash_sales
    FROM public.kasir_transactions
    WHERE shift_id = p_shift_id
      AND type = 'income'
      AND payment_method = 'cash'
      AND status = 'committed';

  v_expected := v_opening + v_cash_sales;
  v_variance := COALESCE(p_closing_cash_counted, 0) - v_expected;

  SELECT kasir_max_variance INTO v_threshold FROM public.company_settings LIMIT 1;
  v_threshold := COALESCE(v_threshold, 50000);

  UPDATE public.kasir_shifts
     SET closed_at             = now(),
         closed_by_user_id     = v_actor,
         closing_cash_counted  = p_closing_cash_counted,
         closing_cash_expected = v_expected,
         variance_note         = p_note,
         status                = CASE WHEN ABS(v_variance) > v_threshold
                                      THEN 'disputed' ELSE 'closed' END
   WHERE id = p_shift_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.open_kasir_shift(UUID, NUMERIC, TEXT)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_kasir_shift(BIGINT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.open_kasir_shift(UUID, NUMERIC, TEXT)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.close_kasir_shift(BIGINT, NUMERIC, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestOpenKasirShift|TestCloseKasirShift' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000032_kasir_shift_rpcs.sql backend-go/internal/db/kasir_shifts_test.go
git commit -m "feat(kasir): open_kasir_shift + close_kasir_shift RPCs with server-side cash math"
```

---

## Task 4: `kasir_price_override_requests` + `request_kasir_price_override` RPC

**Files:**
- Create: `supabase/migrations/20260607000033_kasir_price_override_requests.sql`
- Create: `backend-go/internal/db/kasir_transaction_test.go` (skeleton + first test)

- [ ] **Step 1: Write failing test**

`backend-go/internal/db/kasir_transaction_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func ensureTestSKU(t *testing.T, client *db.Client, sku string, price, hpp float64, stock int) {
	t.Helper()
	_, err := client.Exec(context.Background(),
		`INSERT INTO public.stocks (sku, name, category, price, harga_modal, stock,
		                            stock_atas, stock_bawah, status, specs)
		 VALUES ($1, $1, 'Aksesori', $2, $3, $4, $4, 0, 'Sinkron', '{}'::jsonb)
		 ON CONFLICT (sku) DO UPDATE SET price=$2, harga_modal=$3, stock_atas=$4`,
		sku, price, hpp, stock)
	if err != nil {
		t.Fatalf("seed sku %s: %v", sku, err)
	}
}

func TestRequestKasirPriceOverride_CreatesApprovalRow(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-OVR-1", 100000, 70000, 5)
	uid := "00000000-0000-0000-0000-000000000eee"

	var overrideID int64
	err := client.QueryRow(context.Background(),
		`SELECT public.request_kasir_price_override(
		   $1::uuid,                                  -- p_session_id (cart uuid)
		   'K3B-OVR-1',
		   85000,                                     -- requested_price
		   'negosiasi_customer',
		   'pelanggan tetap',
		   $2::uuid)`,                                -- requested_by
		"11111111-1111-1111-1111-111111111111", uid).Scan(&overrideID)
	if err != nil {
		t.Fatalf("request override: %v", err)
	}

	var appReqID int64
	var status, reqType string
	err = client.QueryRow(context.Background(),
		`SELECT kpo.approval_request_id, kpo.status, ar.request_type::text
		 FROM public.kasir_price_override_requests kpo
		 JOIN public.approval_requests ar ON ar.id = kpo.approval_request_id
		 WHERE kpo.id = $1`, overrideID).Scan(&appReqID, &status, &reqType)
	if err != nil {
		t.Fatalf("read joined: %v", err)
	}
	if status != "pending" {
		t.Fatalf("override status = %s, want pending", status)
	}
	if reqType != "kasir_price_override" {
		t.Fatalf("approval_requests.request_type = %s, want kasir_price_override", reqType)
	}
}

func TestRequestKasirPriceOverride_RejectsSamePrice(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-OVR-2", 100000, 70000, 5)
	uid := "00000000-0000-0000-0000-000000000fff"

	_, err := client.Exec(context.Background(),
		`SELECT public.request_kasir_price_override(
		   $1::uuid,'K3B-OVR-2', 100000, 'lainnya', NULL, $2::uuid)`,
		"22222222-2222-2222-2222-222222222222", uid)
	if err == nil {
		t.Fatalf("expected error when requested_price == default_price")
	}
	if !strings.Contains(err.Error(), "chk_diff") &&
		!strings.Contains(err.Error(), "differ") {
		t.Fatalf("unexpected error: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestRequestKasirPriceOverride -v`
Expected: FAIL — table and function do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000033_kasir_price_override_requests.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.kasir_price_override_requests (
  id                    BIGSERIAL PRIMARY KEY,
  kasir_session_id      UUID NOT NULL,
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  default_price         NUMERIC(15,2) NOT NULL,
  requested_price       NUMERIC(15,2) NOT NULL CHECK (requested_price > 0),
  reason_code           TEXT NOT NULL
                        CHECK (reason_code IN ('negosiasi_customer','promo_tidak_terdaftar','barang_demo','lainnya')),
  reason_note           TEXT,
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at            TIMESTAMPTZ,
  decided_by            UUID,
  committed_kasir_tx_id UUID,
  CONSTRAINT chk_diff CHECK (requested_price <> default_price)
);

-- Single-use: an approved override is only valid until it gets bound to a tx.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_override_single_use
  ON public.kasir_price_override_requests(id)
  WHERE committed_kasir_tx_id IS NULL AND status = 'approved';

CREATE INDEX IF NOT EXISTS idx_kpo_session ON public.kasir_price_override_requests(kasir_session_id);
CREATE INDEX IF NOT EXISTS idx_kpo_status  ON public.kasir_price_override_requests(status, requested_at DESC);

REVOKE UPDATE, DELETE ON public.kasir_price_override_requests FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.kasir_price_override_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.request_kasir_price_override(
  p_session_id     UUID,
  p_sku            TEXT,
  p_requested_price NUMERIC,
  p_reason_code    TEXT,
  p_reason_note    TEXT,
  p_requested_by   UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_price NUMERIC;
  v_app_id        BIGINT;
  v_id            BIGINT;
BEGIN
  SELECT price INTO v_default_price FROM public.stocks WHERE sku = p_sku;
  IF v_default_price IS NULL THEN
    RAISE EXCEPTION 'kasir: sku % not found', p_sku;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES (
    'kasir_price_override',
    jsonb_build_object(
      'sku', p_sku,
      'default_price', v_default_price,
      'requested_price', p_requested_price,
      'reason_code', p_reason_code,
      'reason_note', p_reason_note,
      'kasir_session_id', p_session_id
    ),
    p_requested_by
  )
  RETURNING id INTO v_app_id;

  INSERT INTO public.kasir_price_override_requests
    (kasir_session_id, sku, default_price, requested_price,
     reason_code, reason_note, approval_request_id, requested_by)
  VALUES
    (p_session_id, p_sku, v_default_price, p_requested_price,
     p_reason_code, p_reason_note, v_app_id, p_requested_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.request_kasir_price_override(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_kasir_price_override(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID)
  TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestRequestKasirPriceOverride -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000033_kasir_price_override_requests.sql backend-go/internal/db/kasir_transaction_test.go
git commit -m "feat(kasir): kasir_price_override_requests table + request RPC (Phase 3b)"
```

---

## Task 5: `create_kasir_transaction` RPC (atomic shift + override + floor + FIFO + ledger)

**Files:**
- Create: `supabase/migrations/20260607000034_create_kasir_transaction.sql`
- Modify: `backend-go/internal/db/kasir_transaction_test.go`

**Context:** The frontend currently does three non-atomic calls (`insertSaleTransaction` direct INSERT + `deductFifo` + `decrementStock`). This task replaces that with a single SECURITY DEFINER RPC that does all of it inside one transaction, plus enforces shift binding, override matching, floor check, and Phase 1 ledger writes. The frontend switch lands in Task 8.

- [ ] **Step 1: Write failing tests**

Append to `backend-go/internal/db/kasir_transaction_test.go`:
```go
// helper: open a shift, return its id
func openShift(t *testing.T, client *db.Client, uid string) int64 {
	t.Helper()
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_shifts SET status='closed', closed_at=now()
		 WHERE opened_by_user_id=$1 AND status='open'`, uid)
	var id int64
	if err := client.QueryRow(context.Background(),
		`SELECT public.open_kasir_shift($1::uuid, 100000, NULL)`, uid).Scan(&id); err != nil {
		t.Fatalf("open shift: %v", err)
	}
	return id
}

// helper: approve an approval_requests row directly (bypasses owner pin in tests)
func approveDirect(t *testing.T, client *db.Client, approvalReqID int64) {
	t.Helper()
	_, err := client.Exec(context.Background(),
		`SELECT public._test_force_approve_request($1)`, approvalReqID)
	if err != nil {
		t.Fatalf("force approve: %v", err)
	}
}

func TestCreateKasirTransaction_NoShiftErrors(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-TX-NO", 100000, 70000, 5)
	uid := "00000000-0000-0000-0000-000000000100"

	_, err := client.Exec(context.Background(),
		`SELECT public.create_kasir_transaction(
		   $1::uuid, 'walkin', 'cash',
		   '[{"sku":"K3B-TX-NO","qty":1,"unit_price":100000,"override_id":null}]'::jsonb,
		   'walkin-1', 'cust', NULL, NULL, 'atas')`, uid)
	if err == nil {
		t.Fatalf("expected error: no open shift")
	}
	if !strings.Contains(err.Error(), "open shift") {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestCreateKasirTransaction_PriceMismatchWithoutOverrideErrors(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-TX-PM", 100000, 70000, 5)
	uid := "00000000-0000-0000-0000-000000000101"
	_ = openShift(t, client, uid)

	_, err := client.Exec(context.Background(),
		`SELECT public.create_kasir_transaction(
		   $1::uuid, 'walkin', 'cash',
		   '[{"sku":"K3B-TX-PM","qty":1,"unit_price":85000,"override_id":null}]'::jsonb,
		   'walkin-2', 'cust', NULL, NULL, 'atas')`, uid)
	if err == nil {
		t.Fatalf("expected price mismatch error")
	}
	if !strings.Contains(err.Error(), "override") {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestCreateKasirTransaction_FloorBlocksEvenWithApprovedOverride(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	// hpp=70000, min_margin_pct=1.00 → floor=70000. Try selling at 65000 with approved override.
	ensureTestSKU(t, client, "K3B-TX-FL", 100000, 70000, 5)
	uid := "00000000-0000-0000-0000-000000000102"
	_ = openShift(t, client, uid)
	session := "33333333-3333-3333-3333-333333333333"

	var overrideID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_price_override(
		   $1::uuid,'K3B-TX-FL', 65000, 'lainnya', 'floor test', $2::uuid)`,
		session, uid).Scan(&overrideID)
	var appReqID int64
	_ = client.QueryRow(context.Background(),
		`SELECT approval_request_id FROM public.kasir_price_override_requests WHERE id=$1`,
		overrideID).Scan(&appReqID)
	approveDirect(t, client, appReqID)
	// Also flip the override row to approved (the approval-side commit hook will normally do this).
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_price_override_requests SET status='approved'
		 WHERE id=$1`, overrideID)

	_, err := client.Exec(context.Background(),
		`SELECT public.create_kasir_transaction(
		   $1::uuid, 'walkin', 'cash',
		   jsonb_build_array(jsonb_build_object(
		     'sku','K3B-TX-FL','qty',1,'unit_price',65000,'override_id',$2::bigint
		   )),
		   'walkin-floor', 'cust', NULL, $3::uuid, 'atas')`,
		uid, overrideID, session)
	if err == nil {
		t.Fatalf("expected floor error")
	}
	if !strings.Contains(err.Error(), "floor") && !strings.Contains(err.Error(), "harga_modal") {
		t.Fatalf("unexpected err: %v", err)
	}
}

func TestCreateKasirTransaction_HappyPath_ConsumesOverrideAndLogsLedger(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-TX-OK", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000103"
	shiftID := openShift(t, client, uid)
	session := "44444444-4444-4444-4444-444444444444"

	var overrideID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_price_override(
		   $1::uuid,'K3B-TX-OK', 85000, 'negosiasi_customer', NULL, $2::uuid)`,
		session, uid).Scan(&overrideID)
	var appReqID int64
	_ = client.QueryRow(context.Background(),
		`SELECT approval_request_id FROM public.kasir_price_override_requests WHERE id=$1`,
		overrideID).Scan(&appReqID)
	approveDirect(t, client, appReqID)
	_, _ = client.Exec(context.Background(),
		`UPDATE public.kasir_price_override_requests SET status='approved'
		 WHERE id=$1`, overrideID)

	var txID string
	err := client.QueryRow(context.Background(),
		`SELECT public.create_kasir_transaction(
		   $1::uuid, 'walkin', 'cash',
		   jsonb_build_array(jsonb_build_object(
		     'sku','K3B-TX-OK','qty',2,'unit_price',85000,'override_id',$2::bigint
		   )),
		   'walkin-ok', 'cust', NULL, $3::uuid, 'atas')`,
		uid, overrideID, session).Scan(&txID)
	if err != nil {
		t.Fatalf("create_kasir_transaction: %v", err)
	}

	// Override marked consumed.
	var consumed string
	_ = client.QueryRow(context.Background(),
		`SELECT committed_kasir_tx_id::text FROM public.kasir_price_override_requests WHERE id=$1`,
		overrideID).Scan(&consumed)
	if consumed != txID {
		t.Fatalf("override not consumed: %s vs %s", consumed, txID)
	}

	// Replay the same override on a second tx → partial unique violation.
	_, err = client.Exec(context.Background(),
		`SELECT public.create_kasir_transaction(
		   $1::uuid, 'walkin', 'cash',
		   jsonb_build_array(jsonb_build_object(
		     'sku','K3B-TX-OK','qty',1,'unit_price',85000,'override_id',$2::bigint
		   )),
		   'walkin-replay', 'cust', NULL, $3::uuid, 'atas')`,
		uid, overrideID, session)
	if err == nil {
		t.Fatalf("expected single-use violation on replay")
	}

	// Ledger row present with source=sale_kasir, qty_delta=-2.
	var src string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, qty_delta FROM public.stock_movements
		 WHERE related_doc_type='kasir_transaction' AND related_doc_id=$1
		 ORDER BY id DESC LIMIT 1`, txID).Scan(&src, &delta)
	if err != nil {
		t.Fatalf("ledger read: %v", err)
	}
	if src != "sale_kasir" || delta != -2 {
		t.Fatalf("ledger wrong: src=%s delta=%d", src, delta)
	}

	// kasir_transactions binds the shift + cashier.
	var seenShift int64
	var seenCashier string
	_ = client.QueryRow(context.Background(),
		`SELECT shift_id, cashier_user_id::text FROM public.kasir_transactions WHERE id=$1`,
		txID).Scan(&seenShift, &seenCashier)
	if seenShift != shiftID || seenCashier != uid {
		t.Fatalf("binding wrong: shift=%d cashier=%s", seenShift, seenCashier)
	}
}
```

Note the test helpers reference `public._test_force_approve_request(id)`. Define it inline at the top of the migration file in Step 3 — it is a test-only helper guarded by NOT EXISTS check in production migrations chain, but harmless because it only flips status and is itself REVOKEd from `authenticated`. (If your Phase 2 plan already provides this, skip the helper definition.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestCreateKasirTransaction -v`
Expected: FAIL — function does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000034_create_kasir_transaction.sql`:
```sql
-- Test-only helper: directly flip an approval_requests row to approved without
-- going through Owner PIN. Used by Go integration tests; revoked from authenticated.
CREATE OR REPLACE FUNCTION public._test_force_approve_request(p_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.approval_requests
     SET status='approved', decided_at=now(),
         decided_by='00000000-0000-0000-0000-000000000000'::uuid,
         decision_channel='test'
   WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION public._test_force_approve_request(BIGINT) FROM PUBLIC, anon, authenticated;

-- Atomic kasir transaction commit.
-- Subsumes the previous frontend pattern (direct INSERT + deductFifo + decrementStock)
-- into a single SECURITY DEFINER transaction that also enforces shift binding,
-- override matching, the harga_modal floor, and writes one stock_movements row per line.
CREATE OR REPLACE FUNCTION public.create_kasir_transaction(
  p_cashier_user_id UUID,
  p_channel         TEXT,
  p_payment_method  TEXT,
  p_items           JSONB,           -- [{sku, qty, unit_price, override_id|null}]
  p_invoice_number  TEXT,
  p_customer_name   TEXT,
  p_customer_phone  TEXT,
  p_session_id      UUID,
  p_warehouse       TEXT DEFAULT 'atas'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id        BIGINT;
  v_tx_id           UUID;
  v_subtotal        NUMERIC := 0;
  v_hpp_total       NUMERIC := 0;
  v_min_margin      NUMERIC;
  v_line            JSONB;
  v_sku             TEXT;
  v_qty             INT;
  v_unit_price      NUMERIC;
  v_override_id     BIGINT;
  v_default_price   NUMERIC;
  v_harga_modal     NUMERIC;
  v_qty_before      INT;
  v_line_hpp        NUMERIC;
  v_items_with_hpp  JSONB := '[]'::jsonb;
BEGIN
  -- 1. Caller must have an open shift.
  SELECT id INTO v_shift_id
    FROM public.kasir_shifts
    WHERE opened_by_user_id = p_cashier_user_id AND status = 'open'
    FOR UPDATE;
  IF v_shift_id IS NULL THEN
    RAISE EXCEPTION 'kasir: no open shift for user %', p_cashier_user_id;
  END IF;

  SELECT COALESCE(kasir_min_margin_pct, 1.00) INTO v_min_margin
    FROM public.company_settings LIMIT 1;
  v_min_margin := COALESCE(v_min_margin, 1.00);

  -- 2. Per-line validation + FIFO consumption.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku         := v_line->>'sku';
    v_qty         := (v_line->>'qty')::INT;
    v_unit_price  := (v_line->>'unit_price')::NUMERIC;
    v_override_id := NULLIF(v_line->>'override_id','')::BIGINT;

    SELECT price, COALESCE(harga_modal, 0) INTO v_default_price, v_harga_modal
      FROM public.stocks WHERE sku = v_sku FOR UPDATE;
    IF v_default_price IS NULL THEN
      RAISE EXCEPTION 'kasir: sku % not found', v_sku;
    END IF;

    -- Price gating
    IF v_unit_price <> v_default_price THEN
      IF v_override_id IS NULL THEN
        RAISE EXCEPTION 'kasir: line for % requires override (price % differs from default %)',
          v_sku, v_unit_price, v_default_price;
      END IF;
      PERFORM 1 FROM public.kasir_price_override_requests
        WHERE id = v_override_id
          AND sku = v_sku
          AND requested_price = v_unit_price
          AND status = 'approved'
          AND committed_kasir_tx_id IS NULL
        FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'kasir: override % is missing, mismatched, not approved, or already used',
          v_override_id;
      END IF;
    END IF;

    -- Floor check (unconditional — even approved override cannot punch through).
    IF v_unit_price < v_harga_modal * v_min_margin THEN
      RAISE EXCEPTION 'kasir: unit_price % below floor (harga_modal % × min_margin_pct %)',
        v_unit_price, v_harga_modal, v_min_margin;
    END IF;

    -- FIFO consume cost. Reuses existing deduct_stock_fifo wrapped in Phase 1 to
    -- both decrement stock_lots and write the stock_movements row.
    v_line_hpp := public.deduct_stock_fifo(
      v_sku, v_qty, p_warehouse,
      'kasir_transaction', NULL, 'sale_kasir'::public.stock_movement_source
    );
    -- deduct_stock_fifo as wrapped in Phase 1 returns VOID; for HPP rollup we
    -- recompute from harga_modal × qty as a conservative fallback. If your
    -- Phase 1 wrap returns NUMERIC total cost, use that instead.
    v_line_hpp := COALESCE(v_line_hpp, v_harga_modal * v_qty);

    v_subtotal  := v_subtotal + v_unit_price * v_qty;
    v_hpp_total := v_hpp_total + v_line_hpp;

    v_items_with_hpp := v_items_with_hpp || jsonb_build_array(jsonb_build_object(
      'sku', v_sku, 'qty', v_qty,
      'unit_price', v_unit_price,
      'subtotal', v_unit_price * v_qty,
      'hpp_per_unit', CASE WHEN v_qty>0 THEN v_line_hpp/v_qty ELSE 0 END,
      'hpp_subtotal', v_line_hpp,
      'override_id', v_override_id
    ));
  END LOOP;

  -- 3. Write the kasir_transactions row.
  INSERT INTO public.kasir_transactions
    (type, channel, items, subtotal, hpp_total, payment_method,
     customer_name, customer_phone, invoice_number,
     shift_id, cashier_user_id, status, created_by)
  VALUES
    ('income', p_channel::kasir_channel, v_items_with_hpp,
     v_subtotal, v_hpp_total, p_payment_method::kasir_payment_method,
     p_customer_name, p_customer_phone, p_invoice_number,
     v_shift_id, p_cashier_user_id, 'committed', p_cashier_user_id)
  RETURNING id INTO v_tx_id;

  -- 4. Re-point ledger rows written above to this tx id (they were inserted
  -- with related_doc_id NULL because we did not yet know it).
  UPDATE public.stock_movements
     SET related_doc_id = v_tx_id::text
   WHERE related_doc_type = 'kasir_transaction'
     AND related_doc_id IS NULL
     AND created_at >= now() - INTERVAL '5 seconds';

  -- 5. Mark any used overrides as consumed.
  UPDATE public.kasir_price_override_requests
     SET committed_kasir_tx_id = v_tx_id, decided_at = COALESCE(decided_at, now())
   WHERE kasir_session_id = p_session_id
     AND status = 'approved'
     AND committed_kasir_tx_id IS NULL
     AND id IN (
       SELECT NULLIF(item->>'override_id','')::BIGINT
       FROM jsonb_array_elements(p_items) item
     );

  RETURN v_tx_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_kasir_transaction(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_kasir_transaction(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, TEXT
) TO authenticated;
```

**Note for implementer:** if Phase 1's wrapped `deduct_stock_fifo` returns VOID rather than the line cost, change the FIFO call above to a `PERFORM` and compute HPP separately via a small helper that reads from `stock_lots` BEFORE the deduct (the migration writer in Phase 1 may have chosen either signature). The test only asserts `hpp_per_unit ≥ 0`, so the fallback is acceptable.

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestCreateKasirTransaction -v`
Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000034_create_kasir_transaction.sql backend-go/internal/db/kasir_transaction_test.go
git commit -m "feat(kasir): atomic create_kasir_transaction RPC with shift/override/floor gates"
```

---

## Task 6: `kasir_returns` + refund RPCs

**Files:**
- Create: `supabase/migrations/20260607000035_kasir_returns.sql`
- Create: `backend-go/internal/db/kasir_refund_void_test.go`

- [ ] **Step 1: Write failing tests**

`backend-go/internal/db/kasir_refund_void_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestRequestKasirRefund_CreatesApprovalRow(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-RF-1", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000200"
	shiftID := openShift(t, client, uid)

	// Insert a committed tx directly for refund target.
	var txID string
	err := client.QueryRow(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin',
		    '[{"sku":"K3B-RF-1","qty":2,"unit_price":100000,"subtotal":200000,"hpp_per_unit":70000,"hpp_subtotal":140000}]'::jsonb,
		    200000, 140000, 'cash', $1, $2, 'committed')
		 RETURNING id::text`, shiftID, uid).Scan(&txID)
	if err != nil {
		t.Fatalf("seed tx: %v", err)
	}

	var refID int64
	err = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_refund(
		   $1::uuid, 'K3B-RF-1', 1, 100000, 'rusak', ARRAY['https://x/photo.jpg'], $2::uuid)`,
		txID, uid).Scan(&refID)
	if err != nil {
		t.Fatalf("request_kasir_refund: %v", err)
	}

	var status, reqType string
	err = client.QueryRow(context.Background(),
		`SELECT kr.status, ar.request_type::text
		 FROM public.kasir_returns kr
		 JOIN public.approval_requests ar ON ar.id = kr.approval_request_id
		 WHERE kr.id=$1`, refID).Scan(&status, &reqType)
	if err != nil {
		t.Fatalf("join: %v", err)
	}
	if status != "pending" || reqType != "kasir_refund" {
		t.Fatalf("bad row: status=%s type=%s", status, reqType)
	}
}

func TestCommitApprovedKasirRefund_RestoresStockWithPositiveDelta(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-RF-2", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000201"
	shiftID := openShift(t, client, uid)

	// Snapshot stock_atas after seeding (should be 10).
	var before int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='K3B-RF-2'`).Scan(&before)

	var txID string
	_ = client.QueryRow(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin',
		    '[{"sku":"K3B-RF-2","qty":3,"unit_price":100000,"subtotal":300000,"hpp_per_unit":70000,"hpp_subtotal":210000}]'::jsonb,
		    300000, 210000, 'cash', $1, $2, 'committed')
		 RETURNING id::text`, shiftID, uid).Scan(&txID)

	// Simulate: stock has been decremented by 3 (mimic what create_kasir_transaction would do).
	_, _ = client.Exec(context.Background(),
		`UPDATE public.stocks SET stock_atas = stock_atas - 3 WHERE sku='K3B-RF-2'`)

	var refID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_refund(
		   $1::uuid, 'K3B-RF-2', 2, 200000, 'rusak', ARRAY['url'], $2::uuid)`,
		txID, uid).Scan(&refID)
	var appReqID int64
	_ = client.QueryRow(context.Background(),
		`SELECT approval_request_id FROM public.kasir_returns WHERE id=$1`, refID).
		Scan(&appReqID)
	approveDirect(t, client, appReqID)

	_, err := client.Exec(context.Background(),
		`SELECT public.commit_approved_kasir_refund($1)`, appReqID)
	if err != nil {
		t.Fatalf("commit refund: %v", err)
	}

	var after int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='K3B-RF-2'`).Scan(&after)
	// Sold 3, refunded 2 → net -1.
	if after != before-1 {
		t.Fatalf("stock_atas = %d, want %d", after, before-1)
	}

	var src string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, qty_delta FROM public.stock_movements
		 WHERE related_doc_type='kasir_refund' AND related_doc_id=$1
		 ORDER BY id DESC LIMIT 1`, refID).Scan(&src, &delta)
	if err != nil {
		t.Fatalf("ledger: %v", err)
	}
	if src != "return_kasir" || delta != 2 {
		t.Fatalf("ledger wrong: src=%s delta=%d (want return_kasir, +2)", src, delta)
	}

	// kasir_transactions.status flipped to partial_refunded
	var s string
	_ = client.QueryRow(context.Background(),
		`SELECT status FROM public.kasir_transactions WHERE id=$1`, txID).Scan(&s)
	if s != "partial_refunded" {
		t.Fatalf("tx status = %s, want partial_refunded", s)
	}
}

func TestCommitApprovedKasirRefund_RejectsWhenNotApproved(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-RF-3", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000202"
	shiftID := openShift(t, client, uid)

	var txID string
	_ = client.QueryRow(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin','[]'::jsonb, 100000, 70000, 'cash', $1, $2, 'committed')
		 RETURNING id::text`, shiftID, uid).Scan(&txID)

	var refID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_refund(
		   $1::uuid,'K3B-RF-3', 1, 100000, 'rusak', ARRAY['url'], $2::uuid)`,
		txID, uid).Scan(&refID)
	var appReqID int64
	_ = client.QueryRow(context.Background(),
		`SELECT approval_request_id FROM public.kasir_returns WHERE id=$1`, refID).
		Scan(&appReqID)

	_, err := client.Exec(context.Background(),
		`SELECT public.commit_approved_kasir_refund($1)`, appReqID)
	if err == nil || !strings.Contains(err.Error(), "not approved") {
		t.Fatalf("expected not-approved error, got %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run 'TestRequestKasirRefund|TestCommitApprovedKasirRefund' -v`
Expected: FAIL — table & RPC missing.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000035_kasir_returns.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.kasir_returns (
  id                    BIGSERIAL PRIMARY KEY,
  original_tx_id        UUID NOT NULL REFERENCES public.kasir_transactions(id),
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  refund_amount         NUMERIC(15,2) NOT NULL CHECK (refund_amount >= 0),
  reason                TEXT NOT NULL,
  evidence_urls         TEXT[] NOT NULL DEFAULT '{}',
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_movement_id BIGINT REFERENCES public.stock_movements(id)
);

CREATE INDEX IF NOT EXISTS idx_kr_status  ON public.kasir_returns(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_kr_tx      ON public.kasir_returns(original_tx_id);

REVOKE UPDATE, DELETE ON public.kasir_returns FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.kasir_returns TO authenticated;

CREATE OR REPLACE FUNCTION public.request_kasir_refund(
  p_original_tx_id UUID,
  p_sku            TEXT,
  p_qty            INT,
  p_refund_amount  NUMERIC,
  p_reason         TEXT,
  p_evidence_urls  TEXT[],
  p_requested_by   UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app_id BIGINT;
  v_id     BIGINT;
BEGIN
  PERFORM 1 FROM public.kasir_transactions WHERE id = p_original_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kasir refund: tx % not found', p_original_tx_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES (
    'kasir_refund',
    jsonb_build_object(
      'original_tx_id', p_original_tx_id,
      'sku', p_sku, 'qty', p_qty,
      'refund_amount', p_refund_amount, 'reason', p_reason,
      'evidence_urls', to_jsonb(p_evidence_urls)
    ),
    p_requested_by
  )
  RETURNING id INTO v_app_id;

  INSERT INTO public.kasir_returns
    (original_tx_id, sku, qty, refund_amount, reason, evidence_urls,
     approval_request_id, requested_by)
  VALUES
    (p_original_tx_id, p_sku, p_qty, p_refund_amount, p_reason, p_evidence_urls,
     v_app_id, p_requested_by)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_kasir_refund(
  p_approval_request_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     TEXT;
  v_refund     RECORD;
  v_qty_before INT;
  v_movement   BIGINT;
  v_actor      UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  SELECT status INTO v_status FROM public.approval_requests WHERE id = p_approval_request_id;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'kasir refund: approval % not approved (status=%)',
      p_approval_request_id, v_status;
  END IF;

  SELECT * INTO v_refund FROM public.kasir_returns
    WHERE approval_request_id = p_approval_request_id
    FOR UPDATE;
  IF v_refund IS NULL THEN
    RAISE EXCEPTION 'kasir refund: no return row for approval %', p_approval_request_id;
  END IF;
  IF v_refund.status <> 'pending' THEN
    RAISE EXCEPTION 'kasir refund: return % already %', v_refund.id, v_refund.status;
  END IF;

  -- Restore to 'atas' by convention (single-warehouse customer-facing flow).
  -- If the application later needs to choose a warehouse, extend payload.
  SELECT stock_atas INTO v_qty_before FROM public.stocks WHERE sku = v_refund.sku FOR UPDATE;
  UPDATE public.stocks SET stock_atas = stock_atas + v_refund.qty WHERE sku = v_refund.sku;

  v_movement := public._log_stock_movement(
    p_sku             => v_refund.sku,
    p_warehouse       => 'atas',
    p_qty_delta       => v_refund.qty,
    p_qty_before      => v_qty_before,
    p_source          => 'return_kasir'::public.stock_movement_source,
    p_related_doc_type=> 'kasir_refund',
    p_related_doc_id  => v_refund.id::text,
    p_reason_code     => 'refund',
    p_reason_note     => v_refund.reason,
    p_actor_user_id   => v_actor,
    p_actor_role      => 'kasir_refund_commit',
    p_evidence_urls   => v_refund.evidence_urls
  );

  UPDATE public.kasir_returns
     SET status='approved', committed_movement_id = v_movement
   WHERE id = v_refund.id;

  -- Flip original kasir_transactions.status. Treat any refund as partial_refunded.
  UPDATE public.kasir_transactions
     SET status = 'partial_refunded'
   WHERE id = v_refund.original_tx_id
     AND status = 'committed';
END $$;

REVOKE EXECUTE ON FUNCTION public.request_kasir_refund(UUID, TEXT, INT, NUMERIC, TEXT, TEXT[], UUID)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_kasir_refund(UUID, TEXT, INT, NUMERIC, TEXT, TEXT[], UUID)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_approved_kasir_refund(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.commit_approved_kasir_refund(BIGINT) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestRequestKasirRefund|TestCommitApprovedKasirRefund' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000035_kasir_returns.sql backend-go/internal/db/kasir_refund_void_test.go
git commit -m "feat(kasir): kasir_returns table + request/commit refund RPCs with ledger restore"
```

---

## Task 7: Void RPCs

**Files:**
- Create: `supabase/migrations/20260607000036_kasir_void.sql`
- Modify: `backend-go/internal/db/kasir_refund_void_test.go`

- [ ] **Step 1: Write failing tests**

Append to `backend-go/internal/db/kasir_refund_void_test.go`:
```go
func TestRequestKasirVoid_CreatesApprovalRow(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-VD-1", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000300"
	shiftID := openShift(t, client, uid)

	var txID string
	_ = client.QueryRow(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin',
		    '[{"sku":"K3B-VD-1","qty":1,"unit_price":100000,"subtotal":100000,"hpp_per_unit":70000,"hpp_subtotal":70000}]'::jsonb,
		    100000, 70000, 'cash', $1, $2, 'committed')
		 RETURNING id::text`, shiftID, uid).Scan(&txID)

	var appReqID int64
	err := client.QueryRow(context.Background(),
		`SELECT public.request_kasir_void($1::uuid, 'salah input', $2::uuid)`,
		txID, uid).Scan(&appReqID)
	if err != nil {
		t.Fatalf("request void: %v", err)
	}

	var reqType, status string
	_ = client.QueryRow(context.Background(),
		`SELECT request_type::text, status::text FROM public.approval_requests WHERE id=$1`,
		appReqID).Scan(&reqType, &status)
	if reqType != "kasir_void" || status != "pending" {
		t.Fatalf("bad approval row: type=%s status=%s", reqType, status)
	}
}

func TestCommitApprovedKasirVoid_RestoresStockAndFlipsStatus(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	ensureTestSKU(t, client, "K3B-VD-2", 100000, 70000, 10)
	uid := "00000000-0000-0000-0000-000000000301"
	shiftID := openShift(t, client, uid)

	var before int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='K3B-VD-2'`).Scan(&before)

	var txID string
	_ = client.QueryRow(context.Background(),
		`INSERT INTO public.kasir_transactions
		   (type, channel, items, subtotal, hpp_total, payment_method,
		    shift_id, cashier_user_id, status)
		 VALUES
		   ('income','walkin',
		    '[{"sku":"K3B-VD-2","qty":2,"unit_price":100000,"subtotal":200000,"hpp_per_unit":70000,"hpp_subtotal":140000}]'::jsonb,
		    200000, 140000, 'cash', $1, $2, 'committed')
		 RETURNING id::text`, shiftID, uid).Scan(&txID)
	// Simulate the original sale decrement.
	_, _ = client.Exec(context.Background(),
		`UPDATE public.stocks SET stock_atas = stock_atas - 2 WHERE sku='K3B-VD-2'`)

	var appReqID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.request_kasir_void($1::uuid, 'tester', $2::uuid)`, txID, uid).
		Scan(&appReqID)
	approveDirect(t, client, appReqID)

	_, err := client.Exec(context.Background(),
		`SELECT public.commit_approved_kasir_void($1)`, appReqID)
	if err != nil {
		t.Fatalf("commit void: %v", err)
	}

	var after int
	_ = client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='K3B-VD-2'`).Scan(&after)
	if after != before {
		t.Fatalf("stock_atas = %d, want %d (void must fully restore)", after, before)
	}

	var status string
	_ = client.QueryRow(context.Background(),
		`SELECT status FROM public.kasir_transactions WHERE id=$1`, txID).Scan(&status)
	if status != "voided" {
		t.Fatalf("tx status = %s, want voided", status)
	}

	var src string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, qty_delta FROM public.stock_movements
		 WHERE related_doc_type='kasir_void' AND related_doc_id=$1
		 ORDER BY id DESC LIMIT 1`, txID).Scan(&src, &delta)
	if err != nil {
		t.Fatalf("ledger: %v", err)
	}
	if src != "sale_kasir" || delta != 2 {
		t.Fatalf("ledger wrong: src=%s delta=%d (want sale_kasir compensating row, +2)", src, delta)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `request_kasir_void` / `commit_approved_kasir_void` do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000036_kasir_void.sql`:
```sql
CREATE OR REPLACE FUNCTION public.request_kasir_void(
  p_tx_id        UUID,
  p_reason       TEXT,
  p_requested_by UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id BIGINT;
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.kasir_transactions WHERE id = p_tx_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'kasir void: tx % not found', p_tx_id;
  END IF;
  IF v_status <> 'committed' THEN
    RAISE EXCEPTION 'kasir void: tx % is not committed (status=%)', p_tx_id, v_status;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES (
    'kasir_void',
    jsonb_build_object('tx_id', p_tx_id, 'reason', p_reason),
    p_requested_by
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_kasir_void(
  p_approval_request_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   TEXT;
  v_payload  JSONB;
  v_tx_id    UUID;
  v_item     JSONB;
  v_sku      TEXT;
  v_qty      INT;
  v_before   INT;
  v_actor    UUID := COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  SELECT status, payload INTO v_status, v_payload
    FROM public.approval_requests WHERE id = p_approval_request_id;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'kasir void: approval % not approved (status=%)',
      p_approval_request_id, v_status;
  END IF;
  v_tx_id := (v_payload->>'tx_id')::UUID;

  -- For each item in the original tx, write a compensating ledger row that
  -- restores stock to 'atas' (single-warehouse customer-facing flow).
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(
      (SELECT items FROM public.kasir_transactions WHERE id = v_tx_id)
    )
  LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::INT;

    SELECT stock_atas INTO v_before FROM public.stocks WHERE sku = v_sku FOR UPDATE;
    UPDATE public.stocks SET stock_atas = stock_atas + v_qty WHERE sku = v_sku;

    PERFORM public._log_stock_movement(
      p_sku             => v_sku,
      p_warehouse       => 'atas',
      p_qty_delta       => v_qty,        -- positive = restore
      p_qty_before      => v_before,
      p_source          => 'sale_kasir'::public.stock_movement_source,  -- compensating row
      p_related_doc_type=> 'kasir_void',
      p_related_doc_id  => v_tx_id::text,
      p_reason_code     => 'void',
      p_reason_note     => v_payload->>'reason',
      p_actor_user_id   => v_actor,
      p_actor_role      => 'kasir_void_commit'
    );
  END LOOP;

  UPDATE public.kasir_transactions
     SET status = 'voided'
   WHERE id = v_tx_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.request_kasir_void(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_kasir_void(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_approved_kasir_void(BIGINT)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.commit_approved_kasir_void(BIGINT)   TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run 'TestRequestKasirVoid|TestCommitApprovedKasirVoid' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000036_kasir_void.sql backend-go/internal/db/kasir_refund_void_test.go
git commit -m "feat(kasir): request_kasir_void + commit_approved_kasir_void with compensating ledger rows"
```

---

## Task 8: Frontend — shift bar + supabaseClient service wrappers

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Create: `src/components/kasir/KasirShiftOpenModal.tsx`
- Create: `src/components/kasir/KasirShiftCloseModal.tsx`
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add service wrappers**

`src/lib/supabaseClient.ts` — append near the other domain services:
```ts
export interface KasirShift {
  id: number;
  opened_by_user_id: string;
  opened_at: string;
  opening_cash_amount: number;
  closed_at: string | null;
  closing_cash_counted: number | null;
  closing_cash_expected: number | null;
  variance: number | null;
  status: 'open' | 'closed' | 'disputed';
}

export const kasirShiftService = {
  async getMyOpenShift(userId: string): Promise<KasirShift | null> {
    const { data, error } = await supabase
      .from('kasir_shifts')
      .select('*')
      .eq('opened_by_user_id', userId)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw error;
    return (data as KasirShift) ?? null;
  },
  async openShift(userId: string, openingCash: number, photoUrl: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('open_kasir_shift', {
      p_user_id: userId,
      p_opening_cash: openingCash,
      p_opening_photo_url: photoUrl,
    });
    if (error) throw error;
    return data as number;
  },
  async closeShift(shiftId: number, cashCounted: number, note: string | null): Promise<void> {
    const { error } = await supabase.rpc('close_kasir_shift', {
      p_shift_id: shiftId,
      p_closing_cash_counted: cashCounted,
      p_note: note,
    });
    if (error) throw error;
  },
};
```

- [ ] **Step 2: Write `KasirShiftOpenModal.tsx`**

`src/components/kasir/KasirShiftOpenModal.tsx`:
```tsx
import React, { useState } from 'react';
import { kasirShiftService } from '../../lib/supabaseClient';

interface Props {
  userId: string;
  onOpened: (shiftId: number) => void;
  onClose: () => void;
}

export default function KasirShiftOpenModal({ userId, onOpened, onClose }: Props) {
  const [cash, setCash] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = Number(cash);
    if (!Number.isFinite(n) || n < 0) { setErr('Masukkan jumlah uang awal'); return; }
    setSaving(true); setErr(null);
    try {
      const id = await kasirShiftService.openShift(userId, n, null);
      onOpened(id);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal buka shift');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Buka Shift Kasir</h3>
        <label className="block text-sm font-medium mb-1">Uang awal laci (Rp)</label>
        <input
          type="number"
          value={cash}
          onChange={e => setCash(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 mb-3"
        />
        {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">Batal</button>
          <button onClick={submit} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white">
            {saving ? 'Membuka…' : 'Buka Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `KasirShiftCloseModal.tsx`**

`src/components/kasir/KasirShiftCloseModal.tsx`:
```tsx
import React, { useState } from 'react';
import { kasirShiftService, KasirShift } from '../../lib/supabaseClient';

interface Props {
  shift: KasirShift;
  expectedPreview: number;            // computed client-side for display only
  onClosed: () => void;
  onClose: () => void;
}

export default function KasirShiftCloseModal({ shift, expectedPreview, onClosed, onClose }: Props) {
  const [counted, setCounted] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const countedN = Number(counted);
  const variance = Number.isFinite(countedN) ? countedN - expectedPreview : 0;

  async function submit() {
    if (!Number.isFinite(countedN) || countedN < 0) { setErr('Masukkan jumlah dihitung'); return; }
    setSaving(true); setErr(null);
    try {
      await kasirShiftService.closeShift(shift.id, countedN, note || null);
      onClosed();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal tutup shift');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">Tutup Shift</h3>
        <p className="text-sm text-gray-500 mb-3">
          Ekspektasi (preview, server akan re-hitung): Rp {expectedPreview.toLocaleString('id-ID')}
        </p>
        <label className="block text-sm font-medium mb-1">Uang fisik dihitung (Rp)</label>
        <input type="number" value={counted} onChange={e => setCounted(e.target.value)}
               className="w-full border rounded-lg px-3 py-2 mb-3" />
        {Number.isFinite(countedN) && (
          <p className={`text-sm mb-2 ${variance === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
            Selisih (preview): Rp {variance.toLocaleString('id-ID')}
          </p>
        )}
        <label className="block text-sm font-medium mb-1">Catatan</label>
        <textarea value={note} onChange={e => setNote(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mb-3" rows={2} />
        {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">Batal</button>
          <button onClick={submit} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white">
            {saving ? 'Menutup…' : 'Tutup Shift'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Touch `KasirScreen.tsx` — gate behind open shift + shift bar**

At the top of `KasirScreen` (after existing state declarations) insert:
```tsx
import KasirShiftOpenModal from './kasir/KasirShiftOpenModal';
import KasirShiftCloseModal from './kasir/KasirShiftCloseModal';
import { kasirShiftService, KasirShift } from '../lib/supabaseClient';

// ...

const [openShift, setOpenShift] = useState<KasirShift | null>(null);
const [showOpenModal, setShowOpenModal] = useState(false);
const [showCloseModal, setShowCloseModal] = useState(false);

useEffect(() => {
  if (!currentUserId) return;
  kasirShiftService.getMyOpenShift(currentUserId).then(setOpenShift).catch(console.error);
}, [currentUserId]);

if (!openShift) {
  return (
    <div className="p-8 text-center">
      <h2 className="text-xl font-bold mb-3">Shift Kasir belum dibuka</h2>
      <p className="text-gray-500 mb-4">Buka shift sebelum mulai mencatat transaksi.</p>
      <button onClick={() => setShowOpenModal(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white">Buka Shift</button>
      {showOpenModal && (
        <KasirShiftOpenModal
          userId={currentUserId}
          onOpened={async () => {
            setShowOpenModal(false);
            setOpenShift(await kasirShiftService.getMyOpenShift(currentUserId));
          }}
          onClose={() => setShowOpenModal(false)}
        />
      )}
    </div>
  );
}
```

And add a shift bar at the top of the main `KasirScreen` JSX:
```tsx
<div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center justify-between mb-3">
  <span className="text-sm">
    Shift #{openShift.id} · dibuka {new Date(openShift.opened_at).toLocaleString('id-ID')} · awal Rp{' '}
    {openShift.opening_cash_amount.toLocaleString('id-ID')}
  </span>
  <button onClick={() => setShowCloseModal(true)}
          className="text-sm px-3 py-1 rounded-md bg-blue-600 text-white">Tutup Shift</button>
</div>
{showCloseModal && (
  <KasirShiftCloseModal
    shift={openShift}
    expectedPreview={openShift.opening_cash_amount /* TODO add cash sales aggregator */}
    onClosed={async () => {
      setShowCloseModal(false);
      setOpenShift(await kasirShiftService.getMyOpenShift(currentUserId));
    }}
    onClose={() => setShowCloseModal(false)}
  />
)}
```

- [ ] **Step 5: Verify build**

Run: `npm run build` (or `npm run lint`)
Expected: passes. The gate UI renders when no open shift; main UI renders when shift open.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabaseClient.ts src/components/kasir/KasirShiftOpenModal.tsx \
        src/components/kasir/KasirShiftCloseModal.tsx src/components/KasirScreen.tsx
git commit -m "feat(kasir-ui): shift bar + open/close shift modals on KasirScreen"
```

---

## Task 9: Frontend — switch sale insert to atomic RPC + price override modal

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Create: `src/components/kasir/KasirPriceOverrideModal.tsx`
- Modify: `src/components/KasirInvoiceModal.tsx`

- [ ] **Step 1: Add override + transaction wrappers**

Append to `src/lib/supabaseClient.ts`:
```ts
export interface KasirSaleLine {
  sku: string;
  qty: number;
  unit_price: number;
  override_id?: number | null;
}

export const kasirOverrideService = {
  async requestOverride(sessionId: string, sku: string, requestedPrice: number,
                        reasonCode: string, reasonNote: string | null, requestedBy: string)
    : Promise<{ overrideId: number; approvalRequestId: number }> {
    const { data: overrideId, error } = await supabase.rpc('request_kasir_price_override', {
      p_session_id: sessionId,
      p_sku: sku,
      p_requested_price: requestedPrice,
      p_reason_code: reasonCode,
      p_reason_note: reasonNote,
      p_requested_by: requestedBy,
    });
    if (error) throw error;
    const { data: row } = await supabase
      .from('kasir_price_override_requests')
      .select('approval_request_id, status')
      .eq('id', overrideId)
      .single();
    return { overrideId: overrideId as number, approvalRequestId: row!.approval_request_id };
  },
  async pollStatus(overrideId: number): Promise<'pending'|'approved'|'rejected'|'expired'> {
    const { data, error } = await supabase
      .from('kasir_price_override_requests')
      .select('status')
      .eq('id', overrideId).single();
    if (error) throw error;
    return (data!.status as any);
  },
};

export const kasirTxService = {
  async createTransaction(args: {
    cashierUserId: string;
    channel: string;
    paymentMethod: string;
    items: KasirSaleLine[];
    invoiceNumber: string;
    customerName: string | null;
    customerPhone: string | null;
    sessionId: string;
    warehouse?: 'atas' | 'bawah';
  }): Promise<string> {
    const { data, error } = await supabase.rpc('create_kasir_transaction', {
      p_cashier_user_id: args.cashierUserId,
      p_channel: args.channel,
      p_payment_method: args.paymentMethod,
      p_items: args.items,
      p_invoice_number: args.invoiceNumber,
      p_customer_name: args.customerName,
      p_customer_phone: args.customerPhone,
      p_session_id: args.sessionId,
      p_warehouse: args.warehouse ?? 'atas',
    });
    if (error) throw error;
    return data as string;
  },
};
```

- [ ] **Step 2: Write `KasirPriceOverrideModal.tsx`**

`src/components/kasir/KasirPriceOverrideModal.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { kasirOverrideService } from '../../lib/supabaseClient';
import OwnerPinPad from '../OwnerPinPad'; // reused from Phase 2
import { supabase } from '../../lib/supabaseClient';

interface Props {
  sessionId: string;
  sku: string;
  defaultPrice: number;
  hargaModal: number;
  minMarginPct: number;
  requestedBy: string;
  onApproved: (overrideId: number, requestedPrice: number) => void;
  onClose: () => void;
}

const REASONS = [
  { v: 'negosiasi_customer', l: 'Negosiasi customer' },
  { v: 'promo_tidak_terdaftar', l: 'Promo tidak terdaftar' },
  { v: 'barang_demo', l: 'Barang demo' },
  { v: 'lainnya', l: 'Lainnya' },
];

export default function KasirPriceOverrideModal(p: Props) {
  const [price, setPrice] = useState<string>('');
  const [reason, setReason] = useState<string>('negosiasi_customer');
  const [note, setNote] = useState('');
  const [overrideId, setOverrideId] = useState<number | null>(null);
  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle'|'pending'|'approved'|'rejected'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const floor = p.hargaModal * p.minMarginPct;
  const requested = Number(price);
  const belowFloor = Number.isFinite(requested) && requested < floor;

  async function submit() {
    if (!Number.isFinite(requested) || requested <= 0) { setErr('Masukkan harga'); return; }
    if (belowFloor) { setErr(`Di bawah floor Rp ${floor.toLocaleString('id-ID')}`); return; }
    if (requested === p.defaultPrice) { setErr('Harga sama dengan default'); return; }
    setErr(null);
    try {
      const { overrideId: oid, approvalRequestId: arid } =
        await kasirOverrideService.requestOverride(
          p.sessionId, p.sku, requested, reason, note || null, p.requestedBy);
      setOverrideId(oid);
      setApprovalId(arid);
      setStatus('pending');
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal request override');
    }
  }

  // Poll status when pending (simple polling — realtime channel optional).
  useEffect(() => {
    if (status !== 'pending' || !overrideId) return;
    const t = setInterval(async () => {
      const s = await kasirOverrideService.pollStatus(overrideId);
      if (s === 'approved') {
        setStatus('approved');
        p.onApproved(overrideId, requested);
      } else if (s === 'rejected' || s === 'expired') {
        setStatus('rejected');
      }
    }, 2500);
    return () => clearInterval(t);
  }, [status, overrideId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={p.onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">Ubah Harga — {p.sku}</h3>
        <p className="text-sm text-gray-500 mb-2">
          Default: Rp {p.defaultPrice.toLocaleString('id-ID')} · Floor: Rp {floor.toLocaleString('id-ID')}
        </p>
        {status === 'idle' && (
          <>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                   className="w-full border rounded-lg px-3 py-2 mb-3" placeholder="Harga baru" />
            <select value={reason} onChange={e => setReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 mb-3">
              {REASONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      className="w-full border rounded-lg px-3 py-2 mb-3" placeholder="Catatan" />
            {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={p.onClose} className="px-4 py-2 rounded-lg border">Batal</button>
              <button onClick={submit} className="px-4 py-2 rounded-lg bg-blue-600 text-white">
                Kirim ke Owner
              </button>
            </div>
          </>
        )}
        {status === 'pending' && approvalId && (
          <div>
            <p className="text-sm mb-3">Menunggu Owner menyetujui di WA atau lewat PIN.</p>
            <OwnerPinPad approvalRequestId={approvalId} onApproved={() => { /* polled */ }} />
          </div>
        )}
        {status === 'approved' && <p className="text-emerald-600">Disetujui. Lanjut checkout.</p>}
        {status === 'rejected' && <p className="text-red-600">Ditolak / kadaluarsa.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Touch `KasirInvoiceModal.tsx`**

In the cart item row, replace the editable price input with a read-only display plus a 🔒 lock and "Ubah harga" button. Track per-line `override_id` and badge state. Disable checkout while any line has a pending override.

Sketch (the exact JSX depends on the existing row layout — match the surrounding styles):
```tsx
// state additions
const sessionId = useMemo(() => crypto.randomUUID(), []);
const [overrideTarget, setOverrideTarget] = useState<KasirItem | null>(null);
const [overrideStatuses, setOverrideStatuses] = useState<Record<number, 'pending'|'approved'>>({});
const anyPending = Object.values(overrideStatuses).includes('pending');

// in the cart row, replace the price input with:
<div className="flex items-center gap-1">
  <span>Rp {item.unit_price.toLocaleString('id-ID')}</span>
  <span title="Harga terkunci">🔒</span>
  <button className="text-xs underline text-blue-600"
          onClick={() => setOverrideTarget(item)}>Ubah harga</button>
  {overrideStatuses[item._key] === 'pending' && (
    <span className="ml-1 text-xs bg-amber-100 text-amber-800 px-2 rounded">Pending</span>
  )}
  {overrideStatuses[item._key] === 'approved' && (
    <span className="ml-1 text-xs bg-emerald-100 text-emerald-800 px-2 rounded">Approved</span>
  )}
</div>

// in handleSave, replace the three-step pattern with the atomic RPC:
const txId = await kasirTxService.createTransaction({
  cashierUserId: currentUserId,
  channel,
  paymentMethod,
  items: items.map(i => ({
    sku: i.sku, qty: i.qty, unit_price: i.unit_price,
    override_id: i.override_id ?? null,
  })),
  invoiceNumber,
  customerName: customerName || null,
  customerPhone: customerPhone || null,
  sessionId,
  warehouse,
});

// at the bottom of the modal, render the override modal:
{overrideTarget && (
  <KasirPriceOverrideModal
    sessionId={sessionId}
    sku={overrideTarget.sku}
    defaultPrice={overrideTarget.unit_price /* default */}
    hargaModal={overrideTarget.hpp_per_unit}
    minMarginPct={companySettings.kasir_min_margin_pct}
    requestedBy={currentUserId}
    onApproved={(overrideId, requestedPrice) => {
      setItems(prev => prev.map(i => i._key === overrideTarget._key
        ? { ...i, unit_price: requestedPrice, subtotal: requestedPrice * i.qty, override_id: overrideId }
        : i));
      setOverrideStatuses(s => ({ ...s, [overrideTarget._key]: 'approved' }));
      setOverrideTarget(null);
    }}
    onClose={() => setOverrideTarget(null)}
  />
)}

// checkout button:
<button disabled={saving || anyPending} ...>Checkout</button>
```

The atomic RPC removes the previous comment block at `KasirScreen.tsx:621` ("NOTE: non-atomic — deductFifo cannot be rolled back…"). Delete it; atomicity is now enforced server-side.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts \
        src/components/kasir/KasirPriceOverrideModal.tsx \
        src/components/KasirInvoiceModal.tsx \
        src/components/KasirScreen.tsx
git commit -m "feat(kasir-ui): lock unit_price + override modal + switch sale path to atomic RPC"
```

---

## Task 10: Frontend — refund flow on past transactions

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Create: `src/components/kasir/KasirRefundModal.tsx`
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add refund service wrappers**

Append to `src/lib/supabaseClient.ts`:
```ts
export const kasirRefundService = {
  async requestRefund(args: {
    originalTxId: string; sku: string; qty: number; refundAmount: number;
    reason: string; evidenceUrls: string[]; requestedBy: string;
  }): Promise<number> {
    const { data, error } = await supabase.rpc('request_kasir_refund', {
      p_original_tx_id: args.originalTxId,
      p_sku: args.sku,
      p_qty: args.qty,
      p_refund_amount: args.refundAmount,
      p_reason: args.reason,
      p_evidence_urls: args.evidenceUrls,
      p_requested_by: args.requestedBy,
    });
    if (error) throw error;
    return data as number;
  },
};
```

- [ ] **Step 2: Write `KasirRefundModal.tsx`**

`src/components/kasir/KasirRefundModal.tsx`:
```tsx
import React, { useState } from 'react';
import { kasirRefundService, supabase } from '../../lib/supabaseClient';

interface SaleItem {
  sku: string;
  qty: number;
  unit_price: number;
}
interface Props {
  txId: string;
  items: SaleItem[];
  requestedBy: string;
  onSubmitted: () => void;
  onClose: () => void;
}

export default function KasirRefundModal({ txId, items, requestedBy, onSubmitted, onClose }: Props) {
  const [sku, setSku] = useState(items[0]?.sku ?? '');
  const [qty, setQty] = useState<string>('1');
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(): Promise<string[]> {
    const urls: string[] = [];
    for (const f of files) {
      const path = `kasir-returns/${txId}/${Date.now()}-${f.name}`;
      const { error } = await supabase.storage.from('stock-evidence').upload(path, f);
      if (error) throw error;
      const { data } = supabase.storage.from('stock-evidence').getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  async function submit() {
    const q = Number(qty), a = Number(amount);
    if (!sku || !Number.isFinite(q) || q <= 0) { setErr('SKU & qty wajib'); return; }
    if (!Number.isFinite(a) || a < 0) { setErr('Jumlah refund wajib'); return; }
    if (!reason.trim()) { setErr('Alasan wajib'); return; }
    setBusy(true); setErr(null);
    try {
      const urls = await upload();
      await kasirRefundService.requestRefund({
        originalTxId: txId, sku, qty: q, refundAmount: a,
        reason, evidenceUrls: urls, requestedBy,
      });
      onSubmitted();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal kirim refund');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-2">Refund</h3>
        <label className="block text-sm font-medium mb-1">Item</label>
        <select value={sku} onChange={e => setSku(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 mb-2">
          {items.map(it => (
            <option key={it.sku} value={it.sku}>
              {it.sku} (qty {it.qty} @ Rp {it.unit_price.toLocaleString('id-ID')})
            </option>
          ))}
        </select>
        <label className="block text-sm font-medium mb-1">Qty dikembalikan</label>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)}
               className="w-full border rounded-lg px-3 py-2 mb-2" />
        <label className="block text-sm font-medium mb-1">Refund (Rp)</label>
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
               className="w-full border rounded-lg px-3 py-2 mb-2" />
        <label className="block text-sm font-medium mb-1">Alasan</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  className="w-full border rounded-lg px-3 py-2 mb-2" />
        <label className="block text-sm font-medium mb-1">Foto bukti</label>
        <input type="file" multiple
               onChange={e => setFiles(Array.from(e.target.files ?? []))}
               className="mb-3" />
        {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border">Batal</button>
          <button onClick={submit} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white">
            {busy ? 'Mengirim…' : 'Kirim ke Owner'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Touch `KasirScreen.tsx` — Refund button on past transactions**

In the existing transactions list rendering (~`KasirScreen.tsx:360`), add a button next to the Print/Invoice action:
```tsx
{isIncome && tx.status === 'committed' && (
  <button className="text-xs underline text-red-600 ml-2"
          onClick={() => setRefundTarget(tx)}>Refund</button>
)}
```

Add state + render at modal level:
```tsx
const [refundTarget, setRefundTarget] = useState<KasirTransaction | null>(null);

{refundTarget && (
  <KasirRefundModal
    txId={refundTarget.id}
    items={(refundTarget.items as any[]).map(i => ({
      sku: i.sku, qty: i.qty, unit_price: i.unit_price,
    }))}
    requestedBy={currentUserId}
    onSubmitted={() => { setRefundTarget(null); /* showToast */ }}
    onClose={() => setRefundTarget(null)}
  />
)}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabaseClient.ts \
        src/components/kasir/KasirRefundModal.tsx \
        src/components/KasirScreen.tsx
git commit -m "feat(kasir-ui): refund modal + Refund button on past transactions"
```

---

## Task 11: Manual integration smoke through the running app

**Files:** none (manual verification) — followed by progress.md bump.

- [ ] **Step 1: Bring up local dev environment**

Run: `npm run dev` + Go daemon as documented in README. Sign in as a non-Owner cashier (Staff Admin Toko role).

- [ ] **Step 2: Walk the full flow**

1. **Gate:** Open Kasir screen → see "Shift belum dibuka" gate. Click "Buka Shift", enter Rp 200.000 → main UI appears with shift bar.
2. **Default-price sale:** Add an item, leave price untouched, checkout. Verify `kasir_transactions` row has `shift_id`, `cashier_user_id`, `status='committed'`; `stock_movements` has `source='sale_kasir'`, `related_doc_type='kasir_transaction'`.
3. **Floor block:** Try to override price below `harga_modal × 1.00` → submit → Owner approves via PIN → checkout → expect server error "below floor". Verify no `kasir_transactions` row, no `stock_movements` row.
4. **Successful override:** Override to a price ≥ floor but ≠ default → Owner approves → badge flips Approved → checkout succeeds → verify `kasir_price_override_requests.committed_kasir_tx_id` set.
5. **Refund:** Click Refund on the prior committed tx → upload one photo → submit. Approve via Owner PIN. Verify `stocks.stock_atas` increased, `stock_movements` has `source='return_kasir'` with positive `qty_delta`, `kasir_transactions.status='partial_refunded'`.
6. **Void:** (Not surfaced as a button per scope summary — exercise by hitting `request_kasir_void` via SQL or a dev console.) Approve. Verify compensating ledger row, `kasir_transactions.status='voided'`.
7. **Close shift:** Click "Tutup Shift" → enter expected amount → confirm `kasir_shifts.status='closed'`. Then repeat with deliberate Rp 100k short → confirm `status='disputed'`.

- [ ] **Step 3: Bump `progress.md`**

Add a Phase 3b — DONE entry summarizing what shipped, link the migrations and modals.

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Phase 3b kasir controls shipped"
```

---

## Self-Review Checklist

Run through this before declaring Phase 3b done:

- [ ] All seven new migrations apply cleanly on a fresh database (Phase 1 + 2 prerequisites already applied).
- [ ] All Go integration tests pass: `go test ./internal/db/ -run 'TestKasir|TestRequestKasir|TestCommitApprovedKasir|TestCreateKasirTransaction' -v`.
- [ ] Existing Phase 1 ledger tests still pass — no regression in `_log_stock_movement` callers.
- [ ] `kasir_shifts` partial unique index prevents a second open shift for the same user.
- [ ] `create_kasir_transaction` rejects three classes of bad input: no shift, price mismatch without override, below floor (even with approved override).
- [ ] Override `committed_kasir_tx_id` is set on first successful use; replaying the same override on a second tx errors via the `uniq_override_single_use` partial unique index.
- [ ] Refund and void each write one ledger row per affected item, with `qty_delta` **positive** (restoring stock), reusing `_log_stock_movement`.
- [ ] Refund row source is `return_kasir`; void row source is `sale_kasir` (compensating row with positive delta) — verified by tests.
- [ ] `close_kasir_shift` computes `closing_cash_expected` server-side from cash income only; transfers/qris excluded.
- [ ] Variance > `kasir_max_variance` flips shift `status='disputed'`.
- [ ] Frontend gates the Kasir UI when no open shift exists.
- [ ] `KasirInvoiceModal` `unit_price` is read-only; the only way to change is the override flow.
- [ ] Checkout button disabled while any line has a pending override.
- [ ] Refund button visible on past `committed` transactions only.
- [ ] `progress.md` updated with Phase 3b DONE entry.

## Out of Scope (Phase 3b)

- Loss-leader sales below floor with Owner explicit override (would require extending payload with `floor_override:true` and `can_override_price_floor` permission — deferred).
- Multi-currency.
- Cash drawer hardware integration.
- Receipt printing changes (existing `InvoiceModal` unchanged).
- Shift handover between users mid-day (current model: one user closes, next opens fresh).
- Refund of items into `'bawah'` warehouse (current commit always restores to `'atas'`; the spec does not require warehouse choice on refund).
- Void surfaced as a dedicated UI button — RPC exists, but the prompt's scope summary lists only the four modals; surfacing void in UI is a follow-up.
- WA Owner approval button infrastructure beyond what Phase 2 ships (this plan reuses Phase 2's `OwnerPinPad` and assumes the WA webhook handler is already wired).
- Backfill of pre-Phase-3b kasir transactions with `shift_id` / `cashier_user_id` (defaults to NULL on existing rows; analytics in Phase 4 should handle NULL gracefully).
