# Stock Fraud Phase 3a — Penerimaan PO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Penerimaan barang dari supplier menjadi proses 2-orang dengan 3-way match (PO vs fisik vs faktur supplier) dan foto wajib. Tambah tabel `purchase_order_receipts` (UNIQUE per PO) + `purchase_order_receipt_lines`, extend `receive_purchase_order` RPC dengan saksi + foto + per-line `received_qty`/`invoice_qty`, deteksi varians 3-way → `has_variance=TRUE` + WA alert Owner. Frontend: extend `ReceiveGoodsModal.tsx` dengan saksi dropdown, foto dropzone, dan kolom faktur per-line.

**Architecture:** Single new SECURITY DEFINER replacement of `receive_purchase_order` that runs inside one transaction: validate witness ≠ receiver + ≥ 1 photo, insert receipt header + lines, run existing stocks/stock_lots updates, call Phase-1 `_log_stock_movement` (source `purchase_receive`) per line. Variance detection is a per-line `GENERATED` column; receipt-level `has_variance` set if any line varies, triggering a Go-daemon webhook → Owner WA alert (fire-and-forget, does not block commit). New `stock-evidence` Supabase storage bucket with authenticated policy mirrors Phase 2's pattern; receipt photos go under `po-receipts/<po_id>/`. Frontend swaps the legacy "Qty Baik / Qty Rusak" UI for a saksi dropdown + foto dropzone + 3-column per-line entry (Dipesan / Diterima / Faktur) with live variance computation.

**Tech Stack:** Postgres 15 (Supabase), Go 1.25 with existing `dbClient` pattern, React 19 + TypeScript + Tailwind, TDD via Go integration tests against a real Supabase test database + behavioral integration test through `supabaseClient` for the modal flow.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 3a section)

**Migration numbering:** Phase 2 uses up to `20260607000019` in the worst case. Phase 3a starts at `20260607000020` to leave headroom.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000020_purchase_order_receipts.sql` | Create | `purchase_order_receipts` + `purchase_order_receipt_lines` tables, indexes, immutability triggers |
| `supabase/migrations/20260607000021_stock_evidence_bucket.sql` | Create | Create `stock-evidence` Supabase storage bucket + authenticated full-access policy (mirrors `20260604000012`) |
| `supabase/migrations/20260607000022_wrap_receive_po_3way.sql` | Create | Replace `receive_purchase_order` with witness + photo + 3-way match version that emits ledger rows |
| `backend-go/internal/db/po_receipts_test.go` | Create | Integration tests against Supabase test DB for the new RPC contract |
| `backend-go/internal/webhooks/po_variance.go` | Create | Go HTTP endpoint `/api/po/variance-alert` that sends Owner WA message |
| `backend-go/internal/webhooks/po_variance_test.go` | Create | Unit test for the variance alert payload formatting |
| `src/components/pembelian/ReceiveGoodsModal.tsx` | Modify | Add saksi dropdown, foto dropzone, 3-column per-line entry with live variance; submit-disabled gating |
| `src/lib/pembelianService.ts` | Modify | `receiveGoods` extended with `witnessed_by_user_id`, `photo_urls`, per-line `invoice_qty` payload |
| `src/lib/onlineUsersService.ts` | Create (if absent) | `listOnlineUsers(excludeSelf)` helper consumed by saksi dropdown |
| `src/components/pembelian/__tests__/ReceiveGoodsModal.test.tsx` | Create | Behavioral integration test via supabaseClient mock — asserts payload shape + variance UI |

---

## Task 1: Receipts schema + immutability

**Files:**
- Create: `supabase/migrations/20260607000020_purchase_order_receipts.sql`
- Create: `backend-go/internal/db/po_receipts_test.go` (skeleton + first test)

- [ ] **Step 1: Write failing test for table existence + UNIQUE constraint on po_id**

`backend-go/internal/db/po_receipts_test.go`:
```go
package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestPOReceipts_TablesExist(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT count(*) FROM information_schema.tables
		 WHERE table_schema='public'
		   AND table_name IN ('purchase_order_receipts','purchase_order_receipt_lines')`).Scan(&n)
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 tables, got %d", n)
	}
}

func TestPOReceipts_UniquePerPO(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-PR-UNIQ", OrderedQty: 5, UnitPrice: 1000},
	})

	witness := db.SeedAdminUser(t, client, "witness-uniq")
	receiver := db.SeedAdminUser(t, client, "receiver-uniq")

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.purchase_order_receipts
		   (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
		 VALUES ($1, $2, $3, 'atas', ARRAY['https://x/p.jpg'])`,
		po.ID, receiver, witness)
	if err != nil {
		t.Fatalf("first insert failed: %v", err)
	}

	_, err = client.Exec(context.Background(),
		`INSERT INTO public.purchase_order_receipts
		   (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
		 VALUES ($1, $2, $3, 'atas', ARRAY['https://x/p2.jpg'])`,
		po.ID, receiver, witness)
	if err == nil {
		t.Fatalf("expected UNIQUE violation on po_id, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "unique") {
		t.Fatalf("expected unique violation error, got: %v", err)
	}
}
```

(If `SeedAdminUser` does not exist yet in `testhelpers.go`, add a thin helper that INSERTs into `admin_users` with a random UUID and returns it. Use existing `SeedPurchaseOrder` from Phase 1.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestPOReceipts -v`
Expected: FAIL — relations do not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000020_purchase_order_receipts.sql`:
```sql
-- Phase 3a — Penerimaan PO 2-orang dengan 3-way match.
-- One receipt per PO (UNIQUE po_id), witness ≠ receiver, ≥ 1 photo,
-- per-line ordered/received/invoice with auto-computed variance flag.

CREATE TABLE public.purchase_order_receipts (
  id                    BIGSERIAL PRIMARY KEY,
  po_id                 TEXT NOT NULL UNIQUE REFERENCES public.purchase_orders(id),
  received_by_user_id   UUID NOT NULL,
  witnessed_by_user_id  UUID NOT NULL,
  CONSTRAINT chk_two_person_receipt CHECK (received_by_user_id <> witnessed_by_user_id),
  warehouse             TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  photo_urls            TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT chk_photo_required CHECK (array_length(photo_urls, 1) >= 1),
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  has_variance          BOOLEAN NOT NULL DEFAULT FALSE,
  variance_note         TEXT
);

CREATE INDEX idx_por_received_at ON public.purchase_order_receipts(received_at DESC);
CREATE INDEX idx_por_variance    ON public.purchase_order_receipts(has_variance) WHERE has_variance = TRUE;
CREATE INDEX idx_por_receiver    ON public.purchase_order_receipts(received_by_user_id, received_at DESC);

CREATE TABLE public.purchase_order_receipt_lines (
  receipt_id    BIGINT NOT NULL REFERENCES public.purchase_order_receipts(id) ON DELETE CASCADE,
  po_line_id    BIGINT NOT NULL,
  sku           TEXT   NOT NULL REFERENCES public.stocks(sku),
  ordered_qty   INTEGER NOT NULL CHECK (ordered_qty >= 0),
  received_qty  INTEGER NOT NULL CHECK (received_qty >= 0),
  invoice_qty   INTEGER NOT NULL CHECK (invoice_qty  >= 0),
  variance_flag BOOLEAN GENERATED ALWAYS AS
                (ordered_qty <> received_qty OR received_qty <> invoice_qty) STORED,
  PRIMARY KEY (receipt_id, po_line_id)
);

CREATE INDEX idx_porl_sku ON public.purchase_order_receipt_lines(sku);

