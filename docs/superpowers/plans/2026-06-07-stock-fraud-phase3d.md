# Stock Fraud Phase 3d — Transfer Two-Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the instant single-shot `transfer_warehouse` RPC with an explicit two-step state machine (`initiated → received | disputed | cancelled`) backed by a new `warehouse_transfers` table. Initiator ≠ intended receiver is enforced by CHECK + RPC validation, ≥ 1 send photo and ≥ 1 receive photo are required, and the receiver-side ledger row writes only the `counted_qty` — any shortfall stays as a logical deficit on the disputed transfer until the Owner files a Phase 2 `stock_adjustment` (reason `'hilang'`). No phantom `transit` warehouse: the ledger only knows `'atas'` and `'bawah'`.

**Architecture:** New `warehouse_transfers` table holds the state machine + photo arrays + qty fields with CHECK constraints (different warehouses, two-person, ≥ 1 send photo). Three new `SECURITY DEFINER` RPCs — `transfer_initiate`, `transfer_receive`, `transfer_dispute` — call the Phase 1 `_log_stock_movement` helper to emit `transfer_out` / `transfer_in` ledger rows inside the same transaction as the `stocks` mutation. The legacy `transfer_warehouse` (already wrapped in Phase 1 to log a paired out+in) is dropped in the last task, after all callers are migrated. Frontend: `WarehouseTransferModal.tsx` is rewritten to call `transferService.initiate`; a new `TransferMasukScreen.tsx` (gated by a live-count query on `warehouse_transfers WHERE intended_receiver_user_id = me AND status = 'initiated'`) lists incoming transfers awaiting confirmation; `TransferReceiveModal.tsx` takes `counted_qty` + receive-photo dropzone and calls `transferService.receive`. The Phase 4 aging dashboard reads `initiated_at` + `status` from this table — Phase 3d only writes the data, no aging UI here.

**Tech Stack:** Postgres 15 (Supabase), Go 1.25 for RPC integration tests via existing `dbClient` pattern, React + TypeScript + Tailwind for the UI, behavioral tests via the `supabaseClient` mock pattern already used elsewhere in `src/`.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 3d section)

**Depends on:** Phase 1 (immutable ledger + `_log_stock_movement` helper), Phase 2 (`approval_requests`, `action_permissions` column on `admin_users`, `stock-evidence` storage bucket policies, Owner WA alert infra).

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000040_warehouse_transfers.sql` | Create | New `warehouse_transfers` table + `transfer_status` enum + CHECK constraints + indexes |
| `supabase/migrations/20260607000041_transfer_initiate.sql` | Create | `transfer_initiate` RPC — validates, decrements source, writes table row + `transfer_out` ledger row |
| `supabase/migrations/20260607000042_transfer_receive.sql` | Create | `transfer_receive` RPC — caller must be intended_receiver, writes `transfer_in` ledger row for `counted_qty`; shortfall → status `disputed` |
| `supabase/migrations/20260607000043_transfer_dispute.sql` | Create | `transfer_dispute` RPC for wrong-SKU disputes by the receiver |
| `supabase/migrations/20260607000044_transfer_action_permissions_seed.sql` | Create | UPDATE `admin_users.action_permissions` to seed `can_initiate_transfer` + `can_receive_transfer` defaults per role |
| `supabase/migrations/20260607000049_drop_legacy_transfer_warehouse.sql` | Create | `DROP FUNCTION public.transfer_warehouse(text,text,text,int)` — runs LAST, after all callers migrated |
| `backend-go/internal/db/warehouse_transfers.go` | Create | Go query helpers (`InsertTransferInitiate`, `RecordTransferReceive`, `CountPendingForReceiver`) for tests + future Phase 4 |
| `backend-go/internal/db/warehouse_transfers_test.go` | Create | Integration tests for all three RPCs against the Supabase test DB |
| `backend-go/internal/whatsapp/transfer_alert.go` | Create | `SendDisputedTransferAlert(ownerJID, transferID, shortfall)` — no-button informational alert |
| `backend-go/internal/whatsapp/transfer_alert_test.go` | Create | Unit test for the alert payload |
| `src/lib/transferService.ts` | Create | `transferService.initiate / receive / dispute / listIncoming` wrappers around the new RPCs |
| `src/lib/transferService.test.ts` | Create | Behavioral tests via supabaseClient mock |
| `src/lib/pembelianService.ts` | Modify | Remove the deprecated `transferWarehouse` method (last task) |
| `src/components/WarehouseTransferModal.tsx` | Modify | Add intended-receiver dropdown, send-photo dropzone, call `transferService.initiate` |
| `src/components/TransferMasukScreen.tsx` | Create | List incoming transfers (intended_receiver = me, status = initiated); opens receive modal |
| `src/components/TransferReceiveModal.tsx` | Create | counted_qty input + receive-photo dropzone, calls `transferService.receive` |
| `src/components/Sidebar.tsx` | Modify | Add "Transfer Masuk" item, conditionally visible when pending count > 0 |
| `src/types.ts` | Modify | Add `'transfer-masuk'` to `ActivePage`; add `WarehouseTransfer` interface |
| `src/App.tsx` | Modify | Route `transfer-masuk` to `<TransferMasukScreen />` |

**Migration numbering note:** Phase 2's plan uses `20260607000006`–`20260607000020`; Phase 3a uses `20260607000021`–`20260607000030`; Phase 3b uses `20260607000031`–`20260607000039`. Phase 3d takes `20260607000040`+ with `20260607000049` deliberately reserved for the legacy-drop migration so it sorts after everything in this phase.

---

## Task 1: `warehouse_transfers` table + state machine + constraints

**Files:**
- Create: `supabase/migrations/20260607000040_warehouse_transfers.sql`
- Create: `backend-go/internal/db/warehouse_transfers_test.go` (skeleton + first test)

- [ ] **Step 1: Write failing test for table existence + key constraints**

`backend-go/internal/db/warehouse_transfers_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestWarehouseTransfers_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema='public' AND table_name='warehouse_transfers'`).Scan(&n)
	if err != nil {
		t.Fatalf("warehouse_transfers table missing: %v", err)
	}
}

func TestWarehouseTransfers_RejectsSameWarehouse(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.warehouse_transfers
		   (sku, from_warehouse, to_warehouse, initiated_qty,
		    initiated_by_user_id, intended_receiver_user_id, send_photo_urls)
		 VALUES ('TEST-TR','atas','atas', 1,
		         '00000000-0000-0000-0000-000000000001',
		         '00000000-0000-0000-0000-000000000002',
		         ARRAY['https://example.com/p.jpg'])`)
	if err == nil || !strings.Contains(err.Error(), "chk_different_warehouses") {
		t.Fatalf("expected chk_different_warehouses violation, got: %v", err)
	}
}

