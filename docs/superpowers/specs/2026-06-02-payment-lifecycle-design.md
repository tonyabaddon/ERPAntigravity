# Payment Lifecycle Design Spec

**Date:** 2026-06-02
**Sub-project:** C1 of C (Payment Lifecycle)
**Status:** Approved for implementation

---

## Problem

After a customer confirms an order (state: BOOKED, status: PENDING_ADMIN_CONFIRMATION), the payment lifecycle is incomplete:

1. `HandleApprovedOrder` hardcodes bank details instead of reading from `bank_config`.
2. `HandleApprovedOrder` sets order status to `COMPLETED` immediately after approval — wrong per SOP. Correct next state is `WAITING_PAYMENT`.
3. No admin/owner WA notification table exists — there is no way to notify staff when payment proof is uploaded.
4. `handleMediaMessage` escalates all images to admin regardless of context — payment proof photos from customers with `WAITING_PAYMENT` orders are not handled.
5. No LISTEN/NOTIFY channels exist for `payment_verified` or `payment_rejected` — admin verification in the dashboard cannot trigger WA messages to customers.

---

## Goal

Implement the full payment lifecycle after order approval:
- Admin approves → customer receives payment instructions with real bank details → order status `WAITING_PAYMENT`
- Customer sends payment proof photo → stored in Supabase Storage → customer receives acknowledgment → admin/owner notified via WA → order status `PAYMENT_UPLOADED`
- Admin verifies → customer receives confirmation → order status `COMPLETED`
- Admin rejects → customer receives rejection message → order status resets to `WAITING_PAYMENT` for re-upload

---

## Decisions

- **Supabase Storage for photo storage** — permanent URL, no expiry, accessible from dashboard. Service role key required for uploads. Bucket: `payment-proofs` (public, created manually in Supabase dashboard before deploy).
- **LISTEN/NOTIFY for admin verification** — follows existing `order_approved` pattern. Admin updates order status in DB → Postgres trigger fires NOTIFY → daemon sends WA. Dashboard stays decoupled from daemon. Adding a second daemon later requires only a `wa_number_id` filter in the handler (3 lines).
- **`wa_recipients` table for admin/owner numbers** — separate from `bank_config`, supports multiple numbers per role, togglable via dashboard. Phase 1: all recipients receive identical notifications.
- **PAYMENT_REJECTED as transient status** — admin sets `PAYMENT_REJECTED` in dashboard → trigger fires → daemon sends rejection WA + immediately resets to `WAITING_PAYMENT`. Customer can re-upload.

---

## Files Changed

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/20260602000001_payment_flow.sql` | `wa_recipients` table, `PAYMENT_REJECTED` enum value, `payment_verified` and `payment_rejected` triggers |
| `backend-go/internal/storage/supabase_storage.go` | `UploadPaymentProof` — download from WA, upload to Supabase Storage, return public URL |
| `backend-go/internal/db/wa_recipients.go` | `GetActiveRecipients` — all active admin/owner WA numbers |
| `backend-go/internal/db/payment.go` | `UpdatePaymentProof`, `RejectPayment` |

### Modified files

| File | Change |
|---|---|
| `backend-go/internal/models/types.go` | Add `OrderStatusPaymentRejected`, `WaRecipient` struct |
| `backend-go/internal/db/client.go` | Add `OnPaymentVerified`, `OnPaymentRejected` to `NotifyHandlers`; subscribe to two new channels |
| `backend-go/internal/whatsapp/sender.go` | Add `DownloadMedia(img *waProto.ImageMessage) ([]byte, string, error)` |
| `backend-go/internal/whatsapp/handler.go` | Fix `HandleApprovedOrder`; rewrite `handleMediaMessage`; add `HandlePaymentVerified`, `HandlePaymentRejected` |
| `backend-go/config/config.go` | Add `SupabaseURL`, `SupabaseServiceKey` |
| `backend-go/main.go` | Pass storage config to handler; wire two new LISTEN/NOTIFY handlers |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `orders.go`, `conversations.go`, `customers.go`, `leads.go`, any React files.

---

## Section 1: Database Migration

**File:** `supabase/migrations/20260602000001_payment_flow.sql`

### 1a. `PAYMENT_REJECTED` enum value

```sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';
```

### 1b. `wa_recipients` table

```sql
CREATE TABLE IF NOT EXISTS wa_recipients (
  id         serial      PRIMARY KEY,
  role       text        NOT NULL,  -- 'admin' or 'owner'
  name       text        NOT NULL DEFAULT '',
  wa_number  text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wa_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_select_wa_recipients'
  ) THEN
    CREATE POLICY "anon_select_wa_recipients" ON wa_recipients FOR SELECT TO anon USING (true);
  END IF;