-- Note: purchase_order_receipts is NOT in Foundational Decision #1's append-only
-- list (only stock_movements, stock_price_history, approval_requests,
-- kasir_shifts are). Standard grants apply; the receipt header is updated once
-- in-RPC to set has_variance and then left alone — no immutability trigger
-- needed (and adding one would force a workaround for that single legitimate
-- UPDATE).
GRANT SELECT ON public.purchase_order_receipts      TO authenticated;
GRANT SELECT ON public.purchase_order_receipt_lines TO authenticated;
```

- [ ] **Step 4: Apply migration locally**

Run: `supabase db push --include-all`
Expected: migration applies cleanly.

- [ ] **Step 5: Re-run tests to verify they pass**

Run: `cd backend-go && go test ./internal/db/ -run TestPOReceipts -v`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000020_purchase_order_receipts.sql backend-go/internal/db/po_receipts_test.go
git commit -m "feat(po): add purchase_order_receipts schema with 3-way match (Phase 3a)"
```

---

## Task 2: Receipts immutability + two-person CHECK + photo CHECK

**Files:**
- Modify: `backend-go/internal/db/po_receipts_test.go`

- [ ] **Step 1: Write failing tests for each constraint**

Append to `backend-go/internal/db/po_receipts_test.go`:
```go
func TestPOReceipts_WitnessNotEqualReceiver(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-PR-SELF", OrderedQty: 1, UnitPrice: 1000},
	})
	u := db.SeedAdminUser(t, client, "self-witness")

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.purchase_order_receipts
		   (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
		 VALUES ($1, $2, $2, 'atas', ARRAY['https://x/p.jpg'])`,
		po.ID, u)
	if err == nil {
		t.Fatalf("expected chk_two_person_receipt to fire, got nil")
	}
	if !strings.Contains(err.Error(), "chk_two_person_receipt") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPOReceipts_PhotoRequired(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-PR-NOPHOTO", OrderedQty: 1, UnitPrice: 1000},
	})
	w := db.SeedAdminUser(t, client, "w-nophoto")
	r := db.SeedAdminUser(t, client, "r-nophoto")

	_, err := client.Exec(context.Background(),
		`INSERT INTO public.purchase_order_receipts
		   (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
		 VALUES ($1, $2, $3, 'atas', '{}')`,
		po.ID, r, w)
	if err == nil {
		t.Fatalf("expected chk_photo_required to fire, got nil")
	}
	if !strings.Contains(err.Error(), "chk_photo_required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPOReceipts_LineVarianceFlagAutoComputed(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{SKU: "TEST-PR-VFLAG", OrderedQty: 10, UnitPrice: 1000},
	})
	w := db.SeedAdminUser(t, client, "w-vflag")
	r := db.SeedAdminUser(t, client, "r-vflag")

	var rid int64
	if err := client.QueryRow(context.Background(),
		`INSERT INTO public.purchase_order_receipts
		   (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
		 VALUES ($1, $2, $3, 'atas', ARRAY['https://x/p.jpg'])
		 RETURNING id`, po.ID, r, w).Scan(&rid); err != nil {
		t.Fatalf("seed receipt: %v", err)
	}
	// ordered=10, received=9, invoice=10 → variance_flag true
	if _, err := client.Exec(context.Background(),
		`INSERT INTO public.purchase_order_receipt_lines
		   (receipt_id, po_line_id, sku, ordered_qty, received_qty, invoice_qty)
		 VALUES ($1, 1, 'TEST-PR-VFLAG', 10, 9, 10)`, rid); err != nil {
		t.Fatalf("seed line: %v", err)
	}

	var flag bool
	if err := client.QueryRow(context.Background(),
		`SELECT variance_flag FROM public.purchase_order_receipt_lines
		 WHERE receipt_id=$1 AND po_line_id=1`, rid).Scan(&flag); err != nil {
		t.Fatalf("read: %v", err)
	}
	if !flag {
		t.Fatalf("expected variance_flag=true, got false")
	}
}
```

- [ ] **Step 2: Run tests to verify they pass (constraints already installed in Task 1)**

Run: `cd backend-go && go test ./internal/db/ -run 'TestPOReceipts_(WitnessNotEqualReceiver|PhotoRequired|UpdateRaises|LineVarianceFlagAutoComputed)' -v`
Expected: all PASS.

If any fails, the constraints from Task 1 are misnamed — fix Task 1 migration.

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/po_receipts_test.go
git commit -m "test(stocks): verify PO receipt constraints (witness, photo, immutability)"
```

---

## Task 3: `stock-evidence` Supabase storage bucket + authenticated policy

**Files:**
- Create: `supabase/migrations/20260607000021_stock_evidence_bucket.sql`
- Modify: `backend-go/internal/db/po_receipts_test.go`

- [ ] **Step 1: Write failing test for bucket existence**

Append:
```go
func TestStockEvidenceBucket_Exists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT count(*) FROM storage.buckets WHERE id='stock-evidence'`).Scan(&n)
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected stock-evidence bucket to exist, got %d rows", n)
	}
}

func TestStockEvidenceBucket_AuthenticatedPolicyExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.QueryRow(context.Background(),
		`SELECT count(*) FROM pg_policies
		 WHERE schemaname='storage' AND tablename='objects'
		   AND policyname='authenticated full access stock-evidence'`).Scan(&n)
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected stock-evidence policy to exist, got %d", n)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestStockEvidenceBucket -v`
Expected: FAIL — bucket missing.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000021_stock_evidence_bucket.sql`:
```sql
-- Phase 3a storage bucket for evidence photos (PO receipts, adjustments, opname, transfers).
-- Mirrors the pattern from 20260604000012_storage_authenticated_policies.sql.

INSERT INTO storage.buckets (id, name, public)
VALUES ('stock-evidence', 'stock-evidence', FALSE)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated full access stock-evidence'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated full access stock-evidence"
        ON storage.objects FOR ALL TO authenticated
        USING (bucket_id = 'stock-evidence')
        WITH CHECK (bucket_id = 'stock-evidence');
    $p$;
  END IF;
END $$;
```

- [ ] **Step 4: Apply migration & re-run test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestStockEvidenceBucket -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000021_stock_evidence_bucket.sql backend-go/internal/db/po_receipts_test.go
git commit -m "feat(storage): create stock-evidence bucket for Phase 3a/3b/3d evidence photos"
```

---

## Task 4: Extend `receive_purchase_order` RPC with witness + photos + 3-way match

**Files:**
- Read first: `supabase/migrations/20260604000015_fifo_rpcs.sql` (current `receive_purchase_order` body)
- Read first: `supabase/migrations/20260605000002_warehouse_columns.sql` (warehouse-aware version)
- Read first: `supabase/migrations/20260607000002_wrap_receive_po.sql` (Phase 1 wrap — the one this replaces)
- Create: `supabase/migrations/20260607000022_wrap_receive_po_3way.sql`
- Modify: `backend-go/internal/db/po_receipts_test.go`

- [ ] **Step 1: Write failing test for the new RPC signature + happy path**

