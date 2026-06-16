# Order Confirmation & Fulfillment Revamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current fragmented order management UX (Sales Inbox → Penjualan>Riwayat with no shared state) with a single funnel-driven Pesanan Aktif tab inside Penjualan, plus auto-generated SO/Invoice/Surat Jalan PDFs, full lifecycle from PROCESSING through customer confirmation, channel-aware Input Baru wizard, and Pengaturan additions for store info + bank accounts.

**Architecture:** Universal `order_status` enum (additive migration) drives a 6-stage funnel UI. Stock decrements at payment-verification (not approval) via atomic Postgres RPC. PDFs generated server-side in Go (chromedp HTML-to-PDF for layout fidelity), stored in Supabase storage, attached to WA messages for chat channels or printed at counter for offline channels. A single `<OrderActionPanel>` React component renders per-status actions and is reused inside both the Inbox quick-action card and the Pesanan Aktif drawer.

**Tech Stack:** Go 1.26 (backend, scheduler, PDF), React 18 + TypeScript + Vite (frontend), Supabase PostgreSQL (DB, storage, realtime), whatsmeow (WA delivery), chromedp (HTML→PDF rendering).

**Reference spec:** `docs/superpowers/specs/2026-06-15-order-confirmation-fulfillment-revamp-design.md` — read sections 3 (state machine), 5 (Pengaturan), 6 (PDF layouts), 7 (WA templates), 9 (data model) before starting each task.

**Branch:** Work on `feat/calista-phase-1a` (already on remote). All tasks commit there; merge to `main` only after Phase 1A acceptance criteria pass.

**Verification:** After each Phase, run the end-to-end smoke at the end of that phase's task list before moving to the next phase.

---

## File Structure

### Backend (Go)

| File | Status | Responsibility |
|---|---|---|
| `backend-go/internal/models/types.go` | Modify | Add new order_status string constants and helpers (IsTerminal, IsPaid, etc.) |
| `backend-go/internal/db/orders.go` | Modify | Add status-transition query helpers |
| `backend-go/internal/db/inventory.go` | Create | RPC wrappers for stock reservation / restock |
| `backend-go/internal/db/store_settings.go` | Create | CRUD for store_settings + store_bank_accounts |
| `backend-go/internal/db/order_modifications.go` | Create | Audit log inserts |
| `backend-go/internal/db/numbering.go` | Create | Document numbering counters with annual reset |
| `backend-go/internal/orders/lifecycle.go` | Create | Business logic for state transitions (Approve, Verify, MarkReady, MarkDispatched, MarkReceived) |
| `backend-go/internal/orders/modifications.go` | Create | Order edit logic + diff for audit |
| `backend-go/internal/orders/stuck_alerts.go` | Create | Cron job for stuck-order detection |
| `backend-go/internal/pdf/render.go` | Create | chromedp HTML→PDF helper |
| `backend-go/internal/pdf/templates/common.html` | Create | Common header + footer template |
| `backend-go/internal/pdf/templates/sales_order.html` | Create | SO HTML template |
| `backend-go/internal/pdf/templates/invoice_dp.html` | Create | Invoice DP HTML |
| `backend-go/internal/pdf/templates/invoice_final.html` | Create | Invoice Pelunasan / Lunas HTML |
| `backend-go/internal/pdf/templates/invoice_tempo.html` | Create | Invoice Tempo HTML |
| `backend-go/internal/pdf/templates/surat_jalan.html` | Create | Surat Jalan HTML |
| `backend-go/internal/pdf/dotmatrix.go` | Create | Plain-text dot matrix format for Invoice + Surat Jalan |
| `backend-go/internal/whatsapp/order_notify.go` | Create | Send WA + attach PDF for order state transitions |
| `backend-go/internal/whatsapp/templates_orders.go` | Create | 10 template strings + variable interpolation |
| `backend-go/internal/whatsapp/handler.go` | Modify | Wire confirmation parser for AWAITING_CUSTOMER_CONFIRMATION state |
| `backend-go/internal/api/orders.go` | Modify | New endpoints: edit, mark-ready, mark-dispatched, mark-received |
| `backend-go/internal/api/store_settings.go` | Create | HTTP handlers for Pengaturan UI |
| `backend-go/main.go` | Modify | Wire stuck-alert cron, new HTTP routes |

### Database (Supabase migrations)

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260615000002_order_fulfillment_lifecycle.sql` | Create | All enum additions, columns, new tables |
| `supabase/migrations/20260615000003_order_rpcs.sql` | Create | Atomic RPCs: `verify_payment_with_stock`, `restock_cancelled_order` |
| `supabase/migrations/20260615000004_seed_store_settings.sql` | Create | Seed initial row in store_settings (so Pengaturan UI has something to read) |

### Frontend (React/TypeScript)

| File | Status | Responsibility |
|---|---|---|
| `src/types/orders.ts` | Modify | Extend Order type with new status values + new fields |
| `src/lib/supabaseClient.ts` | Modify | Add wrappers: editOrder, markReady, markDispatched, markReceived, etc. |
| `src/hooks/usePesananAktif.ts` | Create | Realtime subscription + funnel data fetch |
| `src/hooks/useOrderActions.ts` | Create | Mutations for order lifecycle |
| `src/hooks/useStoreSettings.ts` | Create | Fetch + update store settings |
| `src/components/penjualan/PesananAktifTab.tsx` | Create | Funnel view container |
| `src/components/penjualan/FunnelControls.tsx` | Create | Search + channel + date + sort top bar |
| `src/components/penjualan/funnel/StageHeader.tsx` | Create | Stage header with summary metrics |
| `src/components/penjualan/funnel/StageRow.tsx` | Create | One order row inside a stage |
| `src/components/penjualan/funnel/Stage1Bertanya.tsx` | Create | Conversation rows |
| `src/components/penjualan/funnel/Stage2KonfirmasiTungguBayar.tsx` | Create | |
| `src/components/penjualan/funnel/Stage3Diproses.tsx` | Create | With tempo badge |
| `src/components/penjualan/funnel/Stage4DikirimSiapDiambil.tsx` | Create | |
| `src/components/penjualan/funnel/Stage5Diterima.tsx` | Create | With pagination |
| `src/components/penjualan/funnel/Stage6DibatalkanDitolak.tsx` | Create | |
| `src/components/orders/OrderActionPanel.tsx` | Create | Shared per-status action UI |
| `src/components/orders/OrderDetailDrawer.tsx` | Create | Drawer wrapping OrderActionPanel for Pesanan Aktif |
| `src/components/orders/EditOrderModal.tsx` | Create | Order modification with reason field |
| `src/components/orders/PrintFormatPicker.tsx` | Create | A4 vs Dot Matrix picker |
| `src/components/inputbaru/InputBaruWizard.tsx` | Create | 3-step wizard root |
| `src/components/inputbaru/Step1KanalPelanggan.tsx` | Create | |
| `src/components/inputbaru/Step2ItemsPembayaran.tsx` | Create | Search + Jasa Rakit + Jasa Custom Panel preserved |
| `src/components/inputbaru/Step3FulfillmentSave.tsx` | Create | Status preview + smart save button |
| `src/components/pengaturan/AlamatTokoSection.tsx` | Create | Store address + Google Maps required |
| `src/components/pengaturan/JamOperasionalSection.tsx` | Create | Per-day toggle + holidays |
| `src/components/pengaturan/RekeningBankSection.tsx` | Create | Multi-bank list |
| `src/components/dashboard/StuckOrdersWidget.tsx` | Create | 5-category stuck order summary |
| `src/components/SalesInboxScreen.tsx` | Modify | Update Buka Detail button URL to `/penjualan?tab=pesanan-aktif&order={id}` |
| `src/components/PenjualanScreen.tsx` | Modify | Replace Riwayat tab with Pesanan Aktif tab; use InputBaruWizard instead of PenjualanBaruScreen |
| `src/components/OrderHistoryScreen.tsx` | DELETE in Phase 1C | Superseded by Pesanan Aktif funnel; verify no other imports |
| `src/components/PenjualanBaruScreen.tsx` | DELETE in Phase 1C | Replaced by InputBaruWizard |
| `src/App.tsx` | Modify | Route param handling for `?tab=pesanan-aktif&order={id}` |

---

# PHASE 1A — Foundation + Inventory (2 weeks)

Goal: data model, funnel UI, state machine code, stock reservation, order modification, realtime.

## Task 1: Migration — order_status enum additions

**Files:**
- Create: `supabase/migrations/20260615000002_order_fulfillment_lifecycle.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 20260615000002_order_fulfillment_lifecycle.sql

-- 1. Order status enum additions (idempotent)
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY_AWAITING_PAYMENT';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DISPATCHED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'AWAITING_CUSTOMER_CONFIRMATION';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ASSUMED_COMPLETED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DELIVERY_ISSUE';
```

- [ ] **Step 2: Apply to dev DB via Supabase management API**

Run:
```bash
SUPABASE_TOKEN="<token>"
PROJECT_REF="ekhhojaezdfjfwuxyjkl"
for STMT in \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PROCESSING'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY_AWAITING_PAYMENT'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DISPATCHED'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'AWAITING_CUSTOMER_CONFIRMATION'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ASSUMED_COMPLETED'" \
  "ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DELIVERY_ISSUE'"; do
  curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"$STMT\"}"
done
```

Expected: each request returns `[]` (success).

- [ ] **Step 3: Verify enum values present**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT unnest(enum_range(NULL::order_status))"}'
```

Expected output includes all 7 new values.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000002_order_fulfillment_lifecycle.sql
git commit -m "feat(migration): add fulfillment lifecycle states to order_status enum"
```

---

## Task 2: Migration — orders columns + audit/settings tables

**Files:**
- Modify: `supabase/migrations/20260615000002_order_fulfillment_lifecycle.sql`

- [ ] **Step 1: Append to migration file**

Append this to `20260615000002_order_fulfillment_lifecycle.sql`:

```sql
-- 2. New columns on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_order_ref TEXT,
  ADD COLUMN IF NOT EXISTS courier_tracking_link TEXT,
  ADD COLUMN IF NOT EXISTS customer_confirm_source TEXT,
  ADD COLUMN IF NOT EXISTS customer_confirm_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_issue_reason TEXT,
  ADD COLUMN IF NOT EXISTS delivery_issue_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_order_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS sales_order_revision INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS invoice_dp_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_final_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS surat_jalan_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS surat_jalan_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_decremented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_restocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stuck_alert_at TIMESTAMPTZ;

-- 3. Order modifications audit table
CREATE TABLE IF NOT EXISTS order_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  modified_by_user_id UUID,
  modification_type TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_modifications_order_id ON order_modifications(order_id);

-- 4. Store settings
CREATE TABLE IF NOT EXISTS store_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL,
  logo_url TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  store_phone TEXT NOT NULL,
  gmaps_link TEXT NOT NULL,
  parking_info TEXT,
  pickup_notes TEXT,
  operational_hours JSONB,
  holidays_overrides DATE[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Store bank accounts
CREATE TABLE IF NOT EXISTS store_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Document numbering counters
CREATE TABLE IF NOT EXISTS doc_number_counters (
  doc_type TEXT PRIMARY KEY,
  current_year INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0
);

INSERT INTO doc_number_counters (doc_type, current_year, last_number) VALUES
  ('sales_order', EXTRACT(YEAR FROM NOW())::INT, 0),
  ('invoice',     EXTRACT(YEAR FROM NOW())::INT, 0),
  ('invoice_dp',  EXTRACT(YEAR FROM NOW())::INT, 0),
  ('surat_jalan', EXTRACT(YEAR FROM NOW())::INT, 0)
ON CONFLICT (doc_type) DO NOTHING;
```

- [ ] **Step 2: Apply to dev DB**

Loop the SQL above through Supabase management API one statement at a time (CREATE TABLE statements can run in one go each):

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"<paste each statement>\"}"
```

- [ ] **Step 3: Verify tables exist**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT table_name FROM information_schema.tables WHERE table_name IN ('\''order_modifications'\'', '\''store_settings'\'', '\''store_bank_accounts'\'', '\''doc_number_counters'\'')"}'
```

Expected: 4 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000002_order_fulfillment_lifecycle.sql
git commit -m "feat(migration): add orders columns + audit + store settings tables"
```

---

## Task 3: Migration — RPCs for atomic stock operations

**Files:**
- Create: `supabase/migrations/20260615000003_order_rpcs.sql`

- [ ] **Step 1: Write the RPCs**

```sql
-- 20260615000003_order_rpcs.sql

-- verify_payment_with_stock(order_id, verified_by)
-- Atomically: check stock for all order items, decrement, update status to PAYMENT_VERIFIED
-- Returns: {success: bool, error: text|null, insufficient_skus: jsonb}
CREATE OR REPLACE FUNCTION verify_payment_with_stock(
  p_order_id UUID,
  p_verified_by TEXT
) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
  v_sku TEXT;
  v_qty INT;
  v_stock_available INT;
  v_insufficient JSONB := '[]'::jsonb;
BEGIN
  -- Lock order row
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.status NOT IN ('PAYMENT_UPLOADED', 'DP_UPLOADED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_status');
  END IF;

  -- Check stock for all items (using stock_atas from stocks table)
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::INT;
    SELECT stock_atas INTO v_stock_available FROM stocks WHERE sku = v_sku FOR UPDATE;
    IF v_stock_available IS NULL OR v_stock_available < v_qty THEN
      v_insufficient := v_insufficient || jsonb_build_object(
        'sku', v_sku,
        'requested', v_qty,
        'available', COALESCE(v_stock_available, 0)
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_insufficient) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'stock_insufficient',
      'insufficient_skus', v_insufficient
    );
  END IF;

  -- All stock available — decrement
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_sku := v_item->>'sku';
    v_qty := (v_item->>'qty')::INT;
    UPDATE stocks SET stock_atas = stock_atas - v_qty WHERE sku = v_sku;
  END LOOP;

  -- Update order status
  UPDATE orders SET
    status = CASE WHEN v_order.status = 'DP_UPLOADED' THEN 'DP_VERIFIED' ELSE 'PAYMENT_VERIFIED' END,
    payment_verified_at = NOW(),
    verified_by = p_verified_by,
    stock_decremented_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- restock_cancelled_order(order_id)
-- Reverses stock decrement if order is cancelled after stock was deducted
CREATE OR REPLACE FUNCTION restock_cancelled_order(p_order_id UUID) RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_item JSONB;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;
  IF v_order.stock_decremented_at IS NULL THEN
    RETURN jsonb_build_object('success', true, 'note', 'no_stock_to_restock');
  END IF;
  IF v_order.stock_restocked_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_restocked');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    UPDATE stocks SET stock_atas = stock_atas + (v_item->>'qty')::INT
      WHERE sku = v_item->>'sku';
  END LOOP;

  UPDATE orders SET stock_restocked_at = NOW() WHERE id = p_order_id;
  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION verify_payment_with_stock(UUID, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION restock_cancelled_order(UUID) TO authenticated, anon;
```

- [ ] **Step 2: Apply RPCs via management API**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -Rs '{query: .}' < supabase/migrations/20260615000003_order_rpcs.sql)"
```

- [ ] **Step 3: Smoke test RPC with an existing PAYMENT_UPLOADED order**

```bash
# Find one
curl -s ... -d '{"query":"SELECT id FROM orders WHERE status = '\''PAYMENT_UPLOADED'\'' LIMIT 1"}'
# Call
curl -s ... -d '{"query":"SELECT verify_payment_with_stock('\''<id>'\'', '\''test'\'')"}'
```

Expected: `{"success": true}` or `{"success": false, "error": "stock_insufficient", ...}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260615000003_order_rpcs.sql
git commit -m "feat(migration): atomic verify_payment_with_stock + restock_cancelled_order RPCs"
```

---

## Task 4: Seed initial store_settings

**Files:**
- Create: `supabase/migrations/20260615000004_seed_store_settings.sql`

- [ ] **Step 1: Write seed migration**

```sql
-- 20260615000004_seed_store_settings.sql
-- Seed default store_settings row so Pengaturan UI has something to read

