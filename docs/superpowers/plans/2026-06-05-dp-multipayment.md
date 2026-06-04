# DP & Multi-Payment Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DP (downpayment) payment mode alongside full payment — admin sets payment type on order confirmation, customer sends up to 2 proof photos via WhatsApp, auto-replace before verification, admin can reject with reason.

**Architecture:** Supabase migration adds 6 new columns + 2 Postgres NOTIFY triggers (dp_verified, dp_proof_rejected). Go backend adds 3 new OrderStatus constants, new DB methods, and 2 new WA notification handlers. Frontend extends the confirm panel, adds a DP_UPLOADED expand panel, a RejectProofModal component, and updates status maps and tab counts.

**Tech Stack:** PostgreSQL (Supabase), Go 1.25, React 18 + TypeScript, Tailwind CSS, supabase-js

---

## File Map

**Create:**
- `supabase/migrations/20260605000004_dp_payment.sql` — column rename + new columns + 2 NOTIFY triggers

**Modify:**
- `backend-go/internal/models/types.go` — 4 new OrderStatus constants + 5 new Order struct fields
- `backend-go/internal/db/payment.go` — 4 new DB methods + update UpdatePaymentProof SQL
- `backend-go/internal/db/orders.go` — update GetOrderByConversation SELECT to include new columns
- `backend-go/internal/db/client.go` — 2 new NotifyHandlers + 2 new LISTEN channels
- `backend-go/internal/whatsapp/handler.go` — update proof routing switch + HandleApprovedOrder DP logic + 2 new handler funcs
- `backend-go/main.go` — wire 2 new handlers into StartListening call
- `src/types.ts` — 3 new status values + 6 new DbOrder fields
- `src/lib/supabaseClient.ts` — status maps + tab filters + approveOrder extension + 3 new service funcs
- `src/components/OrderHistoryScreen.tsx` — confirm panel DP selector + DP_UPLOADED panel + RejectProofModal + DP_VERIFIED panel + PAYMENT_UPLOADED DP context + status maps/counts

---

## Task 1: Supabase Migration

**Files:**
- Create: `supabase/migrations/20260605000004_dp_payment.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration: DP payment support
-- Renames payment_proof_url → full_proof_url, adds DP columns, adds 2 NOTIFY triggers.

-- 1. Rename existing proof URL column
ALTER TABLE orders RENAME COLUMN payment_proof_url TO full_proof_url;

-- 2. Add new columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_type    text    NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS dp_input_type   text,
  ADD COLUMN IF NOT EXISTS dp_value        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_amount       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_proof_url    text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 3. Constraints
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_payment_type,
  DROP CONSTRAINT IF EXISTS chk_dp_input_type;
ALTER TABLE orders
  ADD CONSTRAINT chk_payment_type CHECK (payment_type IN ('FULL', 'DP')),
  ADD CONSTRAINT chk_dp_input_type CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT', 'PERCENTAGE'));

-- 4. NOTIFY trigger: dp_verified
--    Fires when admin sets status → DP_VERIFIED. Handler sends WA asking for full payment.
CREATE OR REPLACE FUNCTION notify_dp_verified() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'DP_VERIFIED' AND OLD.status IS DISTINCT FROM 'DP_VERIFIED' THEN
    PERFORM pg_notify('dp_verified', json_build_object(
      'order_id',        NEW.id,
      'conversation_id', NEW.conversation_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_dp_verified' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_dp_verified
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_dp_verified();
  END IF;
END $$;

-- 5. NOTIFY trigger: dp_proof_rejected
--    Fires when admin sets status → DP_PROOF_REJECTED. Handler sends WA and resets to WAITING_DP.
CREATE OR REPLACE FUNCTION notify_dp_proof_rejected() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'DP_PROOF_REJECTED' AND OLD.status IS DISTINCT FROM 'DP_PROOF_REJECTED' THEN
    PERFORM pg_notify('dp_proof_rejected', json_build_object(
      'order_id',        NEW.id,
      'conversation_id', NEW.conversation_id,
      'reason',          COALESCE(NEW.rejection_reason, '')
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_dp_proof_rejected' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_dp_proof_rejected
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_dp_proof_rejected();
  END IF;
END $$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool:
- project_id: `ekhhojaezdfjfwuxyjkl`
- name: `dp_payment`
- query: contents of the SQL above

- [ ] **Step 3: Verify migration applied**

Run via `execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('full_proof_url','payment_type','dp_input_type','dp_value','dp_amount','dp_proof_url','rejection_reason')
ORDER BY column_name;
```
Expected: 7 rows returned.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/20260605000004_dp_payment.sql
git commit -m "feat(migration): rename payment_proof_url→full_proof_url, add DP columns + NOTIFY triggers"
```

---

## Task 2: Go Models + DB Methods

**Files:**
- Modify: `backend-go/internal/models/types.go`
- Modify: `backend-go/internal/db/payment.go`
- Modify: `backend-go/internal/db/orders.go`

- [ ] **Step 1: Add new OrderStatus constants to `backend-go/internal/models/types.go`**