Append:
```go
func TestReceivePO_3Way_HappyPath(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 101, SKU: "TEST-PR-HAPPY-A", OrderedQty: 10, UnitPrice: 1000},
		{ID: 102, SKU: "TEST-PR-HAPPY-B", OrderedQty: 5,  UnitPrice: 2000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-happy")
	witness  := db.SeedAdminUser(t, client, "wit-happy")

	beforeRows := db.CountStockMovements(t, client, "TEST-PR-HAPPY-A")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1,
		   p_warehouse=>'atas',
		   p_payment_amount=>0::numeric,
		   p_payment_method=>'cash',
		   p_received_by_user_id=>$2,
		   p_witnessed_by_user_id=>$3,
		   p_photo_urls=>ARRAY['https://x/foto1.jpg'],
		   p_lines=>$4::jsonb
		 )`,
		po.ID, receiver, witness,
		`[{"po_line_id":101,"received_qty":10,"invoice_qty":10},
		  {"po_line_id":102,"received_qty":5,"invoice_qty":5}]`)
	if err != nil {
		t.Fatalf("receive_purchase_order failed: %v", err)
	}

	// Receipt header exists, has_variance=false
	var has bool
	if err := client.QueryRow(context.Background(),
		`SELECT has_variance FROM public.purchase_order_receipts WHERE po_id=$1`, po.ID).Scan(&has); err != nil {
		t.Fatalf("read header: %v", err)
	}
	if has {
		t.Fatalf("expected has_variance=false on clean receipt")
	}

	// Two lines written
	var n int
	if err := client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.purchase_order_receipt_lines rl
		 JOIN public.purchase_order_receipts r ON r.id=rl.receipt_id
		 WHERE r.po_id=$1`, po.ID).Scan(&n); err != nil {
		t.Fatalf("count lines: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 receipt lines, got %d", n)
	}

	// One ledger row per line for sku A (Phase 1 contract preserved)
	afterRows := db.CountStockMovements(t, client, "TEST-PR-HAPPY-A")
	if afterRows-beforeRows != 1 {
		t.Fatalf("expected 1 new ledger row for TEST-PR-HAPPY-A, got %d", afterRows-beforeRows)
	}

	// Ledger row metadata
	var source, warehouse string
	var delta int
	if err := client.QueryRow(context.Background(),
		`SELECT source::text, warehouse, qty_delta
		 FROM public.stock_movements
		 WHERE related_doc_type='purchase_order' AND related_doc_id=$1 AND sku='TEST-PR-HAPPY-A'
		 ORDER BY id DESC LIMIT 1`, po.ID).Scan(&source, &warehouse, &delta); err != nil {
		t.Fatalf("read ledger: %v", err)
	}
	if source != "purchase_receive" || warehouse != "atas" || delta != 10 {
		t.Fatalf("ledger row wrong: source=%s warehouse=%s delta=%d", source, warehouse, delta)
	}
}

func TestReceivePO_3Way_NoWitnessRejected(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 201, SKU: "TEST-PR-NOW", OrderedQty: 1, UnitPrice: 1000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-now")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2,
		   p_witnessed_by_user_id=>NULL,
		   p_photo_urls=>ARRAY['https://x/p.jpg'],
		   p_lines=>$3::jsonb
		 )`,
		po.ID, receiver,
		`[{"po_line_id":201,"received_qty":1,"invoice_qty":1}]`)
	if err == nil {
		t.Fatalf("expected witness-missing error, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "saksi") &&
		!strings.Contains(strings.ToLower(err.Error()), "witness") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestReceivePO_3Way_WitnessEqualsReceiverRejected(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 301, SKU: "TEST-PR-SELFRCV", OrderedQty: 1, UnitPrice: 1000},
	})
	u := db.SeedAdminUser(t, client, "rcv-self")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2,
		   p_witnessed_by_user_id=>$2,
		   p_photo_urls=>ARRAY['https://x/p.jpg'],
		   p_lines=>$3::jsonb
		 )`,
		po.ID, u,
		`[{"po_line_id":301,"received_qty":1,"invoice_qty":1}]`)
	if err == nil {
		t.Fatalf("expected witness==receiver error, got nil")
	}
}

func TestReceivePO_3Way_NoPhotoRejected(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 401, SKU: "TEST-PR-NOPHOTO2", OrderedQty: 1, UnitPrice: 1000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-np")
	witness  := db.SeedAdminUser(t, client, "wit-np")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2,
		   p_witnessed_by_user_id=>$3,
		   p_photo_urls=>'{}'::text[],
		   p_lines=>$4::jsonb
		 )`,
		po.ID, receiver, witness,
		`[{"po_line_id":401,"received_qty":1,"invoice_qty":1}]`)
	if err == nil {
		t.Fatalf("expected photo-required error, got nil")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestReceivePO_3Way -v`
Expected: FAIL — the current RPC signature does not accept these args.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000022_wrap_receive_po_3way.sql`:
```sql
-- Phase 3a — Replace receive_purchase_order with 2-person + 3-way match version.
-- This supersedes the Phase 1 wrap (20260607000002_wrap_receive_po.sql). All of:
--   - existing PO status check + payment recording
--   - existing stock_lots insert + stocks.<warehouse> increment
--   - Phase 1 _log_stock_movement call (source=purchase_receive) per line
-- are preserved. New behavior:
--   - REQUIRE p_witnessed_by_user_id (NOT NULL) ≠ p_received_by_user_id
--   - REQUIRE array_length(p_photo_urls,1) >= 1
--   - INSERT purchase_order_receipts + per-line purchase_order_receipt_lines
--     from p_lines JSONB (each entry: po_line_id, received_qty, invoice_qty)
--   - If any line has ordered<>received OR received<>invoice → has_variance=TRUE
--   - has_variance=TRUE → NOTIFY a Go-side webhook channel for Owner WA alert
--     (the Go daemon LISTENs and posts to /api/po/variance-alert).

DROP FUNCTION IF EXISTS public.receive_purchase_order(TEXT, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id                 TEXT,
  p_warehouse             TEXT DEFAULT 'atas',
  p_payment_amount        NUMERIC DEFAULT 0,
  p_payment_method        TEXT DEFAULT 'cash',
  p_received_by_user_id   UUID DEFAULT NULL,
  p_witnessed_by_user_id  UUID DEFAULT NULL,
  p_photo_urls            TEXT[] DEFAULT '{}',
  p_lines                 JSONB DEFAULT '[]'::jsonb
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_id BIGINT;
  v_actor      UUID := COALESCE(p_received_by_user_id, auth.uid(),
                                '00000000-0000-0000-0000-000000000000'::uuid);
  v_line       JSONB;
  v_po_line_id BIGINT;
  v_recv_qty   INT;
  v_inv_qty    INT;
  v_sku        TEXT;
  v_ord_qty    INT;
  v_qty_before INT;
  v_has_var    BOOLEAN := FALSE;
BEGIN
  -- ----- Validation -----
  IF p_witnessed_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Saksi (witness) wajib dipilih untuk penerimaan barang';
  END IF;
  IF p_received_by_user_id IS NULL THEN
    RAISE EXCEPTION 'Penerima (receiver) wajib disediakan';
  END IF;
  IF p_witnessed_by_user_id = p_received_by_user_id THEN
    RAISE EXCEPTION 'Saksi tidak boleh sama dengan penerima';
  END IF;
  IF p_photo_urls IS NULL OR array_length(p_photo_urls, 1) IS NULL OR array_length(p_photo_urls, 1) < 1 THEN
    RAISE EXCEPTION 'Minimal 1 foto pengiriman wajib diunggah';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Daftar item penerimaan tidak boleh kosong';
  END IF;

  -- ----- Existing PO status guard (copy verbatim from current RPC body) -----
  PERFORM 1 FROM public.purchase_orders
   WHERE id = p_po_id AND status IN ('SENT','PARTIAL');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO % tidak dalam status yang dapat diterima', p_po_id;
  END IF;

  -- ----- Insert receipt header (CHECK constraints will re-validate witness/photo) -----
  INSERT INTO public.purchase_order_receipts
    (po_id, received_by_user_id, witnessed_by_user_id, warehouse, photo_urls)
  VALUES
    (p_po_id, p_received_by_user_id, p_witnessed_by_user_id, p_warehouse, p_photo_urls)
  RETURNING id INTO v_receipt_id;

  -- ----- Per-line: stocks + stock_lots + receipt line + ledger row -----
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_po_line_id := (v_line->>'po_line_id')::BIGINT;
    v_recv_qty   := (v_line->>'received_qty')::INT;
    v_inv_qty    := (v_line->>'invoice_qty')::INT;

    SELECT sku, qty INTO v_sku, v_ord_qty
      FROM public.purchase_order_items
     WHERE id = v_po_line_id AND po_id = p_po_id;
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'PO line % tidak ditemukan untuk PO %', v_po_line_id, p_po_id;
    END IF;

    -- Lock + read qty_before for the destination warehouse
    EXECUTE format('SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE', p_warehouse)
      INTO v_qty_before USING v_sku;

    -- Existing behavior: increment stock + insert lot
    EXECUTE format('UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1', p_warehouse, p_warehouse)
      USING v_sku, v_recv_qty;
    INSERT INTO public.stock_lots (sku, qty_received, qty_remaining, unit_cost, po_id)
      SELECT v_sku, v_recv_qty, v_recv_qty, unit_price, p_po_id
        FROM public.purchase_order_items WHERE id = v_po_line_id;

    -- Receipt line (variance_flag auto-computed)
    INSERT INTO public.purchase_order_receipt_lines
      (receipt_id, po_line_id, sku, ordered_qty, received_qty, invoice_qty)
    VALUES (v_receipt_id, v_po_line_id, v_sku, v_ord_qty, v_recv_qty, v_inv_qty);

    -- Phase 1 ledger row (source=purchase_receive)
    PERFORM public._log_stock_movement(
      p_sku             => v_sku,
      p_warehouse       => p_warehouse,
      p_qty_delta       => v_recv_qty,
      p_qty_before      => v_qty_before,
      p_source          => 'purchase_receive',
      p_related_doc_type=> 'purchase_order',
      p_related_doc_id  => p_po_id,
      p_actor_user_id   => v_actor,
      p_actor_role      => 'po_receive',
      p_evidence_urls   => p_photo_urls
    );

    IF v_ord_qty <> v_recv_qty OR v_recv_qty <> v_inv_qty THEN
      v_has_var := TRUE;
    END IF;
  END LOOP;

  -- ----- Variance flag + alert -----
  -- Plain UPDATE — no immutability trigger on purchase_order_receipts.
  UPDATE public.purchase_order_receipts
     SET has_variance = v_has_var
   WHERE id = v_receipt_id;

  IF v_has_var THEN
    -- Notify Go daemon for WA alert (LISTEN/NOTIFY; non-blocking).
    PERFORM pg_notify('po_receipt_variance',
      json_build_object('receipt_id', v_receipt_id, 'po_id', p_po_id)::text);
  END IF;

  -- ----- Existing post-loop bookkeeping (status + payment) -----
  UPDATE public.purchase_orders
     SET status = 'RECEIVED', received_at = now()
   WHERE id = p_po_id;

  -- Existing payment recording behavior preserved (copy from current RPC body
  -- if payment-amount > 0 — omitted here for brevity; copy verbatim).

  RETURN v_receipt_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.receive_purchase_order(
  TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT[], JSONB
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.receive_purchase_order(
  TEXT, TEXT, NUMERIC, TEXT, UUID, UUID, TEXT[], JSONB
) TO authenticated;
```

**Important:** before submitting, open `supabase/migrations/20260604000010_receive_po_add_payment_fields.sql`, `20260604000015_fifo_rpcs.sql`, `20260605000002_warehouse_columns.sql`, `20260605000005_dp_payment.sql`, `20260606*_*`, and the Phase 1 `20260607000002_wrap_receive_po.sql` and copy the full existing body of `receive_purchase_order` (PO status check, supplier_invoice / dp_payment side-effects, payment ledger inserts) into the new function. The only NEW logic is the validation block, receipt-header + receipt-line inserts, variance detection, and `pg_notify`. The Phase 1 `_log_stock_movement` call is also preserved.

- [ ] **Step 4: Apply migration & re-run tests**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestReceivePO_3Way -v`
Expected: PASS.

- [ ] **Step 5: Verify Phase 1 regression**

Run: `cd backend-go && go test ./internal/db/ -run TestReceivePO_WritesLedgerRowPerLine -v`
Expected: PASS (the Phase 1 invariant — one ledger row per line — still holds).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260607000022_wrap_receive_po_3way.sql backend-go/internal/db/po_receipts_test.go
git commit -m "feat(stocks): receive_purchase_order requires witness + photo + 3-way match (Phase 3a)"
```

---

## Task 5: Variance detection writes `has_variance=TRUE` + integration test

**Files:**
- Modify: `backend-go/internal/db/po_receipts_test.go`

- [ ] **Step 1: Write failing test for variance scenarios**

Append:
```go
func TestReceivePO_3Way_VarianceReceivedLessThanOrdered(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 501, SKU: "TEST-PR-VR1", OrderedQty: 10, UnitPrice: 1000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-vr1")
	witness  := db.SeedAdminUser(t, client, "wit-vr1")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2,
		   p_witnessed_by_user_id=>$3,
		   p_photo_urls=>ARRAY['https://x/p.jpg'],
		   p_lines=>$4::jsonb
		 )`,
		po.ID, receiver, witness,
		`[{"po_line_id":501,"received_qty":7,"invoice_qty":10}]`)
	if err != nil {
		t.Fatalf("receive failed: %v", err)
	}

	var has bool
	if err := client.QueryRow(context.Background(),
		`SELECT has_variance FROM public.purchase_order_receipts WHERE po_id=$1`, po.ID).Scan(&has); err != nil {
		t.Fatalf("read header: %v", err)
	}
	if !has {
		t.Fatalf("expected has_variance=true when received<ordered")
	}

	var lineVar bool
	if err := client.QueryRow(context.Background(),
		`SELECT variance_flag FROM public.purchase_order_receipt_lines rl
		 JOIN public.purchase_order_receipts r ON r.id=rl.receipt_id
		 WHERE r.po_id=$1`, po.ID).Scan(&lineVar); err != nil {
		t.Fatalf("read line: %v", err)
	}
	if !lineVar {
		t.Fatalf("expected variance_flag=true on the line")
	}

	// Stocks should still reflect *received_qty* (7), not ordered (10)
	var s int
	if err := client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-PR-VR1'`).Scan(&s); err != nil {
		t.Fatalf("read stocks: %v", err)
	}
	if s < 7 {
		t.Fatalf("expected stock_atas >= 7, got %d", s)
	}
}