func TestWarehouseTransfers_RejectsSameInitiatorAndReceiver(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.warehouse_transfers
		   (sku, from_warehouse, to_warehouse, initiated_qty,
		    initiated_by_user_id, intended_receiver_user_id, send_photo_urls)
		 VALUES ('TEST-TR','atas','bawah', 1,
		         '00000000-0000-0000-0000-000000000001',
		         '00000000-0000-0000-0000-000000000001',
		         ARRAY['https://example.com/p.jpg'])`)
	if err == nil || !strings.Contains(err.Error(), "chk_two_person_transfer") {
		t.Fatalf("expected chk_two_person_transfer violation, got: %v", err)
	}
}

func TestWarehouseTransfers_RejectsEmptySendPhoto(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.warehouse_transfers
		   (sku, from_warehouse, to_warehouse, initiated_qty,
		    initiated_by_user_id, intended_receiver_user_id, send_photo_urls)
		 VALUES ('TEST-TR','atas','bawah', 1,
		         '00000000-0000-0000-0000-000000000001',
		         '00000000-0000-0000-0000-000000000002',
		         ARRAY[]::text[])`)
	if err == nil || !strings.Contains(err.Error(), "chk_send_photo") {
		t.Fatalf("expected chk_send_photo violation, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestWarehouseTransfers_ -v`
Expected: FAIL — `relation "warehouse_transfers" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000040_warehouse_transfers.sql`:
```sql
CREATE TYPE public.transfer_status AS ENUM ('initiated','received','disputed','cancelled');

CREATE TABLE public.warehouse_transfers (
  id                        BIGSERIAL PRIMARY KEY,
  sku                       TEXT NOT NULL REFERENCES public.stocks(sku),
  from_warehouse            TEXT NOT NULL CHECK (from_warehouse IN ('atas','bawah')),
  to_warehouse              TEXT NOT NULL CHECK (to_warehouse IN ('atas','bawah')),
  CONSTRAINT chk_different_warehouses CHECK (from_warehouse <> to_warehouse),
  initiated_qty             INTEGER NOT NULL CHECK (initiated_qty > 0),
  initiated_by_user_id      UUID NOT NULL,
  intended_receiver_user_id UUID NOT NULL,
  CONSTRAINT chk_two_person_transfer CHECK (initiated_by_user_id <> intended_receiver_user_id),
  initiated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_photo_urls           TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT chk_send_photo CHECK (array_length(send_photo_urls, 1) >= 1),
  received_qty              INTEGER,
  received_at               TIMESTAMPTZ,
  received_by_user_id       UUID,
  receive_photo_urls        TEXT[] NOT NULL DEFAULT '{}',
  variance                  INTEGER GENERATED ALWAYS AS
                            (COALESCE(received_qty, 0) - initiated_qty) STORED,
  status                    public.transfer_status NOT NULL DEFAULT 'initiated',
  dispute_note              TEXT,
  initiate_movement_id      BIGINT REFERENCES public.stock_movements(id),
  receive_movement_id       BIGINT REFERENCES public.stock_movements(id)
);

CREATE INDEX idx_wt_status_initiated  ON public.warehouse_transfers(status, initiated_at DESC);
CREATE INDEX idx_wt_receiver_status   ON public.warehouse_transfers(intended_receiver_user_id, status);
CREATE INDEX idx_wt_initiator_status  ON public.warehouse_transfers(initiated_by_user_id, status);

GRANT SELECT ON public.warehouse_transfers TO authenticated;
-- INSERT and UPDATE are only performed by the SECURITY DEFINER RPCs below;
-- direct write paths stay revoked.
REVOKE INSERT, UPDATE, DELETE ON public.warehouse_transfers FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Apply migration**

Run: `supabase db push --include-all`
Expected: migration applied with no errors.

- [ ] **Step 5: Re-run tests**

Run: `cd backend-go && go test ./internal/db/ -run TestWarehouseTransfers_ -v`
Expected: all four PASS. (The three INSERT-rejection tests use service-role which bypasses the REVOKE; the CHECKs still fire.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000040_warehouse_transfers.sql \
        backend-go/internal/db/warehouse_transfers_test.go
git commit -m "feat(stocks): add warehouse_transfers table with two-step state machine (Phase 3d)"
```

---

## Task 2: `transfer_initiate` RPC

**Files:**
- Create: `supabase/migrations/20260607000041_transfer_initiate.sql`
- Create: `backend-go/internal/db/warehouse_transfers.go`
- Modify: `backend-go/internal/db/warehouse_transfers_test.go`

- [ ] **Step 1: Write failing test for the happy path**

Append to `backend-go/internal/db/warehouse_transfers_test.go`:
```go
func TestTransferInitiate_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	beforeAtas, _ := db.WarehouseQty(t, client, "TEST-TR", "atas")
	beforeBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")

	var transferID int64
	err := client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate(
		   p_sku=>'TEST-TR', p_from_warehouse=>'atas', p_to_warehouse=>'bawah',
		   p_qty=>3, p_intended_receiver_user_id=>$1::uuid,
		   p_send_photo_urls=>ARRAY['https://example.com/send.jpg'],
		   p_actor_user_id=>$2::uuid)`, receiver, initiator).Scan(&transferID)
	if err != nil {
		t.Fatalf("transfer_initiate failed: %v", err)
	}

	afterAtas, _ := db.WarehouseQty(t, client, "TEST-TR", "atas")
	afterBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")
	if afterAtas != beforeAtas-3 {
		t.Fatalf("source warehouse qty wrong: before=%d after=%d", beforeAtas, afterAtas)
	}
	if afterBawah != beforeBawah {
		t.Fatalf("dest warehouse must NOT change on initiate: before=%d after=%d", beforeBawah, afterBawah)
	}

	var status string
	var movementID int64
	err = client.QueryRow(context.Background(),
		`SELECT status::text, initiate_movement_id FROM public.warehouse_transfers WHERE id=$1`,
		transferID).Scan(&status, &movementID)
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	if status != "initiated" {
		t.Fatalf("status = %s, want initiated", status)
	}

	var source, warehouse string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, warehouse, qty_delta FROM public.stock_movements WHERE id=$1`,
		movementID).Scan(&source, &warehouse, &delta)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if source != "transfer_out" || warehouse != "atas" || delta != -3 {
		t.Fatalf("ledger row wrong: source=%s warehouse=%s delta=%d", source, warehouse, delta)
	}
}

func TestTransferInitiate_RejectsSelfReceiver(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 5)
	uid := "00000000-0000-0000-0000-000000000020"

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_initiate(
		   p_sku=>'TEST-TR', p_from_warehouse=>'atas', p_to_warehouse=>'bawah',
		   p_qty=>1, p_intended_receiver_user_id=>$1::uuid,
		   p_send_photo_urls=>ARRAY['https://example.com/send.jpg'],
		   p_actor_user_id=>$1::uuid)`, uid)
	if err == nil || !strings.Contains(err.Error(), "initiator") {
		t.Fatalf("expected initiator==receiver rejection, got: %v", err)
	}
}

func TestTransferInitiate_RejectsInsufficientStock(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 2)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_initiate(
		   p_sku=>'TEST-TR', p_from_warehouse=>'atas', p_to_warehouse=>'bawah',
		   p_qty=>99, p_intended_receiver_user_id=>$1::uuid,
		   p_send_photo_urls=>ARRAY['https://example.com/send.jpg'],
		   p_actor_user_id=>$2::uuid)`, receiver, initiator)
	if err == nil || !strings.Contains(err.Error(), "tidak cukup") {
		t.Fatalf("expected insufficient-stock error, got: %v", err)
	}
}

func TestTransferInitiate_RejectsEmptyPhoto(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 5)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_initiate(
		   p_sku=>'TEST-TR', p_from_warehouse=>'atas', p_to_warehouse=>'bawah',
		   p_qty=>1, p_intended_receiver_user_id=>$1::uuid,
		   p_send_photo_urls=>ARRAY[]::text[],
		   p_actor_user_id=>$2::uuid)`, receiver, initiator)
	if err == nil || !strings.Contains(err.Error(), "foto") {
		t.Fatalf("expected send-photo required error, got: %v", err)
	}
}
```

Also create the Go helper file `backend-go/internal/db/warehouse_transfers.go` with a `WarehouseQty(t, client, sku, warehouse) (int, error)` helper (read `stock_atas` / `stock_bawah` from `stocks`) — follow the same shape as `EnsureSKUStock` from Phase 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestTransferInitiate_ -v`
Expected: FAIL — `function transfer_initiate does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000041_transfer_initiate.sql`:
```sql
CREATE OR REPLACE FUNCTION public.transfer_initiate(
  p_sku                       TEXT,
  p_from_warehouse            TEXT,
  p_to_warehouse              TEXT,
  p_qty                       INT,
  p_intended_receiver_user_id UUID,
  p_send_photo_urls           TEXT[],
  p_actor_user_id             UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := COALESCE(p_actor_user_id, auth.uid(),
                                 '00000000-0000-0000-0000-000000000000'::uuid);
  v_from_before INT;
  v_movement_id BIGINT;
  v_transfer_id BIGINT;
BEGIN
  IF p_from_warehouse = p_to_warehouse THEN
    RAISE EXCEPTION 'transfer source and destination must differ';
  END IF;
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'qty harus > 0';
  END IF;
  IF v_actor = p_intended_receiver_user_id THEN
    RAISE EXCEPTION 'initiator dan intended receiver tidak boleh user yang sama';
  END IF;
  IF p_send_photo_urls IS NULL OR array_length(p_send_photo_urls, 1) IS NULL THEN
    RAISE EXCEPTION 'wajib minimal 1 foto pengiriman';
  END IF;

  -- Lock + decrement source warehouse
  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_from_warehouse)
    INTO v_from_before USING p_sku;
  IF v_from_before IS NULL THEN
    RAISE EXCEPTION 'SKU % tidak ditemukan', p_sku;
  END IF;
  IF v_from_before < p_qty THEN
    RAISE EXCEPTION 'Stok Gudang % tidak cukup: tersedia %, diminta %',
      p_from_warehouse, v_from_before, p_qty;
  END IF;
  EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I - $2 WHERE sku=$1',
                 p_from_warehouse, p_from_warehouse)
    USING p_sku, p_qty;

  -- Insert the transfer row first so we have an id for related_doc_id
  INSERT INTO public.warehouse_transfers
    (sku, from_warehouse, to_warehouse, initiated_qty,
     initiated_by_user_id, intended_receiver_user_id, send_photo_urls)
  VALUES
    (p_sku, p_from_warehouse, p_to_warehouse, p_qty,
     v_actor, p_intended_receiver_user_id, p_send_photo_urls)
  RETURNING id INTO v_transfer_id;

  -- Phase 1 ledger row — transfer_out only; receiver-side row writes on confirm
  v_movement_id := public._log_stock_movement(
    p_sku=>p_sku, p_warehouse=>p_from_warehouse, p_qty_delta=>-p_qty,
    p_qty_before=>v_from_before, p_source=>'transfer_out',
    p_related_doc_type=>'warehouse_transfer',
    p_related_doc_id=>v_transfer_id::text,
    p_actor_user_id=>v_actor, p_actor_role=>'transfer_initiator',
    p_evidence_urls=>p_send_photo_urls
  );

  UPDATE public.warehouse_transfers
     SET initiate_movement_id = v_movement_id
   WHERE id = v_transfer_id;

  RETURN v_transfer_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.transfer_initiate(
  TEXT, TEXT, TEXT, INT, UUID, TEXT[], UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_initiate(
  TEXT, TEXT, TEXT, INT, UUID, TEXT[], UUID
) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestTransferInitiate_ -v`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000041_transfer_initiate.sql \
        backend-go/internal/db/warehouse_transfers.go \
        backend-go/internal/db/warehouse_transfers_test.go