INSERT INTO store_settings (
  store_name, address, city, store_phone, gmaps_link,
  operational_hours
) VALUES (
  'Sinar Elektrik',
  'Jl. [TBD by founder via Pengaturan UI]',
  'Surabaya',
  '085264787775',
  'https://maps.google.com/?q=[TBD]',
  '{"monday":{"open":"08:00","close":"17:00"},"tuesday":{"open":"08:00","close":"17:00"},"wednesday":{"open":"08:00","close":"17:00"},"thursday":{"open":"08:00","close":"17:00"},"friday":{"open":"08:00","close":"17:00"},"saturday":{"open":"08:00","close":"17:00"},"sunday":null}'::jsonb
) ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply + verify**

Apply via management API, then query:
```bash
curl -s ... -d '{"query":"SELECT store_name, store_phone, operational_hours FROM store_settings LIMIT 1"}'
```

Expected: one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615000004_seed_store_settings.sql
git commit -m "feat(migration): seed initial store_settings row"
```

---

## Task 5: Backend — extend order_status constants

**Files:**
- Modify: `backend-go/internal/models/types.go`

- [ ] **Step 1: Add new ConversationState constants — wait, these are ORDER status**

Check `models/types.go` for OrderStatus declarations:
```bash
grep -n "OrderStatus\|order_status" backend-go/internal/models/types.go
```

- [ ] **Step 2: Add new OrderStatus constants**

In `backend-go/internal/models/types.go`, find the OrderStatus type and add:

```go
const (
    // ... existing constants ...
    StatusProcessing                  OrderStatus = "PROCESSING"
    StatusReadyAwaitingPayment        OrderStatus = "READY_AWAITING_PAYMENT"
    StatusReady                       OrderStatus = "READY"
    StatusDispatched                  OrderStatus = "DISPATCHED"
    StatusAwaitingCustomerConfirmation OrderStatus = "AWAITING_CUSTOMER_CONFIRMATION"
    StatusAssumedCompleted            OrderStatus = "ASSUMED_COMPLETED"
    StatusDeliveryIssue               OrderStatus = "DELIVERY_ISSUE"
)

// IsActivelyFulfillable returns true for statuses that should show in funnel stages 3-4
func (s OrderStatus) IsActivelyFulfillable() bool {
    switch s {
    case StatusProcessing, StatusReadyAwaitingPayment, StatusReady,
         StatusDispatched, StatusAwaitingCustomerConfirmation, StatusDeliveryIssue:
        return true
    }
    return false
}

// IsTerminal returns true for completed/cancelled statuses
func (s OrderStatus) IsTerminal() bool {
    switch s {
    case StatusCompleted, StatusAssumedCompleted,
         StatusCancelled, StatusPaymentRejected, StatusDpProofRejected:
        return true
    }
    return false
}
```

- [ ] **Step 3: Build to verify no syntax errors**

```bash
cd backend-go && go build ./...
```

Expected: exit 0.

- [ ] **Step 4: Write test for new helpers**

Create `backend-go/internal/models/types_test.go` (or append if exists):

```go
package models

import "testing"

func TestOrderStatus_IsActivelyFulfillable(t *testing.T) {
    cases := []struct {
        status OrderStatus
        want   bool
    }{
        {StatusProcessing, true},
        {StatusReady, true},
        {StatusDispatched, true},
        {StatusCompleted, false},
        {StatusPending, false},
    }
    for _, c := range cases {
        if got := c.status.IsActivelyFulfillable(); got != c.want {
            t.Errorf("IsActivelyFulfillable(%q) = %v, want %v", c.status, got, c.want)
        }
    }
}
```

- [ ] **Step 5: Run test**

```bash
cd backend-go && go test ./internal/models/ -run TestOrderStatus -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/models/types.go backend-go/internal/models/types_test.go
git commit -m "feat(models): add fulfillment lifecycle OrderStatus constants + helpers"
```

---

## Task 6: Backend — inventory.go RPC wrappers

**Files:**
- Create: `backend-go/internal/db/inventory.go`
- Test: `backend-go/internal/db/inventory_test.go`

- [ ] **Step 1: Write the RPC wrapper**

`backend-go/internal/db/inventory.go`:

```go
package db

import (
    "context"
    "encoding/json"
    "fmt"
)

type VerifyPaymentResult struct {
    Success           bool             `json:"success"`
    Error             string           `json:"error"`
    InsufficientSkus []map[string]any `json:"insufficient_skus"`
}

func (c *Client) VerifyPaymentWithStock(ctx context.Context, orderID, verifiedBy string) (*VerifyPaymentResult, error) {
    var raw json.RawMessage
    err := c.DB.QueryRowContext(ctx,
        `SELECT verify_payment_with_stock($1, $2)`, orderID, verifiedBy,
    ).Scan(&raw)
    if err != nil {
        return nil, fmt.Errorf("verify_payment_with_stock rpc: %w", err)
    }
    var result VerifyPaymentResult
    if err := json.Unmarshal(raw, &result); err != nil {
        return nil, fmt.Errorf("verify_payment_with_stock parse: %w", err)
    }
    return &result, nil
}

func (c *Client) RestockCancelledOrder(ctx context.Context, orderID string) error {
    var raw json.RawMessage
    err := c.DB.QueryRowContext(ctx,
        `SELECT restock_cancelled_order($1)`, orderID,
    ).Scan(&raw)
    if err != nil {
        return fmt.Errorf("restock_cancelled_order rpc: %w", err)
    }
    var result map[string]any
    if err := json.Unmarshal(raw, &result); err != nil {
        return fmt.Errorf("restock parse: %w", err)
    }
    if success, _ := result["success"].(bool); !success {
        return fmt.Errorf("restock failed: %v", result["error"])
    }
    return nil
}
```

- [ ] **Step 2: Build**

```bash
cd backend-go && go build ./...
```

Expected: exit 0.

- [ ] **Step 3: Commit (tests deferred to integration smoke later)**

```bash
git add backend-go/internal/db/inventory.go
git commit -m "feat(db): VerifyPaymentWithStock + RestockCancelledOrder RPC wrappers"
```

---

## Task 7: Backend — store_settings.go CRUD

**Files:**
- Create: `backend-go/internal/db/store_settings.go`

- [ ] **Step 1: Write the queries**

```go
package db

import (
    "context"
    "encoding/json"
    "time"
)

type StoreSettings struct {
    ID                string                 `json:"id"`
    StoreName         string                 `json:"store_name"`
    LogoURL           *string                `json:"logo_url,omitempty"`
    Address           string                 `json:"address"`
    City              string                 `json:"city"`
    StorePhone        string                 `json:"store_phone"`
    GmapsLink         string                 `json:"gmaps_link"`
    ParkingInfo       *string                `json:"parking_info,omitempty"`
    PickupNotes       *string                `json:"pickup_notes,omitempty"`
    OperationalHours  json.RawMessage        `json:"operational_hours"`
    HolidaysOverrides []time.Time            `json:"holidays_overrides,omitempty"`
}

type StoreBankAccount struct {
    ID            string `json:"id"`
    BankName      string `json:"bank_name"`
    AccountNumber string `json:"account_number"`
    AccountHolder string `json:"account_holder"`
    IsActive      bool   `json:"is_active"`
    DisplayOrder  int    `json:"display_order"`
}

func (c *Client) GetStoreSettings(ctx context.Context) (*StoreSettings, error) {
    var s StoreSettings
    err := c.DB.QueryRowContext(ctx, `
        SELECT id, store_name, logo_url, address, city, store_phone,
               gmaps_link, parking_info, pickup_notes,
               operational_hours, holidays_overrides
        FROM store_settings LIMIT 1
    `).Scan(&s.ID, &s.StoreName, &s.LogoURL, &s.Address, &s.City, &s.StorePhone,
        &s.GmapsLink, &s.ParkingInfo, &s.PickupNotes,
        &s.OperationalHours, &s.HolidaysOverrides)
    if err != nil {
        return nil, err
    }
    return &s, nil
}

func (c *Client) ListActiveBankAccounts(ctx context.Context) ([]StoreBankAccount, error) {
    rows, err := c.DB.QueryContext(ctx, `
        SELECT id, bank_name, account_number, account_holder, is_active, display_order
        FROM store_bank_accounts
        WHERE is_active = TRUE
        ORDER BY display_order, created_at
    `)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var out []StoreBankAccount
    for rows.Next() {
        var b StoreBankAccount
        if err := rows.Scan(&b.ID, &b.BankName, &b.AccountNumber, &b.AccountHolder, &b.IsActive, &b.DisplayOrder); err != nil {
            return nil, err
        }
        out = append(out, b)
    }
    return out, rows.Err()
}
```

- [ ] **Step 2: Build**

```bash
cd backend-go && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/store_settings.go
git commit -m "feat(db): store_settings + bank_accounts read queries"
```

---

## Task 8: Backend — order_modifications.go audit inserts

**Files:**
- Create: `backend-go/internal/db/order_modifications.go`

- [ ] **Step 1: Write insert helper**

```go
package db

import (
    "context"
    "encoding/json"
)

type ModificationType string

const (
    ModOngkir      ModificationType = "ongkir"
    ModCartAdd     ModificationType = "cart_add"
    ModCartRemove  ModificationType = "cart_remove"
    ModCartQty     ModificationType = "cart_qty"
    ModAddress     ModificationType = "address"
    ModCustomer    ModificationType = "customer"
    ModNotes       ModificationType = "notes"
)