func TestReceivePO_3Way_VarianceInvoiceDiffersFromReceived(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 601, SKU: "TEST-PR-VR2", OrderedQty: 5, UnitPrice: 1000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-vr2")
	witness  := db.SeedAdminUser(t, client, "wit-vr2")

	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2, p_witnessed_by_user_id=>$3,
		   p_photo_urls=>ARRAY['https://x/p.jpg'],
		   p_lines=>$4::jsonb
		 )`,
		po.ID, receiver, witness,
		// ordered=5, received=5, invoice=6  → invoice ≠ received → variance
		`[{"po_line_id":601,"received_qty":5,"invoice_qty":6}]`)
	if err != nil {
		t.Fatalf("receive failed: %v", err)
	}

	var has bool
	if err := client.QueryRow(context.Background(),
		`SELECT has_variance FROM public.purchase_order_receipts WHERE po_id=$1`, po.ID).Scan(&has); err != nil {
		t.Fatalf("read header: %v", err)
	}
	if !has {
		t.Fatalf("expected has_variance=true when invoice<>received")
	}
}
```

- [ ] **Step 2: Run tests**

Run: `cd backend-go && go test ./internal/db/ -run TestReceivePO_3Way_Variance -v`
Expected: PASS (the migration in Task 4 already covers this; this task is a regression guard + spec coverage for the two distinct variance triggers).