git commit -m "feat(stocks): add transfer_initiate RPC (Phase 3d)"
```

---

## Task 3: `transfer_receive` happy path — counted_qty matches initiated

**Files:**
- Create: `supabase/migrations/20260607000042_transfer_receive.sql`
- Modify: `backend-go/internal/db/warehouse_transfers_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestTransferReceive_HappyPath_FullQty(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate(
		   'TEST-TR','atas','bawah', 4, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	beforeBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_receive(
		   p_transfer_id=>$1, p_counted_qty=>4,
		   p_receive_photo_urls=>ARRAY['https://example.com/recv.jpg'],
		   p_actor_user_id=>$2::uuid)`, transferID, receiver)
	if err != nil {
		t.Fatalf("transfer_receive failed: %v", err)
	}

	afterBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")
	if afterBawah != beforeBawah+4 {
		t.Fatalf("dest warehouse qty wrong: before=%d after=%d", beforeBawah, afterBawah)
	}

	var status string
	var recvMoveID int64
	err = client.QueryRow(context.Background(),
		`SELECT status::text, receive_movement_id
		   FROM public.warehouse_transfers WHERE id=$1`,
		transferID).Scan(&status, &recvMoveID)
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	if status != "received" {
		t.Fatalf("status = %s, want received", status)
	}

	var source, warehouse string
	var delta int
	err = client.QueryRow(context.Background(),
		`SELECT source::text, warehouse, qty_delta FROM public.stock_movements WHERE id=$1`,
		recvMoveID).Scan(&source, &warehouse, &delta)
	if err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if source != "transfer_in" || warehouse != "bawah" || delta != 4 {
		t.Fatalf("recv ledger row wrong: source=%s warehouse=%s delta=%d", source, warehouse, delta)
	}
}

func TestTransferReceive_RejectsWrongCaller(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"
	imposter  := "00000000-0000-0000-0000-000000000099"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 2, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_receive($1, 2,
		   ARRAY['https://example.com/recv.jpg'], $2::uuid)`, transferID, imposter)
	if err == nil || !strings.Contains(err.Error(), "intended receiver") {
		t.Fatalf("expected wrong-caller rejection, got: %v", err)
	}
}

func TestTransferReceive_RejectsEmptyPhoto(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 2, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_receive($1, 2, ARRAY[]::text[], $2::uuid)`,
		transferID, receiver)
	if err == nil || !strings.Contains(err.Error(), "foto") {
		t.Fatalf("expected receive-photo required, got: %v", err)
	}
}

func TestTransferReceive_RejectsAlreadyReceived(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 2, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)
	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_receive($1, 2,
		   ARRAY['https://example.com/recv.jpg'], $2::uuid)`, transferID, receiver)
	if err != nil {
		t.Fatalf("first receive failed: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`SELECT public.transfer_receive($1, 2,
		   ARRAY['https://example.com/recv.jpg'], $2::uuid)`, transferID, receiver)
	if err == nil || !strings.Contains(err.Error(), "initiated") {
		t.Fatalf("expected status-must-be-initiated rejection, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — `function transfer_receive does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000042_transfer_receive.sql`:
```sql
CREATE OR REPLACE FUNCTION public.transfer_receive(
  p_transfer_id        BIGINT,
  p_counted_qty        INT,
  p_receive_photo_urls TEXT[],
  p_actor_user_id      UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       UUID := COALESCE(p_actor_user_id, auth.uid(),
                                 '00000000-0000-0000-0000-000000000000'::uuid);
  v_row         public.warehouse_transfers%ROWTYPE;
  v_to_before   INT;
  v_movement_id BIGINT;
  v_new_status  public.transfer_status;
BEGIN
  SELECT * INTO v_row FROM public.warehouse_transfers
   WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % tidak ditemukan', p_transfer_id;
  END IF;
  IF v_row.status <> 'initiated' THEN
    RAISE EXCEPTION 'transfer % bukan status initiated (current: %)',
      p_transfer_id, v_row.status;
  END IF;
  IF v_actor <> v_row.intended_receiver_user_id THEN
    RAISE EXCEPTION 'hanya intended receiver yang boleh confirm transfer ini';
  END IF;
  IF p_counted_qty < 0 THEN
    RAISE EXCEPTION 'counted_qty tidak boleh negatif';
  END IF;
  IF p_counted_qty > v_row.initiated_qty THEN
    RAISE EXCEPTION 'counted_qty (%) tidak boleh > initiated_qty (%)',
      p_counted_qty, v_row.initiated_qty;
  END IF;
  IF p_receive_photo_urls IS NULL
     OR array_length(p_receive_photo_urls, 1) IS NULL THEN
    RAISE EXCEPTION 'wajib minimal 1 foto penerimaan';
  END IF;

  -- Credit destination warehouse with counted_qty only (NOT initiated_qty).
  EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE',
                 v_row.to_warehouse)
    INTO v_to_before USING v_row.sku;
  EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1',
                 v_row.to_warehouse, v_row.to_warehouse)
    USING v_row.sku, p_counted_qty;

  -- Phase 1 ledger row: transfer_in writes only counted_qty. The shortfall
  -- (initiated_qty - counted_qty) is a logical deficit; Owner must file a
  -- Phase 2 stock_adjustment (reason 'hilang') to write it off. No phantom
  -- 'transit' row is written.
  v_movement_id := public._log_stock_movement(
    p_sku=>v_row.sku, p_warehouse=>v_row.to_warehouse,
    p_qty_delta=>p_counted_qty, p_qty_before=>v_to_before,
    p_source=>'transfer_in',
    p_related_doc_type=>'warehouse_transfer',
    p_related_doc_id=>v_row.id::text,
    p_actor_user_id=>v_actor, p_actor_role=>'transfer_receiver',
    p_evidence_urls=>p_receive_photo_urls
  );

  v_new_status := CASE
    WHEN p_counted_qty < v_row.initiated_qty THEN 'disputed'::public.transfer_status
    ELSE 'received'::public.transfer_status
  END;

  UPDATE public.warehouse_transfers
     SET received_qty        = p_counted_qty,
         received_at         = now(),
         received_by_user_id = v_actor,
         receive_photo_urls  = p_receive_photo_urls,
         receive_movement_id = v_movement_id,
         status              = v_new_status
   WHERE id = p_transfer_id;

  RETURN v_movement_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.transfer_receive(BIGINT, INT, TEXT[], UUID)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.transfer_receive(BIGINT, INT, TEXT[], UUID)
  TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestTransferReceive_ -v`
Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000042_transfer_receive.sql \
        backend-go/internal/db/warehouse_transfers_test.go
git commit -m "feat(stocks): add transfer_receive RPC happy + guard path (Phase 3d)"
```

---

## Task 4: Shortfall path — status `disputed` + Owner WA alert