END $$;
```

### 1c. `payment_verified` NOTIFY trigger

```sql
CREATE OR REPLACE FUNCTION notify_payment_verified() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_VERIFIED' AND OLD.status IS DISTINCT FROM 'PAYMENT_VERIFIED' THEN
    PERFORM pg_notify('payment_verified', json_build_object(
      'order_id', NEW.id,
      'conversation_id', NEW.conversation_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_payment_verified' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_verified
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_verified();
  END IF;
END $$;
```

### 1d. `payment_rejected` NOTIFY trigger

```sql
CREATE OR REPLACE FUNCTION notify_payment_rejected() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_REJECTED' AND OLD.status IS DISTINCT FROM 'PAYMENT_REJECTED' THEN
    PERFORM pg_notify('payment_rejected', json_build_object(
      'order_id', NEW.id,
      'conversation_id', NEW.conversation_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_payment_rejected' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_rejected
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_rejected();
  END IF;
END $$;
```

### 1e. Manual step before deploy

Create a `payment-proofs` bucket in Supabase dashboard (Storage → New bucket → Name: `payment-proofs` → Public: true). The daemon uploads to this bucket using the service role key.

---

## Section 2: Go Models (`backend-go/internal/models/types.go`)

### New `OrderStatus` constant

```go
OrderStatusPaymentRejected OrderStatus = "PAYMENT_REJECTED"
```

### New `WaRecipient` struct

```go
type WaRecipient struct {
    ID        int       `json:"id"`
    Role      string    `json:"role"`
    Name      string    `json:"name"`
    WANumber  string    `json:"wa_number"`
    IsActive  bool      `json:"is_active"`
    CreatedAt time.Time `json:"created_at"`
}
```

---

## Section 3: Storage Layer

**File:** `backend-go/internal/storage/supabase_storage.go`

```go
package storage

import (
    "bytes"
    "context"
    "fmt"
    "net/http"
    "time"
)

// UploadPaymentProof uploads image bytes to Supabase Storage and returns the public URL.
// Returns ("", err) on failure — caller should log and continue.
func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, orderID string, data []byte, contentType string) (string, error) {
    filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
    uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, filename)

    req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(data))
    if err != nil {
        return "", err
    }
    req.Header.Set("Authorization", "Bearer "+serviceKey)
    req.Header.Set("Content-Type", contentType)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return "", err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 300 {
        return "", fmt.Errorf("storage upload failed: HTTP %d", resp.StatusCode)
    }

    publicURL := fmt.Sprintf("%s/storage/v1/object/public/payment-proofs/%s", supabaseURL, filename)
    return publicURL, nil
}
```

---

## Section 4: DB Layer

### `backend-go/internal/db/wa_recipients.go`

```go
func (c *Client) GetActiveRecipients() ([]*models.WaRecipient, error)
// SELECT id, role, name, wa_number, is_active, created_at
// FROM wa_recipients WHERE is_active = true ORDER BY role, id
```

Returns all active admin and owner numbers. Called by handler after payment proof upload and after payment verified/rejected.

### `backend-go/internal/db/payment.go`

```go
// UpdatePaymentProof stores the proof URL and advances status to PAYMENT_UPLOADED.
func (c *Client) UpdatePaymentProof(orderID, url string) error
// UPDATE orders SET payment_proof_url = $1, status = 'PAYMENT_UPLOADED' WHERE id = $2

// RejectPayment resets order status to WAITING_PAYMENT after admin rejects proof.
// Called by daemon after sending rejection WA to customer.
func (c *Client) RejectPayment(orderID string) error
// UPDATE orders SET status = 'WAITING_PAYMENT' WHERE id = $1
```

### `backend-go/internal/db/client.go`

`NotifyHandlers` gains two new fields:

```go
type NotifyHandlers struct {
    OnAdminMessage   func(conversationID, messageID string)
    OnOrderApproved  func(orderID, conversationID string, shippingFee float64)
    OnPaymentVerified func(orderID, conversationID string)
    OnPaymentRejected func(orderID, conversationID string)
}
```

`StartListening` subscribes to `payment_verified` and `payment_rejected` and dispatches to handlers. Payload for both: `{"order_id": "...", "conversation_id": "..."}`.

---

## Section 5: Sender (`backend-go/internal/whatsapp/sender.go`)

One new method added to `Sender` for media download:

```go
func (s *Sender) DownloadMedia(img *waProto.ImageMessage) ([]byte, string, error) {
    data, err := s.client.Download(img)
    if err != nil {
        return nil, "", err
    }
    contentType := img.GetMimetype()
    if contentType == "" {
        contentType = "image/jpeg"
    }
    return data, contentType, nil
}
```

`s.client.Download` is the whatsmeow built-in media downloader. Returns raw bytes + MIME type.

---

## Section 6: Handler (`backend-go/internal/whatsapp/handler.go`)

### Fix `HandleApprovedOrder`

Current bugs fixed:
- Fetch `GetActiveBankConfig()` → use real bank name, account number, account name in invoice
- Fetch `GetActiveRecipients()` → send order notification to all admin/owner numbers
- Set order status to `WAITING_PAYMENT` (was incorrectly `COMPLETED`)
- Set conversation state to `StateBooked` (was incorrectly `StateCompleted`)

New flow:
```
1. GetOrderByConversation
2. scheduler.Cancel(orderID)
3. UpdateOrderTotal(orderID, order.Subtotal + shippingFee)
4. GetActiveBankConfig() — use for invoice
5. GetActiveRecipients() — notify all
6. Send payment instruction WA to customer (invoice + bank details)
7. Send order notification WA to each recipient
8. UpdateOrderStatus(orderID, WAITING_PAYMENT)
9. UpdateConversationState(conversationID, StateBooked)
```

### Rewrite `handleMediaMessage`

```
senderPhone = evt.Info.Sender.ToNonAD().String()
order = GetOrderByConversation via phone lookup (new DB helper needed)

if order == nil OR order.status != WAITING_PAYMENT:
    → existing admin escalation (unchanged)

else:
    1. Download image bytes via h.sender.DownloadMedia(evt.Message.GetImageMessage())
    2. UploadPaymentProof(ctx, supabaseURL, serviceKey, order.ID, bytes, contentType)
       → on error: log, skip URL (still proceed with status update)
    3. UpdatePaymentProof(order.ID, url)  -- sets PAYMENT_UPLOADED
    4. InsertMessage(conv.ID, SenderCustomer, "[Payment proof uploaded]")
    5. Send ack to customer: "Bukti transfer sudah kami terima. Tim kami akan memverifikasi..."
    6. InsertMessage(conv.ID, SenderAI, ack)
    7. GetActiveRecipients() → send notification to each: "💳 Bukti transfer diterima dari [phone]. Order [gjp_order_id]. Silakan verifikasi di dashboard."
```

`handleMediaMessage` already calls `GetOrCreateConversation` which provides the conversation. Then `GetOrderByConversation(conv.ID)` (already exists in `orders.go`) retrieves the order. No new DB function needed.

### New `HandlePaymentVerified`

```go
func (h *Handler) HandlePaymentVerified(ctx context.Context, orderID, conversationID string)
```

```
1. GetOrderByConversation(conversationID)
2. GetActiveBankConfig() — include in confirmation if needed
3. Send "✅ Pembayaran Dikonfirmasi! Pesanan Bapak/Ibu sedang diproses..." to customer
4. InsertMessage(conversationID, SenderSystem, "PAYMENT_VERIFIED: confirmed by admin")
5. UpdateOrderStatus(orderID, COMPLETED)
6. UpdateConversationState(conversationID, StateCompleted)
7. If order.LeadsID != "": UpdateLeadStatus(order.LeadsID, LeadStatusOrdered)
```

### New `HandlePaymentRejected`

```go
func (h *Handler) HandlePaymentRejected(ctx context.Context, orderID, conversationID string)
```

```
1. GetOrderByConversation(conversationID)
2. Send rejection WA to customer: "Kami belum dapat mengkonfirmasi pembayaran Bapak/Ibu. Mohon kirim ulang bukti transfer yang valid..."
3. InsertMessage(conversationID, SenderSystem, "PAYMENT_REJECTED: rejected by admin")
4. RejectPayment(orderID)  -- resets to WAITING_PAYMENT
5. Conversation state unchanged — customer stays in BOOKED, can re-upload
```

---

## Section 7: Config & `main.go`

### `backend-go/config/config.go`

```go
SupabaseURL        string  // SUPABASE_URL
SupabaseServiceKey string  // SUPABASE_SERVICE_KEY
```

### `backend-go/main.go`

- `NewHandler` gains `supabaseURL, supabaseServiceKey string` parameters
- Two new LISTEN/NOTIFY handlers wired into `StartListening`:

```go
OnPaymentVerified: func(orderID, conversationID string) {
    waHandler.HandlePaymentVerified(ctx, orderID, conversationID)
},
OnPaymentRejected: func(orderID, conversationID string) {
    waHandler.HandlePaymentRejected(ctx, orderID, conversationID)
},
```

---

## Success Criteria

1. `CGO_ENABLED=1 go build ./...` passes.
2. `go test ./...` passes — no regressions.
3. Manually applying migration to Supabase succeeds with no errors.
4. Sending a WhatsApp message from a phone with a `WAITING_PAYMENT` order: daemon uploads proof to Supabase Storage, sets `PAYMENT_UPLOADED`, sends ack to customer, sends notification to all `wa_recipients`.
5. Setting order status to `PAYMENT_VERIFIED` in Supabase dashboard: customer receives "Pembayaran Dikonfirmasi" WA, order moves to `COMPLETED`.
6. Setting order status to `PAYMENT_REJECTED` in Supabase dashboard: customer receives rejection WA, order resets to `WAITING_PAYMENT`.
7. `HandleApprovedOrder`: invoice uses bank details from `bank_config`, order status set to `WAITING_PAYMENT` (not `COMPLETED`).