If any test fails, the `v_has_var` flag computation in the loop or the `UPDATE … SET has_variance` after the loop is broken — debug Task 4.

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/po_receipts_test.go
git commit -m "test(stocks): assert has_variance=true for received<ordered and invoice<>received"
```

---

## Task 6: Go variance-alert webhook (Owner WA notification)

**Files:**
- Create: `backend-go/internal/webhooks/po_variance.go`
- Create: `backend-go/internal/webhooks/po_variance_test.go`

The trigger from Task 4 emits `pg_notify('po_receipt_variance', {...})`. The Go daemon LISTENs on that channel and dispatches to `internal/whatsapp/sender.go`. For test discipline, the alert logic lives in an HTTP-driven endpoint (`POST /api/po/variance-alert`) so it can be exercised without a live LISTEN/NOTIFY loop.

- [ ] **Step 1: Write failing test for alert payload formatting**

`backend-go/internal/webhooks/po_variance_test.go`:
```go
package webhooks_test

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/webhooks"
)

func TestFormatVarianceMessage(t *testing.T) {
	msg := webhooks.FormatVarianceMessage(webhooks.VariancePayload{
		POID:     "PO-2026-0042",
		ReceiptID: 17,
		Lines: []webhooks.VarianceLine{
			{SKU: "PAN-001", OrderedQty: 10, ReceivedQty: 7, InvoiceQty: 10},
			{SKU: "PAN-002", OrderedQty: 5,  ReceivedQty: 5,  InvoiceQty: 6},
		},
	})
	want := []string{
		"PO-2026-0042",
		"PAN-001",
		"Dipesan 10 / Diterima 7 / Faktur 10",
		"PAN-002",
		"Dipesan 5 / Diterima 5 / Faktur 6",
		"Mohon dicek",
	}
	for _, w := range want {
		if !contains(msg, w) {
			t.Fatalf("expected message to contain %q, got: %s", w, msg)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) &&
		(haystack == needle ||
			(len(needle) > 0 && indexOf(haystack, needle) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/webhooks/ -run TestFormatVarianceMessage -v`
Expected: FAIL — package or symbols don't exist.

- [ ] **Step 3: Implement the webhook + formatter**

`backend-go/internal/webhooks/po_variance.go`:
```go
package webhooks

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

type VarianceLine struct {
	SKU         string `json:"sku"`
	OrderedQty  int    `json:"ordered_qty"`
	ReceivedQty int    `json:"received_qty"`
	InvoiceQty  int    `json:"invoice_qty"`
}

type VariancePayload struct {
	POID      string         `json:"po_id"`
	ReceiptID int64          `json:"receipt_id"`
	Lines     []VarianceLine `json:"lines"`
}

func FormatVarianceMessage(p VariancePayload) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Selisih penerimaan barang — %s\n\n", p.POID)
	for _, l := range p.Lines {
		fmt.Fprintf(&b, "%s — Dipesan %d / Diterima %d / Faktur %d\n",
			l.SKU, l.OrderedQty, l.ReceivedQty, l.InvoiceQty)
	}
	b.WriteString("\nMohon dicek dan ambil tindakan (adjust / hubungi supplier).")
	return b.String()
}

// HandlePOVarianceAlert is HTTP handler for POST /api/po/variance-alert.
// Body: {"receipt_id": 17}
type Handler struct {
	DB     *db.Client
	WA     whatsapp.Sender
	OwnerJID string
}

func (h *Handler) HandlePOVarianceAlert(w http.ResponseWriter, r *http.Request) {
	var body struct{ ReceiptID int64 `json:"receipt_id"` }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	payload, err := h.loadVariance(r.Context(), body.ReceiptID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	msg := FormatVarianceMessage(payload)
	if err := h.WA.SendText(r.Context(), h.OwnerJID, msg); err != nil {
		http.Error(w, "wa send failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Handler) loadVariance(ctx context.Context, receiptID int64) (VariancePayload, error) {
	var p VariancePayload
	p.ReceiptID = receiptID

	err := h.DB.QueryRow(ctx,
		`SELECT po_id FROM public.purchase_order_receipts WHERE id=$1`, receiptID).Scan(&p.POID)
	if err != nil {
		return p, fmt.Errorf("load receipt: %w", err)
	}

	rows, err := h.DB.Query(ctx,
		`SELECT sku, ordered_qty, received_qty, invoice_qty
		 FROM public.purchase_order_receipt_lines
		 WHERE receipt_id=$1 AND variance_flag = TRUE
		 ORDER BY po_line_id`, receiptID)
	if err != nil {
		return p, fmt.Errorf("load lines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var l VarianceLine
		if err := rows.Scan(&l.SKU, &l.OrderedQty, &l.ReceivedQty, &l.InvoiceQty); err != nil {
			return p, err
		}
		p.Lines = append(p.Lines, l)
	}
	return p, nil
}
```

(If the project's `whatsapp.Sender` interface name differs, adjust accordingly. Owner JID lookup pattern is the same as existing daily heartbeat — see `internal/heartbeat/poller.go`.)

- [ ] **Step 4: Re-run formatter test**

Run: `cd backend-go && go test ./internal/webhooks/ -run TestFormatVarianceMessage -v`
Expected: PASS.

- [ ] **Step 5: Wire endpoint into main router + LISTEN loop**

Edit `backend-go/cmd/daemon/main.go` (or wherever HTTP routes are registered):
```go
// Add the route
mux.HandleFunc("/api/po/variance-alert", varianceHandler.HandlePOVarianceAlert)

// Spawn a goroutine that LISTENs on po_receipt_variance and POSTs to itself.
// Reuse the existing pgx LISTEN pattern (see internal/heartbeat for reference).
go listenPOVariance(ctx, dbpool, "http://localhost:" + httpPort + "/api/po/variance-alert")
```

A simple `listenPOVariance` helper (in `backend-go/internal/webhooks/po_variance_listen.go`):
```go
package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func ListenPOVariance(ctx context.Context, pool *pgxpool.Pool, postURL string) {
	for {
		conn, err := pool.Acquire(ctx)
		if err != nil {
			log.Printf("po-variance listen: acquire failed: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		if _, err := conn.Exec(ctx, "LISTEN po_receipt_variance"); err != nil {
			log.Printf("po-variance listen: LISTEN failed: %v", err)
			conn.Release()
			time.Sleep(5 * time.Second)
			continue
		}
		for {
			n, err := conn.Conn().WaitForNotification(ctx)
			if err != nil {
				log.Printf("po-variance: notification wait failed: %v", err)
				break
			}
			body, _ := json.Marshal(map[string]any{"receipt_id": parseReceiptID(n.Payload)})
			resp, err := http.Post(postURL, "application/json", bytes.NewReader(body))
			if err != nil {
				log.Printf("po-variance: post failed: %v", err)
				continue
			}
			resp.Body.Close()
		}
		conn.Release()
	}
}

func parseReceiptID(payload string) int64 {
	var p struct{ ReceiptID int64 `json:"receipt_id"` }
	_ = json.Unmarshal([]byte(payload), &p)
	return p.ReceiptID
}
```

- [ ] **Step 6: Manual smoke through psql**

Open a psql session, run:
```sql
NOTIFY po_receipt_variance, '{"receipt_id": 999, "po_id": "FAKE"}';
```
The daemon log should show a POST attempt to `/api/po/variance-alert` returning 500 (receipt 999 not found) — confirming the LISTEN loop is wired. If no log appears, LISTEN failed at boot.

- [ ] **Step 7: Commit**

```bash
git add backend-go/internal/webhooks/ backend-go/cmd/daemon/main.go
git commit -m "feat(po): variance webhook + LISTEN loop sends Owner WA alert on 3-way mismatch"
```

---

## Task 7: Frontend service layer extension

**Files:**
- Modify: `src/lib/pembelianService.ts`
- Create: `src/lib/onlineUsersService.ts`

- [ ] **Step 1: Read existing service**

Open `src/lib/pembelianService.ts` and locate `purchaseOrderService.receiveGoods`. Note the current payload shape: `{ received_at, payment_due_at, invoice_url, conditions, warehouse }`.

- [ ] **Step 2: Extend `receiveGoods` payload**

Modify the type and function:
```ts
// In pembelianService.ts (near the existing types)
export interface ReceiveGoodsLine {
  po_line_id: number;
  received_qty: number;
  invoice_qty: number;
}

export interface ReceiveGoodsPayload {
  received_at: string;
  payment_due_at: string;
  invoice_url?: string;
  warehouse: 'atas' | 'bawah';
  witnessed_by_user_id: string;
  photo_urls: string[];
  lines: ReceiveGoodsLine[];
}

async receiveGoods(poId: string, p: ReceiveGoodsPayload): Promise<number> {
  const currentUserId = (await supabase.auth.getUser()).data.user?.id;
  if (!currentUserId) throw new Error('Tidak ada session pengguna');

  const { data, error } = await supabase.rpc('receive_purchase_order', {
    p_po_id: poId,
    p_warehouse: p.warehouse,
    p_payment_amount: 0,
    p_payment_method: 'cash',
    p_received_by_user_id: currentUserId,
    p_witnessed_by_user_id: p.witnessed_by_user_id,
    p_photo_urls: p.photo_urls,
    p_lines: p.lines,
  });
  if (error) throw error;
  return data as number;  // receipt_id
}

async uploadReceiptPhoto(file: File, poId: string): Promise<string> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `po-receipts/${poId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await supabase.storage.from('stock-evidence').upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from('stock-evidence').getPublicUrl(path);
  return data.publicUrl;
}
```

Remove the legacy `conditions` field path from the service. If existing callers still pass `conditions`, mark the old function `receiveGoodsLegacy` and add a TODO to remove after Phase 3a ships.

- [ ] **Step 3: Create online-users helper**

`src/lib/onlineUsersService.ts`:
```ts
import { supabase } from './supabaseClient';

export interface OnlineUser {
  id: string;
  name: string;
  role: string;
}

/** Returns admin users who appear online via Supabase presence/heartbeat.
 *  Falls back to all `is_active=true` users if presence is unavailable.
 *  Always excludes the current user.
 */
export async function listOnlineUsers(excludeUserId: string): Promise<OnlineUser[]> {
  // Existing heartbeat column on admin_users is `last_seen_at` (per Phase 1+2
  // assumptions). "Online" = last_seen_at within 5 minutes.
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, name, role, last_seen_at')
    .neq('id', excludeUserId)
    .eq('is_active', true)
    .gte('last_seen_at', new Date(Date.now() - 5 * 60_000).toISOString())
    .order('name');
  if (error) {
    // Graceful fallback: return all active users if last_seen_at missing
    const { data: all } = await supabase
      .from('admin_users')
      .select('id, name, role')
      .neq('id', excludeUserId)
      .eq('is_active', true)
      .order('name');
    return (all ?? []) as OnlineUser[];
  }
  return (data ?? []).map(({ id, name, role }) => ({ id, name, role }));
}
```

(If `last_seen_at` does not exist in the schema, the fallback path covers it — verify by inspecting `admin_users` columns in `20260603000003_admin_users.sql` and subsequent migrations.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/pembelianService.ts src/lib/onlineUsersService.ts
git commit -m "feat(pembelian): service extends receiveGoods with witness/photo/lines payload"
```

---

## Task 8: ReceiveGoodsModal — saksi dropdown, foto dropzone, 3-column lines

**Files:**
- Modify: `src/components/pembelian/ReceiveGoodsModal.tsx`
- Create: `src/components/pembelian/__tests__/ReceiveGoodsModal.test.tsx`

- [ ] **Step 1: Write failing behavioral test**

`src/components/pembelian/__tests__/ReceiveGoodsModal.test.tsx`:
```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiveGoodsModal from '../ReceiveGoodsModal';

// Mock the services so we don't hit Supabase
vi.mock('../../../lib/pembelianService', () => ({
  purchaseOrderService: {
    receiveGoods: vi.fn().mockResolvedValue(42),
    uploadReceiptPhoto: vi.fn().mockResolvedValue('https://x/photo.jpg'),
  },
}));
vi.mock('../../../lib/onlineUsersService', () => ({
  listOnlineUsers: vi.fn().mockResolvedValue([
    { id: 'witness-1', name: 'Bu Sari',  role: 'staff_admin_toko' },
    { id: 'witness-2', name: 'Pak Joko', role: 'supervisor_gudang' },
  ]),
}));
vi.mock('../../../lib/supabaseClient', () => ({
  supabase: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'me-1' } } }) } },
}));

const samplePO = {
  id: 'PO-2026-0001',
  po_number: 'PO-2026-0001',
  supplier: { payment_term_days: 30 },
  items: [
    { id: 11, sku: 'PAN-001', product_name: 'Panel A', qty: 10 },
    { id: 12, sku: 'PAN-002', product_name: 'Panel B', qty: 5 },
  ],
};

describe('ReceiveGoodsModal — Phase 3a', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submit is disabled until witness + photo + all qtys filled', async () => {
    const showToast = vi.fn();
    render(<ReceiveGoodsModal po={samplePO as any} onClose={() => {}} onReceived={() => {}} showToast={showToast} />);

    const submit = await screen.findByRole('button', { name: /Konfirmasi Terima/i });
    expect(submit).toBeDisabled();

    // Pick witness
    await waitFor(() => screen.getByLabelText(/Saksi/i));
    fireEvent.change(screen.getByLabelText(/Saksi/i), { target: { value: 'witness-1' } });
    expect(submit).toBeDisabled();  // still no photo

    // Upload photo
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/Foto Pengiriman/i) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(submit).toBeEnabled());  // qtys default to ordered

    expect(submit).toBeEnabled();
  });

  it('shows variance banner when received differs from ordered or invoice', async () => {
    const showToast = vi.fn();
    render(<ReceiveGoodsModal po={samplePO as any} onClose={() => {}} onReceived={() => {}} showToast={showToast} />);
    await screen.findByLabelText(/Saksi/i);

    // Find the received-qty input for line 11 and change it
    const recvInputs = screen.getAllByLabelText(/Qty Diterima/i);
    fireEvent.change(recvInputs[0], { target: { value: '7' } });

    expect(await screen.findByText(/Ada selisih/i)).toBeInTheDocument();
  });

  it('submits the correct RPC payload', async () => {
    const { purchaseOrderService } = await import('../../../lib/pembelianService');
    const showToast = vi.fn();
    const onReceived = vi.fn();
    render(<ReceiveGoodsModal po={samplePO as any} onClose={() => {}} onReceived={onReceived} showToast={showToast} />);

    await screen.findByLabelText(/Saksi/i);
    fireEvent.change(screen.getByLabelText(/Saksi/i), { target: { value: 'witness-2' } });

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText(/Foto Pengiriman/i) as HTMLInputElement, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Terima/i }));

    await waitFor(() => expect(purchaseOrderService.receiveGoods).toHaveBeenCalledTimes(1));
    const [poId, payload] = (purchaseOrderService.receiveGoods as any).mock.calls[0];
    expect(poId).toBe('PO-2026-0001');
    expect(payload.witnessed_by_user_id).toBe('witness-2');
    expect(payload.photo_urls).toEqual(['https://x/photo.jpg']);
    expect(payload.lines).toEqual([
      { po_line_id: 11, received_qty: 10, invoice_qty: 10 },
      { po_line_id: 12, received_qty: 5,  invoice_qty: 5  },
    ]);
    expect(payload.warehouse).toBe('atas');
  });
});
```

If Vitest + React Testing Library are not yet set up in this project, add them to `devDependencies` (`vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`) and a minimal `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'] },
});
```
`vitest.setup.ts`: `import '@testing-library/jest-dom';`

If introducing a test runner is too heavy for this phase, replace the RTL tests with a tiny behavioral integration test that wires the component via `react-dom/client.createRoot` in a jsdom environment and drives input events directly. The spec accepts either.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- ReceiveGoodsModal`
Expected: FAIL — the modal still has the old shape (no saksi dropdown, no foto dropzone, no separate "Qty Diterima" / "Qty Faktur" inputs).