**Files:**
- Modify: `backend-go/internal/db/warehouse_transfers_test.go`
- Create: `backend-go/internal/whatsapp/transfer_alert.go`
- Create: `backend-go/internal/whatsapp/transfer_alert_test.go`

- [ ] **Step 1: Write failing test for shortfall → disputed at DB layer**

Append:
```go
func TestTransferReceive_ShortfallMarksDisputed(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 7, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	beforeBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_receive($1, 5,
		   ARRAY['https://example.com/recv.jpg'], $2::uuid)`, transferID, receiver)
	if err != nil {
		t.Fatalf("receive failed: %v", err)
	}

	afterBawah, _ := db.WarehouseQty(t, client, "TEST-TR", "bawah")
	if afterBawah != beforeBawah+5 {
		t.Fatalf("dest must credit only counted_qty=5; before=%d after=%d",
			beforeBawah, afterBawah)
	}

	var status string
	var variance int
	err = client.QueryRow(context.Background(),
		`SELECT status::text, variance FROM public.warehouse_transfers WHERE id=$1`,
		transferID).Scan(&status, &variance)
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	if status != "disputed" {
		t.Fatalf("status = %s, want disputed", status)
	}
	if variance != -2 {
		t.Fatalf("variance = %d, want -2", variance)
	}

	// Verify NO phantom 'transit' row exists in the ledger for this transfer
	var transitCount int
	_ = client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.stock_movements
		  WHERE related_doc_type='warehouse_transfer'
		    AND related_doc_id=$1::text
		    AND warehouse NOT IN ('atas','bawah')`,
		transferID).Scan(&transitCount)
	if transitCount != 0 {
		t.Fatalf("phantom transit ledger rows found: %d", transitCount)
	}

	// Two ledger rows total: one transfer_out for -7, one transfer_in for +5
	var outDelta, inDelta int
	_ = client.QueryRow(context.Background(),
		`SELECT
		   (SELECT qty_delta FROM public.stock_movements
		     WHERE related_doc_type='warehouse_transfer'
		       AND related_doc_id=$1::text AND source='transfer_out'),
		   (SELECT qty_delta FROM public.stock_movements
		     WHERE related_doc_type='warehouse_transfer'
		       AND related_doc_id=$1::text AND source='transfer_in')`,
		transferID).Scan(&outDelta, &inDelta)
	if outDelta != -7 || inDelta != 5 {
		t.Fatalf("ledger rows wrong: out=%d in=%d (want -7 and +5)", outDelta, inDelta)
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd backend-go && go test ./internal/db/ -run TestTransferReceive_ShortfallMarksDisputed -v`
Expected: PASS already — the migration in Task 3 implements the `CASE WHEN p_counted_qty < initiated_qty` branch. The test is a regression guard for the no-phantom-transit invariant and the counted-qty-only ledger row.

- [ ] **Step 3: Write the WA alert sender**

`backend-go/internal/whatsapp/transfer_alert.go`:
```go
package whatsapp

import (
	"context"
	"fmt"
)

// SendDisputedTransferAlert sends an informational (no-button) WA message to
// the Owner JID when a transfer is received with counted_qty < initiated_qty,
// or when the receiver explicitly disputes (e.g. wrong SKU).
//
// This is intentionally a one-way alert. Resolution requires Owner to file a
// Phase 2 stock_adjustment (reason 'hilang') referencing the transfer id —
// no auto-write-off, no embedded approve/reject buttons here.
func (s *Sender) SendDisputedTransferAlert(
	ctx context.Context,
	ownerJID string,
	transferID int64,
	sku string,
	initiatedQty int,
	countedQty int,
	disputeNote string,
) error {
	shortfall := initiatedQty - countedQty
	msg := fmt.Sprintf(
		"⚠️ Transfer Disputed #%d\n"+
			"SKU: %s\n"+
			"Dikirim: %d  •  Diterima: %d  •  Selisih: %d\n",
		transferID, sku, initiatedQty, countedQty, shortfall,
	)
	if disputeNote != "" {
		msg += fmt.Sprintf("Catatan: %s\n", disputeNote)
	}
	msg += "\nTindakan: buka Phase 2 → Stock Adjustment (reason: hilang) " +
		"dengan referensi transfer #%d untuk write-off shortfall."
	msg = fmt.Sprintf(msg, transferID)
	return s.send(ctx, ownerJID, msg)
}
```

`backend-go/internal/whatsapp/transfer_alert_test.go`:
```go
package whatsapp

import (
	"context"
	"strings"
	"testing"
)

func TestSendDisputedTransferAlert_FormatsPayload(t *testing.T) {
	captured := ""
	s := &Sender{sendFn: func(_ context.Context, jid, msg string) error {
		captured = msg
		return nil
	}}
	err := s.SendDisputedTransferAlert(context.Background(), "62812@s.whatsapp.net",
		42, "PNL-001", 7, 5, "kemasan rusak")
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	for _, want := range []string{"Transfer Disputed #42", "PNL-001",
		"Dikirim: 7", "Diterima: 5", "Selisih: 2", "kemasan rusak",
		"hilang"} {
		if !strings.Contains(captured, want) {
			t.Fatalf("payload missing %q:\n%s", want, captured)
		}
	}
}
```

(The `Sender` test-double pattern with `sendFn` mirrors existing `internal/whatsapp/handler_test.go`. If `Sender` doesn't expose `sendFn`, follow the existing test pattern — wrap the underlying client behind an interface.)

- [ ] **Step 4: Run the alert test**

Run: `cd backend-go && go test ./internal/whatsapp/ -run TestSendDisputedTransferAlert_ -v`
Expected: PASS.

- [ ] **Step 5: Wire alert into the receive flow at the daemon edge**

Add a goroutine watcher in `backend-go/cmd/calistad/main.go` (or extend the existing realtime/heartbeat poller) that polls `warehouse_transfers WHERE status='disputed' AND <not_yet_alerted>` and calls `SendDisputedTransferAlert`. Mark alerted via a new `disputed_alert_sent_at TIMESTAMPTZ` column added in the Task 1 migration if not already present — if you forgot to add it in Task 1, append a small ALTER TABLE migration here:

`supabase/migrations/20260607000042b_transfer_disputed_alert_flag.sql`:
```sql
ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS disputed_alert_sent_at TIMESTAMPTZ;
```

(If the column already exists from Task 1, skip the migration.)

The polling shape:
```go
// inside the heartbeat poller loop:
rows, _ := s.db.Query(ctx,
    `SELECT id, sku, initiated_qty, COALESCE(received_qty, 0), COALESCE(dispute_note,'')
       FROM public.warehouse_transfers
      WHERE status='disputed' AND disputed_alert_sent_at IS NULL
      LIMIT 20`)
for rows.Next() {
    var id int64; var sku, note string; var iq, cq int
    rows.Scan(&id, &sku, &iq, &cq, &note)
    if err := s.waSender.SendDisputedTransferAlert(ctx, ownerJID, id, sku, iq, cq, note); err == nil {
        s.db.Exec(ctx, `UPDATE public.warehouse_transfers
                           SET disputed_alert_sent_at = now() WHERE id=$1`, id)
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/db/warehouse_transfers_test.go \
        backend-go/internal/whatsapp/transfer_alert.go \
        backend-go/internal/whatsapp/transfer_alert_test.go \
        backend-go/cmd/calistad/main.go \
        supabase/migrations/20260607000042b_transfer_disputed_alert_flag.sql
git commit -m "feat(stocks): mark transfer disputed on shortfall + Owner WA alert (Phase 3d)"
```

---

## Task 5: `transfer_dispute` RPC for wrong-SKU disputes

**Files:**
- Create: `supabase/migrations/20260607000043_transfer_dispute.sql`
- Modify: `backend-go/internal/db/warehouse_transfers_test.go`

- [ ] **Step 1: Write failing test**

Append:
```go
func TestTransferDispute_FlipsStatusWithoutLedger(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 10)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 3, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	beforeRows := db.CountStockMovements(t, client, "TEST-TR")

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_dispute($1, 'wrong SKU dikirim', $2::uuid)`,
		transferID, receiver)
	if err != nil {
		t.Fatalf("dispute: %v", err)
	}

	var status, note string
	_ = client.QueryRow(context.Background(),
		`SELECT status::text, COALESCE(dispute_note,'') FROM public.warehouse_transfers
		  WHERE id=$1`, transferID).Scan(&status, &note)
	if status != "disputed" {
		t.Fatalf("status = %s, want disputed", status)
	}
	if note != "wrong SKU dikirim" {
		t.Fatalf("dispute_note = %q", note)
	}

	// No ledger row should be written by dispute — the initiate row stays,
	// no transfer_in row, no compensating row. Owner reconciles via Phase 2.
	afterRows := db.CountStockMovements(t, client, "TEST-TR")
	if afterRows != beforeRows {
		t.Fatalf("dispute must not write ledger; before=%d after=%d",
			beforeRows, afterRows)
	}
}