func (c *Client) InsertOrderModification(
    ctx context.Context,
    orderID, modifiedBy string,
    modType ModificationType,
    before, after any,
    reason string,
) error {
    beforeJSON, _ := json.Marshal(before)
    afterJSON, _ := json.Marshal(after)
    _, err := c.DB.ExecContext(ctx, `
        INSERT INTO order_modifications
            (order_id, modified_by_user_id, modification_type, before_value, after_value, reason)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, orderID, modifiedBy, string(modType), beforeJSON, afterJSON, reason)
    return err
}
```

- [ ] **Step 2: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/db/order_modifications.go
git commit -m "feat(db): order_modifications audit insert helper"
```

---

## Task 9: Backend — orders/lifecycle.go state machine business logic

**Files:**
- Create: `backend-go/internal/orders/lifecycle.go`

- [ ] **Step 1: Write the lifecycle functions**

```go
package orders

import (
    "context"
    "fmt"
    "github.com/username/sinar-elektrik-backend/internal/db"
    "github.com/username/sinar-elektrik-backend/internal/models"
)

type Service struct {
    DB *db.Client
}

func NewService(dbClient *db.Client) *Service {
    return &Service{DB: dbClient}
}

// Approve transitions PENDING_ADMIN_CONFIRMATION → APPROVED → WAITING_PAYMENT
func (s *Service) Approve(ctx context.Context, orderID string, shippingFee float64, paymentType string, verifiedBy string) error {
    _, err := s.DB.DB.ExecContext(ctx, `
        UPDATE orders SET
            shipping_fee = $1,
            payment_type = $2,
            status = 'APPROVED',
            approved_at = NOW(),
            total = subtotal + $1
        WHERE id = $3 AND status = 'PENDING_ADMIN_CONFIRMATION'
    `, shippingFee, paymentType, orderID)
    return err
}

// VerifyPayment uses RPC to atomically check stock + decrement + update status
func (s *Service) VerifyPayment(ctx context.Context, orderID, verifiedBy string) (*db.VerifyPaymentResult, error) {
    return s.DB.VerifyPaymentWithStock(ctx, orderID, verifiedBy)
}

// MarkReady advances PROCESSING → READY (if fully paid) or READY_AWAITING_PAYMENT (if DP only)
func (s *Service) MarkReady(ctx context.Context, orderID string, courierLink string) (newStatus models.OrderStatus, err error) {
    var current models.OrderStatus
    var paymentType string
    var dpAmount, total float64
    err = s.DB.DB.QueryRowContext(ctx,
        `SELECT status, payment_type, COALESCE(dp_amount, 0), total FROM orders WHERE id = $1`,
        orderID,
    ).Scan(&current, &paymentType, &dpAmount, &total)
    if err != nil {
        return "", err
    }
    if current != models.StatusProcessing {
        return "", fmt.Errorf("can only mark ready from PROCESSING, current = %s", current)
    }

    fullyPaid := paymentType == "FULL" || (paymentType == "DP" && dpAmount >= total)
    newStatus = models.StatusReady
    if !fullyPaid {
        newStatus = models.StatusReadyAwaitingPayment
    }

    _, err = s.DB.DB.ExecContext(ctx, `
        UPDATE orders SET status = $1, courier_tracking_link = $2 WHERE id = $3
    `, string(newStatus), courierLink, orderID)
    return newStatus, err
}

// MarkDispatched advances READY → DISPATCHED → AWAITING_CUSTOMER_CONFIRMATION
func (s *Service) MarkDispatched(ctx context.Context, orderID string) error {
    _, err := s.DB.DB.ExecContext(ctx, `
        UPDATE orders SET
            status = 'AWAITING_CUSTOMER_CONFIRMATION',
            dispatched_at = NOW()
        WHERE id = $1 AND status = 'READY'
    `, orderID)
    return err
}

// MarkReceived transitions to COMPLETED
func (s *Service) MarkReceived(ctx context.Context, orderID, source, by string) error {
    _, err := s.DB.DB.ExecContext(ctx, `
        UPDATE orders SET
            status = 'COMPLETED',
            customer_confirm_source = $2,
            customer_confirm_at = NOW(),
            verified_by = COALESCE($3, verified_by)
        WHERE id = $1
    `, orderID, source, by)
    return err
}

// Cancel transitions to CANCELLED + restocks if needed
func (s *Service) Cancel(ctx context.Context, orderID, reason, cancelledBy string) error {
    if err := s.DB.RestockCancelledOrder(ctx, orderID); err != nil {
        return fmt.Errorf("restock: %w", err)
    }
    _, err := s.DB.DB.ExecContext(ctx, `
        UPDATE orders SET status = 'CANCELLED' WHERE id = $1
    `, orderID)
    return err
}
```

- [ ] **Step 2: Build**

```bash
cd backend-go && go build ./...
```

- [ ] **Step 3: Write test for MarkReady decision branch**

`backend-go/internal/orders/lifecycle_test.go`:

```go
package orders

import (
    "testing"
    "github.com/username/sinar-elektrik-backend/internal/models"
)

// TODO when DB testkit available; for now placeholder smoke
func TestMarkReady_LogicalBranch(t *testing.T) {
    // Fully paid → StatusReady
    // DP only → StatusReadyAwaitingPayment
    // (Real DB test deferred to integration suite)
    t.Skip("requires DB testkit")
}
```

- [ ] **Step 4: Build + commit**

```bash
cd backend-go && go build ./... && go test ./internal/orders/ 2>&1 | tail -3
git add backend-go/internal/orders/lifecycle.go backend-go/internal/orders/lifecycle_test.go
git commit -m "feat(orders): lifecycle service Approve/VerifyPayment/MarkReady/Dispatched/Received/Cancel"
```

---

## Task 10: Backend — orders/modifications.go edit business logic

**Files:**
- Create: `backend-go/internal/orders/modifications.go`

- [ ] **Step 1: Write the modification handlers**

```go
package orders

import (
    "context"
    "fmt"
    "github.com/username/sinar-elektrik-backend/internal/db"
    "github.com/username/sinar-elektrik-backend/internal/models"
)

type EditRequest struct {
    OrderID      string
    ModifiedBy   string
    NewShippingFee *float64
    NewAddress     *string
    NewItems       []models.OrderItem  // if non-nil, replace cart
    Reason         string              // required
}

func (s *Service) EditOrder(ctx context.Context, req EditRequest) error {
    if req.Reason == "" {
        return fmt.Errorf("reason required for order modification")
    }

    var current models.OrderStatus
    var oldShipping float64
    var oldAddress string
    var oldItemsJSON []byte
    err := s.DB.DB.QueryRowContext(ctx,
        `SELECT status, shipping_fee, customer_address, items FROM orders WHERE id = $1`,
        req.OrderID,
    ).Scan(&current, &oldShipping, &oldAddress, &oldItemsJSON)
    if err != nil {
        return err
    }
    if current == models.StatusDispatched ||
        current == models.StatusAwaitingCustomerConfirmation ||
        current.IsTerminal() {
        return fmt.Errorf("order frozen at status %s; cancel + recreate instead", current)
    }

    // Update ongkir
    if req.NewShippingFee != nil && *req.NewShippingFee != oldShipping {
        _, err = s.DB.DB.ExecContext(ctx,
            `UPDATE orders SET shipping_fee = $1, total = subtotal + $1 WHERE id = $2`,
            *req.NewShippingFee, req.OrderID,
        )
        if err != nil {
            return err
        }
        if err := s.DB.InsertOrderModification(ctx, req.OrderID, req.ModifiedBy,
            db.ModOngkir, oldShipping, *req.NewShippingFee, req.Reason); err != nil {
            return err
        }
    }

    if req.NewAddress != nil && *req.NewAddress != oldAddress {
        _, err = s.DB.DB.ExecContext(ctx,
            `UPDATE orders SET customer_address = $1 WHERE id = $2`,
            *req.NewAddress, req.OrderID,
        )
        if err != nil {
            return err
        }
        if err := s.DB.InsertOrderModification(ctx, req.OrderID, req.ModifiedBy,
            db.ModAddress, oldAddress, *req.NewAddress, req.Reason); err != nil {
            return err
        }
    }

    // Item edits + SO regeneration handled in Phase 1B
    return nil
}
```

- [ ] **Step 2: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/orders/modifications.go
git commit -m "feat(orders): EditOrder with audit log; ongkir + address paths in this commit"
```

---

## Task 11: Frontend — extend Order type

**Files:**
- Modify: `src/types/orders.ts`

- [ ] **Step 1: Find existing type**

```bash
grep -n "type Order\|interface Order\|OrderStatus\|status.*COMPLETED" src/types/orders.ts | head -10
```

- [ ] **Step 2: Add new status values + fields**

Add to OrderStatus union/enum:

```typescript
export type OrderStatus =
  | 'PENDING_ADMIN_CONFIRMATION'
  | 'APPROVED'
  | 'WAITING_PAYMENT'
  | 'PAYMENT_UPLOADED'
  | 'DP_UPLOADED'
  | 'PAYMENT_VERIFIED'
  | 'DP_VERIFIED'
  | 'PROCESSING'                       // NEW
  | 'READY_AWAITING_PAYMENT'           // NEW
  | 'READY'                            // NEW
  | 'DISPATCHED'                       // NEW
  | 'AWAITING_CUSTOMER_CONFIRMATION'   // NEW
  | 'ASSUMED_COMPLETED'                // NEW
  | 'DELIVERY_ISSUE'                   // NEW
  | 'COMPLETED'
  | 'CANCELLED'
  | 'PAYMENT_REJECTED'
  | 'DP_PROOF_REJECTED';

export interface Order {
  // ... existing fields ...
  external_order_ref?: string | null;
  courier_tracking_link?: string | null;
  customer_confirm_source?: 'ai' | 'manual' | 'auto_timer' | 'marketplace_api' | null;
  customer_confirm_at?: string | null;
  dispatched_at?: string | null;
  delivery_issue_reason?: string | null;
  sales_order_pdf_url?: string | null;
  sales_order_revision?: number | null;
  invoice_dp_pdf_url?: string | null;
  invoice_final_pdf_url?: string | null;
  surat_jalan_pdf_url?: string | null;
  stock_decremented_at?: string | null;
  stock_restocked_at?: string | null;
  stuck_alert_at?: string | null;
}

// Helper: funnel stage mapping
export function stageOfOrder(o: Order): 2 | 3 | 4 | 5 | 6 | null {
  if (['PENDING_ADMIN_CONFIRMATION','WAITING_PAYMENT','PAYMENT_UPLOADED','DP_UPLOADED'].includes(o.status)) return 2;
  if (['DP_VERIFIED','PAYMENT_VERIFIED','PROCESSING','READY_AWAITING_PAYMENT'].includes(o.status)) return 3;
  if (['READY','DISPATCHED','AWAITING_CUSTOMER_CONFIRMATION','DELIVERY_ISSUE'].includes(o.status)) return 4;
  if (['COMPLETED','ASSUMED_COMPLETED'].includes(o.status)) return 5;
  if (['CANCELLED','PAYMENT_REJECTED','DP_PROOF_REJECTED'].includes(o.status)) return 6;
  return null;
}
```

- [ ] **Step 3: TypeScript compile**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/orders.ts
git commit -m "feat(types): extend Order with fulfillment lifecycle fields + stageOfOrder helper"
```

---

## Task 12: Frontend — supabaseClient action wrappers

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add new RPC wrappers**

Append to `orderService` object in `src/lib/supabaseClient.ts`:

```typescript
  async verifyPaymentWithStock(orderId: string, verifiedBy: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('verify_payment_with_stock', {
      p_order_id: orderId,
      p_verified_by: verifiedBy,
    });
    if (error) throw error;
    return data as { success: boolean; error?: string; insufficient_skus?: any[] };
  },

  async restockCancelledOrder(orderId: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('restock_cancelled_order', { p_order_id: orderId });
    if (error) throw error;
    return data;
  },

  async editOrder(orderId: string, edits: {
    shipping_fee?: number;
    customer_address?: string;
  }, reason: string, modifiedBy: string) {
    if (!supabase) throw new Error('Supabase not configured');
    // Direct UPDATE; audit insert handled by Postgres trigger in Phase 1B
    const { error } = await supabase
      .from('orders')
      .update(edits)
      .eq('id', orderId);
    if (error) throw error;
    // Insert audit row
    await supabase.from('order_modifications').insert({
      order_id: orderId,
      modified_by_user_id: modifiedBy,
      modification_type: edits.shipping_fee !== undefined ? 'ongkir' : 'address',
      before_value: {}, // PR review note: enrich with old value via prior SELECT
      after_value: edits,
      reason,
    });
  },

  async markOrderReady(orderId: string, courierLink: string) {
    if (!supabase) throw new Error('Supabase not configured');
    // Status decision computed server-side via dedicated RPC in Phase 1B; for now use client-determined
    // Read current state to compute target
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('payment_type, dp_amount, total')
      .eq('id', orderId)
      .single();
    if (fetchErr) throw fetchErr;
    const fullyPaid =
      order.payment_type === 'FULL' ||
      (order.payment_type === 'DP' && (order.dp_amount ?? 0) >= order.total);
    const newStatus = fullyPaid ? 'READY' : 'READY_AWAITING_PAYMENT';
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, courier_tracking_link: courierLink || null })
      .eq('id', orderId);
    if (error) throw error;
    return newStatus;
  },

  async markOrderDispatched(orderId: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'AWAITING_CUSTOMER_CONFIRMATION',
        dispatched_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    if (error) throw error;
  },

  async markOrderReceived(orderId: string, source: 'manual' | 'ai', by: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({
        status: 'COMPLETED',
        customer_confirm_source: source,
        customer_confirm_at: new Date().toISOString(),
        verified_by: by,
      })
      .eq('id', orderId);
    if (error) throw error;
  },
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add src/lib/supabaseClient.ts
git commit -m "feat(supabaseClient): order lifecycle wrappers verify/edit/markReady/Dispatched/Received"
```

---

## Task 13: Frontend — usePesananAktif hook (realtime)

**Files:**
- Create: `src/hooks/usePesananAktif.ts`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/usePesananAktif.ts
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Order } from '../types/orders';

export interface FunnelData {
  bertanya: any[];     // conversations without orders
  konfirmasi: Order[];
  diproses: Order[];
  dikirim: Order[];
  diterima: Order[];
  dibatalkan: Order[];
  loading: boolean;
}

export function usePesananAktif(): FunnelData {
  const [data, setData] = useState<FunnelData>({
    bertanya: [], konfirmasi: [], diproses: [],
    dikirim: [], diterima: [], dibatalkan: [], loading: true,
  });

  async function load() {
    if (!supabase) return;
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .order('updated_at', { ascending: false });

    const { data: convs } = await supabase
      .from('conversations')
      .select('*')
      .in('state', ['GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING','ADD_MORE','DELIVERY']);

    // Filter conversations without orders (Stage 1)
    const orderConvIds = new Set((orders ?? []).map(o => o.conversation_id).filter(Boolean));
    const bertanyaConvs = (convs ?? []).filter(c => !orderConvIds.has(c.id));

    const bucket = (status: string, into: keyof FunnelData) => (orders ?? []).filter(o => o.status === status);

    setData({
      bertanya: bertanyaConvs,
      konfirmasi: (orders ?? []).filter(o => ['PENDING_ADMIN_CONFIRMATION','WAITING_PAYMENT','PAYMENT_UPLOADED','DP_UPLOADED'].includes(o.status)),
      diproses: (orders ?? []).filter(o => ['DP_VERIFIED','PAYMENT_VERIFIED','PROCESSING','READY_AWAITING_PAYMENT'].includes(o.status)),
      dikirim: (orders ?? []).filter(o => ['READY','DISPATCHED','AWAITING_CUSTOMER_CONFIRMATION','DELIVERY_ISSUE'].includes(o.status)),
      diterima: (orders ?? []).filter(o => ['COMPLETED','ASSUMED_COMPLETED'].includes(o.status)),
      dibatalkan: (orders ?? []).filter(o => ['CANCELLED','PAYMENT_REJECTED','DP_PROOF_REJECTED'].includes(o.status)),
      loading: false,
    });
  }

  useEffect(() => {
    load();
    if (!supabase) return;
    const ordersChannel = supabase.channel('pesanan-orders').on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders' }, () => load()).subscribe();
    const convsChannel = supabase.channel('pesanan-convs').on('postgres_changes',
      { event: '*', schema: 'public', table: 'conversations' }, () => load()).subscribe();
    return () => { ordersChannel.unsubscribe(); convsChannel.unsubscribe(); };
  }, []);

  return data;
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add src/hooks/usePesananAktif.ts
git commit -m "feat(hooks): usePesananAktif funnel data hook with Supabase realtime"
```