- [ ] **Step 3: Rewrite the modal**

Replace `src/components/pembelian/ReceiveGoodsModal.tsx`:
```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { X, Upload } from 'lucide-react';
import { DbPurchaseOrder } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { listOnlineUsers, OnlineUser } from '../../lib/onlineUsersService';
import { supabase } from '../../lib/supabaseClient';

interface ReceiveGoodsModalProps {
  po: DbPurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type LineEntry = { received_qty: number; invoice_qty: number };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReceiveGoodsModal({ po, onClose, onReceived, showToast }: ReceiveGoodsModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const supplierTermDays = po.supplier?.payment_term_days ?? 0;
  const defaultDueDate = supplierTermDays > 0 ? addDays(today, supplierTermDays) : today;

  const [receivedAt, setReceivedAt] = useState(today);
  const [paymentDueAt, setPaymentDueAt] = useState(defaultDueDate);
  const [warehouse, setWarehouse] = useState<'atas' | 'bawah'>('atas');
  const [witnessId, setWitnessId] = useState<string>('');
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [witnesses, setWitnesses] = useState<OnlineUser[]>([]);
  const [saving, setSaving] = useState(false);

  const [lines, setLines] = useState<Record<number, LineEntry>>(
    Object.fromEntries((po.items ?? []).map(item => [
      item.id, { received_qty: item.qty, invoice_qty: item.qty },
    ]))
  );

  // Load witnesses (online users ≠ self)
  useEffect(() => {
    (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id ?? '';
      const list = await listOnlineUsers(me);
      setWitnesses(list);
    })();
  }, []);

  const hasAnyVariance = useMemo(() => {
    return (po.items ?? []).some(item => {
      const l = lines[item.id];
      return l && (l.received_qty !== item.qty || l.received_qty !== l.invoice_qty);
    });
  }, [lines, po.items]);

  const canSubmit = useMemo(() => {
    if (!witnessId) return false;
    if (photoFiles.length < 1) return false;
    for (const item of po.items ?? []) {
      const l = lines[item.id];
      if (l == null) return false;
      if (Number.isNaN(l.received_qty) || Number.isNaN(l.invoice_qty)) return false;
      if (l.received_qty < 0 || l.invoice_qty < 0) return false;
    }
    return true;
  }, [witnessId, photoFiles, lines, po.items]);

  function updateLine(itemId: number, field: keyof LineEntry, value: number) {
    setLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  }

  async function handleConfirm() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const photoUrls: string[] = [];
      for (const f of photoFiles) {
        photoUrls.push(await purchaseOrderService.uploadReceiptPhoto(f, po.id));
      }
      await purchaseOrderService.receiveGoods(po.id, {
        received_at: new Date(receivedAt).toISOString(),
        payment_due_at: paymentDueAt,
        warehouse,
        witnessed_by_user_id: witnessId,
        photo_urls: photoUrls,
        lines: (po.items ?? []).map(item => ({
          po_line_id: Number(item.id),
          received_qty: lines[item.id].received_qty,
          invoice_qty: lines[item.id].invoice_qty,
        })),
      });
      showToast(`${po.po_number} diterima${hasAnyVariance ? ' (ADA SELISIH — Owner sudah diberi tahu)' : ''}.`, 'success');
      onReceived();
      onClose();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengkonfirmasi penerimaan.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Terima Barang — {po.po_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
            Penerimaan ini menerapkan <strong>3-way match</strong> (PO vs fisik vs faktur supplier) dan wajib disaksikan.
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Tanggal Terima <span className="text-rose-500">*</span></label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Jatuh Tempo Pembayaran <span className="text-rose-500">*</span></label>
              <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <p className="text-[10px] text-gray-400 mt-1">
                Pre-filled {supplierTermDays > 0 ? `Net ${supplierTermDays}` : 'Cash'}.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Gudang Tujuan <span className="text-rose-500">*</span></label>
              <select value={warehouse} onChange={e => setWarehouse(e.target.value as 'atas' | 'bawah')}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="atas">Gudang Atas</option>
                <option value="bawah">Gudang Bawah</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="saksi-select" className="text-xs font-semibold text-gray-600 block mb-1">
                Saksi <span className="text-rose-500">*</span>
              </label>
              <select
                id="saksi-select"
                aria-label="Saksi"
                value={witnessId}
                onChange={e => setWitnessId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">Pilih saksi (online users)</option>
                {witnesses.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.role})</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">Saksi tidak boleh sama dengan penerima.</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">
                Foto Pengiriman <span className="text-rose-500">*</span>
              </label>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
                <Upload className="w-5 h-5 mb-1 text-gray-300" />
                {photoFiles.length > 0
                  ? `${photoFiles.length} file dipilih`
                  : 'Klik atau drag foto (JPG/PNG, min 1)'}
                <input
                  aria-label="Foto Pengiriman"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => setPhotoFiles(Array.from(e.target.files ?? []))}
                />
              </label>
            </div>
          </div>

          {hasAnyVariance && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
              Ada selisih antara PO / Diterima / Faktur. Owner akan otomatis menerima notifikasi WA.
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-2">Cek 3-way per Item</label>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-5">Produk</span>
                <span className="col-span-2 text-center">Dipesan (PO)</span>
                <span className="col-span-2 text-center text-emerald-600">Qty Diterima</span>
                <span className="col-span-2 text-center text-amber-600">Qty Faktur</span>
                <span className="col-span-1 text-center">Selisih?</span>
              </div>
              {(po.items ?? []).map(item => {
                const l = lines[item.id] ?? { received_qty: item.qty, invoice_qty: item.qty };
                const variance = l.received_qty !== item.qty || l.received_qty !== l.invoice_qty;
                return (
                  <div key={item.id} className={variance ? 'bg-rose-50' : ''}>
                    <div className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-gray-100">
                      <div className="col-span-5">
                        <div className="text-xs font-semibold text-gray-800">{item.product_name}</div>
                        <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                      </div>
                      <span className="col-span-2 text-center text-xs text-gray-500">{item.qty}</span>
                      <div className="col-span-2 flex justify-center">
                        <input
                          aria-label={`Qty Diterima ${item.sku}`}
                          type="number" min="0"
                          value={l.received_qty}
                          onChange={e => updateLine(item.id, 'received_qty', parseInt(e.target.value) || 0)}
                          className="w-16 text-center text-sm border border-emerald-300 rounded-lg px-2 py-1 bg-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <input
                          aria-label={`Qty Faktur ${item.sku}`}
                          type="number" min="0"
                          value={l.invoice_qty}
                          onChange={e => updateLine(item.id, 'invoice_qty', parseInt(e.target.value) || 0)}
                          className="w-16 text-center text-sm border border-amber-300 rounded-lg px-2 py-1 bg-amber-50 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      </div>
                      <span className="col-span-1 text-center text-xs">
                        {variance ? <span className="text-rose-600 font-bold">!</span> : <span className="text-emerald-600">OK</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving || !canSubmit}
                  className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Terima Barang'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Re-run tests to verify they pass**

Run: `npm run test -- ReceiveGoodsModal`
Expected: all three tests PASS.

If `npm run test` is not wired, run via `npx vitest run src/components/pembelian/__tests__/ReceiveGoodsModal.test.tsx`.

- [ ] **Step 5: Smoke through the dev server**

Run: `npm run dev`. Navigate to Pembelian, open a PO with status SENT, click "Terima Barang". Verify:
- Saksi dropdown populated.
- Foto dropzone refuses submit until ≥ 1 file selected.
- Tweaking "Qty Diterima" or "Qty Faktur" away from "Dipesan" flashes the rose banner.
- Submit success toast appears after backend round-trip.

- [ ] **Step 6: Commit**

```bash
git add src/components/pembelian/ReceiveGoodsModal.tsx src/components/pembelian/__tests__/ReceiveGoodsModal.test.tsx
git commit -m "feat(pembelian): ReceiveGoodsModal — saksi + foto + 3-way match UI (Phase 3a)"
```

---

## Task 9: Atomicity smoke — failed receipt rolls back stock + ledger

**Files:**
- Modify: `backend-go/internal/db/po_receipts_test.go`

- [ ] **Step 1: Write test that forces a mid-RPC failure**

Append:
```go
func TestReceivePO_3Way_RollbackOnInvalidPOLine(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	po := db.SeedPurchaseOrder(t, client, []db.POLine{
		{ID: 901, SKU: "TEST-PR-RB", OrderedQty: 4, UnitPrice: 1000},
	})
	receiver := db.SeedAdminUser(t, client, "rcv-rb")
	witness  := db.SeedAdminUser(t, client, "wit-rb")

	var stockBefore int
	client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-PR-RB'`).Scan(&stockBefore)
	ledgerBefore := db.CountStockMovements(t, client, "TEST-PR-RB")

	// Reference an invalid po_line_id (99999) → RAISE EXCEPTION mid-loop
	_, err := client.Exec(context.Background(),
		`SELECT public.receive_purchase_order(
		   p_po_id=>$1, p_warehouse=>'atas',
		   p_payment_amount=>0::numeric, p_payment_method=>'cash',
		   p_received_by_user_id=>$2, p_witnessed_by_user_id=>$3,
		   p_photo_urls=>ARRAY['https://x/p.jpg'],
		   p_lines=>$4::jsonb
		 )`,
		po.ID, receiver, witness,
		`[{"po_line_id":901,"received_qty":4,"invoice_qty":4},
		  {"po_line_id":99999,"received_qty":1,"invoice_qty":1}]`)
	if err == nil {
		t.Fatalf("expected error, got nil")
	}

	var stockAfter int
	client.QueryRow(context.Background(),
		`SELECT stock_atas FROM public.stocks WHERE sku='TEST-PR-RB'`).Scan(&stockAfter)
	if stockAfter != stockBefore {
		t.Fatalf("stock should not have changed: before=%d after=%d", stockBefore, stockAfter)
	}
	ledgerAfter := db.CountStockMovements(t, client, "TEST-PR-RB")
	if ledgerAfter != ledgerBefore {
		t.Fatalf("ledger row leaked: before=%d after=%d", ledgerBefore, ledgerAfter)
	}

	// Receipt header should also not exist
	var n int
	client.QueryRow(context.Background(),
		`SELECT count(*) FROM public.purchase_order_receipts WHERE po_id=$1`, po.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("receipt header leaked: %d rows", n)
	}
}
```

- [ ] **Step 2: Run test**

Run: `cd backend-go && go test ./internal/db/ -run TestReceivePO_3Way_RollbackOnInvalidPOLine -v`
Expected: PASS (Postgres transactionality enforces this; the test is a regression guard).

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/po_receipts_test.go
git commit -m "test(stocks): assert PO receipt RPC failure rolls back stock + ledger + header"
```