After line `OrderStatusWaitingPayment OrderStatus = "WAITING_PAYMENT"`, add:

```go
OrderStatusWaitingDP      OrderStatus = "WAITING_DP"
OrderStatusDPUploaded     OrderStatus = "DP_UPLOADED"
OrderStatusDPVerified     OrderStatus = "DP_VERIFIED"
OrderStatusDPProofRejected OrderStatus = "DP_PROOF_REJECTED"
```

- [ ] **Step 2: Add new fields to `Order` struct in `backend-go/internal/models/types.go`**

After `PaymentProofURL string \`json:"payment_proof_url,omitempty"\``, replace with:

```go
FullProofURL    string  `json:"full_proof_url,omitempty"`
DPProofURL      string  `json:"dp_proof_url,omitempty"`
PaymentType     string  `json:"payment_type,omitempty"`
DPAmount        float64 `json:"dp_amount,omitempty"`
RejectionReason string  `json:"rejection_reason,omitempty"`
```

- [ ] **Step 3: Update DB methods in `backend-go/internal/db/payment.go`**

Replace entire file with:

```go
package db

// UpdatePaymentProof stores the full payment proof URL and advances to PAYMENT_UPLOADED.
func (c *Client) UpdatePaymentProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET full_proof_url = $1, status = 'PAYMENT_UPLOADED' WHERE id = $2
	`, url, orderID)
	return err
}

// UpdateDPProof stores the DP proof URL and advances to DP_UPLOADED.
func (c *Client) UpdateDPProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET dp_proof_url = $1, status = 'DP_UPLOADED' WHERE id = $2
	`, url, orderID)
	return err
}

// VerifyDPPayment advances status to DP_VERIFIED. Postgres trigger fires dp_verified NOTIFY.
func (c *Client) VerifyDPPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'DP_VERIFIED' WHERE id = $1
	`, orderID)
	return err
}

// RejectDPProof sets status to DP_PROOF_REJECTED with optional reason.
// Postgres trigger fires dp_proof_rejected NOTIFY; handler resets to WAITING_DP.
func (c *Client) RejectDPProof(orderID, reason string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'DP_PROOF_REJECTED', rejection_reason = $1, dp_proof_url = NULL WHERE id = $2
	`, reason, orderID)
	return err
}

// RejectPayment resets status to WAITING_PAYMENT. Used for both FULL and DP full-proof rejection.
func (c *Client) RejectPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_PAYMENT', full_proof_url = NULL WHERE id = $1
	`, orderID)
	return err
}

// ResetDPToWaiting is called by handler after dp_proof_rejected is processed.
func (c *Client) ResetDPToWaiting(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_DP', rejection_reason = NULL WHERE id = $1
	`, orderID)
	return err
}
```

- [ ] **Step 4: Update `GetOrderByConversation` SELECT in `backend-go/internal/db/orders.go`**

Find the RETURNING / SELECT clause in `GetOrderByConversation` (around line 136). Add `payment_type`, `dp_amount`, `COALESCE(dp_proof_url,'')`, `COALESCE(full_proof_url,'')` to the SELECT and corresponding Scan. The exact edit depends on what the current query looks like — search for `GetOrderByConversation` and add these columns.

Current SELECT likely ends with `created_at, updated_at`. Change the query to:

```go
func (c *Client) GetOrderByConversation(conversationID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, COALESCE(shipping_fee,0), total, status,
		       booking_expires_at, created_at, updated_at,
		       COALESCE(payment_type,'FULL'), COALESCE(dp_amount,0),
		       COALESCE(dp_proof_url,''), COALESCE(full_proof_url,'')
		FROM orders WHERE conversation_id = $1
		ORDER BY created_at DESC LIMIT 1
	`, conversationID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.ShippingFee, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
		&order.PaymentType, &order.DPAmount,
		&order.DPProofURL, &order.FullProofURL,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(itemsJSON, &order.Items); err != nil {
		return nil, err
	}
	return &order, nil
}
```

> Note: `ShippingFee` in the existing struct is `*float64`. Use `&order.ShippingFeeVal` (a local `float64`) and assign: match the existing scan pattern in the file.

- [ ] **Step 5: Build to verify**

```bash
cd backend-go && go build ./...
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/models/types.go backend-go/internal/db/payment.go backend-go/internal/db/orders.go
git commit -m "feat(go): add DP order status constants, DB methods, updated Order struct"
```

---

## Task 3: Go Handler + Client Wiring

**Files:**
- Modify: `backend-go/internal/db/client.go`
- Modify: `backend-go/internal/whatsapp/handler.go`
- Modify: `backend-go/main.go`

- [ ] **Step 1: Add new NotifyHandlers + channels to `backend-go/internal/db/client.go`**

In `NotifyHandlers` struct, add after `OnPaymentRejected`:
```go
OnDPVerified      func(orderID, conversationID string)
OnDPProofRejected func(orderID, conversationID, reason string)
```

In `StartListening`, add `"dp_verified"` and `"dp_proof_rejected"` to the channels slice:
```go
channels := []string{"admin_messages", "order_approved", "payment_verified", "payment_rejected", "dp_verified", "dp_proof_rejected"}
```

Add two new cases in the switch inside `StartListening`:

```go
case "dp_verified":
    var p struct {
        OrderID        string `json:"order_id"`
        ConversationID string `json:"conversation_id"`
    }
    if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
        log.Printf("[DB] dp_verified parse error: %v", err)
        continue
    }
    if h.OnDPVerified != nil {
        go h.OnDPVerified(p.OrderID, p.ConversationID)
    }