---

## Task 14: Frontend — FunnelControls component

**Files:**
- Create: `src/components/penjualan/FunnelControls.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/penjualan/FunnelControls.tsx
import React from 'react';

export interface FunnelFilters {
  search: string;
  channel: string;    // 'all' | 'WhatsApp' | 'Walk-in' | ...
  dateRange: 'today' | '7d' | '30d' | '90d' | 'custom' | 'all';
  sortBy: 'newest' | 'oldest' | 'amount_high' | 'amount_low' | 'stuck_longest';
}

interface Props {
  filters: FunnelFilters;
  onChange: (f: FunnelFilters) => void;
  summary: { active: number; selesai: number; dibatalkan: number };
}

export function FunnelControls({ filters, onChange, summary }: Props) {
  return (
    <div className="px-4 py-3 bg-white border-b border-gray-200">
      <div className="flex flex-wrap gap-3 items-center mb-2">
        <input
          type="text"
          placeholder="🔍 Cari order/customer/produk..."
          className="flex-1 min-w-[200px] px-3 py-1.5 border rounded-lg text-sm"
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
        />
        <select
          value={filters.channel}
          onChange={e => onChange({ ...filters, channel: e.target.value })}
          className="px-3 py-1.5 border rounded-lg text-sm"
        >
          <option value="all">Channel: Semua</option>
          <option value="WhatsApp">WhatsApp</option>
          <option value="Walk-in">Walk-in</option>
          <option value="Grosir">Grosir</option>
          <option value="Sales Lapangan">Sales Lapangan</option>
          <option value="Pameran / Expo">Pameran</option>
          <option value="Marketplace">Marketplace</option>
        </select>
        <select
          value={filters.dateRange}
          onChange={e => onChange({ ...filters, dateRange: e.target.value as any })}
          className="px-3 py-1.5 border rounded-lg text-sm"
        >
          <option value="all">Date: Semua</option>
          <option value="today">Hari ini</option>
          <option value="7d">7 hari</option>
          <option value="30d">30 hari</option>
          <option value="90d">90 hari</option>
        </select>
        <select
          value={filters.sortBy}
          onChange={e => onChange({ ...filters, sortBy: e.target.value as any })}
          className="px-3 py-1.5 border rounded-lg text-sm"
        >
          <option value="newest">Sort: Terbaru</option>
          <option value="oldest">Tertua</option>
          <option value="amount_high">Amount Tinggi</option>
          <option value="amount_low">Amount Rendah</option>
          <option value="stuck_longest">Stuck Terlama</option>
        </select>
      </div>
      <div className="text-xs text-gray-500">
        Summary: ⏳ {summary.active} aktif · ✓ {summary.selesai} selesai · ✗ {summary.dibatalkan} dibatalkan
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/penjualan/FunnelControls.tsx
git commit -m "feat(funnel): FunnelControls top-bar component"
```

---

## Task 15: Frontend — Stage1 Bertanya (conversation rows)

**Files:**
- Create: `src/components/penjualan/funnel/Stage1Bertanya.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/penjualan/funnel/Stage1Bertanya.tsx
import React, { useState } from 'react';

interface Props {
  conversations: any[];
  onOpenInbox: (convId: string) => void;
}

export function Stage1Bertanya({ conversations, onOpenInbox }: Props) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">💬</span>
          <span className="font-bold text-sm">1. Bertanya</span>
          <span className="bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5 rounded-full">
            {conversations.length}
          </span>
        </div>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="divide-y divide-gray-100">
          {conversations.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              Belum ada customer yang sedang chat. 🤖
            </div>
          ) : (
            conversations.slice(0, 10).map(c => (
              <button
                key={c.id}
                onClick={() => onOpenInbox(c.id)}
                className="w-full text-left px-4 py-2 hover:bg-blue-50"
              >
                <div className="flex justify-between text-sm">
                  <div>
                    <span className="font-medium">{c.customer_phone}</span>
                    <span className="text-gray-500 ml-2">· {c.state}</span>
                  </div>
                  <span className="text-xs text-gray-400">→ Buka Chat</span>
                </div>
              </button>
            ))
          )}
          {conversations.length > 10 && (
            <div className="px-4 py-2 text-center text-sm text-blue-600 hover:bg-blue-50 cursor-pointer">
              Lihat semua {conversations.length} →
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/penjualan/funnel/Stage1Bertanya.tsx
git commit -m "feat(funnel): Stage1 Bertanya conversation rows"
```

---

## Task 16: Frontend — Stage 2-6 with shared row pattern

**Files:**
- Create: `src/components/penjualan/funnel/StageOrderRow.tsx`
- Create: `src/components/penjualan/funnel/Stage2KonfirmasiTungguBayar.tsx`
- Create: `src/components/penjualan/funnel/Stage3Diproses.tsx`
- Create: `src/components/penjualan/funnel/Stage4DikirimSiapDiambil.tsx`
- Create: `src/components/penjualan/funnel/Stage5Diterima.tsx`
- Create: `src/components/penjualan/funnel/Stage6DibatalkanDitolak.tsx`

- [ ] **Step 1: Write shared StageOrderRow**

```tsx
// src/components/penjualan/funnel/StageOrderRow.tsx
import React from 'react';
import type { Order } from '../../../types/orders';

interface Props {
  order: Order;
  onClick: () => void;
  isExpanded: boolean;
  children?: React.ReactNode; // Expanded content (action panel)
}

export function StageOrderRow({ order, onClick, isExpanded, children }: Props) {
  return (
    <>
      <button onClick={onClick} className={`w-full text-left px-4 py-2 hover:bg-gray-50 ${isExpanded ? 'bg-gray-50' : ''}`}>
        <div className="flex justify-between text-sm items-center">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500">#{order.id.slice(0,8)}</span>
            <span className="font-medium">{order.customer_name}</span>
            <span className="text-gray-400 text-xs">@{order.channel}</span>
            <span className="font-bold text-green-700">Rp {order.total?.toLocaleString('id-ID')}</span>
            {order.payment_type === 'TEMPO' && (
              <span className="bg-orange-100 text-orange-700 text-[10px] font-bold px-1.5 py-0.5 rounded">🟠 TEMPO</span>
            )}
            {order.status === 'DP_VERIFIED' && (
              <span className="bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded">💛 DP</span>
            )}
          </div>
          <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{order.status.replace(/_/g, ' ')}</div>
      </button>
      {isExpanded && <div className="border-t border-gray-100 bg-gray-50">{children}</div>}
    </>
  );
}
```

- [ ] **Step 2: Write 5 stage components using the row pattern**

Repeat the same skeleton for Stage2-6. Example for Stage 2:

```tsx
// src/components/penjualan/funnel/Stage2KonfirmasiTungguBayar.tsx
import React, { useState } from 'react';
import type { Order } from '../../../types/orders';
import { StageOrderRow } from './StageOrderRow';
import { OrderActionPanel } from '../../orders/OrderActionPanel';

interface Props { orders: Order[]; }

export function Stage2KonfirmasiTungguBayar({ orders }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const total = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-3 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50">
        <div className="flex items-center gap-3">
          <span>💰</span>
          <span className="font-bold text-sm">2. Konfirmasi & Tunggu Bayar</span>
          <span className="bg-yellow-100 text-yellow-700 text-xs font-bold px-2 py-0.5 rounded-full">{orders.length}</span>
          <span className="text-xs text-gray-500">💵 Rp {total.toLocaleString('id-ID')}</span>
        </div>
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="divide-y divide-gray-100">
          {orders.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm">Tidak ada pesanan menunggu pembayaran.</div>
          ) : (
            orders.slice(0, 10).map(o => (
              <StageOrderRow
                key={o.id}
                order={o}
                isExpanded={openId === o.id}
                onClick={() => setOpenId(openId === o.id ? null : o.id)}
              >
                <OrderActionPanel order={o} />
              </StageOrderRow>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Replicate for Stage 3, 4, 5, 6 — same skeleton, change icon + label + colors + collapse default**

Stage 3 icon `📦`, label `3. Diproses`, collapsed default `false`.
Stage 4 icon `🚚`, label `4. Dikirim / Siap Diambil`.
Stage 5 icon `✓`, label `5. Diterima`, collapsed default `true` + pagination (slice(0, page*10)).
Stage 6 icon `✗`, label `6. Dibatalkan / Ditolak`, collapsed default `true`.

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add src/components/penjualan/funnel/
git commit -m "feat(funnel): Stage 2-6 components with shared StageOrderRow"
```

---

## Task 17: Frontend — OrderActionPanel base

**Files:**
- Create: `src/components/orders/OrderActionPanel.tsx`

- [ ] **Step 1: Write per-status switch**

```tsx
// src/components/orders/OrderActionPanel.tsx
import React from 'react';
import type { Order } from '../../types/orders';
import { orderService } from '../../lib/supabaseClient';

interface Props {
  order: Order;
  currentUser?: string;
}

export function OrderActionPanel({ order, currentUser = 'admin' }: Props) {
  const status = order.status;

  if (status === 'PENDING_ADMIN_CONFIRMATION') return <ApprovePanel order={order} currentUser={currentUser} />;
  if (status === 'PAYMENT_UPLOADED' || status === 'DP_UPLOADED') return <VerifyPanel order={order} currentUser={currentUser} />;
  if (status === 'DP_VERIFIED') return <DpAwaitingPelunasanPanel order={order} />;
  if (status === 'PAYMENT_VERIFIED' || status === 'PROCESSING') return <ProcessingPanel order={order} />;
  if (status === 'READY_AWAITING_PAYMENT') return <ReadyAwaitingPaymentPanel order={order} />;
  if (status === 'READY') return <ReadyPanel order={order} />;
  if (status === 'DISPATCHED' || status === 'AWAITING_CUSTOMER_CONFIRMATION') return <DispatchedPanel order={order} currentUser={currentUser} />;
  if (status === 'DELIVERY_ISSUE') return <DeliveryIssuePanel order={order} />;
  if (status === 'COMPLETED' || status === 'ASSUMED_COMPLETED') return <CompletedPanel order={order} />;

  return <div className="p-4 text-sm text-gray-500">Status: {status}</div>;
}

// ApprovePanel: input ongkir + FULL/DP + Approve/Reject
function ApprovePanel({ order, currentUser }: Props) {
  const [ongkir, setOngkir] = React.useState('');
  const [paymentType, setPaymentType] = React.useState<'FULL' | 'DP'>('FULL');
  const handleApprove = async () => {
    await orderService.approveOrder(order.id, parseFloat(ongkir) || 0, paymentType);
    // realtime will refresh
  };
  return (
    <div className="p-4">
      <h4 className="font-bold mb-2">Konfirmasi Pesanan</h4>
      <div className="flex gap-3 items-center mb-2">
        <label className="text-xs">Ongkir Rp</label>
        <input type="number" value={ongkir} onChange={e => setOngkir(e.target.value)} className="border px-2 py-1 rounded text-sm w-32" />
        <label className="text-xs ml-4">Pembayaran:</label>
        {(['FULL', 'DP'] as const).map(t => (
          <button key={t} onClick={() => setPaymentType(t)}
            className={`px-3 py-1 text-xs rounded ${paymentType === t ? 'bg-purple-600 text-white' : 'bg-white border'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={handleApprove} className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded">✓ Approve</button>
        <button className="px-4 py-2 border border-red-200 text-red-600 text-xs font-bold rounded">✕ Tolak</button>
      </div>
    </div>
  );
}

function VerifyPanel({ order, currentUser }: Props) {
  const handleVerify = async () => {
    const result = await orderService.verifyPaymentWithStock(order.id, currentUser ?? 'admin');
    if (!result.success) {
      alert(result.error === 'stock_insufficient'
        ? `Stock kurang: ${JSON.stringify(result.insufficient_skus)}`
        : result.error);
    }
  };
  return (
    <div className="p-4">
      <h4 className="font-bold mb-2">Verifikasi Pembayaran</h4>
      {order.full_proof_url && (
        <a href={order.full_proof_url} target="_blank" className="text-blue-600 underline text-sm">Lihat Bukti Transfer</a>
      )}
      <div className="mt-3 flex gap-2">
        <button onClick={handleVerify} className="px-4 py-2 bg-green-600 text-white text-xs font-bold rounded">✓ Verify</button>
        <button className="px-4 py-2 border border-red-200 text-red-600 text-xs font-bold rounded">✕ Tolak</button>
      </div>
    </div>
  );
}

function DpAwaitingPelunasanPanel({ order }: { order: Order }) {
  return <div className="p-4 text-sm">DP diterima. Menunggu pelunasan dari customer (sisa Rp {(order.total - (order.dp_amount ?? 0)).toLocaleString('id-ID')}).</div>;
}

function ProcessingPanel({ order }: { order: Order }) {
  const [courier, setCourier] = React.useState('');
  const handleMarkReady = async () => {
    const newStatus = await orderService.markOrderReady(order.id, courier);
    if (newStatus === 'READY_AWAITING_PAYMENT') {
      alert('Barang ready, tapi customer belum lunasi. Mengirim reminder ke customer...');
    }
  };
  return (
    <div className="p-4">
      <h4 className="font-bold mb-2">Sedang Diproses</h4>
      {order.delivery_type === 'DELIVERY' && (
        <div className="mb-2">
          <label className="text-xs">Link Kurir (opsional):</label>
          <input type="text" value={courier} onChange={e => setCourier(e.target.value)} className="border px-2 py-1 rounded text-sm w-full" placeholder="https://lalamove.com/..." />
        </div>
      )}
      <button onClick={handleMarkReady} className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded">📦 Mark Ready</button>
    </div>
  );
}

function ReadyAwaitingPaymentPanel({ order }: { order: Order }) {
  return <div className="p-4 text-sm">Barang siap. Menunggu pelunasan customer sebelum bisa dikirim/diambil.</div>;
}

function ReadyPanel({ order }: { order: Order }) {
  return (
    <div className="p-4">
      <button onClick={() => orderService.markOrderDispatched(order.id)}
        className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded">
        🚚 Mark Dispatched
      </button>
    </div>
  );
}