func TestTransferDispute_RejectsWrongCaller(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	db.EnsureSKUStock(t, client, "TEST-TR", "atas", 5)
	initiator := "00000000-0000-0000-0000-000000000010"
	receiver  := "00000000-0000-0000-0000-000000000011"
	imposter  := "00000000-0000-0000-0000-000000000099"

	var transferID int64
	_ = client.QueryRow(context.Background(),
		`SELECT public.transfer_initiate('TEST-TR','atas','bawah', 1, $1::uuid,
		   ARRAY['https://example.com/send.jpg'], $2::uuid)`,
		receiver, initiator).Scan(&transferID)

	_, err := client.Exec(context.Background(),
		`SELECT public.transfer_dispute($1, 'x', $2::uuid)`, transferID, imposter)
	if err == nil || !strings.Contains(err.Error(), "intended receiver") {
		t.Fatalf("expected wrong-caller rejection, got: %v", err)
	}
}
```

- [ ] **Step 2: Run test**

Expected: FAIL — `function transfer_dispute does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000043_transfer_dispute.sql`:
```sql
CREATE OR REPLACE FUNCTION public.transfer_dispute(
  p_transfer_id    BIGINT,
  p_note           TEXT,
  p_actor_user_id  UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_user_id, auth.uid(),
                           '00000000-0000-0000-0000-000000000000'::uuid);
  v_row   public.warehouse_transfers%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.warehouse_transfers
   WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % tidak ditemukan', p_transfer_id;
  END IF;
  IF v_row.status <> 'initiated' THEN
    RAISE EXCEPTION 'transfer % bukan status initiated (current: %)',
      p_transfer_id, v_row.status;
  END IF;
  IF v_actor <> v_row.intended_receiver_user_id THEN
    RAISE EXCEPTION 'hanya intended receiver yang boleh dispute transfer ini';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'wajib mengisi catatan dispute';
  END IF;

  UPDATE public.warehouse_transfers
     SET status       = 'disputed',
         dispute_note = p_note,
         received_at  = now()
   WHERE id = p_transfer_id;
  -- Intentionally no ledger row: the original transfer_out has already debited
  -- the source warehouse. Owner files a Phase 2 stock_adjustment to reconcile.
END $$;