case "dp_proof_rejected":
    var p struct {
        OrderID        string `json:"order_id"`
        ConversationID string `json:"conversation_id"`
        Reason         string `json:"reason"`
    }
    if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
        log.Printf("[DB] dp_proof_rejected parse error: %v", err)
        continue
    }
    if h.OnDPProofRejected != nil {
        go h.OnDPProofRejected(p.OrderID, p.ConversationID, p.Reason)
    }
```

Update the log line to include new channels:
```go
log.Println("[DB] LISTEN/NOTIFY active on admin_messages, order_approved, payment_verified, payment_rejected, dp_verified, dp_proof_rejected")
```

- [ ] **Step 2: Update payment proof routing in `backend-go/internal/whatsapp/handler.go`**

Find line ~310 which currently reads:
```go
if orderErr != nil || order == nil || order.Status != models.OrderStatusWaitingPayment || (img == nil && doc == nil) {
```

Replace the condition to accept DP statuses too:
```go
isPaymentStatus := order != nil && (
    order.Status == models.OrderStatusWaitingPayment ||
    order.Status == models.OrderStatusPaymentUploaded ||
    order.Status == models.OrderStatusWaitingDP ||
    order.Status == models.OrderStatusDPUploaded ||
    order.Status == models.OrderStatusDPVerified)

if orderErr != nil || order == nil || !isPaymentStatus || (img == nil && doc == nil) {
```

After the `proofURL == ""` early return, find the block that calls `h.db.UpdatePaymentProof`. Replace with a switch:

```go
// Route proof to correct column based on order status.
switch order.Status {
case models.OrderStatusWaitingDP, models.OrderStatusDPUploaded:
    if err := h.db.UpdateDPProof(order.ID, proofURL); err != nil {
        log.Printf("[HANDLER] UpdateDPProof error for order %s: %v", order.ID, err)
    }
default: // WAITING_PAYMENT, PAYMENT_UPLOADED, DP_VERIFIED
    if err := h.db.UpdatePaymentProof(order.ID, proofURL); err != nil {
        log.Printf("[HANDLER] UpdatePaymentProof error for order %s: %v", order.ID, err)
    }
}
h.db.InsertMessage(conv.ID, models.SenderCustomer, "[Payment proof uploaded]")
```

The ack message and recipient notify block below remain unchanged.

- [ ] **Step 3: Update `HandleApprovedOrder` for DP vs FULL in `backend-go/internal/whatsapp/handler.go`**

In `HandleApprovedOrder` (around line 398), after computing `total` and sending the invoice, replace the final `UpdateOrderStatus` call:

```go
// Set next status and send appropriate payment instructions.
if order.PaymentType == "DP" {
    dpMsg := fmt.Sprintf("💳 *Instruksi Pembayaran DP*\n\nHalo Bapak/Ibu %s,\norder Anda telah dikonfirmasi!\n\nSilakan transfer *DP sebesar Rp %.0f* ke:\nBank %s — %s a/n %s\n\nSetelah transfer, kirim foto bukti pembayaran di sini. 🙏",
        order.CustomerName, order.DPAmount,
        bankName(bank), bankAccount(bank), bankOwner(bank))
    if conv := order; conv.ConversationID != "" { // language check
        lang := "id"
        h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, order.ConversationID).Scan(&lang)
        if lang == "en" {
            dpMsg = fmt.Sprintf("💳 *DP Payment Instructions*\n\nHi %s, your order has been confirmed!\n\nPlease transfer the *DP of Rp %.0f* to:\nBank %s — %s (%s)\n\nAfter transferring, send your proof of payment here. 🙏",
                order.CustomerName, order.DPAmount, bankName(bank), bankAccount(bank), bankOwner(bank))
        }
    }
    h.sender.SendText(ctx, order.CustomerPhone, dpMsg)
    h.db.UpdateOrderStatus(orderID, string(models.OrderStatusWaitingDP))
} else {
    // existing invoice already sent above — just set status
    h.db.UpdateOrderStatus(orderID, string(models.OrderStatusWaitingPayment))
}
h.db.UpdateConversationState(conversationID, models.StateBooked)
```

Add helper functions (after `HandleApprovedOrder`):
```go
func bankName(b *models.BankConfig) string {
    if b != nil { return b.BankName }
    return "BCA"
}
func bankAccount(b *models.BankConfig) string {
    if b != nil { return b.AccountNumber }
    return "1234567890"
}
func bankOwner(b *models.BankConfig) string {
    if b != nil { return b.AccountName }
    return "Garindo Jaya Panel"
}
```

> Note: The existing `buildInvoiceMessage` function already sends for FULL orders — keep calling it for FULL, just skip it for DP and use `dpMsg` instead. Refactor `HandleApprovedOrder` accordingly.

- [ ] **Step 4: Add `HandleDPVerified` to `backend-go/internal/whatsapp/handler.go`**

Add after `HandlePaymentVerified`:

```go
// HandleDPVerified is called when admin verifies the DP proof. Sends WA asking customer for full payment.
func (h *Handler) HandleDPVerified(ctx context.Context, orderID, conversationID string) {
    order, err := h.db.GetOrderByConversation(conversationID)
    if err != nil || order == nil {
        log.Printf("[HANDLER] HandleDPVerified: GetOrderByConversation error for %s: %v", conversationID, err)
        return
    }

    lang := "id"
    h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

    remaining := order.Total - order.DPAmount
    msg := fmt.Sprintf("✅ *DP Terverifikasi!*\n\nTerima kasih Bapak/Ibu %s, DP Anda sebesar Rp %.0f telah kami konfirmasi.\n\nSilakan lunasi sisa pembayaran sebesar *Rp %.0f* dan kirim bukti transfernya di sini. 🙏",
        order.CustomerName, order.DPAmount, remaining)
    if lang == "en" {
        msg = fmt.Sprintf("✅ *DP Verified!*\n\nThank you %s, your downpayment of Rp %.0f has been confirmed.\n\nPlease transfer the remaining *Rp %.0f* and send your proof of payment here. 🙏",
            order.CustomerName, order.DPAmount, remaining)
    }

    if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
        log.Printf("[HANDLER] HandleDPVerified: SendText error: %v", err)
    }
    h.db.InsertMessage(conversationID, models.SenderSystem, "DP_VERIFIED: customer notified to send full payment")
}
```

- [ ] **Step 5: Add `HandleDPProofRejected` to `backend-go/internal/whatsapp/handler.go`**

Add after `HandleDPVerified`:

```go
// HandleDPProofRejected is called when admin rejects the DP proof. Sends WA and resets to WAITING_DP.
func (h *Handler) HandleDPProofRejected(ctx context.Context, orderID, conversationID, reason string) {
    order, err := h.db.GetOrderByConversation(conversationID)
    if err != nil || order == nil {
        log.Printf("[HANDLER] HandleDPProofRejected: GetOrderByConversation error for %s: %v", conversationID, err)
        return
    }

    lang := "id"
    h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

    reasonSuffix := ""
    if reason != "" {
        reasonSuffix = " — " + reason
    }
    msg := fmt.Sprintf("⚠️ *Bukti DP Ditolak*\n\nMohon maaf Bapak/Ibu %s, bukti DP Anda tidak dapat kami konfirmasi%s.\n\nTolong kirim ulang foto bukti transfer DP yang jelas. 🙏",
        order.CustomerName, reasonSuffix)
    if lang == "en" {
        msg = fmt.Sprintf("⚠️ *DP Proof Rejected*\n\nSorry %s, your DP payment proof could not be confirmed%s.\n\nPlease resend a clear photo of your DP transfer receipt. 🙏",
            order.CustomerName, reasonSuffix)
    }

    if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
        log.Printf("[HANDLER] HandleDPProofRejected: SendText error: %v", err)
    }
    h.db.InsertMessage(conversationID, models.SenderSystem, "DP_PROOF_REJECTED: customer notified")
    if err := h.db.ResetDPToWaiting(orderID); err != nil {
        log.Printf("[HANDLER] ResetDPToWaiting error for order %s: %v", orderID, err)
    }
}
```

- [ ] **Step 6: Wire new handlers in `backend-go/main.go`**

Find the `dbClient.StartListening(db.NotifyHandlers{...})` call (around line 102). Add two new fields:

```go
OnDPVerified: func(orderID, conversationID string) {
    waHandler.HandleDPVerified(context.Background(), orderID, conversationID)
},
OnDPProofRejected: func(orderID, conversationID, reason string) {
    waHandler.HandleDPProofRejected(context.Background(), orderID, conversationID, reason)
},
```

- [ ] **Step 7: Build to verify**

```bash
cd backend-go && go build ./...
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend-go/internal/db/client.go backend-go/internal/whatsapp/handler.go backend-go/main.go
git commit -m "feat(go): DP payment proof routing + HandleDPVerified + HandleDPProofRejected handlers"
```

---

## Task 4: Frontend Types + Service Layer

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add new status values to `src/types.ts`**

In the `DbOrder` type (around line 175), find the `status` union and add after `'WAITING_PAYMENT'`:

```typescript
  status:
    | 'PENDING'
    | 'PENDING_ADMIN_CONFIRMATION'
    | 'PENDING_PRICE_NEGO'
    | 'PENDING_STOCK_CHECK'
    | 'PENDING_CUSTOM_QUOTE'
    | 'PENDING_WIRING_QUOTE'
    | 'APPROVED'
    | 'WAITING_PAYMENT'
    | 'WAITING_DP'
    | 'DP_UPLOADED'
    | 'DP_VERIFIED'
    | 'DP_PROOF_REJECTED'
    | 'PAYMENT_UPLOADED'
    | 'PAYMENT_VERIFIED'
    | 'PAYMENT_REJECTED'
    | 'CANCELLED'
    | 'COMPLETED';