---

## Task 10: Manual integration smoke + progress doc

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Bring up local dev environment**

Run: `npm run dev` (frontend) + Go daemon as documented in README.

- [ ] **Step 2: Create a PO and receive it clean**

1. In Pembelian, create a PO with 2 items.
2. Open the receive modal. Pick a saksi. Upload 1 photo.
3. Leave qtys at PO defaults. Submit.
4. `SELECT * FROM purchase_order_receipts WHERE po_id='...'` → 1 row, `has_variance=FALSE`.
5. `SELECT * FROM purchase_order_receipt_lines WHERE receipt_id=...` → 2 rows, `variance_flag=FALSE`.
6. `SELECT * FROM stock_movements WHERE related_doc_id='...'` → 2 rows, source `purchase_receive`.
7. Verify no Owner WA message was sent (daemon log).

- [ ] **Step 3: Create another PO and receive with variance**

1. Repeat above but enter `received_qty=ordered-1` on one line.
2. Submit. Toast should mention "ADA SELISIH".
3. `has_variance=TRUE` in receipt header.
4. Owner WA message arrives within 30s. Daemon log shows `pg_notify` → POST → WA send.

- [ ] **Step 4: Update progress.md (per CLAUDE.md GOTCHA)**

Open `progress.md`. Add an entry under the current date for "Phase 3a — Penerimaan PO with 2-person + 3-way match — DONE", linking to this plan and the three migrations.