REVOKE EXECUTE ON FUNCTION public.transfer_dispute(BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.transfer_dispute(BIGINT, TEXT, UUID) TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestTransferDispute_ -v`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000043_transfer_dispute.sql \
        backend-go/internal/db/warehouse_transfers_test.go
git commit -m "feat(stocks): add transfer_dispute RPC for wrong-SKU receiver flag (Phase 3d)"
```

---

## Task 6: Seed `action_permissions` defaults for transfer keys

**Files:**
- Read first: `supabase/migrations/20260607000007_action_permissions.sql` (from Phase 2 — adds the JSONB column)
- Create: `supabase/migrations/20260607000044_transfer_action_permissions_seed.sql`

- [ ] **Step 1: Write the seed migration**

`supabase/migrations/20260607000044_transfer_action_permissions_seed.sql`:
```sql
-- Defaults per Phase 3d spec:
--   can_initiate_transfer: Staff Admin Toko, Supervisor Gudang, Owner
--   can_receive_transfer:  Staff Admin Toko, Supervisor Gudang, Owner
-- Owner is locked-on; Finance Manager defaults to false.

UPDATE public.admin_users
   SET action_permissions = action_permissions
     || jsonb_build_object(
          'can_initiate_transfer', CASE
            WHEN role IN ('Owner','Staff Admin Toko','Supervisor Gudang') THEN TRUE
            ELSE FALSE END,
          'can_receive_transfer',  CASE
            WHEN role IN ('Owner','Staff Admin Toko','Supervisor Gudang') THEN TRUE
            ELSE FALSE END
        )
 WHERE NOT (action_permissions ? 'can_initiate_transfer')
    OR NOT (action_permissions ? 'can_receive_transfer');
```

- [ ] **Step 2: Apply & verify**

Run: `supabase db push --include-all`
Then in a psql session:
```sql
SELECT email, role, action_permissions->>'can_initiate_transfer' AS init,
       action_permissions->>'can_receive_transfer' AS recv
FROM public.admin_users;
```
Expected: Owner / Staff Admin Toko / Supervisor Gudang rows show `true`/`true`; Finance Manager rows show `false`/`false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000044_transfer_action_permissions_seed.sql
git commit -m "feat(stocks): seed can_initiate_transfer + can_receive_transfer defaults (Phase 3d)"
```

---

## Task 7: Frontend service layer — `transferService`

**Files:**
- Create: `src/lib/transferService.ts`
- Create: `src/lib/transferService.test.ts`
- Modify: `src/types.ts` (add `WarehouseTransfer` interface)

- [ ] **Step 1: Write failing test**

`src/lib/transferService.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transferService } from './transferService';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

beforeEach(() => { rpcMock.mockReset(); fromMock.mockReset(); });

describe('transferService', () => {
  it('initiate forwards every param to transfer_initiate RPC', async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const id = await transferService.initiate({
      sku: 'PNL-001',
      from: 'atas',
      to: 'bawah',
      qty: 3,
      intendedReceiverUserId: 'user-2',
      sendPhotoUrls: ['https://x/a.jpg'],
    });
    expect(id).toBe(42);
    expect(rpcMock).toHaveBeenCalledWith('transfer_initiate', {
      p_sku: 'PNL-001',
      p_from_warehouse: 'atas',
      p_to_warehouse: 'bawah',
      p_qty: 3,
      p_intended_receiver_user_id: 'user-2',
      p_send_photo_urls: ['https://x/a.jpg'],
    });
  });

  it('initiate rejects empty photo list before hitting Supabase', async () => {
    await expect(transferService.initiate({
      sku: 'X', from: 'atas', to: 'bawah', qty: 1,
      intendedReceiverUserId: 'u', sendPhotoUrls: [],
    })).rejects.toThrow(/foto/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('receive forwards transfer id + counted qty + photos', async () => {
    rpcMock.mockResolvedValue({ data: 99, error: null });
    await transferService.receive({
      transferId: 7, countedQty: 4,
      receivePhotoUrls: ['https://x/r.jpg'],
    });
    expect(rpcMock).toHaveBeenCalledWith('transfer_receive', {
      p_transfer_id: 7, p_counted_qty: 4,
      p_receive_photo_urls: ['https://x/r.jpg'],
    });
  });

  it('dispute forwards transfer id + note', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await transferService.dispute(7, 'wrong sku');
    expect(rpcMock).toHaveBeenCalledWith('transfer_dispute', {
      p_transfer_id: 7, p_note: 'wrong sku',
    });
  });

  it('listIncoming queries warehouse_transfers filtered to user + initiated', async () => {
    const eq = vi.fn().mockReturnThis();
    const order = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq, order }),
      eq, order,
    });
    const rows = await transferService.listIncoming('user-2');
    expect(fromMock).toHaveBeenCalledWith('warehouse_transfers');
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- transferService`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the service**

`src/lib/transferService.ts`:
```ts
import { supabase } from './supabaseClient';
import { WarehouseTransfer } from '../types';

export interface InitiateParams {
  sku: string;
  from: 'atas' | 'bawah';
  to: 'atas' | 'bawah';
  qty: number;
  intendedReceiverUserId: string;
  sendPhotoUrls: string[];
}

export interface ReceiveParams {
  transferId: number;
  countedQty: number;
  receivePhotoUrls: string[];
}

export const transferService = {
  async initiate(p: InitiateParams): Promise<number> {
    if (!supabase) throw new Error('Supabase not configured');
    if (!p.sendPhotoUrls.length) throw new Error('Wajib upload minimal 1 foto pengiriman');
    if (p.from === p.to) throw new Error('Asal dan tujuan harus berbeda');
    if (p.qty <= 0) throw new Error('Qty harus > 0');
    const { data, error } = await supabase.rpc('transfer_initiate', {
      p_sku: p.sku,
      p_from_warehouse: p.from,
      p_to_warehouse: p.to,
      p_qty: p.qty,
      p_intended_receiver_user_id: p.intendedReceiverUserId,
      p_send_photo_urls: p.sendPhotoUrls,
    });
    if (error) throw new Error(error.message);
    return data as number;
  },

  async receive(p: ReceiveParams): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (!p.receivePhotoUrls.length) throw new Error('Wajib upload minimal 1 foto penerimaan');
    if (p.countedQty < 0) throw new Error('Jumlah counted tidak boleh negatif');
    const { error } = await supabase.rpc('transfer_receive', {
      p_transfer_id: p.transferId,
      p_counted_qty: p.countedQty,
      p_receive_photo_urls: p.receivePhotoUrls,
    });
    if (error) throw new Error(error.message);
  },

  async dispute(transferId: number, note: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('transfer_dispute', {
      p_transfer_id: transferId,
      p_note: note,
    });
    if (error) throw new Error(error.message);
  },

  async listIncoming(myUserId: string): Promise<WarehouseTransfer[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('warehouse_transfers')
      .select('*')
      .eq('intended_receiver_user_id', myUserId)
      .eq('status', 'initiated')
      .order('initiated_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as WarehouseTransfer[];
  },

  async countIncoming(myUserId: string): Promise<number> {
    if (!supabase) return 0;
    const { count } = await supabase
      .from('warehouse_transfers')
      .select('id', { count: 'exact', head: true })
      .eq('intended_receiver_user_id', myUserId)
      .eq('status', 'initiated');
    return count ?? 0;
  },
};
```

Append to `src/types.ts`:
```ts
export interface WarehouseTransfer {
  id: number;
  sku: string;
  from_warehouse: 'atas' | 'bawah';
  to_warehouse: 'atas' | 'bawah';
  initiated_qty: number;
  initiated_by_user_id: string;
  intended_receiver_user_id: string;
  initiated_at: string;
  send_photo_urls: string[];
  received_qty: number | null;
  received_at: string | null;
  received_by_user_id: string | null;
  receive_photo_urls: string[];
  variance: number;
  status: 'initiated' | 'received' | 'disputed' | 'cancelled';
  dispute_note: string | null;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- transferService`
Expected: all five PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transferService.ts src/lib/transferService.test.ts src/types.ts
git commit -m "feat(stocks): add transferService wrapping two-step transfer RPCs (Phase 3d)"
```

---

## Task 8: Rewrite `WarehouseTransferModal.tsx` for two-step initiate

**Files:**
- Modify: `src/components/WarehouseTransferModal.tsx`

- [ ] **Step 1: Write failing behavioral test**

Create `src/components/WarehouseTransferModal.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WarehouseTransferModal from './WarehouseTransferModal';
import { transferService } from '../lib/transferService';

vi.mock('../lib/transferService');

const item = {
  sku: 'PNL-001', name: 'Panel A',
  stock_atas: 10, stock_bawah: 2, stock: 12,
} as any;

const users = [
  { id: 'u1', name: 'Me' },
  { id: 'u2', name: 'Rian' },
  { id: 'u3', name: 'Andi' },
];

const baseProps = {
  item,
  currentUserId: 'u1',
  candidateReceivers: users.filter(u => u.id !== 'u1'),
  uploadPhoto: vi.fn().mockResolvedValue('https://example.com/p.jpg'),
  onClose: vi.fn(),
  onTransferred: vi.fn(),
  showToast: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe('WarehouseTransferModal (two-step)', () => {
  it('disables submit until receiver + qty + photo are present', () => {
    render(<WarehouseTransferModal {...baseProps} />);
    const submit = screen.getByRole('button', { name: /transfer/i });
    expect(submit).toBeDisabled();
  });

  it('calls transferService.initiate with correct params', async () => {
    (transferService.initiate as any).mockResolvedValue(7);
    render(<WarehouseTransferModal {...baseProps} />);

    fireEvent.change(screen.getByLabelText(/Jumlah/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Penerima/i), { target: { value: 'u2' } });
    // Simulate photo upload (component invokes baseProps.uploadPhoto on file pick)
    const file = new File(['x'], 'send.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Foto Pengiriman/i),
      { target: { files: [file] } });
    await waitFor(() => expect(baseProps.uploadPhoto).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /transfer/i }));
    await waitFor(() => expect(transferService.initiate).toHaveBeenCalledWith({
      sku: 'PNL-001', from: 'atas', to: 'bawah', qty: 3,
      intendedReceiverUserId: 'u2',
      sendPhotoUrls: ['https://example.com/p.jpg'],
    }));
    expect(baseProps.onTransferred).toHaveBeenCalled();
  });

  it('excludes current user from receiver dropdown', () => {
    render(<WarehouseTransferModal {...baseProps} />);
    const opts = Array.from(screen.getByLabelText(/Penerima/i).querySelectorAll('option'));
    const ids = opts.map(o => (o as HTMLOptionElement).value);
    expect(ids).not.toContain('u1');
    expect(ids).toEqual(expect.arrayContaining(['u2', 'u3']));
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- WarehouseTransferModal`
Expected: FAIL — modal still uses old single-shot API.

- [ ] **Step 3: Rewrite the modal**

Replace the body of `src/components/WarehouseTransferModal.tsx` with the new two-step flow. Key changes:
- New props: `currentUserId: string`, `candidateReceivers: { id: string; name: string }[]`, `uploadPhoto: (file: File) => Promise<string>`.
- Drop the `purchaseOrderService.transferWarehouse` import, add `import { transferService } from '../lib/transferService'`.
- Add a receiver `<select aria-label="Penerima">` with `candidateReceivers` filtered to ≠ `currentUserId`.
- Add a file `<input aria-label="Foto Pengiriman" type="file" accept="image/*">` that calls `uploadPhoto(file)` and stores the URL in local state.
- Submit calls `transferService.initiate({ sku, from, to, qty, intendedReceiverUserId, sendPhotoUrls })`.
- Disable submit when: `qty<=0 || !receiver || sendPhotoUrls.length === 0 || saving`.

```tsx
// abbreviated; full implementation follows the existing modal styling.
async function handleConfirm() {
  if (!receiver || !sendPhotoUrls.length || !qty || qty <= 0) return;
  setSaving(true);
  try {
    await transferService.initiate({
      sku: item.sku, from, to,
      qty: qty as number,
      intendedReceiverUserId: receiver,
      sendPhotoUrls,
    });
    showToast('Transfer dikirim — menunggu konfirmasi penerima.', 'success');
    onTransferred();
  } catch (e: any) {
    showToast(e.message ?? 'Transfer gagal.', 'warning');
  } finally {
    setSaving(false);
  }
}
```

Photo storage uses the Phase 2 `stock-evidence` bucket under `transfers/<sku>/send/<timestamp>-<filename>` (path encoded by the caller's `uploadPhoto` prop — the existing `stock-evidence` policies from Phase 2 already permit authenticated uploads).

Update the parent screen `src/components/StockManagerScreen.tsx` (line ~875) where `<WarehouseTransferModal>` is rendered: pass `currentUserId`, `candidateReceivers` (fetched from `admin_users` filtered by `can_initiate_transfer` OR `can_receive_transfer`), and `uploadPhoto` (the existing upload helper used by other modals).

- [ ] **Step 4: Run tests**

Run: `npm test -- WarehouseTransferModal`
Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/WarehouseTransferModal.tsx \
        src/components/WarehouseTransferModal.test.tsx \
        src/components/StockManagerScreen.tsx
git commit -m "feat(stocks): rewrite WarehouseTransferModal for two-step initiate flow (Phase 3d)"
```

---

## Task 9: `TransferMasukScreen` + `TransferReceiveModal` + Sidebar wiring

**Files:**
- Create: `src/components/TransferMasukScreen.tsx`
- Create: `src/components/TransferReceiveModal.tsx`
- Create: `src/components/TransferMasukScreen.test.tsx`
- Modify: `src/types.ts` (extend `ActivePage`)
- Modify: `src/components/Sidebar.tsx` (conditional item)
- Modify: `src/App.tsx` (route handling)

- [ ] **Step 1: Write failing behavioral test for the screen**

`src/components/TransferMasukScreen.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TransferMasukScreen from './TransferMasukScreen';
import { transferService } from '../lib/transferService';

vi.mock('../lib/transferService');

const fakeRows = [
  { id: 11, sku: 'PNL-001', from_warehouse: 'atas', to_warehouse: 'bawah',
    initiated_qty: 5, initiated_by_user_id: 'u9',
    intended_receiver_user_id: 'u1',
    initiated_at: '2026-06-07T10:00:00Z',
    send_photo_urls: ['https://x/s.jpg'],
    received_qty: null, received_at: null, received_by_user_id: null,
    receive_photo_urls: [], variance: 0, status: 'initiated',
    dispute_note: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  (transferService.listIncoming as any).mockResolvedValue(fakeRows);
});

describe('TransferMasukScreen', () => {
  it('renders one row per pending transfer for current user', async () => {
    render(<TransferMasukScreen currentUserId="u1"
      uploadPhoto={vi.fn().mockResolvedValue('https://x/r.jpg')}
      showToast={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/PNL-001/)).toBeInTheDocument());
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('opens receive modal and calls transferService.receive on submit', async () => {
    (transferService.receive as any).mockResolvedValue(undefined);
    render(<TransferMasukScreen currentUserId="u1"
      uploadPhoto={vi.fn().mockResolvedValue('https://x/r.jpg')}
      showToast={vi.fn()} />);
    await waitFor(() => screen.getByText(/PNL-001/));
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Terima/i }));

    fireEvent.change(screen.getByLabelText(/Jumlah Diterima/i),
      { target: { value: '5' } });
    const file = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Foto Penerimaan/i),
      { target: { files: [file] } });
    await waitFor(() => screen.getByRole('button', { name: /Konfirmasi$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi$/i }));

    await waitFor(() => expect(transferService.receive).toHaveBeenCalledWith({
      transferId: 11, countedQty: 5,
      receivePhotoUrls: ['https://x/r.jpg'],
    }));
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL — files do not exist.

- [ ] **Step 3: Implement `TransferReceiveModal.tsx`**

```tsx
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { transferService } from '../lib/transferService';
import { WarehouseTransfer } from '../types';

interface Props {
  transfer: WarehouseTransfer;
  uploadPhoto: (file: File) => Promise<string>;
  onClose: () => void;
  onReceived: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function TransferReceiveModal({
  transfer, uploadPhoto, onClose, onReceived, showToast,
}: Props) {
  const [countedQty, setCountedQty] = useState<number | ''>(transfer.initiated_qty);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const isDisputed = typeof countedQty === 'number' && countedQty < transfer.initiated_qty;
  const canSubmit = typeof countedQty === 'number' && countedQty >= 0
    && photoUrls.length > 0 && !saving;

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadPhoto(file);
    setPhotoUrls(prev => [...prev, url]);
  }

  async function handleSubmit() {
    if (typeof countedQty !== 'number') return;
    setSaving(true);
    try {
      await transferService.receive({
        transferId: transfer.id,
        countedQty,
        receivePhotoUrls: photoUrls,
      });
      showToast(
        isDisputed
          ? 'Konfirmasi tersimpan dengan selisih — Owner sudah diberi tahu.'
          : 'Transfer dikonfirmasi.', isDisputed ? 'warning' : 'success');
      onReceived();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal konfirmasi.', 'warning');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-extrabold text-[#012749]">
            Konfirmasi Terima — {transfer.sku}
          </h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-slate-600">
            Dikirim {transfer.initiated_qty} pcs dari Gudang {transfer.from_warehouse}.
          </div>
          <label className="block">
            <span className="text-[10px] font-extrabold text-gray-500 uppercase">Jumlah Diterima (Pcs)</span>
            <input
              aria-label="Jumlah Diterima"
              type="number" min="0" max={transfer.initiated_qty}
              value={countedQty}
              onChange={e => setCountedQty(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
              className="w-full mt-1 rounded-xl px-3 py-2.5 border border-slate-200 text-sm font-bold"
            />
          </label>
          {isDisputed && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              Selisih {transfer.initiated_qty - (countedQty as number)} pcs.
              Transfer akan ditandai DISPUTED dan Owner diberi tahu.
            </div>
          )}
          <label className="block">
            <span className="text-[10px] font-extrabold text-gray-500 uppercase">Foto Penerimaan</span>
            <input
              aria-label="Foto Penerimaan"
              type="file" accept="image/*" onChange={handlePhoto}
              className="block w-full text-xs mt-1"
            />
            <div className="text-[10px] text-slate-500 mt-1">{photoUrls.length} foto terupload</div>
          </label>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 border rounded-full text-xs font-bold">Batal</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 py-2.5 bg-[#2d8a4e] text-white rounded-full text-xs font-bold disabled:opacity-50"
          >
            {saving ? 'Memproses...' : 'Konfirmasi'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `TransferMasukScreen.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { transferService } from '../lib/transferService';
import { WarehouseTransfer } from '../types';
import TransferReceiveModal from './TransferReceiveModal';

interface Props {
  currentUserId: string;
  uploadPhoto: (file: File) => Promise<string>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function TransferMasukScreen({ currentUserId, uploadPhoto, showToast }: Props) {
  const [rows, setRows] = useState<WarehouseTransfer[]>([]);
  const [picked, setPicked] = useState<WarehouseTransfer | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await transferService.listIncoming(currentUserId));
    } catch (e: any) {
      showToast(e.message ?? 'Gagal memuat transfer masuk.', 'warning');
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [currentUserId]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-extrabold text-[#012749] mb-4">Transfer Masuk</h1>
      {loading && <div className="text-xs text-slate-500">Memuat...</div>}
      {!loading && rows.length === 0 && (
        <div className="text-xs text-slate-500">Tidak ada transfer masuk yang menunggu.</div>
      )}
      <div className="space-y-2">
        {rows.map(t => (
          <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <div className="font-extrabold text-sm">{t.sku}</div>
              <div className="text-xs text-slate-600">
                {t.initiated_qty} pcs · Gudang {t.from_warehouse} → {t.to_warehouse}
              </div>
              <div className="text-[10px] text-slate-400">Dikirim {new Date(t.initiated_at).toLocaleString('id-ID')}</div>
            </div>
            <button
              onClick={() => setPicked(t)}
              className="px-4 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold"
            >
              Konfirmasi Terima
            </button>
          </div>
        ))}
      </div>
      {picked && (
        <TransferReceiveModal
          transfer={picked}
          uploadPhoto={uploadPhoto}
          showToast={showToast}
          onClose={() => setPicked(null)}
          onReceived={() => { setPicked(null); refresh(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire `ActivePage` + Sidebar + App router**

In `src/types.ts`:
```ts
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock'
  | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai'
  | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan'
  | 'pembelian' | 'kasir' | 'transfer-masuk';
```

In `src/components/Sidebar.tsx`, accept a new prop `incomingTransferCount: number` and append to `menuItems`:
```ts
// At top, extend interface:
interface SidebarProps {
  activePage: ActivePage;
  onPageChange: (page: ActivePage) => void;
  currentUser: { name: string; role: string; permissions: PermissionSet; avatarUrl: string } | null;
  onLogout: () => void;
  incomingTransferCount: number;
}

// Inside the component:
import { Truck } from 'lucide-react';
// ...
const itemsWithDynamic: typeof menuItems = [...menuItems];
if (incomingTransferCount > 0) {
  itemsWithDynamic.push({
    id: 'transfer-masuk',
    label: `Transfer Masuk (${incomingTransferCount})`,
    icon: Truck,
    description: 'Konfirmasi penerimaan',
    permKey: 'aiStock', // gate behind stock module access; receive perm checked in screen
  });
}
const visibleItems = currentUser?.permissions
  ? itemsWithDynamic.filter(item => currentUser.permissions[item.permKey] !== false)
  : itemsWithDynamic;
```

In `src/App.tsx`, add:
```tsx
// State for pending count, refreshed every 60s (or via realtime subscription)
const [incomingCount, setIncomingCount] = useState(0);
useEffect(() => {
  if (!currentUser?.id) return;
  const tick = async () => setIncomingCount(await transferService.countIncoming(currentUser.id));
  tick();
  const t = setInterval(tick, 60_000);
  return () => clearInterval(t);
}, [currentUser?.id]);

// Pass to Sidebar:
<Sidebar
  /* existing props */
  incomingTransferCount={incomingCount}
/>

// Route case:
{activePage === 'transfer-masuk' && (
  <TransferMasukScreen
    currentUserId={currentUser!.id}
    uploadPhoto={uploadStockEvidence}
    showToast={showToast}
  />
)}
```

(Realtime upgrade — subscribe to `warehouse_transfers` on `intended_receiver_user_id = me` — is optional; the 60s poll is acceptable for Phase 3d. Phase 4 may extend.)

- [ ] **Step 6: Run tests**

Run: `npm test -- TransferMasuk`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/TransferMasukScreen.tsx \
        src/components/TransferReceiveModal.tsx \
        src/components/TransferMasukScreen.test.tsx \
        src/components/Sidebar.tsx \
        src/types.ts \
        src/App.tsx
git commit -m "feat(stocks): add TransferMasukScreen + receive modal + sidebar item (Phase 3d)"
```

---

## Task 10: Drop legacy `transfer_warehouse` + remove `pembelianService.transferWarehouse`

**Files:**
- Create: `supabase/migrations/20260607000049_drop_legacy_transfer_warehouse.sql`
- Modify: `src/lib/pembelianService.ts` (remove `transferWarehouse` method)
- Modify: `progress.md`

This task runs **last** — only after every caller of the legacy RPC has been migrated by Task 8.

- [ ] **Step 1: Confirm no remaining callers in code**

Run: `grep -rn "transfer_warehouse\|transferWarehouse" src/ backend-go/ supabase/migrations/`
Expected: matches only in:
  - `supabase/migrations/20260607000004_wrap_transfer_warehouse.sql` (Phase 1 wrapper — leave; migration history is immutable)
  - the new migration file from this task

If any other caller remains, fix it before continuing.

- [ ] **Step 2: Write failing test**

Append to `backend-go/internal/db/warehouse_transfers_test.go`:
```go
func TestLegacyTransferWarehouse_DroppedAfterPhase3d(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT count(*) FROM pg_proc p
		   JOIN pg_namespace n ON n.oid = p.pronamespace
		  WHERE n.nspname='public' AND p.proname='transfer_warehouse'`).Scan(&n)
	if err != nil {
		t.Fatalf("query pg_proc: %v", err)
	}
	if n != 0 {
		t.Fatalf("legacy transfer_warehouse still present (%d defs)", n)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — legacy function still exists from Phase 1 wrapper.

- [ ] **Step 4: Write the drop migration**

`supabase/migrations/20260607000049_drop_legacy_transfer_warehouse.sql`:
```sql
-- Phase 3d ships the two-step transfer flow (transfer_initiate /
-- transfer_receive / transfer_dispute). All callers of the legacy
-- single-shot transfer_warehouse have been migrated. Drop it.
--
-- Per spec "Out of Scope (Whole Spec)": no backwards-compat shim.
DROP FUNCTION IF EXISTS public.transfer_warehouse(TEXT, TEXT, TEXT, INT);
```

- [ ] **Step 5: Remove the frontend wrapper**

In `src/lib/pembelianService.ts`, delete the `transferWarehouse` method (lines ~153–159).

- [ ] **Step 6: Apply + re-run**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestLegacyTransferWarehouse_DroppedAfterPhase3d -v`
Expected: PASS.

Then: `npm run build` to confirm no TS error remains from the deleted method.
Then: full Go test suite `cd backend-go && go test ./...` — expected PASS.

- [ ] **Step 7: Update progress doc**

Edit `progress.md` to add a "Phase 3d Transfer 2-langkah — DONE" entry under the Stock Fraud Prevention section.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260607000049_drop_legacy_transfer_warehouse.sql \
        src/lib/pembelianService.ts \
        backend-go/internal/db/warehouse_transfers_test.go \
        progress.md
git commit -m "feat(stocks): drop legacy transfer_warehouse RPC; Phase 3d complete"
```

---

## Task 11: Manual integration smoke

**Files:** none (manual verification).

- [ ] **Step 1: Bring up local dev environment**

Run `npm run dev` + the Go daemon as documented in README.

- [ ] **Step 2: Walk the happy path**

1. Login as Staff Admin Toko user A.
2. Open Stok Manager → pick an SKU with ≥ 5 stock_atas → click Transfer.
3. Confirm modal: receiver dropdown shows other users (not self); pick user B; qty 3; upload a photo. Submit.
4. Verify `stocks.stock_atas` decremented by 3; `stocks.stock_bawah` unchanged; one `stock_movements` row with `source='transfer_out'` and `related_doc_id=<transfer_id>`; one `warehouse_transfers` row with `status='initiated'`.
5. Login as user B. Sidebar shows "Transfer Masuk (1)". Click → see the pending transfer.
6. Click "Konfirmasi Terima"; counted_qty = 3; upload receive photo. Submit.
7. Verify `stocks.stock_bawah` += 3; new `stock_movements` row with `source='transfer_in'`; `warehouse_transfers.status='received'`.

- [ ] **Step 3: Walk the shortfall path**

1. Repeat steps 1–4 with qty 5.
2. As user B, confirm with counted_qty = 3.
3. Verify: `stocks.stock_bawah` += 3 (not 5); `warehouse_transfers.status='disputed'`; `variance = -2`; Owner receives a WA alert via the daemon poller.
4. Confirm no `warehouse='transit'` rows in `stock_movements`.

- [ ] **Step 4: Walk the wrong-SKU dispute path**

1. Initiate again as user A.
2. As user B, click "Dispute" (UI button on the row — add if not present in Task 9).
3. Enter note → submit. Verify `status='disputed'`, `dispute_note` populated, no extra ledger row.

- [ ] **Step 5: Verify guard rails**

1. Try `transfer_initiate` with self as receiver via psql — expect error.
2. Try `transfer_receive` as user A (not B) via psql — expect error.
3. Try receiving the same transfer twice — second call expects status error.
4. Try `SELECT public.transfer_warehouse(...)` via psql — expect "function does not exist".

No commit; this task is observation-only.

---

## Self-Review Checklist

Run through this before declaring Phase 3d done:

- [ ] All migrations `20260607000040`–`20260607000049` apply cleanly on a fresh DB.
- [ ] `warehouse_transfers` CHECK constraints fire for: same warehouse, same user, empty send photo.
- [ ] `transfer_initiate` decrements source only; emits exactly one `transfer_out` row.
- [ ] `transfer_receive` happy path emits exactly one `transfer_in` row with `qty_delta = counted_qty`.
- [ ] `transfer_receive` with shortfall sets `status='disputed'` and writes only `counted_qty` to the ledger — NO `'transit'` warehouse row, NO compensating row.
- [ ] `transfer_receive` rejects: wrong caller, empty photo, status != initiated, counted_qty > initiated_qty.
- [ ] `transfer_dispute` flips status without writing a ledger row.
- [ ] Owner WA alert fires once per disputed transfer (`disputed_alert_sent_at` set to prevent dupes).
- [ ] `transferService` validates photo + qty + warehouse before hitting Supabase.
- [ ] `WarehouseTransferModal` excludes current user from the receiver dropdown.
- [ ] Sidebar "Transfer Masuk" item appears only when `countIncoming > 0`.
- [ ] Legacy `transfer_warehouse` is gone from both the DB and `pembelianService.ts`.
- [ ] All Go integration tests in `internal/db/warehouse_transfers_test.go` PASS.
- [ ] All UI tests in `WarehouseTransferModal.test.tsx` + `TransferMasukScreen.test.tsx` PASS.
- [ ] Existing tests in `internal/whatsapp/` + `internal/heartbeat/` still PASS.
- [ ] `progress.md` updated with Phase 3d DONE entry.
- [ ] Manual smoke (Task 11) walked end-to-end.

## Out of Scope (Phase 3d)

- Aging > 24h flag UI — surfaced by Phase 4 dashboard (`v_pengawasan_transfer_aging` view in `20260607000014_pengawasan_views.sql`). Phase 3d only writes `initiated_at` + `status` for Phase 4 to read.
- Multi-step (3+) routing — only `atas ↔ bawah` exist.
- Bulk transfers (multiple SKUs per record) — one SKU per transfer row stays the model.
- Auto-receive after N hours — Owner must manually adjust transit losses via Phase 2 `stock_adjustment`.
- Cancel button for the initiator — `cancelled` status is reserved in the enum for a future "initiator recalls before pickup" workflow; not implemented here.
- Backwards-compat shim for `transfer_warehouse` — dropped per spec's "Out of Scope (Whole Spec)" rule.
- Realtime push for incoming-transfer badge — 60s poll is sufficient; realtime subscription can replace it later without schema change.
- Phantom `transit` warehouse — explicitly rejected; shortfall is a logical deficit reconciled via Phase 2 only.