```

After `payment_proof_url?: string;` (line 194), replace with:

```typescript
  full_proof_url?: string | null;
  dp_proof_url?: string | null;
  payment_type?: 'FULL' | 'DP';
  dp_input_type?: 'AMOUNT' | 'PERCENTAGE';
  dp_value?: number;
  dp_amount?: number;
  rejection_reason?: string | null;
```

- [ ] **Step 2: Add status maps to `src/lib/supabaseClient.ts`**

Find `ORDER_STATUS_CONFIG` (around line 16). Add after `WAITING_PAYMENT` entry:

```typescript
WAITING_DP:       { label: '⏳ Menunggu DP',      className: 'bg-yellow-100 text-yellow-800' },
DP_UPLOADED:      { label: '📎 Bukti DP Dikirim',  className: 'bg-indigo-100 text-indigo-800' },
DP_VERIFIED:      { label: '✓ DP Lunas',           className: 'bg-teal-100 text-teal-800' },
DP_PROOF_REJECTED:{ label: '✕ DP Ditolak',         className: 'bg-red-100 text-red-800' },
```

Find `ORDER_STATUS_TEXT_COLOR` map. Add:
```typescript
WAITING_DP:        'text-yellow-700',
DP_UPLOADED:       'text-indigo-700',
DP_VERIFIED:       'text-teal-700',
DP_PROOF_REJECTED: 'text-red-700',
```

Find `ORDER_STATUS_BORDER` map. Add:
```typescript
DP_UPLOADED: 'border-l-4 border-l-indigo-500',
```

- [ ] **Step 3: Update `filterOrders` tab logic in `src/lib/supabaseClient.ts` (or `OrderHistoryScreen.tsx`)**

Find where `filterOrders` is defined (around line 47 of OrderHistoryScreen.tsx):

```typescript
if (tab === 'waiting')   filtered = orders.filter(o => o.status === 'WAITING_PAYMENT' || o.status === 'WAITING_DP');
if (tab === 'uploaded')  filtered = orders.filter(o => o.status === 'PAYMENT_UPLOADED' || o.status === 'DP_UPLOADED');
```

- [ ] **Step 4: Extend `approveOrder` in `src/lib/supabaseClient.ts`**

Replace current `approveOrder`:

```typescript
async approveOrder(
  orderId: string,
  shippingFee: number,
  paymentType: 'FULL' | 'DP',
  dpInputType?: 'AMOUNT' | 'PERCENTAGE',
  dpValue?: number,
  dpAmount?: number,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({
      shipping_fee: shippingFee,
      status: 'APPROVED',
      payment_type: paymentType,
      dp_input_type: paymentType === 'DP' ? dpInputType : null,
      dp_value: paymentType === 'DP' ? (dpValue ?? 0) : 0,
      dp_amount: paymentType === 'DP' ? (dpAmount ?? 0) : 0,
    })
    .eq('id', orderId);
  if (error) throw error;
},
```

- [ ] **Step 5: Add new service functions to `src/lib/supabaseClient.ts`**

Add after `rejectPayment`:

```typescript
async verifyDPPayment(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({ status: 'DP_VERIFIED' })
    .eq('id', orderId);
  if (error) throw error;
},