- [ ] **Step 5: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Phase 3a Penerimaan PO shipped"
```

---

## Self-Review Checklist

Run through this before declaring Phase 3a done:

- [ ] All three migrations (`20260607000020`, `20260607000021`, `20260607000022`) apply cleanly on a fresh database.
- [ ] All Go tests in `internal/db/` for `TestPOReceipts_*` and `TestReceivePO_3Way_*` and `TestStockEvidenceBucket_*` pass.
- [ ] `internal/webhooks/` tests pass; daemon LISTEN loop boots without error.
- [ ] Phase 1 regression test `TestReceivePO_WritesLedgerRowPerLine` still passes (one ledger row per line, source `purchase_receive`).
- [ ] Direct `INSERT` into `purchase_order_receipts` with `witnessed_by_user_id = received_by_user_id` raises (CHECK).
- [ ] Direct `INSERT` into `purchase_order_receipts` with empty `photo_urls` raises (CHECK).
- [ ] `purchase_order_receipts.has_variance` is set correctly inside the RPC for both clean and mismatched receipts (verified by Task 4 tests).
- [ ] Inserting a second receipt for the same `po_id` raises (UNIQUE).
- [ ] `stock-evidence` bucket exists; `po-receipts/<po_id>/` uploads succeed from authenticated client.
- [ ] Modal submit button stays disabled until witness + ≥ 1 photo + all qty fields populated.
- [ ] Variance banner appears whenever any line shows `ordered ≠ received` OR `received ≠ invoice`.
- [ ] On variance, Owner WA receives a message with the line-level breakdown.
- [ ] On variance, receipt still commits (mismatch alerts; does not block).
- [ ] PO status transitions to `RECEIVED` and `received_at` is set.
- [ ] Failure mid-RPC rolls back stocks, stock_lots, ledger, receipt header, AND receipt lines.
- [ ] `progress.md` updated with Phase 3a DONE entry.

## Out of Scope (Phase 3a)

- Partial receipt of a single PO across multiple sessions (current model: one receipt = one PO closed; `UNIQUE(po_id)` enforces this).
- Supplier-side electronic invoice integration / EDI.
- Auto-OCR of supplier invoice photo to extract qty.
- Owner approval flow for variance (variance triggers alert only; receipt commits regardless — formal correction goes through Phase 2's `request_adjustment`).
- Multi-witness receipts (1 witness sufficient).
- Photo deletion / replacement after receipt commits (Owner can file a stock_adjustment via Phase 2 if a correction is needed).
- Per-line photo attachment (photos are receipt-level only).
- Voiding a committed receipt (out-of-scope; correction via Phase 2 adjustment with `reason_code='koreksi_input'`).
- Damage-tracking flow from the legacy modal (`qty_damaged` + `damage_notes` removed; damage now goes through Phase 2 `request_adjustment` with `reason_code='rusak'` after receipt).