function DispatchedPanel({ order, currentUser }: Props) {
  const handleMarkReceived = async () => {
    await orderService.markOrderReceived(order.id, 'manual', currentUser ?? 'admin');
  };
  return (
    <div className="p-4">
      <h4 className="font-bold mb-2">Tunggu Konfirmasi Customer</h4>
      {order.courier_tracking_link && <a href={order.courier_tracking_link} target="_blank" className="text-blue-600 underline text-sm">Tracking →</a>}
      <button onClick={handleMarkReceived} className="mt-3 px-4 py-2 bg-green-600 text-white text-xs font-bold rounded">
        ✓ Tandai Diterima (Override)
      </button>
    </div>
  );
}

function DeliveryIssuePanel({ order }: { order: Order }) {
  return <div className="p-4 text-sm text-red-700">Issue: {order.delivery_issue_reason}</div>;
}

function CompletedPanel({ order }: { order: Order }) {
  return <div className="p-4 text-sm text-green-700">✓ Order selesai pada {order.customer_confirm_at}</div>;
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit 2>&1 | head -5
git add src/components/orders/OrderActionPanel.tsx
git commit -m "feat(orders): OrderActionPanel base with per-status action UI"
```

---

## Task 18: Frontend — PesananAktifTab container

**Files:**
- Create: `src/components/penjualan/PesananAktifTab.tsx`

- [ ] **Step 1: Write container**

```tsx
// src/components/penjualan/PesananAktifTab.tsx
import React, { useState } from 'react';
import { usePesananAktif } from '../../hooks/usePesananAktif';
import { FunnelControls, type FunnelFilters } from './FunnelControls';
import { Stage1Bertanya } from './funnel/Stage1Bertanya';
import { Stage2KonfirmasiTungguBayar } from './funnel/Stage2KonfirmasiTungguBayar';
import { Stage3Diproses } from './funnel/Stage3Diproses';
import { Stage4DikirimSiapDiambil } from './funnel/Stage4DikirimSiapDiambil';
import { Stage5Diterima } from './funnel/Stage5Diterima';
import { Stage6DibatalkanDitolak } from './funnel/Stage6DibatalkanDitolak';

interface Props {
  preOpenedOrderId?: string;   // from URL ?order={id}
  onNavigateToInbox: (convId: string) => void;
}

export function PesananAktifTab({ preOpenedOrderId, onNavigateToInbox }: Props) {
  const data = usePesananAktif();
  const [filters, setFilters] = useState<FunnelFilters>({
    search: '', channel: 'all', dateRange: 'all', sortBy: 'newest',
  });

  if (data.loading) return <div className="p-6 text-center">Memuat...</div>;

  const summary = {
    active: data.konfirmasi.length + data.diproses.length + data.dikirim.length,
    selesai: data.diterima.length,
    dibatalkan: data.dibatalkan.length,
  };

  return (
    <div>
      <FunnelControls filters={filters} onChange={setFilters} summary={summary} />
      <div className="p-4">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">━━━━ Aktif ━━━━</div>
        <Stage1Bertanya conversations={data.bertanya} onOpenInbox={onNavigateToInbox} />
        <Stage2KonfirmasiTungguBayar orders={data.konfirmasi} />
        <Stage3Diproses orders={data.diproses} />
        <Stage4DikirimSiapDiambil orders={data.dikirim} />
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wide my-4">━━━━ Selesai ━━━━</div>
        <Stage5Diterima orders={data.diterima} />
        <Stage6DibatalkanDitolak orders={data.dibatalkan} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/penjualan/PesananAktifTab.tsx
git commit -m "feat(penjualan): PesananAktifTab container with 6-stage funnel"
```

---

## Task 19: Frontend — wire Pesanan Aktif into Penjualan menu

**Files:**
- Modify: `src/components/PenjualanScreen.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Inspect existing PenjualanScreen**

```bash
grep -n "Riwayat\|Input Baru\|WIP Rakit\|OrderHistoryScreen" src/components/PenjualanScreen.tsx | head -10
```

- [ ] **Step 2: Replace Riwayat tab with PesananAktifTab**

In `src/components/PenjualanScreen.tsx`, find the tabs definition and update:

```tsx
const tabs = [
  { id: 'baru', label: 'Baru' },
  { id: 'pesanan-aktif', label: 'Pesanan Aktif' },  // was 'riwayat'
  { id: 'wip', label: 'WIP Rakit' },
];

// In tab content rendering:
{activeTab === 'pesanan-aktif' && (
  <PesananAktifTab
    preOpenedOrderId={searchParams.get('order') ?? undefined}
    onNavigateToInbox={(convId) => onNavigate('sales-inbox', { conversationId: convId })}
  />
)}
```

Remove the `<OrderHistoryScreen />` import and usage from this file.

- [ ] **Step 3: Update App.tsx routing for URL params**

In `src/App.tsx`, ensure when `case 'penjualan':` is rendered, `searchParams` is passed (or use `window.location.search` inside PenjualanScreen).

- [ ] **Step 4: tsc + manual smoke**

```bash
npx tsc --noEmit
npm run build  # ensure full build OK
```

- [ ] **Step 5: Commit**

```bash
git add src/components/PenjualanScreen.tsx src/App.tsx
git commit -m "feat(penjualan): replace Riwayat tab with Pesanan Aktif funnel"
```

---

## Task 20: Frontend — Inbox quick-action card update

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

- [ ] **Step 1: Find Konfirmasi Pesanan button**

```bash
grep -n "Konfirmasi Pesanan\|onNavigate" src/components/SalesInboxScreen.tsx | head -10
```

- [ ] **Step 2: Update button to deep-link with order id**

Replace `onNavigate('order-history')` with:

```tsx
onClick={() => onNavigate('penjualan', { tab: 'pesanan-aktif', order: order.id })}
```

And ensure App.tsx case `'penjualan'` consumes the extra params (set them as URL search params or in component state).

- [ ] **Step 3: Verify by manual click in dev**

Run `npm run dev`, navigate to Sales Inbox, click Konfirmasi Pesanan, verify it lands at `/penjualan?tab=pesanan-aktif&order=<id>` with the order expanded.

- [ ] **Step 4: Commit**

```bash
git add src/components/SalesInboxScreen.tsx
git commit -m "feat(inbox): Buka Detail deep-links to Penjualan>Pesanan Aktif with order param"
```

---

## Task 21: Frontend — EditOrderModal

**Files:**
- Create: `src/components/orders/EditOrderModal.tsx`

- [ ] **Step 1: Write modal component**

```tsx
// src/components/orders/EditOrderModal.tsx
import React, { useState } from 'react';
import type { Order } from '../../types/orders';
import { orderService } from '../../lib/supabaseClient';

interface Props {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  currentUser: string;
}

export function EditOrderModal({ order, isOpen, onClose, currentUser }: Props) {
  const [shippingFee, setShippingFee] = useState(String(order.shipping_fee ?? ''));
  const [address, setAddress] = useState(order.customer_address ?? '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!reason.trim()) { alert('Reason wajib diisi'); return; }
    setSaving(true);
    try {
      await orderService.editOrder(order.id, {
        shipping_fee: parseFloat(shippingFee) || 0,
        customer_address: address,
      }, reason, currentUser);
      onClose();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h3 className="font-bold mb-3">Edit Pesanan #{order.id.slice(0,8)}</h3>
        <label className="text-xs">Ongkir</label>
        <input type="number" value={shippingFee} onChange={e => setShippingFee(e.target.value)} className="w-full border px-2 py-1 rounded text-sm mb-2" />
        <label className="text-xs">Alamat</label>
        <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className="w-full border px-2 py-1 rounded text-sm mb-2" />
        <label className="text-xs">Alasan perubahan *</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="w-full border px-2 py-1 rounded text-sm mb-3" placeholder="Contoh: customer minta ubah alamat" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1 text-sm">Batal</button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-sm rounded">
            {saving ? 'Saving...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/orders/EditOrderModal.tsx
git commit -m "feat(orders): EditOrderModal with required reason field"
```

---

## Task 22: Phase 1A smoke test

- [ ] **Step 1: Manual e2e via WA + admin dashboard**

1. Send a WA "Halo" from a test number.
2. In admin dashboard, open Penjualan > Pesanan Aktif.
3. Verify the conversation appears in Stage 1 Bertanya.
4. Continue chat to produce a BOOKED order — order moves to Stage 2.
5. From Stage 2, click order row, approve with ongkir → moves to Stage 2 (WAITING_PAYMENT).
6. Upload payment proof from WA, click verify in admin → stock decrements + status → Stage 3.
7. Click "Mark Ready" → Stage 4.
8. Click "Mark Dispatched" → Stage 4 with AWAITING_CUSTOMER_CONFIRMATION.
9. Customer replies "sudah" via WA → Calista routes to manual mark for now (Phase 1A doesn't have AI parse yet) — admin clicks Tandai Diterima → COMPLETED → Stage 5.
10. Verify funnel auto-updates via realtime (no manual refresh).

- [ ] **Step 2: Verify stock change**

Query stock for the SKU before and after verify_payment. Stock should decrement by qty.

- [ ] **Step 3: Cancel test**

Cancel a verified order → stock should restock.

- [ ] **Step 4: Edit test**

Open EditOrderModal, change ongkir, provide reason, save. Verify `order_modifications` table has audit row.

- [ ] **Step 5: Commit smoke checklist**

Create `docs/superpowers/plans/2026-06-15-order-confirmation-fulfillment-revamp-implementation-1A-smoke.md` with results, commit.

```bash
git add docs/superpowers/plans/
git commit -m "test(phase-1a): smoke test results — funnel + state machine + stock + edit"
```

---

# PHASE 1B — Documents, Notifications & Alerts (2 weeks)

Goal: PDFs, WA notifications, stuck-order alerts, Pengaturan UI.

## Task 23: Frontend — Pengaturan Alamat Toko section

**Files:**
- Create: `src/components/pengaturan/AlamatTokoSection.tsx`
- Modify: `src/components/PengaturanScreen.tsx`

- [ ] **Step 1: Write component**

```tsx
// src/components/pengaturan/AlamatTokoSection.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

export function AlamatTokoSection() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase?.from('store_settings').select('*').single().then(({ data }) => setSettings(data));
  }, []);

  if (!settings) return <div>Memuat...</div>;

  const update = (field: string, value: any) => setSettings({ ...settings, [field]: value });

  const handleSave = async () => {
    setSaving(true);
    await supabase?.from('store_settings').update({
      store_name: settings.store_name,
      logo_url: settings.logo_url,
      address: settings.address,
      city: settings.city,
      store_phone: settings.store_phone,
      gmaps_link: settings.gmaps_link,
      parking_info: settings.parking_info,
      pickup_notes: settings.pickup_notes,
    }).eq('id', settings.id);
    setSaving(false);
    alert('Tersimpan');
  };

  return (
    <div className="p-4 bg-white rounded-lg">
      <h3 className="font-bold mb-3">🏪 Alamat Toko</h3>
      <div className="space-y-2">
        <Field label="Nama Toko *" value={settings.store_name} onChange={v => update('store_name', v)} />
        <Field label="URL Logo (PNG/JPG)" value={settings.logo_url ?? ''} onChange={v => update('logo_url', v)} />
        <Field label="Alamat Lengkap *" value={settings.address} onChange={v => update('address', v)} multiline />
        <Field label="Kota *" value={settings.city} onChange={v => update('city', v)} />
        <Field label="Telp/WA Toko *" value={settings.store_phone} onChange={v => update('store_phone', v)} />
        <Field label="Link Google Maps *" value={settings.gmaps_link} onChange={v => update('gmaps_link', v)} />
        <Field label="Info Parkir (opsional)" value={settings.parking_info ?? ''} onChange={v => update('parking_info', v)} />
        <Field label="Catatan Pickup (opsional)" value={settings.pickup_notes ?? ''} onChange={v => update('pickup_notes', v)} multiline />
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white text-sm rounded">
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <label className="text-xs text-gray-600">{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={2} className="w-full border px-2 py-1 rounded text-sm" />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} className="w-full border px-2 py-1 rounded text-sm" />
      }
    </div>
  );
}
```

- [ ] **Step 2: Wire into PengaturanScreen as a new section/tab**

Find `src/components/PengaturanScreen.tsx`, add new section button/tab "Alamat Toko" that renders `<AlamatTokoSection />`.

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/pengaturan/AlamatTokoSection.tsx src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): AlamatTokoSection with required fields"
```

---

## Task 24: Frontend — Pengaturan Jam Operasional section

**Files:**
- Create: `src/components/pengaturan/JamOperasionalSection.tsx`

- [ ] **Step 1: Write component (per-day toggle + holidays)**

```tsx
// src/components/pengaturan/JamOperasionalSection.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function JamOperasionalSection() {
  const [hours, setHours] = useState<any>({});
  const [holidays, setHolidays] = useState<string[]>([]);
  const [settingsId, setSettingsId] = useState<string | null>(null);

  useEffect(() => {
    supabase?.from('store_settings').select('id, operational_hours, holidays_overrides').single().then(({ data }) => {
      if (data) {
        setSettingsId(data.id);
        setHours(data.operational_hours ?? {});
        setHolidays(data.holidays_overrides ?? []);
      }
    });
  }, []);

  const updateDay = (day: string, field: 'open' | 'close' | 'closed', value: any) => {
    const dayData = hours[day];
    if (field === 'closed') {
      setHours({ ...hours, [day]: value ? null : { open: '08:00', close: '17:00' } });
    } else {
      setHours({ ...hours, [day]: { ...dayData, [field]: value } });
    }
  };

  const handleSave = async () => {
    if (!settingsId) return;
    await supabase?.from('store_settings').update({
      operational_hours: hours,
      holidays_overrides: holidays,
    }).eq('id', settingsId);
    alert('Tersimpan');
  };

  return (
    <div className="p-4 bg-white rounded-lg">
      <h3 className="font-bold mb-3">🕐 Jam Operasional</h3>
      <table className="w-full text-sm">
        <thead><tr><th>Hari</th><th>Tutup?</th><th>Buka</th><th>Tutup</th></tr></thead>
        <tbody>
          {DAYS.map(d => (
            <tr key={d}>
              <td className="capitalize">{d}</td>
              <td><input type="checkbox" checked={!hours[d]} onChange={e => updateDay(d, 'closed', e.target.checked)} /></td>
              <td><input type="time" value={hours[d]?.open ?? ''} onChange={e => updateDay(d, 'open', e.target.value)} disabled={!hours[d]} /></td>
              <td><input type="time" value={hours[d]?.close ?? ''} onChange={e => updateDay(d, 'close', e.target.value)} disabled={!hours[d]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <label className="text-xs">Tanggal Libur Khusus (comma-separated YYYY-MM-DD)</label>
        <input type="text" value={holidays.join(', ')} onChange={e => setHolidays(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} className="w-full border px-2 py-1 rounded text-sm" />
      </div>
      <button onClick={handleSave} className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded">Simpan</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire + commit**

```bash
npx tsc --noEmit
git add src/components/pengaturan/JamOperasionalSection.tsx src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): JamOperasionalSection with per-day + holidays"
```

---

## Task 25: Frontend — Pengaturan Rekening Bank section

**Files:**
- Create: `src/components/pengaturan/RekeningBankSection.tsx`

- [ ] **Step 1: Write multi-bank list manager**

```tsx
// src/components/pengaturan/RekeningBankSection.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface Bank { id?: string; bank_name: string; account_number: string; account_holder: string; is_active: boolean; display_order: number; }

export function RekeningBankSection() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const load = () => supabase?.from('store_bank_accounts').select('*').order('display_order').then(({ data }) => setBanks(data ?? []));
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    await supabase?.from('store_bank_accounts').insert({
      bank_name: 'BCA', account_number: '', account_holder: '', is_active: true, display_order: banks.length,
    });
    load();
  };

  const handleSave = async (b: Bank) => {
    if (!b.id) return;
    await supabase?.from('store_bank_accounts').update({
      bank_name: b.bank_name, account_number: b.account_number, account_holder: b.account_holder, is_active: b.is_active,
    }).eq('id', b.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus rekening ini?')) return;
    await supabase?.from('store_bank_accounts').delete().eq('id', id);
    load();
  };

  return (
    <div className="p-4 bg-white rounded-lg">
      <h3 className="font-bold mb-3">💳 Informasi Rekening Bank</h3>
      {banks.map((b, i) => (
        <div key={b.id ?? i} className="border p-2 rounded mb-2">
          <div className="grid grid-cols-4 gap-2 text-sm">
            <input value={b.bank_name} onChange={e => { const c = [...banks]; c[i].bank_name = e.target.value; setBanks(c); }} placeholder="Bank" />
            <input value={b.account_number} onChange={e => { const c = [...banks]; c[i].account_number = e.target.value; setBanks(c); }} placeholder="Nomor" />
            <input value={b.account_holder} onChange={e => { const c = [...banks]; c[i].account_holder = e.target.value; setBanks(c); }} placeholder="Atas Nama" />
            <div className="flex gap-2">
              <label className="text-xs"><input type="checkbox" checked={b.is_active} onChange={e => { const c = [...banks]; c[i].is_active = e.target.checked; setBanks(c); }} /> Aktif</label>
              <button onClick={() => handleSave(b)} className="text-blue-600 text-xs">Save</button>
              <button onClick={() => b.id && handleDelete(b.id)} className="text-red-600 text-xs">Hapus</button>
            </div>
          </div>
        </div>
      ))}
      <button onClick={handleAdd} className="mt-2 px-3 py-1 bg-green-600 text-white text-sm rounded">+ Tambah Bank</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire + commit**

```bash
npx tsc --noEmit
git add src/components/pengaturan/RekeningBankSection.tsx src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): RekeningBankSection multi-bank manager"
```

---

## Task 26: Backend — PDF library setup + common template

**Files:**
- Create: `backend-go/internal/pdf/render.go`
- Create: `backend-go/internal/pdf/templates/common.html`

- [ ] **Step 1: Add chromedp dependency**

```bash
cd backend-go && go get github.com/chromedp/chromedp@latest
```

- [ ] **Step 2: Write render.go**

```go
package pdf

import (
    "bytes"
    "context"
    "html/template"
    "io"
    "github.com/chromedp/chromedp"
)

// RenderHTMLToPDF executes a headless Chrome render and returns the PDF bytes.
func RenderHTMLToPDF(ctx context.Context, htmlContent string) ([]byte, error) {
    actx, cancel := chromedp.NewContext(ctx)
    defer cancel()
    var buf []byte
    err := chromedp.Run(actx,
        chromedp.Navigate("data:text/html,"+htmlContent),
        chromedp.ActionFunc(func(ctx context.Context) error {
            var err error
            buf, _, err = chromedp.WaitReady("body").(chromedp.Action).Do(ctx), nil, nil
            // Simpler: use page.PrintToPDF action
            return err
        }),
    )
    if err != nil { return nil, err }
    return buf, nil
}

// SimpleRender uses a one-shot data URL approach. Production should use a file server.
func SimpleRender(ctx context.Context, htmlContent string) ([]byte, error) {
    return RenderHTMLToPDF(ctx, htmlContent)
}

// RenderTemplate parses HTML template + data + returns PDF bytes.
func RenderTemplate(ctx context.Context, tmplString string, data any) ([]byte, error) {
    t, err := template.New("doc").Parse(tmplString)
    if err != nil { return nil, err }
    var buf bytes.Buffer
    if err := t.Execute(&buf, data); err != nil { return nil, err }
    return SimpleRender(ctx, buf.String())
}

// Write convenience
func Write(w io.Writer, b []byte) (int, error) { return w.Write(b) }
```

NOTE: chromedp PDF generation API uses `page.PrintToPDF`. Production-grade implementation:

```go
import "github.com/chromedp/cdproto/page"
err := chromedp.Run(actx,
  chromedp.Navigate("data:text/html;base64,"+base64.StdEncoding.EncodeToString([]byte(htmlContent))),
  chromedp.ActionFunc(func(ctx context.Context) error {
    var pdfErr error
    buf, _, pdfErr = page.PrintToPDF().Do(ctx)
    return pdfErr
  }),
)
```

- [ ] **Step 3: Write common.html template**

```html
<!-- backend-go/internal/pdf/templates/common.html -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; margin: 20mm; }
  .header { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 8mm; margin-bottom: 8mm; }
  .logo { width: 50px; height: 50px; }
  .doc-no { font-weight: bold; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin: 5mm 0; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  th { background: #f5f5f5; }
  .footer { margin-top: 10mm; border-top: 1px solid #ccc; padding-top: 5mm; font-size: 9pt; color: #333; }
  .footer h4 { margin: 0 0 3mm 0; font-size: 10pt; }
  .bank-block { border: 1px solid #ddd; padding: 5mm; margin: 3mm 0; }
</style>
</head>
<body>
  {{template "header" .}}
  {{template "content" .}}
  {{template "footer" .}}
</body>
</html>

{{define "header"}}
<div class="header">
  <div style="display: flex; gap: 10mm;">
    {{if .Store.LogoURL}}<img src="{{.Store.LogoURL}}" class="logo" />{{end}}
    <div>
      <strong>{{.Store.StoreName}}</strong><br>
      {{.Store.Address}}<br>
      {{.Store.City}}<br>
      Telp/WA: {{.Store.StorePhone}}
    </div>
  </div>
  <div class="doc-no">
    {{.DocNo}}<br>
    <small>{{.Date}}</small>
  </div>
</div>
{{end}}

{{define "footer"}}
<div class="footer">
  <h4>SYARAT &amp; KETENTUAN</h4>
  <ul>
    <li>Barang yang telah dibeli tidak dapat dikembalikan</li>
    <li>Pembayaran dianggap sah setelah dana masuk ke rekening kami</li>
    <li>Komplain barang rusak/kurang harap disampaikan saat barang diterima</li>
  </ul>
  <div style="text-align: right; margin-top: 3mm;">Dicetak otomatis · {{.GeneratedAt}}</div>
</div>
{{end}}
```

- [ ] **Step 4: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/pdf/
git commit -m "feat(pdf): chromedp HTML→PDF render helper + common header/footer template"
```

---

## Task 27: Backend — numbering counters

**Files:**
- Create: `backend-go/internal/db/numbering.go`

- [ ] **Step 1: Write numbering helper**

```go
package db

import (
    "context"
    "fmt"
    "time"
)

// NextDocNumber atomically increments the counter and returns formatted "PREFIX/YYYY/NNNN"
func (c *Client) NextDocNumber(ctx context.Context, docType, prefix string) (string, error) {
    currentYear := time.Now().Year()
    var num int
    err := c.DB.QueryRowContext(ctx, `
        UPDATE doc_number_counters
        SET last_number = CASE WHEN current_year != $2 THEN 1 ELSE last_number + 1 END,
            current_year = $2
        WHERE doc_type = $1
        RETURNING last_number
    `, docType, currentYear).Scan(&num)
    if err != nil {
        return "", err
    }
    return fmt.Sprintf("%s/%d/%05d", prefix, currentYear, num), nil
}
```

- [ ] **Step 2: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/db/numbering.go
git commit -m "feat(db): NextDocNumber atomic counter with annual reset"
```

---

## Task 28-32: Backend — 5 PDF templates (SO, Invoice DP, Invoice Final, Invoice Tempo, Surat Jalan)

For each: create HTML template file, write Go function that loads data from DB + renders + uploads to Supabase storage + updates orders.X_pdf_url column.

- [ ] **Task 28: sales_order.html template + GenerateSO func**

Template per spec Section 6 "Sales Order layout". Go func:

```go
// backend-go/internal/pdf/sales_order.go
package pdf

import (
    "context"
    _ "embed"
    "github.com/username/sinar-elektrik-backend/internal/db"
)

//go:embed templates/sales_order.html
var soTemplate string

type SOData struct {
    Store      *db.StoreSettings
    Banks      []db.StoreBankAccount
    Order      any   // marshal-compatible
    DocNo      string
    Date       string
    GeneratedAt string
}

func GenerateSO(ctx context.Context, dbClient *db.Client, orderID string) (string /*pdf_url*/, error) {
    store, _ := dbClient.GetStoreSettings(ctx)
    banks, _ := dbClient.ListActiveBankAccounts(ctx)
    docNo, _ := dbClient.NextDocNumber(ctx, "sales_order", "SO")
    // load order (use existing query)
    // pdfBytes := RenderTemplate(ctx, soTemplate, SOData{...})
    // upload to supabase storage at sales-documents/{order_id}/{docNo}.pdf
    // update orders.sales_order_pdf_url
    return "https://storage.../url", nil
}
```

Commit.

- [ ] **Task 29: invoice_dp.html + GenerateInvoiceDP** — similar pattern, no bank block (per spec).
- [ ] **Task 30: invoice_final.html + GenerateInvoiceFinal** — for FULLY_PAID or Lunas Kasir.
- [ ] **Task 31: invoice_tempo.html + GenerateInvoiceTempo** — includes due_date prominent + bank block.
- [ ] **Task 32: surat_jalan.html + GenerateSuratJalan** — admin print only, includes tanda terima box.

---

## Task 33: Backend — Dot Matrix print path

**Files:**
- Create: `backend-go/internal/pdf/dotmatrix.go`

- [ ] **Step 1: Inspect existing Kasir dot matrix code**

```bash
grep -rln "dot.*matrix\|dotmatrix\|RAW\|epson" backend-go src
```

- [ ] **Step 2: Write thin wrapper that formats Invoice/Surat Jalan as plain text**

```go
// backend-go/internal/pdf/dotmatrix.go
package pdf

import (
    "fmt"
    "strings"
)

// FormatInvoiceDotMatrix returns plain text suitable for dot matrix line printing.
func FormatInvoiceDotMatrix(order map[string]any) string {
    var sb strings.Builder
    sb.WriteString(fmt.Sprintf("%-40s %20s\n", "INVOICE", order["doc_no"]))
    sb.WriteString(strings.Repeat("=", 60) + "\n")
    // ... items, totals, footer
    return sb.String()
}

func FormatSuratJalanDotMatrix(order map[string]any) string {
    // similar
    return ""
}
```

- [ ] **Step 3: Frontend Print picker re-uses existing Kasir mechanism** — reuse `KasirInvoiceModal.tsx` printer routing (no new path needed if existing handles it).

- [ ] **Step 4: Commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/pdf/dotmatrix.go
git commit -m "feat(pdf): dot matrix plain-text formatters for Invoice + Surat Jalan"
```

---

## Task 34: Backend — 10 WA notification templates

**Files:**
- Create: `backend-go/internal/whatsapp/templates_orders.go`

- [ ] **Step 1: Write template strings + interpolation**

```go
package whatsapp

import "strings"

type OrderNotifTemplate string

const (
    TplOrderApproved              OrderNotifTemplate = "order_approved"
    TplPaymentDPVerified          OrderNotifTemplate = "payment_dp_verified"
    TplPaymentFullVerified        OrderNotifTemplate = "payment_full_verified"
    TplPaymentRejected            OrderNotifTemplate = "payment_rejected"
    TplDpRejected                 OrderNotifTemplate = "dp_rejected"
    TplReadyAwaitingFullPayment   OrderNotifTemplate = "ready_awaiting_full_payment"
    TplDispatchedDelivery         OrderNotifTemplate = "dispatched_delivery"
    TplDispatchedPickup           OrderNotifTemplate = "dispatched_pickup"
    TplConfirmationReminder       OrderNotifTemplate = "confirmation_reminder"
    TplOrderCompleted             OrderNotifTemplate = "order_completed"
)

var templates = map[OrderNotifTemplate]string{
    TplOrderApproved: `Halo {customer_name} 🙏

Pesanan #{order_id} telah dikonfirmasi.
Total: Rp {total}

Mohon transfer ke salah satu rekening berikut:
{bank_info}

Setelah transfer, mohon upload bukti via WA ini.

Sales Order terlampir.`,

    TplPaymentDPVerified: `DP sebesar Rp {dp_amount} telah kami terima 🙏

Sisa pelunasan: Rp {remaining}
Mohon dilunasi sebelum barang dikirim/diambil.

Invoice DP terlampir.`,

    TplPaymentFullVerified: `Pembayaran lunas Rp {total} telah kami terima ✓

Pesanan #{order_id} akan kami proses.
Invoice terlampir.`,

    TplPaymentRejected: `Mohon maaf, bukti pembayaran perlu kami verifikasi ulang.

Alasan: {reason}

Bisa kirim ulang screenshot transferan Anda? 🙏`,

    TplDpRejected: `Mohon maaf, bukti DP perlu kami verifikasi ulang.

Alasan: {reason}

Mohon kirim ulang bukti transferan DP. 🙏`,

    TplReadyAwaitingFullPayment: `Barang Anda sudah siap 📦

Namun mohon lunasi sisa Rp {remaining} dulu agar dapat kami kirim/diambil 🙏

Setelah transfer, upload bukti via WA ini.`,

    TplDispatchedDelivery: `Barang Anda sedang dikirim 🚚

Tracking: {courier_link}

Mohon konfirmasi setelah diterima dengan balas 'sudah' atau hubungi kami jika ada masalah 🙏`,

    TplDispatchedPickup: `Barang siap diambil di toko kami 🏪

Alamat: {store_address}
{store_phone}
Maps: {gmaps_link}

Jam operasional: {operational_hours}

{pickup_notes}

Mohon konfirmasi setelah diambil dengan balas 'sudah ambil' 🙏`,

    TplConfirmationReminder: `Hai {customer_name},

Mohon konfirmasi pesanan Anda sudah diterima ya 🙏
Atau hubungi kami jika ada masalah.`,

    TplOrderCompleted: `Terima kasih atas kepercayaannya 🙏

Pesanan #{order_id} telah selesai. Semoga produk kami memenuhi kebutuhan Anda!

Boleh kami minta feedback singkat tentang pengalaman Anda?
Saran/kritik sangat membantu kami untuk berkembang.

Jika Anda berkenan, mohon dukung kami dengan bintang 5 di Google Maps 🌟
👉 {google_maps_link}

Terima kasih atas waktunya! Sampai jumpa di pesanan berikutnya 🙏`,
}

func RenderTemplate(t OrderNotifTemplate, vars map[string]string) string {
    s := templates[t]
    for k, v := range vars {
        s = strings.ReplaceAll(s, "{"+k+"}", v)
    }
    return s
}
```

- [ ] **Step 2: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/whatsapp/templates_orders.go
git commit -m "feat(whatsapp): 10 order notification templates with variable interpolation"
```

---

## Task 35: Backend — wire notifications to state transitions

**Files:**
- Create: `backend-go/internal/whatsapp/order_notify.go`

- [ ] **Step 1: Write notification dispatcher**

```go
// backend-go/internal/whatsapp/order_notify.go
package whatsapp

import (
    "context"
    "fmt"
    "github.com/username/sinar-elektrik-backend/internal/db"
)

type OrderNotifier struct {
    DB     *db.Client
    Sender *Sender
}

// NotifyOrderApproved sends order_approved template + attaches SO PDF
func (n *OrderNotifier) NotifyOrderApproved(ctx context.Context, orderID string) error {
    // Only for chat channels (WA, IG, future)
    channel, phone, customerName, total, soPdfURL := n.loadOrder(ctx, orderID) // simplified
    if !isChatChannel(channel) { return nil }
    banks, _ := n.DB.ListActiveBankAccounts(ctx)
    msg := RenderTemplate(TplOrderApproved, map[string]string{
        "customer_name": customerName,
        "order_id": orderID[:8],
        "total": fmt.Sprintf("%.0f", total),
        "bank_info": formatBanks(banks),
    })
    if err := n.Sender.SendText(ctx, phone, msg); err != nil { return err }
    if soPdfURL != "" {
        return n.Sender.SendDocument(ctx, phone, soPdfURL, "Sales Order.pdf")
    }
    return nil
}

// Similar functions for each state transition: NotifyPaymentDPVerified, NotifyPaymentFullVerified, NotifyDispatched, NotifyCompleted, etc.

func isChatChannel(channel string) bool {
    switch channel {
    case "WhatsApp", "Instagram DM": return true
    }
    return false
}

func formatBanks(banks []db.StoreBankAccount) string {
    s := ""
    for _, b := range banks {
        s += fmt.Sprintf("• %s\n  No: %s\n  a.n. %s\n\n", b.BankName, b.AccountNumber, b.AccountHolder)
    }
    return s
}

func (n *OrderNotifier) loadOrder(ctx context.Context, orderID string) (channel, phone, name string, total float64, soPdfURL string) {
    // implement query
    return "", "", "", 0, ""
}
```

- [ ] **Step 2: Wire dispatcher into lifecycle service**

In `backend-go/internal/orders/lifecycle.go`, inject `*OrderNotifier` and call:
- `n.NotifyOrderApproved` after `Approve()`
- `n.NotifyPaymentDPVerified` after VerifyPayment with status=DP_VERIFIED
- `n.NotifyPaymentFullVerified` after VerifyPayment with status=PAYMENT_VERIFIED
- `n.NotifyDispatched` after MarkDispatched (delivery OR pickup template)
- `n.NotifyCompleted` after MarkReceived

- [ ] **Step 3: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/whatsapp/order_notify.go backend-go/internal/orders/lifecycle.go
git commit -m "feat(whatsapp): OrderNotifier dispatcher wired into lifecycle transitions"
```

---

## Task 36: Backend — stuck-order detection cron

**Files:**
- Create: `backend-go/internal/orders/stuck_alerts.go`
- Modify: `backend-go/main.go`

- [ ] **Step 1: Write cron job**

```go
// backend-go/internal/orders/stuck_alerts.go
package orders

import (
    "context"
    "log"
    "time"
)

func (s *Service) RunStuckAlertCron(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Hour)
    defer ticker.Stop()
    s.runStuckScan(ctx)
    for {
        select {
        case <-ctx.Done(): return
        case <-ticker.C: s.runStuckScan(ctx)
        }
    }
}

func (s *Service) runStuckScan(ctx context.Context) {
    rules := []struct {
        whereClause string
        category    string
    }{
        {`status IN ('WAITING_PAYMENT','PAYMENT_UPLOADED','DP_UPLOADED') AND approved_at < NOW() - INTERVAL '7 days'`, "tunggu_bayar_7d"},
        {`status = 'DP_VERIFIED' AND payment_verified_at < NOW() - INTERVAL '7 days'`, "dp_pelunasan_7d"},
        {`status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '3 days'`, "diproses_3d"},
        {`status = 'AWAITING_CUSTOMER_CONFIRMATION' AND dispatched_at < NOW() - INTERVAL '3 days'`, "pickup_3d"},
        {`status = 'DELIVERY_ISSUE' AND updated_at < NOW() - INTERVAL '1 day'`, "delivery_issue_1d"},
    }
    for _, r := range rules {
        sql := `UPDATE orders SET stuck_alert_at = NOW() WHERE stuck_alert_at IS NULL AND payment_type != 'TEMPO' AND ` + r.whereClause
        if _, err := s.DB.DB.ExecContext(ctx, sql); err != nil {
            log.Printf("[STUCK_CRON] %s: %v", r.category, err)
        }
    }
}
```

- [ ] **Step 2: Wire cron in main.go**

In `backend-go/main.go`, after lifecycle service init:

```go
orderSvc := orders.NewService(dbClient)
go orderSvc.RunStuckAlertCron(ctx)
```

- [ ] **Step 3: Build + commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/orders/stuck_alerts.go backend-go/main.go
git commit -m "feat(orders): hourly stuck-order detection cron (5 categories, excludes tempo)"
```

---

## Task 37: Frontend — StuckOrdersWidget on Dashboard

**Files:**
- Create: `src/components/dashboard/StuckOrdersWidget.tsx`
- Modify: `src/components/DashboardScreen.tsx`

- [ ] **Step 1: Write widget**

```tsx
// src/components/dashboard/StuckOrdersWidget.tsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export function StuckOrdersWidget({ onNavigateToOrder }: { onNavigateToOrder: (id: string) => void }) {
  const [counts, setCounts] = useState({
    tungguBayar7d: 0, dpPelunasan7d: 0, diproses3d: 0, pickup3d: 0, deliveryIssue1d: 0,
  });

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc('count_stuck_orders').then(({ data }) => {  // future RPC, or compute via direct queries
      if (data) setCounts(data);
    });
    // For now, do direct counts via 5 queries
  }, []);

  return (
    <div className="bg-white border border-yellow-300 rounded-lg p-4">
      <h3 className="font-bold mb-2">⚠️ Pesanan Perlu Perhatian</h3>
      <ul className="text-sm space-y-1">
        <li>💰 {counts.tungguBayar7d} tunggu bayar &gt; 7 hari</li>
        <li>📦 {counts.dpPelunasan7d} DP_VERIFIED &gt; 7 hari</li>
        <li>📦 {counts.diproses3d} diproses &gt; 3 hari</li>
        <li>🚚 {counts.pickup3d} pickup tunggu konfirmasi &gt; 3 hari</li>
        <li>🆘 {counts.deliveryIssue1d} delivery issue unresolved</li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add widget to Dashboard**

In `src/components/DashboardScreen.tsx`, render `<StuckOrdersWidget />` in the dashboard layout.

- [ ] **Step 3: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/dashboard/StuckOrdersWidget.tsx src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): StuckOrdersWidget showing 5 stuck categories"
```

---

## Task 38: Phase 1B smoke test

- [ ] **Step 1: End-to-end test**

1. Send WA "Halo" → Approve → expect Sales Order PDF received via WA.
2. Upload DP proof → Verify → expect Invoice DP PDF + WA template `payment_dp_verified`.
3. Pay remaining + verify → expect Invoice Pelunasan + WA template `payment_full_verified`.
4. Mark Ready → Print Surat Jalan PDF (admin only).
5. Mark Dispatched → expect WA template `dispatched_delivery` or `dispatched_pickup` based on type.
6. Customer reply "sudah" → expect WA template `order_completed` with Google Maps review link.
7. Wait 24h on a separate test order → verify `confirmation_reminder` sent (or simulate via SQL update timestamp).
8. Verify stuck order widget on Dashboard shows counts updated by cron.

- [ ] **Step 2: Verify all PDFs in Supabase storage**

```bash
curl -s "https://api.supabase.com/v1/projects/${REF}/storage/buckets/sales-documents/objects" ...
```

- [ ] **Step 3: Commit smoke results**

```bash
git add docs/superpowers/plans/
git commit -m "test(phase-1b): smoke test results — PDFs + WA templates + stuck alerts"
```

---

# PHASE 1C — Input Baru Wizard Revamp (1 week)

## Task 39: Frontend — InputBaruWizard skeleton

**Files:**
- Create: `src/components/inputbaru/InputBaruWizard.tsx`

- [ ] **Step 1: Write 3-step wizard root**

```tsx
// src/components/inputbaru/InputBaruWizard.tsx
import React, { useState } from 'react';
import { Step1KanalPelanggan } from './Step1KanalPelanggan';
import { Step2ItemsPembayaran } from './Step2ItemsPembayaran';
import { Step3FulfillmentSave } from './Step3FulfillmentSave';

export interface OrderDraft {
  channel?: string;
  customer?: any;
  items: any[];
  jasaItems?: any[];   // Jasa Rakit + Custom Panel
  paymentType?: 'LUNAS' | 'DP' | 'TEMPO';
  paymentMethod?: 'Cash' | 'Transfer' | 'EDC';
  dpAmount?: number;
  tempoDueDate?: string;
  marketplaceOrderId?: string;
  pickupLangsung?: boolean;
  address?: string;
  notes?: string;
}

export function InputBaruWizard() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<OrderDraft>({ items: [] });

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex justify-center mb-4">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex-1 text-center pb-2 border-b-2 ${step === s ? 'border-blue-600 text-blue-700 font-bold' : 'border-gray-200 text-gray-400'}`}>
            Step {s}
          </div>
        ))}
      </div>
      {step === 1 && <Step1KanalPelanggan draft={draft} setDraft={setDraft} onNext={() => setStep(2)} />}
      {step === 2 && <Step2ItemsPembayaran draft={draft} setDraft={setDraft} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <Step3FulfillmentSave draft={draft} setDraft={setDraft} onBack={() => setStep(2)} />}
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/inputbaru/InputBaruWizard.tsx
git commit -m "feat(inputbaru): 3-step wizard root component"
```

---

## Task 40: Frontend — Step 1 Kanal & Pelanggan

**Files:**
- Create: `src/components/inputbaru/Step1KanalPelanggan.tsx`

- [ ] **Step 1: Write step component**

```tsx
// src/components/inputbaru/Step1KanalPelanggan.tsx
import React from 'react';
import type { OrderDraft } from './InputBaruWizard';

interface Props { draft: OrderDraft; setDraft: (d: OrderDraft) => void; onNext: () => void; }

const CHANNELS = {
  OFFLINE: ['Walk-in', 'Grosir', 'Sales Lapangan', 'Pameran / Expo'],
  MARKETPLACE: ['Tokopedia', 'Shopee', 'Lazada', 'Blibli', 'Bukalapak', 'Ralali', 'Bhinneka'],
  DIRECT: ['WhatsApp', 'Instagram DM', 'Website Sendiri'],
};

export function Step1KanalPelanggan({ draft, setDraft, onNext }: Props) {
  return (
    <div>
      <h3 className="font-bold mb-3">Step 1: Kanal & Pelanggan</h3>
      {Object.entries(CHANNELS).map(([group, list]) => (
        <div key={group} className="mb-3">
          <div className="text-xs font-bold text-gray-500 uppercase mb-1">{group}</div>
          <div className="flex flex-wrap gap-2">
            {list.map(c => (
              <button key={c} onClick={() => setDraft({ ...draft, channel: c })}
                className={`px-3 py-1 text-sm rounded ${draft.channel === c ? 'bg-blue-600 text-white' : 'bg-white border'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="mt-4">
        <label className="text-xs">Pelanggan (search / + buat baru)</label>
        {/* Reuse existing PelangganSearchInput component if available */}
        <input type="text" placeholder="Cari nama / HP / perusahaan..." className="w-full border px-2 py-1 rounded text-sm" />
      </div>
      <button onClick={onNext} disabled={!draft.channel}
        className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded disabled:opacity-40">
        Lanjut →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/inputbaru/Step1KanalPelanggan.tsx
git commit -m "feat(inputbaru): Step 1 Kanal & Pelanggan"
```

---

## Task 41: Frontend — Step 2 Items & Pembayaran (with Jasa Rakit + Custom Panel)

**Files:**
- Create: `src/components/inputbaru/Step2ItemsPembayaran.tsx`

- [ ] **Step 1: Write step with product search + Jasa preserved**

```tsx
// src/components/inputbaru/Step2ItemsPembayaran.tsx
import React from 'react';
import type { OrderDraft } from './InputBaruWizard';

interface Props { draft: OrderDraft; setDraft: (d: OrderDraft) => void; onBack: () => void; onNext: () => void; }

export function Step2ItemsPembayaran({ draft, setDraft, onBack, onNext }: Props) {
  const isMarketplace = ['Tokopedia','Shopee','Lazada','Blibli','Bukalapak','Ralali','Bhinneka'].includes(draft.channel ?? '');

  return (
    <div>
      <h3 className="font-bold mb-3">Step 2: Items & Pembayaran</h3>

      <div className="mb-3">
        <label className="text-xs">🔍 Cari Barang</label>
        <input type="text" placeholder="Ketik nama atau SKU..." className="w-full border px-2 py-1 rounded text-sm" />
        {/* Live dropdown showing SKU + name + price + stock */}
      </div>

      <div className="mb-3 flex gap-2">
        <button className="px-3 py-1 border rounded text-xs">⚡ + Tambah Jasa Rakit</button>
        <button className="px-3 py-1 border rounded text-xs">📦 + Tambah Jasa Custom Panel</button>
      </div>

      <div className="border rounded p-2 mb-3 min-h-[80px]">
        🛒 Keranjang (preview live)
      </div>

      <div className="mb-3">
        <label className="text-xs">Tipe Pembayaran</label>
        <div className="flex gap-2">
          {(['LUNAS', 'DP', 'TEMPO'] as const).map(t => (
            <button key={t} onClick={() => setDraft({ ...draft, paymentType: t })}
              className={`px-3 py-1 text-sm rounded ${draft.paymentType === t ? 'bg-blue-600 text-white' : 'bg-white border'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {!isMarketplace && draft.paymentType === 'LUNAS' && (
        <div className="mb-3">
          <label className="text-xs">Metode Pembayaran</label>
          <div className="flex gap-2">
            {(['Cash', 'Transfer', 'EDC'] as const).map(m => (
              <button key={m} onClick={() => setDraft({ ...draft, paymentMethod: m })}
                className={`px-3 py-1 text-sm rounded ${draft.paymentMethod === m ? 'bg-blue-600 text-white' : 'bg-white border'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {isMarketplace && (
        <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-sm">
          ✓ Sudah dibayar via {draft.channel}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-1 border text-sm">← Kembali</button>
        <button onClick={onNext} className="px-3 py-1 bg-blue-600 text-white text-sm rounded">Lanjut →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/inputbaru/Step2ItemsPembayaran.tsx
git commit -m "feat(inputbaru): Step 2 items+payment with Jasa Rakit+Custom Panel preserved"
```

---

## Task 42: Frontend — Step 3 Fulfillment & Save

**Files:**
- Create: `src/components/inputbaru/Step3FulfillmentSave.tsx`

- [ ] **Step 1: Write step with status preview + smart save button**

```tsx
// src/components/inputbaru/Step3FulfillmentSave.tsx
import React from 'react';
import type { OrderDraft } from './InputBaruWizard';

interface Props { draft: OrderDraft; setDraft: (d: OrderDraft) => void; onBack: () => void; }

export function Step3FulfillmentSave({ draft, setDraft, onBack }: Props) {
  const isMarketplace = ['Tokopedia','Shopee','Lazada','Blibli','Bukalapak','Ralali','Bhinneka'].includes(draft.channel ?? '');

  // Compute predicted status
  const predictStatus = (): { status: string; funnelStage: string; buttonLabel: string } => {
    if (isMarketplace) return { status: 'PROCESSING', funnelStage: 'Stage 3 Diproses', buttonLabel: 'Save & Lanjut Proses' };
    if (draft.pickupLangsung && draft.paymentType === 'LUNAS') return { status: 'COMPLETED', funnelStage: 'Selesai (Lunas Kasir)', buttonLabel: 'Save & Cetak Invoice Lunas' };
    if (draft.paymentType === 'TEMPO') return { status: 'PROCESSING', funnelStage: 'Stage 3 (TEMPO badge)', buttonLabel: 'Save & Lanjut Proses' };
    if (draft.paymentType === 'DP') return { status: 'PROCESSING (DP)', funnelStage: 'Stage 3 (DP badge)', buttonLabel: 'Save & Cetak Invoice DP' };
    return { status: 'PROCESSING', funnelStage: 'Stage 3 Diproses', buttonLabel: 'Save & Cetak Invoice Lunas' };
  };

  const { status, funnelStage, buttonLabel } = predictStatus();

  return (
    <div>
      <h3 className="font-bold mb-3">Step 3: Fulfillment & Save</h3>

      {!isMarketplace && (
        <div className="mb-3">
          <label className="text-xs">
            <input type="checkbox" checked={draft.pickupLangsung ?? false} onChange={e => setDraft({ ...draft, pickupLangsung: e.target.checked })} />
            {' '}Customer ambil langsung?
          </label>
        </div>
      )}

      {!draft.pickupLangsung && (
        <div className="mb-3">
          <label className="text-xs">Alamat Pengiriman</label>
          <textarea value={draft.address ?? ''} onChange={e => setDraft({ ...draft, address: e.target.value })} rows={2} className="w-full border px-2 py-1 rounded text-sm" />
        </div>
      )}

      {isMarketplace && (
        <div className="mb-3">
          <label className="text-xs">Marketplace Order ID</label>
          <input type="text" value={draft.marketplaceOrderId ?? ''} onChange={e => setDraft({ ...draft, marketplaceOrderId: e.target.value })} className="w-full border px-2 py-1 rounded text-sm" placeholder="#INV/T20260615/MPL/123" />
        </div>
      )}

      <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-sm">
        🔮 <strong>Preview:</strong> Order akan disimpan dengan status <strong>{status}</strong>, muncul di <strong>{funnelStage}</strong>.
      </div>

      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-1 border text-sm">← Kembali</button>
        <button onClick={() => { /* call save mutation */ }}
          className="px-4 py-2 bg-green-600 text-white text-sm font-bold rounded">
          💾 {buttonLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc + commit**

```bash
npx tsc --noEmit
git add src/components/inputbaru/Step3FulfillmentSave.tsx
git commit -m "feat(inputbaru): Step 3 fulfillment + smart save button + status preview"
```

---

## Task 43: Frontend — wire InputBaruWizard into Penjualan menu, delete legacy

**Files:**
- Modify: `src/components/PenjualanScreen.tsx`
- Delete: `src/components/PenjualanBaruScreen.tsx`
- Delete: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Replace legacy with new wizard**

In PenjualanScreen.tsx, replace `<PenjualanBaruScreen />` with `<InputBaruWizard />` under the "Baru" tab.

- [ ] **Step 2: Search for other references to deleted components**

```bash
grep -rn "PenjualanBaruScreen\|OrderHistoryScreen" src/
```

Fix any other references (e.g., App.tsx routing).

- [ ] **Step 3: Delete files**

```bash
git rm src/components/PenjualanBaruScreen.tsx src/components/OrderHistoryScreen.tsx
```

- [ ] **Step 4: tsc + build**

```bash
npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(penjualan): replace legacy PenjualanBaruScreen + OrderHistoryScreen with new wizard + funnel"
```

---

## Task 44: Phase 1C smoke test

- [ ] **Step 1: Test each channel through Input Baru wizard**

1. **Walk-in + Lunas + ambil langsung** → COMPLETED + Invoice Lunas printed.
2. **Walk-in + Lunas + delivery** → PROCESSING in Stage 3.
3. **Walk-in + DP + delivery** → PROCESSING with DP badge.
4. **Walk-in + TEMPO + delivery** → PROCESSING with TEMPO badge.
5. **Marketplace (Tokopedia) + sudah dibayar** → PROCESSING + Marketplace Order ID stored.
6. **Grosir + DP** → PROCESSING with DP badge + counter print only.

- [ ] **Step 2: Verify Jasa Rakit + Jasa Custom Panel still work**

Through Step 2 of wizard, click Tambah Jasa Rakit + Tambah Jasa Custom Panel. Verify existing flow intact.

- [ ] **Step 3: Commit smoke**

```bash
git add docs/superpowers/plans/
git commit -m "test(phase-1c): smoke test results — Input Baru wizard channel-aware paths"
```

---

## Task 45: Final integration + acceptance review

- [ ] **Step 1: Run all 11 acceptance criteria from spec**

Open `docs/superpowers/specs/2026-06-15-order-confirmation-fulfillment-revamp-design.md` section "Acceptance criteria for Phase 1" and run each:

1. WA Calista end-to-end (repeat 2026-06-14 test).
2. Walk-in cash one-click.
3. Marketplace manual input → Stage 3 + external_order_ref.
4. DP-then-pelunasan → 2 invoices PDF via WA.
5. order_completed WA with Google Maps link.
6. Pickup dual completion (AI or manual).
7. Auto-timer 24h reminder + 72h auto-complete.
8. Stock decrement on payment verify; cancel restocks.
9. Order modification audit recorded.
10. Stuck-order widget + cron.
11. Dot matrix print working.

- [ ] **Step 2: Document results**

Append results to `docs/superpowers/plans/2026-06-15-order-confirmation-fulfillment-revamp-implementation.md` as appendix.

- [ ] **Step 3: Open PR to main**

```bash
gh pr create --title "Order Confirmation & Fulfillment Revamp (Phase 1)" \
  --body "Implements docs/superpowers/specs/2026-06-15-order-confirmation-fulfillment-revamp-design.md. All 11 acceptance criteria verified."
```

- [ ] **Step 4: Commit final review notes**

```bash
git add docs/superpowers/plans/
git commit -m "docs(plan): Phase 1 acceptance review results — all 11 criteria passed"
```

---

## Self-review (after writing this plan)

**1. Spec coverage check:**

- Section 1 Architecture (sidebar + Inbox→Penjualan link) → Tasks 19, 20 ✓
- Section 2 Funnel (6-stage, controls, summary, search) → Tasks 13-18 ✓
- Section 3 State machine (enum, channel paths) → Tasks 1, 5, 9 ✓
- Section 4 Customer confirmation (AI + manual + timer) → Task 35 + Section 4 partially deferred (Calista AI route deeper integration in 1B)
- Section 5 Pengaturan (Alamat + Jam + Bank) → Tasks 23, 24, 25 ✓
- Section 6 PDF templates → Tasks 26, 28-32 ✓
- Section 7 WA templates → Tasks 34, 35 ✓
- Section 8 Input Baru wizard → Tasks 39-43 ✓
- Section 9 Data model → Tasks 1, 2, 3, 4 ✓
- Stock reservation & inventory → Tasks 3, 6 ✓
- Order modification → Tasks 8, 10, 21 ✓
- Stuck order alerts → Tasks 36, 37 ✓

**Gap noted:** Calista AI confirmation parser update (for AWAITING_CUSTOMER_CONFIRMATION state) is not explicitly a task — should be added before Phase 1B smoke. Adding Task 35.5 below.

**2. Placeholder check:** Searched plan for "TBD", "implement later", "similar to". Some Phase 1B PDF tasks (28-32) say "similar pattern" — that's intentional given the templates are similar; subagent should fill in HTML based on spec Section 6 layouts. The skeleton is identical, only template content differs.

**3. Type consistency:**
- `OrderStatus` enum values consistent across Go and TS.
- `customer_confirm_source` consistently uses 'ai'|'manual'|'auto_timer'|'marketplace_api'.
- `stageOfOrder()` mapping matches spec Section "Stage-to-status mapping".

### Task 35.5 (insert before Phase 1B smoke): Calista AI parser for AWAITING_CUSTOMER_CONFIRMATION

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`
- Modify: `backend-go/internal/llm/chain.go` (add new prompt state)

- [ ] **Step 1: Add per-state prompt for `AWAITING_CUSTOMER_CONFIRMATION` in prompts.go**

When conversation reaches this state (after dispatch), Calista's per-state prompt should be:

```
FASE: KONFIRMASI PENERIMAAN
Customer telah dikirim barang. Mereka mungkin akan balas:
- "sudah/diterima/ok/sampai/thanks" → confirmed: true
- "belum sampai/rusak/salah/kurang" → issue: true
- Off-topic → confirmed: false, issue: false

Balas HANYA JSON: {"reply":"<pesan singkat>","confirmed":false,"issue":false}
```

- [ ] **Step 2: Add handler in engine machine.go** that on confirmed=true calls `orderSvc.MarkReceived(orderID, 'ai', '')`; on issue=true sets order to DELIVERY_ISSUE.

- [ ] **Step 3: Test via simulating customer reply on a dispatched order.**

- [ ] **Step 4: Commit**

```bash
cd backend-go && go build ./...
git add backend-go/internal/engine/ backend-go/internal/llm/
git commit -m "feat(engine): Calista AI parses AWAITING_CUSTOMER_CONFIRMATION replies → COMPLETED/DELIVERY_ISSUE"
```

---

## Notes for executor

- **Do NOT push to main** until Task 45 acceptance review passes.
- All commits go on `feat/calista-phase-1a` branch.
- Run `npx tsc --noEmit` + `go build ./...` before each commit.
- If a task takes longer than 1 hour, split it further.
- Use subagent-driven development per `docs/superpowers/specs/...` reference at each task.