async rejectDPProof(orderId: string, reason: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({ status: 'DP_PROOF_REJECTED', rejection_reason: reason || null, dp_proof_url: null })
    .eq('id', orderId);
  if (error) throw error;
},

async rejectFullProof(orderId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('orders')
    .update({ status: 'PAYMENT_REJECTED', full_proof_url: null })
    .eq('id', orderId);
  if (error) throw error;
},
```

- [ ] **Step 6: TypeScript check**

```bash
cd /path/to/project && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts
git commit -m "feat(frontend): add DP types, status maps, and service functions"
```

---

## Task 5: Frontend — Order Confirm Panel (Payment Type Selector)

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add state for payment type in `OrderHistoryScreen`**

Add after existing state declarations (around line 141):

```typescript
const [paymentTypes, setPaymentTypes] = useState<Record<string, 'FULL' | 'DP'>>({});
const [dpInputTypes, setDpInputTypes] = useState<Record<string, 'AMOUNT' | 'PERCENTAGE'>>({});
const [dpValues, setDpValues] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Extend `handleApprove` to pass payment type**

Replace `handleApprove`:

```typescript
const handleApprove = async (orderId: string, deliveryType: string | undefined, orderTotal: number) => {
  const fee = deliveryType === 'PICKUP' ? 0 : parseFloat(shippingFees[orderId] ?? '0');
  const paymentType = paymentTypes[orderId] ?? 'FULL';
  const dpInputType = dpInputTypes[orderId] ?? 'AMOUNT';
  const dpVal = parseFloat(dpValues[orderId] ?? '0');
  const dpAmount = paymentType === 'DP'
    ? (dpInputType === 'PERCENTAGE' ? (orderTotal + fee) * dpVal / 100 : dpVal)
    : 0;

  if (paymentType === 'DP' && (dpAmount <= 0 || dpAmount >= orderTotal + fee)) {
    showToast('Nominal DP harus lebih dari 0 dan kurang dari total order.', 'warning');
    return;
  }

  setApprovingId(orderId);
  try {
    await orderService.approveOrder(orderId, fee, paymentType, dpInputType, dpVal, dpAmount);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'APPROVED', shipping_fee: fee } : o));
    setExpandedId(null);
    showToast('Pesanan berhasil disetujui.', 'success');
  } catch {
    showToast('Gagal menyetujui pesanan.', 'warning');
  } finally {
    setApprovingId(null);
  }
};
```

- [ ] **Step 3: Add payment type selector to `PENDING_ADMIN_CONFIRMATION` panel**

In the expand panel for `PENDING_ADMIN_CONFIRMATION` (around line 356), find the right column with "Tetapkan Ongkir". After the shipping fee input block, add before the Approve button:

```tsx
{/* Payment type selector */}
<div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center mt-2">Tipe Pembayaran</div>
<div className="flex gap-2 justify-center">
  {(['FULL', 'DP'] as const).map(t => (
    <button
      key={t}
      onClick={() => setPaymentTypes(prev => ({ ...prev, [order.id]: t }))}
      className={`text-xs px-3 py-1 rounded-full border font-bold transition-all ${
        (paymentTypes[order.id] ?? 'FULL') === t
          ? 'bg-purple-600 text-white border-purple-600'
          : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'
      }`}
    >
      {t === 'FULL' ? 'Full' : 'DP'}
    </button>
  ))}
</div>

{/* DP input — shown only when DP selected */}
{(paymentTypes[order.id] ?? 'FULL') === 'DP' && (
  <div className="mt-1">
    <div className="flex gap-1 mb-1 justify-center">
      {(['AMOUNT', 'PERCENTAGE'] as const).map(t => (
        <button
          key={t}
          onClick={() => setDpInputTypes(prev => ({ ...prev, [order.id]: t }))}
          className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
            (dpInputTypes[order.id] ?? 'AMOUNT') === t
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {t === 'AMOUNT' ? 'Nominal' : '%'}
        </button>
      ))}
    </div>
    <div className="flex items-center gap-1 bg-gray-50 border border-purple-200 rounded-lg px-2 py-1">
      {(dpInputTypes[order.id] ?? 'AMOUNT') === 'AMOUNT' && <span className="text-gray-400 text-xs">Rp</span>}
      <input
        type="number"
        min="0"
        className="flex-1 bg-transparent text-sm font-bold text-gray-700 outline-none w-20"
        placeholder={dpInputTypes[order.id] === 'PERCENTAGE' ? '50' : '500000'}
        value={dpValues[order.id] ?? ''}
        onChange={e => setDpValues(prev => ({ ...prev, [order.id]: e.target.value }))}
      />
      {(dpInputTypes[order.id] ?? 'AMOUNT') === 'PERCENTAGE' && <span className="text-gray-400 text-xs">%</span>}
    </div>
    {/* Preview computed IDR amount when % selected */}
    {(dpInputTypes[order.id] ?? 'AMOUNT') === 'PERCENTAGE' && dpValues[order.id] && (
      <div className="text-[9px] text-indigo-600 font-semibold mt-0.5 text-center">
        = Rp {Math.round((order.total ?? 0) * parseFloat(dpValues[order.id]) / 100).toLocaleString('id-ID')}
      </div>
    )}
  </div>
)}
```

Update the Approve button's `onClick` to pass `order.total`:

```tsx
onClick={() => handleApprove(order.id, order.delivery_type, order.total ?? 0)}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors from these changes.

- [ ] **Step 5: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(ui): add payment type selector (Full/DP) to order confirm panel"
```

---

## Task 6: Frontend — DP_UPLOADED Panel + RejectProofModal

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add `RejectProofModal` component (bottom of file, before export)**

```tsx
interface RejectProofModalProps {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  loading: boolean;
}
function RejectProofModal({ onConfirm, onCancel, loading }: RejectProofModalProps) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
        <h3 className="text-sm font-bold text-gray-800 mb-1">Tolak Bukti Transfer</h3>
        <p className="text-xs text-gray-400 mb-4">Customer akan dinotifikasi via WhatsApp untuk kirim ulang.</p>
        <textarea
          className="w-full border border-gray-200 rounded-lg p-3 text-xs resize-none outline-none focus:border-red-300"
          rows={3}
          placeholder="Alasan penolakan (opsional)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Batal
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading}
            className="px-4 py-2 text-xs font-bold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40"
          >
            {loading ? 'Memproses...' : 'Tolak & Notifikasi'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add state and handlers for DP verification/rejection**

Add to component state block:

```typescript
const [verifyingDPId, setVerifyingDPId] = useState<string | null>(null);
const [rejectDPModalOrderId, setRejectDPModalOrderId] = useState<string | null>(null);
const [rejectingDPId, setRejectingDPId] = useState<string | null>(null);
```

Add handler functions:

```typescript
const handleVerifyDP = async (orderId: string) => {
  setVerifyingDPId(orderId);
  try {
    await orderService.verifyDPPayment(orderId);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DP_VERIFIED' } : o));
    setExpandedId(null);
    showToast('DP berhasil diverifikasi. Customer dinotifikasi untuk lunasi.', 'success');
  } catch {
    showToast('Gagal verifikasi DP.', 'warning');
  } finally {
    setVerifyingDPId(null);
  }
};

const handleRejectDP = async (orderId: string, reason: string) => {
  setRejectingDPId(orderId);
  try {
    await orderService.rejectDPProof(orderId, reason);
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'DP_PROOF_REJECTED', dp_proof_url: null } : o));
    setRejectDPModalOrderId(null);
    setExpandedId(null);
    showToast('Bukti DP ditolak. Customer dinotifikasi.', 'info');
  } catch {
    showToast('Gagal menolak bukti DP.', 'warning');
  } finally {
    setRejectingDPId(null);
  }
};
```

- [ ] **Step 3: Add `DP_UPLOADED` expand panel**

After the `PAYMENT_UPLOADED` expand panel block (around line 408), add:

```tsx
{isExpanded && order.status === 'DP_UPLOADED' && (
  <div className="px-5 py-4 border-t border-indigo-200 bg-indigo-50">
    <div className="grid grid-cols-[1fr_auto] gap-5 items-start">
      <div>
        <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
          <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pengiriman</div><div className="font-semibold text-gray-700">{order.delivery_type === 'PICKUP' ? '🏪 Pickup' : '🚚 Delivery'}</div></div>
        </div>
        <ItemsTable items={order.items} headerClass="bg-indigo-100 text-indigo-700" />
        {/* DP Proof */}
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">
            Bukti DP {order.dp_amount ? `(Rp ${Number(order.dp_amount).toLocaleString('id-ID')})` : ''}
          </div>
          <div className="flex items-start gap-3">
            {order.dp_proof_url ? (
              order.dp_proof_url.endsWith('.pdf') ? (
                <a href={order.dp_proof_url} target="_blank" rel="noreferrer"
                  className="w-16 h-20 bg-red-50 border-2 border-red-200 rounded-lg flex flex-col items-center justify-center gap-1 hover:bg-red-100">
                  <span className="text-red-500 text-2xl">📄</span>
                  <span className="text-[9px] text-red-500 font-semibold">PDF</span>
                </a>
              ) : (
                <img src={order.dp_proof_url} alt="Bukti DP"
                  className="w-16 h-20 object-cover rounded-lg border-2 border-indigo-200 cursor-pointer"
                  onClick={() => window.open(order.dp_proof_url!, '_blank')} />
              )
            ) : (
              <div className="w-16 h-20 bg-indigo-100 border-2 border-indigo-200 rounded-lg flex flex-col items-center justify-center gap-1">
                <span className="text-indigo-400 text-lg">🖼</span>
                <span className="text-[9px] text-indigo-400 font-semibold">Foto DP</span>
              </div>
            )}
            <div>
              {order.dp_proof_url && (
                <a href={order.dp_proof_url} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-600 font-semibold underline">Lihat Ukuran Penuh ↗</a>
              )}
              <p className="text-[10px] text-gray-400 mt-1">Dikirim {formatDate(order.updated_at)}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 min-w-[120px]">
        <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 text-center">Tindakan</div>
        <button
          onClick={() => handleVerifyDP(order.id)}
          disabled={verifyingDPId === order.id}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-xs font-bold rounded-lg hover:bg-teal-700 disabled:opacity-40"
        >
          {verifyingDPId === order.id ? 'Memproses...' : '✓ Verifikasi DP'}
        </button>
        <button
          onClick={() => setRejectDPModalOrderId(order.id)}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-red-600 text-xs font-bold rounded-lg border-2 border-red-200 hover:bg-red-50"
        >
          ✕ Tolak
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Render `RejectProofModal` in component JSX**

At the bottom of the component return, before the closing `</div>`, add:

```tsx
{rejectDPModalOrderId && (
  <RejectProofModal
    loading={rejectingDPId === rejectDPModalOrderId}
    onConfirm={(reason) => handleRejectDP(rejectDPModalOrderId, reason)}
    onCancel={() => setRejectDPModalOrderId(null)}
  />
)}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(ui): add DP_UPLOADED expand panel + RejectProofModal component"
```

---

## Task 7: Frontend — DP_VERIFIED Panel + PAYMENT_UPLOADED DP Context + Counts

**Files:**
- Modify: `src/components/OrderHistoryScreen.tsx`

- [ ] **Step 1: Add `DP_VERIFIED` expand panel (waiting for full proof)**

After `DP_UPLOADED` panel, add:

```tsx
{isExpanded && order.status === 'DP_VERIFIED' && (
  <div className="px-5 py-4 border-t border-teal-200 bg-teal-50">
    <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">Pelanggan</div><div className="font-semibold text-gray-700">{order.customer_name}</div></div>
      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">No. WA</div><div className="font-mono font-semibold text-gray-700">{order.customer_phone}</div></div>
      <div><div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-1">DP Terverifikasi</div><div className="font-semibold text-teal-700">Rp {Number(order.dp_amount ?? 0).toLocaleString('id-ID')}</div></div>
    </div>
    <ItemsTable items={order.items} headerClass="bg-teal-100 text-teal-700" />
    <div className="flex items-center gap-2 mt-2 bg-teal-100 rounded-lg px-3 py-2">
      <span className="text-teal-600 text-sm">⏳</span>
      <span className="text-xs text-teal-700 font-semibold">Menunggu bukti pelunasan dari customer</span>
    </div>
  </div>
)}
```

- [ ] **Step 2: Update `PAYMENT_UPLOADED` panel to show DP context for DP orders**

In the `PAYMENT_UPLOADED` expand panel (around line 408), find the "Bukti Transfer" section. Add a read-only DP proof section above it, shown only for DP orders:

```tsx
{/* DP proof summary — shown for DP orders above full proof */}
{order.payment_type === 'DP' && (
  <div className="mb-4 p-3 bg-teal-50 rounded-xl border border-teal-200">
    <div className="text-[9px] font-bold uppercase tracking-wide text-teal-600 mb-1">
      ✓ DP Terverifikasi — Rp {Number(order.dp_amount ?? 0).toLocaleString('id-ID')}
    </div>
    {order.dp_proof_url && (
      <a href={order.dp_proof_url} target="_blank" rel="noreferrer"
        className="text-xs text-teal-700 underline font-semibold">Lihat Bukti DP ↗</a>
    )}
  </div>
)}
```

Also update the "Bukti Transfer" label to be contextual:
```tsx
<div className="text-[9px] font-bold uppercase tracking-wide text-gray-400 mb-2">
  {order.payment_type === 'DP' ? 'Bukti Pelunasan' : 'Bukti Transfer'}
</div>
```

Also update the proof URL references: replace `order.payment_proof_url` → `order.full_proof_url` throughout the `PAYMENT_UPLOADED` panel.

- [ ] **Step 3: Update tab counts to include new statuses**

Find lines 229-232:

```typescript
const uploadedCount  = orders.filter(o => o.status === 'PAYMENT_UPLOADED' || o.status === 'DP_UPLOADED').length;
const waitingCount   = orders.filter(o => o.status === 'WAITING_PAYMENT' || o.status === 'WAITING_DP').length;
```

- [ ] **Step 4: Update `filterOrders` function**

Find the `filterOrders` function (around line 44):

```typescript
if (tab === 'waiting')  filtered = orders.filter(o => o.status === 'WAITING_PAYMENT' || o.status === 'WAITING_DP');
if (tab === 'uploaded') filtered = orders.filter(o => o.status === 'PAYMENT_UPLOADED' || o.status === 'DP_UPLOADED');
```

- [ ] **Step 5: Final TypeScript check + build**

```bash
npx tsc --noEmit && npm run build
```
Expected: no errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/OrderHistoryScreen.tsx
git commit -m "feat(ui): DP_VERIFIED panel, PAYMENT_UPLOADED DP context, updated tab counts"
```

---

## Task 8: Deploy

**Files:** none new

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```
Expected: Cloud Build triggered for backend (cloudbuild.yaml). Frontend deploys via cloudbuild.frontend.yaml.

- [ ] **Step 2: Smoke test — create a DP order**

1. Open OrderHistoryScreen in dashboard
2. Find a `PENDING_ADMIN_CONFIRMATION` order
3. Select DP, enter 50%, verify preview shows correct IDR
4. Click Approve
5. Verify order status advances to `APPROVED` (then daemon sets to `WAITING_DP`)
6. Customer sends photo → verify status becomes `DP_UPLOADED` in dashboard
7. Admin clicks "Verifikasi DP" → verify status becomes `DP_VERIFIED`, customer receives WA message
8. Customer sends full proof → verify status becomes `PAYMENT_UPLOADED`
9. Admin verifies → verify status becomes `PAYMENT_VERIFIED`

- [ ] **Step 3: Smoke test — reject DP proof**

1. Get order to `DP_UPLOADED`
2. Admin clicks "Tolak", enters reason, confirms
3. Verify order resets to `WAITING_DP`, customer receives WA with reason

- [ ] **Step 4: Smoke test — FULL order unchanged**

1. Approve a FULL order → verify existing flow works exactly as before
2. Customer sends proof → `PAYMENT_UPLOADED`, admin verifies → `PAYMENT_VERIFIED`
