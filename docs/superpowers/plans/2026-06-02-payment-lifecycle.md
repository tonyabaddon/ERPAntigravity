# Payment Lifecycle (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full payment lifecycle after order approval — payment instructions with real bank details, payment proof photo detection and Supabase Storage upload, admin/owner WA notifications, and LISTEN/NOTIFY-driven payment verification and rejection flows.

**Architecture:** The existing LISTEN/NOTIFY pattern (used for `order_approved`) is extended with two new Postgres triggers (`payment_verified`, `payment_rejected`). A new `storage` package handles Supabase Storage uploads. The handler gains three new methods and two rewrites. All new DB functions are thin wrappers over SQL — no ORM.

**Tech Stack:** Go 1.25, PostgreSQL (Supabase), `database/sql`, `github.com/lib/pq`, whatsmeow (WA media download), Supabase Storage REST API (plain `net/http`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260602000001_payment_flow.sql` | **Create** | `PAYMENT_REJECTED` enum, `wa_recipients` table, `payment_verified` + `payment_rejected` triggers |
| `backend-go/internal/models/types.go` | **Modify** | Add `OrderStatusPaymentRejected`, `WaRecipient` struct |
| `backend-go/internal/storage/supabase_storage.go` | **Create** | `UploadPaymentProof` — PUT to Supabase Storage, return public URL |
| `backend-go/internal/storage/supabase_storage_test.go` | **Create** | Unit tests using `httptest.NewServer` |
| `backend-go/internal/db/wa_recipients.go` | **Create** | `GetActiveRecipients` |
| `backend-go/internal/db/payment.go` | **Create** | `UpdatePaymentProof`, `RejectPayment` |
| `backend-go/internal/db/client.go` | **Modify** | Add `OnPaymentVerified`, `OnPaymentRejected` to `NotifyHandlers`; subscribe to two new channels |
| `backend-go/config/config.go` | **Modify** | Add `SupabaseURL`, `SupabaseServiceKey` |
| `backend-go/internal/whatsapp/sender.go` | **Modify** | Add `DownloadMedia` |
| `backend-go/internal/whatsapp/handler.go` | **Modify** | Fix `HandleApprovedOrder`; rewrite `handleMediaMessage`; add `HandlePaymentVerified`, `HandlePaymentRejected` |
| `backend-go/main.go` | **Modify** | Pass storage config to `NewHandler`; wire two new LISTEN/NOTIFY handlers |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `orders.go`, `conversations.go`, `customers.go`, `leads.go`, any React files.

---

## Task 1: Write and apply the Supabase migration

**Files:**
- Create: `supabase/migrations/20260602000001_payment_flow.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260602000001_payment_flow.sql

-- 1. Add PAYMENT_REJECTED order status.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';

-- 2. wa_recipients table — stores admin and owner WA numbers for notifications.
CREATE TABLE IF NOT EXISTS wa_recipients (
  id         serial      PRIMARY KEY,
  role       text        NOT NULL,   -- 'admin' or 'owner'
  name       text        NOT NULL DEFAULT '',
  wa_number  text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wa_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'wa_recipients' AND policyname = 'anon_select_wa_recipients'
  ) THEN
    CREATE POLICY "anon_select_wa_recipients" ON wa_recipients FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 3. NOTIFY trigger for payment_verified.
--    Fires when an admin sets order status to PAYMENT_VERIFIED in the dashboard.
CREATE OR REPLACE FUNCTION notify_payment_verified() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_VERIFIED' AND OLD.status IS DISTINCT FROM 'PAYMENT_VERIFIED' THEN
    PERFORM pg_notify('payment_verified', json_build_object(
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
    WHERE trigger_name = 'trg_payment_verified' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_verified
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_verified();
  END IF;
END $$;

-- 4. NOTIFY trigger for payment_rejected.
--    Fires when an admin sets order status to PAYMENT_REJECTED in the dashboard.
CREATE OR REPLACE FUNCTION notify_payment_rejected() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_REJECTED' AND OLD.status IS DISTINCT FROM 'PAYMENT_REJECTED' THEN
    PERFORM pg_notify('payment_rejected', json_build_object(
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
    WHERE trigger_name = 'trg_payment_rejected' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_rejected
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_rejected();
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration to Supabase**

Open the Supabase dashboard → SQL Editor → paste the entire file → Run.

Expected: All statements execute without error. Verify in Table Editor: `wa_recipients` table exists. In Database → Functions: `notify_payment_verified` and `notify_payment_rejected` exist. In Database → Triggers: `trg_payment_verified` and `trg_payment_rejected` exist on the `orders` table.

- [ ] **Step 3: Create the payment-proofs Storage bucket**

In Supabase dashboard → Storage → New bucket:
- Name: `payment-proofs`
- Public: **true** (so the stored URL is accessible from the React dashboard without auth)

Expected: Bucket appears in the Storage list as public.

- [ ] **Step 4: Commit the migration file**

```bash
cd /path/to/ERPAntigravity
git add supabase/migrations/20260602000001_payment_flow.sql
git commit -m "feat(sql): add payment flow migration — wa_recipients, PAYMENT_REJECTED, payment triggers"
```

---

## Task 2: Update Go models

**Files:**
- Modify: `backend-go/internal/models/types.go`

- [ ] **Step 1: Add `OrderStatusPaymentRejected` constant**

In the `const` block for `OrderStatus`, after `OrderStatusCompleted`, add:

```go
OrderStatusPaymentRejected  OrderStatus = "PAYMENT_REJECTED"
```

The full updated `OrderStatus` const block:

```go
const (
	OrderStatusPendingAdminConfirmation OrderStatus = "PENDING_ADMIN_CONFIRMATION"
	OrderStatusPendingPriceNego         OrderStatus = "PENDING_PRICE_NEGO"
	OrderStatusPendingStockCheck        OrderStatus = "PENDING_STOCK_CHECK"
	OrderStatusPendingCustomQuote       OrderStatus = "PENDING_CUSTOM_QUOTE"
	OrderStatusPendingWiringQuote       OrderStatus = "PENDING_WIRING_QUOTE"
	OrderStatusWaitingPayment           OrderStatus = "WAITING_PAYMENT"
	OrderStatusPaymentUploaded          OrderStatus = "PAYMENT_UPLOADED"
	OrderStatusPaymentVerified          OrderStatus = "PAYMENT_VERIFIED"
	OrderStatusPaymentRejected          OrderStatus = "PAYMENT_REJECTED"
	OrderStatusCancelled                OrderStatus = "CANCELLED"
	OrderStatusCompleted                OrderStatus = "COMPLETED"
)
```

- [ ] **Step 2: Add `WaRecipient` struct**

At the end of `types.go`, after the `BankConfig` struct, add:

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

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 4: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/models/types.go
git commit -m "feat(go): add OrderStatusPaymentRejected and WaRecipient model"
```

---

## Task 3: Create storage package with tests

**Files:**
- Create: `backend-go/internal/storage/supabase_storage.go`
- Create: `backend-go/internal/storage/supabase_storage_test.go`

- [ ] **Step 1: Write the failing tests**

Create `backend-go/internal/storage/supabase_storage_test.go`:

```go
package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUploadPaymentProof_Success(t *testing.T) {
	var receivedMethod, receivedAuth, receivedContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		receivedAuth = r.Header.Get("Authorization")
		receivedContentType = r.Header.Get("Content-Type")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	url, err := UploadPaymentProof(context.Background(), srv.URL, "test-service-key", "order-abc", []byte("fake-image-bytes"), "image/jpeg")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if url == "" {
		t.Fatal("expected non-empty public URL")
	}
	if !strings.Contains(url, "order-abc") {
		t.Errorf("URL should contain order ID, got: %s", url)
	}
	if receivedMethod != http.MethodPut {
		t.Errorf("expected PUT, got: %s", receivedMethod)
	}
	if receivedAuth != "Bearer test-service-key" {
		t.Errorf("unexpected Authorization header: %s", receivedAuth)
	}
	if receivedContentType != "image/jpeg" {
		t.Errorf("unexpected Content-Type: %s", receivedContentType)
	}
}

func TestUploadPaymentProof_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-xyz", []byte("bytes"), "image/jpeg")
	if err == nil {
		t.Fatal("expected error when server returns 5xx")
	}
}

func TestUploadPaymentProof_DefaultContentType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ct := r.Header.Get("Content-Type")
		if ct != "image/jpeg" {
			http.Error(w, "bad content type", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// empty contentType should default to image/jpeg
	_, err := UploadPaymentProof(context.Background(), srv.URL, "key", "order-1", []byte("bytes"), "")
	if err != nil {
		t.Fatalf("expected no error with empty content type, got: %v", err)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/storage/... -v 2>&1
```

Expected: FAIL — `storage` package does not exist yet.

- [ ] **Step 3: Create `backend-go/internal/storage/supabase_storage.go`**

```go
package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"time"
)

// UploadPaymentProof uploads image bytes to the Supabase Storage `payment-proofs` bucket.
// Returns the permanent public URL on success, or ("", err) on failure.
// Caller should log the error and continue — a failed upload must not drop the payment flow.
func UploadPaymentProof(ctx context.Context, supabaseURL, serviceKey, orderID string, data []byte, contentType string) (string, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	filename := fmt.Sprintf("%s/%d", orderID, time.Now().UnixMilli())
	uploadURL := fmt.Sprintf("%s/storage/v1/object/payment-proofs/%s", supabaseURL, filename)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("storage: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+serviceKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("storage: upload request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("storage: upload failed with HTTP %d", resp.StatusCode)
	}

	publicURL := fmt.Sprintf("%s/storage/v1/object/public/payment-proofs/%s", supabaseURL, filename)
	return publicURL, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/storage/... -v 2>&1
```

Expected:
```
--- PASS: TestUploadPaymentProof_Success (0.00s)
--- PASS: TestUploadPaymentProof_ServerError (0.00s)
--- PASS: TestUploadPaymentProof_DefaultContentType (0.00s)
ok  	github.com/username/sinar-elektrik-backend/internal/storage
```

- [ ] **Step 5: Full build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/storage/supabase_storage.go backend-go/internal/storage/supabase_storage_test.go
git commit -m "feat(go): add storage package — UploadPaymentProof to Supabase Storage"
```

---

## Task 4: Create DB files — wa_recipients and payment

**Files:**
- Create: `backend-go/internal/db/wa_recipients.go`
- Create: `backend-go/internal/db/payment.go`

- [ ] **Step 1: Create `backend-go/internal/db/wa_recipients.go`**

```go
package db

import "github.com/username/sinar-elektrik-backend/internal/models"

// GetActiveRecipients returns all active admin and owner WA numbers.
// Called when sending payment notifications and order approval notifications.
func (c *Client) GetActiveRecipients() ([]*models.WaRecipient, error) {
	rows, err := c.DB.Query(`
		SELECT id, role, name, wa_number, is_active, created_at
		FROM wa_recipients
		WHERE is_active = true
		ORDER BY role, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.WaRecipient
	for rows.Next() {
		var r models.WaRecipient
		if err := rows.Scan(&r.ID, &r.Role, &r.Name, &r.WANumber, &r.IsActive, &r.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, &r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
```

- [ ] **Step 2: Create `backend-go/internal/db/payment.go`**

```go
package db

// UpdatePaymentProof stores the proof URL and advances the order to PAYMENT_UPLOADED.
// url may be empty if the Supabase Storage upload failed — the status still advances.
func (c *Client) UpdatePaymentProof(orderID, url string) error {
	_, err := c.DB.Exec(`
		UPDATE orders
		SET payment_proof_url = $1, status = 'PAYMENT_UPLOADED'
		WHERE id = $2
	`, url, orderID)
	return err
}

// RejectPayment resets the order status from PAYMENT_REJECTED back to WAITING_PAYMENT.
// Called by the daemon after sending the rejection WA message to the customer.
func (c *Client) RejectPayment(orderID string) error {
	_, err := c.DB.Exec(`
		UPDATE orders SET status = 'WAITING_PAYMENT' WHERE id = $1
	`, orderID)
	return err
}
```

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 4: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/db/wa_recipients.go backend-go/internal/db/payment.go
git commit -m "feat(go): add db layer for wa_recipients, payment proof, and payment rejection"
```

---

## Task 5: Update DB client — new LISTEN/NOTIFY channels

**Files:**
- Modify: `backend-go/internal/db/client.go`

- [ ] **Step 1: Replace the full content of `backend-go/internal/db/client.go`**

```go
package db

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/lib/pq"
)

type NotifyHandlers struct {
	OnAdminMessage    func(conversationID, messageID string)
	OnOrderApproved   func(orderID, conversationID string, shippingFee float64)
	OnPaymentVerified func(orderID, conversationID string)
	OnPaymentRejected func(orderID, conversationID string)
}

type Client struct {
	DB       *sql.DB
	listener *pq.Listener
}

func NewClient(connStr string) (*Client, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	log.Println("[DB] Connected to Supabase PostgreSQL")

	listener := pq.NewListener(connStr, 10*time.Second, time.Minute,
		func(ev pq.ListenerEventType, err error) {
			if err != nil {
				log.Printf("[DB] Listener event error: %v", err)
			}
		})

	return &Client{DB: db, listener: listener}, nil
}

// StartListening subscribes to Postgres NOTIFY channels and dispatches to handlers.
// Call once at startup; runs until the client is closed.
func (c *Client) StartListening(h NotifyHandlers) error {
	channels := []string{"admin_messages", "order_approved", "payment_verified", "payment_rejected"}
	for _, ch := range channels {
		if err := c.listener.Listen(ch); err != nil {
			return err
		}
	}

	go func() {
		for notification := range c.listener.Notify {
			if notification == nil {
				continue
			}
			switch notification.Channel {
			case "admin_messages":
				var p struct {
					ConversationID string `json:"conversation_id"`
					MessageID      string `json:"message_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] admin_messages parse error: %v", err)
					continue
				}
				if h.OnAdminMessage != nil {
					go h.OnAdminMessage(p.ConversationID, p.MessageID)
				}

			case "order_approved":
				var p struct {
					OrderID        string  `json:"order_id"`
					ConversationID string  `json:"conversation_id"`
					ShippingFee    float64 `json:"shipping_fee"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] order_approved parse error: %v", err)
					continue
				}
				if h.OnOrderApproved != nil {
					go h.OnOrderApproved(p.OrderID, p.ConversationID, p.ShippingFee)
				}

			case "payment_verified":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] payment_verified parse error: %v", err)
					continue
				}
				if h.OnPaymentVerified != nil {
					go h.OnPaymentVerified(p.OrderID, p.ConversationID)
				}

			case "payment_rejected":
				var p struct {
					OrderID        string `json:"order_id"`
					ConversationID string `json:"conversation_id"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] payment_rejected parse error: %v", err)
					continue
				}
				if h.OnPaymentRejected != nil {
					go h.OnPaymentRejected(p.OrderID, p.ConversationID)
				}
			}
		}
	}()

	log.Println("[DB] LISTEN/NOTIFY active on admin_messages, order_approved, payment_verified, payment_rejected")
	return nil
}

func (c *Client) Close() {
	c.listener.Close()
	c.DB.Close()
}
```

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors. The new `OnPaymentVerified` and `OnPaymentRejected` fields in `NotifyHandlers` are optional (nil-checked before dispatch) so `main.go`'s existing struct literal still compiles.

- [ ] **Step 3: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/client.go
git commit -m "feat(go): db client — add payment_verified and payment_rejected LISTEN channels"
```

---

## Task 6: Update config

**Files:**
- Modify: `backend-go/config/config.go`

- [ ] **Step 1: Replace the full content of `backend-go/config/config.go`**

```go
package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	SupabaseDBConn    string
	GeminiAPIKey      string
	Port              string
	WAStorePath       string
	SupabaseURL       string
	SupabaseServiceKey string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("[CONFIG] No .env file, reading from environment")
	}
	return &Config{
		SupabaseDBConn:    getEnv("SUPABASE_DB_CONNECTION", "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		GeminiAPIKey:      getEnv("GEMINI_API_KEY", ""),
		Port:              getEnv("PORT", "8080"),
		WAStorePath:       getEnv("WA_STORE_PATH", "wa_store.db"),
		SupabaseURL:       getEnv("SUPABASE_URL", ""),
		SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 3: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/config/config.go
git commit -m "feat(go): config — add SUPABASE_URL and SUPABASE_SERVICE_KEY"
```

---

## Task 7: Update sender — add DownloadMedia

**Files:**
- Modify: `backend-go/internal/whatsapp/sender.go`

- [ ] **Step 1: Replace the full content of `backend-go/internal/whatsapp/sender.go`**

```go
package whatsapp

import (
	"context"
	"fmt"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

type Sender struct {
	client *whatsmeow.Client
}

func NewSender(client *whatsmeow.Client) *Sender {
	return &Sender{client: client}
}

func (s *Sender) SendText(ctx context.Context, toPhone, text string) error {
	// toPhone may be a full JID string (e.g. "628xx@s.whatsapp.net" or "120363xx@lid")
	// or a bare phone number from legacy callers. Preserve the server suffix.
	jid, err := types.ParseJID(toPhone)
	if err != nil {
		jid = types.NewJID(toPhone, types.DefaultUserServer)
	}
	_, err = s.client.SendMessage(ctx, jid, &waProto.Message{
		Conversation: proto.String(text),
	})
	if err != nil {
		return fmt.Errorf("sender: send text to %s: %w", toPhone, err)
	}
	return nil
}

// DownloadMedia downloads an image message's bytes from WhatsApp servers.
// Returns the raw bytes and MIME type. Defaults to "image/jpeg" if MIME type is missing.
func (s *Sender) DownloadMedia(img *waProto.ImageMessage) ([]byte, string, error) {
	data, err := s.client.Download(img)
	if err != nil {
		return nil, "", fmt.Errorf("sender: download media: %w", err)
	}
	contentType := img.GetMimetype()
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return data, contentType, nil
}
```

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 3: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/sender.go
git commit -m "feat(go): sender — add DownloadMedia for WA image download"
```

---

## Task 8: Update handler and main.go

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`
- Modify: `backend-go/main.go`

These two files are updated together because `NewHandler` gains new parameters — changing the signature in `handler.go` without updating `main.go` breaks the build.

- [ ] **Step 1: Replace the full content of `backend-go/internal/whatsapp/handler.go`**

```go
package whatsapp

import (
	"context"
	"fmt"
	"log"
	"time"

	"go.mau.fi/whatsmeow/types/events"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/rules"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/storage"
)

type Handler struct {
	db                 *db.Client
	machine            *engine.Machine
	sender             *Sender
	scheduler          *scheduler.Scheduler
	waNumberID         string
	startedAt          time.Time
	supabaseURL        string
	supabaseServiceKey string
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID, supabaseURL, supabaseServiceKey string) *Handler {
	return &Handler{
		db: d, machine: m, sender: s, scheduler: sc,
		waNumberID: waNumberID, startedAt: time.Now(),
		supabaseURL: supabaseURL, supabaseServiceKey: supabaseServiceKey,
	}
}

func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}
	// Skip messages sent before the daemon started — these are WhatsApp's
	// queued backlog delivered on first connect, not live customer messages.
	if evt.Info.Timestamp.Before(h.startedAt) {
		return
	}

	text := evt.Message.GetConversation()
	if text == "" && evt.Message.GetExtendedTextMessage() != nil {
		text = evt.Message.GetExtendedTextMessage().GetText()
	}
	if text == "" {
		h.handleMediaMessage(evt)
		return
	}

	// Preserve the full JID string (including @lid server for LID-based senders)
	// so sender.go can route it correctly.
	senderJID := evt.Info.Sender.ToNonAD().String()
	go h.processMessage(context.Background(), senderJID, text)
}

func (h *Handler) processMessage(ctx context.Context, senderPhone, text string) {
	// 1. Keyword rules — fast path, zero LLM cost
	esc := rules.CheckEscalation(text)
	if esc == rules.EscalationWiring {
		h.handleWiringEscalation(ctx, senderPhone, text)
		return
	}

	// 2. Get or create conversation
	conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// 3. Ensure customer record exists; create lead on new conversations.
	//    Errors here are non-fatal — log and continue so the message is never dropped.
	var leadsID, customerID string
	customer, err := h.db.GetOrCreateCustomer(senderPhone)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateCustomer error for %s: %v", senderPhone, err)
	} else {
		customerID = customer.ID
		if created {
			lead, err := h.db.CreateLead(customer.ID, conv.ID, senderPhone)
			if err != nil {
				log.Printf("[HANDLER] CreateLead error for conv %s: %v", conv.ID, err)
			} else {
				leadsID = lead.ID
			}
		}
	}

	// 4. Admin escalation keyword
	if esc == rules.EscalationAdmin {
		h.handleAdminEscalation(ctx, conv, text)
		return
	}

	// 5. Terminal state — ignore further messages
	if conv.State.IsTerminal() {
		return
	}

	// 6. Insert customer message → Realtime pushes to Sales Inbox
	if _, err := h.db.InsertMessage(conv.ID, models.SenderCustomer, text); err != nil {
		log.Printf("[HANDLER] InsertMessage error: %v", err)
	}

	// 7. Load history
	history, _ := h.db.ListLast10Messages(conv.ID)

	// 8. Build stock context if needed
	stockContext := ""
	if conv.State == models.StateStockCheck || conv.State == models.StateClarifying {
		items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
		stockContext = engine.StockContextString(items)
	}

	// 9. Run state machine
	result, err := h.machine.Process(ctx, conv, text, history, stockContext)
	if err != nil {
		log.Printf("[HANDLER] Machine.Process error: %v", err)
		return
	}

	// 10. Persist state + data before sending reply
	if result.NewData != nil {
		if err := h.db.UpdateCollectedData(conv.ID, *result.NewData, result.ClarificationRound); err != nil {
			log.Printf("[HANDLER] UpdateCollectedData error: %v", err)
		}
	}
	if result.Language != conv.Language {
		if err := h.db.UpdateLanguage(conv.ID, result.Language); err != nil {
			log.Printf("[HANDLER] UpdateLanguage error: %v", err)
		}
	}
	if result.NextState != conv.State {
		if err := h.db.UpdateConversationState(conv.ID, result.NextState); err != nil {
			log.Printf("[HANDLER] UpdateConversationState error: %v", err)
		}
	}

	// 11. If order just booked, create order row and start timer
	if result.CreateOrder {
		h.handleBooking(ctx, conv, leadsID, customerID)
	}

	// 12. Insert AI reply + send to WA
	if result.Reply != "" {
		h.db.InsertMessage(conv.ID, models.SenderAI, result.Reply)
		if err := h.sender.SendText(ctx, senderPhone, result.Reply); err != nil {
			log.Printf("[HANDLER] SendText error: %v", err)
		}
	}
}

func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation, leadsID, customerID string) {
	items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
	var orderItems []models.OrderItem
	var subtotal float64
	if len(items) > 0 {
		item := items[0]
		qty := conv.CollectedData.Quantity
		if qty == 0 {
			qty = 1
		}
		sub := item.Price * float64(qty)
		orderItems = append(orderItems, models.OrderItem{
			SKU: item.SKU, Name: item.Name, Qty: qty,
			UnitPrice: item.Price, Subtotal: sub,
		})
		subtotal = sub
	}
	if len(items) == 0 {
		log.Printf("[HANDLER] Warning: no stock found for product %q, order will have empty items", conv.CollectedData.Product)
	}
	order, err := h.db.CreateOrder(conv, orderItems, subtotal, leadsID, customerID, models.OrderTypeStandard, "")
	if err != nil {
		log.Printf("[HANDLER] CreateOrder error: %v", err)
		return
	}
	h.scheduler.Schedule(order.ID, order.BookingExpiresAt)
	log.Printf("[HANDLER] Order %s created, timer scheduled until %v", order.ID, order.BookingExpiresAt)
}

func (h *Handler) handleWiringEscalation(ctx context.Context, senderPhone, text string) {
	conv, _, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}
	h.db.InsertMessage(conv.ID, models.SenderCustomer, text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedWiring)
	h.db.InsertMessage(conv.ID, models.SenderSystem, "ESCALATED_WIRING: keyword match")

	reply := "Permintaan ini membutuhkan tim teknis kami. Staf kami akan segera menghubungi Anda."
	if conv.Language == "en" {
		reply = "Your request requires our technical team. Our staff will contact you shortly."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	h.sender.SendText(ctx, senderPhone, reply)
}

func (h *Handler) handleAdminEscalation(ctx context.Context, conv *models.Conversation, text string) {
	h.db.InsertMessage(conv.ID, models.SenderCustomer, text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	h.db.InsertMessage(conv.ID, models.SenderSystem, "ESCALATED_ADMIN: keyword match")

	reply := "Permintaan Anda akan diproses oleh tim kami. Mohon tunggu sebentar."
	if conv.Language == "en" {
		reply = "Your request will be handled by our team. Please wait a moment."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	h.sender.SendText(ctx, conv.CustomerPhone, reply)
}

func (h *Handler) handleMediaMessage(evt *events.Message) {
	senderPhone := evt.Info.Sender.ToNonAD().String()
	conv, _, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}

	order, orderErr := h.db.GetOrderByConversation(conv.ID)
	if orderErr != nil || order.Status != models.OrderStatusWaitingPayment {
		// Not a payment proof context — fall through to admin escalation.
		h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
		h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
		reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
		if conv.Language == "en" {
			reply = "We have received your document. Our technical team will review and contact you shortly."
		}
		h.db.InsertMessage(conv.ID, models.SenderAI, reply)
		h.sender.SendText(context.Background(), senderPhone, reply)
		return
	}

	// Payment proof flow.
	var proofURL string
	if img := evt.Message.GetImageMessage(); img != nil {
		data, contentType, dlErr := h.sender.DownloadMedia(img)
		if dlErr != nil {
			log.Printf("[HANDLER] DownloadMedia error for order %s: %v", order.ID, dlErr)
		} else {
			url, upErr := storage.UploadPaymentProof(context.Background(), h.supabaseURL, h.supabaseServiceKey, order.ID, data, contentType)
			if upErr != nil {
				log.Printf("[HANDLER] UploadPaymentProof error for order %s: %v", order.ID, upErr)
			} else {
				proofURL = url
			}
		}
	}

	if err := h.db.UpdatePaymentProof(order.ID, proofURL); err != nil {
		log.Printf("[HANDLER] UpdatePaymentProof error for order %s: %v", order.ID, err)
	}
	h.db.InsertMessage(conv.ID, models.SenderCustomer, "[Payment proof uploaded]")

	ack := "Bukti transfer sudah kami terima 🙏 Tim kami akan memverifikasi dan menghubungi Bapak/Ibu segera."
	if conv.Language == "en" {
		ack = "We have received your payment proof 🙏 Our team will verify and contact you shortly."
	}
	h.db.InsertMessage(conv.ID, models.SenderAI, ack)
	if err := h.sender.SendText(context.Background(), senderPhone, ack); err != nil {
		log.Printf("[HANDLER] Payment ack send error: %v", err)
	}

	recipients, err := h.db.GetActiveRecipients()
	if err != nil {
		log.Printf("[HANDLER] GetActiveRecipients error: %v", err)
		return
	}
	orderRef := order.GJPOrderID
	if orderRef == "" {
		orderRef = order.ID
	}
	notif := fmt.Sprintf("💳 *Bukti Transfer Diterima*\n\nDari: %s\nOrder: %s\nCustomer: %s\n\nSilakan verifikasi di dashboard.",
		senderPhone, orderRef, order.CustomerName)
	for _, r := range recipients {
		if err := h.sender.SendText(context.Background(), r.WANumber, notif); err != nil {
			log.Printf("[HANDLER] Recipient notify error (%s): %v", r.WANumber, err)
		}
	}
}

// HandleApprovedOrder is called by the LISTEN/NOTIFY dispatcher when an order is approved.
// Sends payment instructions to the customer using live bank_config data.
// Sets order status to WAITING_PAYMENT (not COMPLETED — payment is still pending).
func (h *Handler) HandleApprovedOrder(ctx context.Context, orderID, conversationID string, shippingFee float64) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil {
		log.Printf("[HANDLER] GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}
	h.scheduler.Cancel(orderID)

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	total := order.Subtotal + shippingFee
	if err := h.db.UpdateOrderTotal(orderID, total); err != nil {
		log.Printf("[HANDLER] UpdateOrderTotal error: %v", err)
	}

	bank, err := h.db.GetActiveBankConfig()
	if err != nil {
		log.Printf("[HANDLER] GetActiveBankConfig error (using fallback): %v", err)
	}

	invoice := buildInvoiceMessage(order, shippingFee, total, lang, bank)
	h.db.InsertMessage(conversationID, models.SenderSystem, "ORDER_APPROVED: payment instructions sent")
	if err := h.sender.SendText(ctx, order.CustomerPhone, invoice); err != nil {
		log.Printf("[HANDLER] Invoice send error: %v", err)
	}

	recipients, err := h.db.GetActiveRecipients()
	if err != nil {
		log.Printf("[HANDLER] GetActiveRecipients error: %v", err)
	} else {
		orderRef := order.GJPOrderID
		if orderRef == "" {
			orderRef = orderID
		}
		notif := fmt.Sprintf("✅ *Order Disetujui*\n\nOrder: %s\nCustomer: %s (%s)\nTotal: Rp %.0f\n\nMenunggu konfirmasi pembayaran.",
			orderRef, order.CustomerName, order.CustomerPhone, total)
		for _, r := range recipients {
			if err := h.sender.SendText(ctx, r.WANumber, notif); err != nil {
				log.Printf("[HANDLER] Recipient notify error (%s): %v", r.WANumber, err)
			}
		}
	}

	h.db.UpdateOrderStatus(orderID, string(models.OrderStatusWaitingPayment))
	h.db.UpdateConversationState(conversationID, models.StateBooked)
}

// HandlePaymentVerified is called by the LISTEN/NOTIFY dispatcher when admin verifies payment.
func (h *Handler) HandlePaymentVerified(ctx context.Context, orderID, conversationID string) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil {
		log.Printf("[HANDLER] HandlePaymentVerified: GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	msg := "✅ *Pembayaran Dikonfirmasi!*\n\nTerima kasih Bapak/Ibu " + order.CustomerName + ", pembayaran Anda telah kami verifikasi.\nPesanan Anda sedang diproses. Terima kasih telah berbelanja di Garindo Jaya Panel! 😊"
	if lang == "en" {
		msg = "✅ *Payment Confirmed!*\n\nThank you " + order.CustomerName + ", your payment has been verified.\nYour order is being processed. Thank you for shopping at Garindo Jaya Panel! 😊"
	}
	if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
		log.Printf("[HANDLER] HandlePaymentVerified: SendText error: %v", err)
	}

	h.db.InsertMessage(conversationID, models.SenderSystem, "PAYMENT_VERIFIED: confirmed by admin")
	h.db.UpdateOrderStatus(orderID, string(models.OrderStatusCompleted))
	h.db.UpdateConversationState(conversationID, models.StateCompleted)

	if order.LeadsID != "" {
		if err := h.db.UpdateLeadStatus(order.LeadsID, models.LeadStatusOrdered); err != nil {
			log.Printf("[HANDLER] UpdateLeadStatus error for lead %s: %v", order.LeadsID, err)
		}
	}
}

// HandlePaymentRejected is called by the LISTEN/NOTIFY dispatcher when admin rejects payment.
// Sends rejection WA to customer and resets order status to WAITING_PAYMENT for re-upload.
func (h *Handler) HandlePaymentRejected(ctx context.Context, orderID, conversationID string) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil {
		log.Printf("[HANDLER] HandlePaymentRejected: GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}

	lang := "id"
	h.db.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, conversationID).Scan(&lang)

	msg := "⚠️ *Konfirmasi Pembayaran*\n\nKami belum dapat mengkonfirmasi pembayaran Bapak/Ibu " + order.CustomerName + ".\nKemungkinan foto bukti transfer tidak terbaca dengan jelas.\n\nMohon kirim ulang bukti transfer yang valid (foto jelas, nominal terlihat).\nTerima kasih. 🙏"
	if lang == "en" {
		msg = "⚠️ *Payment Confirmation*\n\nWe could not confirm your payment, " + order.CustomerName + ".\nThe transfer proof image may not be clear enough.\n\nPlease resend a valid transfer proof (clear photo, amount visible).\nThank you. 🙏"
	}
	if err := h.sender.SendText(ctx, order.CustomerPhone, msg); err != nil {
		log.Printf("[HANDLER] HandlePaymentRejected: SendText error: %v", err)
	}

	h.db.InsertMessage(conversationID, models.SenderSystem, "PAYMENT_REJECTED: rejected by admin")
	if err := h.db.RejectPayment(orderID); err != nil {
		log.Printf("[HANDLER] RejectPayment error for order %s: %v", orderID, err)
	}
}

func buildInvoiceMessage(order *models.Order, shippingFee, total float64, lang string, bank *models.BankConfig) string {
	bankName := "BCA"
	bankAccount := "1234567890"
	bankOwner := "Garindo Jaya Panel"
	if bank != nil {
		bankName = bank.BankName
		bankAccount = bank.AccountNumber
		bankOwner = bank.AccountName
	}

	var items string
	for _, item := range order.Items {
		items += fmt.Sprintf("- %s x%d @ Rp %.0f = Rp %.0f\n", item.Name, item.Qty, item.UnitPrice, item.Subtotal)
	}
	if lang == "en" {
		return fmt.Sprintf(`✅ ORDER CONFIRMED

Customer: %s (%s)
Address: %s

Items:
%s
Subtotal: Rp %.0f
Shipping: Rp %.0f
TOTAL: Rp %.0f

Please transfer to:
Bank %s — %s
A/N %s

Payment deadline: 2×24 hours from this message.
Thank you!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
			items, order.Subtotal, shippingFee, total, bankName, bankAccount, bankOwner)
	}
	return fmt.Sprintf(`✅ PESANAN DIKONFIRMASI

Pelanggan: %s (%s)
Alamat: %s

Detail Pesanan:
%s
Subtotal: Rp %.0f
Ongkos Kirim: Rp %.0f
TOTAL: Rp %.0f

Silakan transfer ke:
Bank %s — %s
A/N %s

Batas pembayaran: 2×24 jam sejak pesan ini.
Terima kasih!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
		items, order.Subtotal, shippingFee, total, bankName, bankAccount, bankOwner)
}
```

- [ ] **Step 2: Update `backend-go/main.go` — update NewHandler call and wire new LISTEN handlers**

Find the line in `main.go`:
```go
waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID)
```

Replace with:
```go
waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey)
```

Find the `StartListening` call in `main.go`:
```go
if err := dbClient.StartListening(db.NotifyHandlers{
    OnAdminMessage: func(conversationID, messageID string) {
        ...
    },
    OnOrderApproved: func(orderID, conversationID string, shippingFee float64) {
        waHandler.HandleApprovedOrder(ctx, orderID, conversationID, shippingFee)
    },
}); err != nil {
```

Replace with:
```go
if err := dbClient.StartListening(db.NotifyHandlers{
    OnAdminMessage: func(conversationID, messageID string) {
        log.Printf("[MAIN] Admin message in conversation %s", conversationID)
        msg, err := dbClient.GetMessageByID(messageID)
        if err != nil {
            log.Printf("[MAIN] GetMessageByID failed for %s: %v", messageID, err)
            return
        }
        var customerPhone string
        dbClient.DB.QueryRow(`SELECT customer_phone FROM conversations WHERE id = $1`, conversationID).Scan(&customerPhone)
        if customerPhone != "" && msg.Text != "" {
            if err := sender.SendText(ctx, customerPhone, msg.Text); err != nil {
                log.Printf("[MAIN] Admin forward WA send failed: %v", err)
            }
        }
    },
    OnOrderApproved: func(orderID, conversationID string, shippingFee float64) {
        waHandler.HandleApprovedOrder(ctx, orderID, conversationID, shippingFee)
    },
    OnPaymentVerified: func(orderID, conversationID string) {
        waHandler.HandlePaymentVerified(ctx, orderID, conversationID)
    },
    OnPaymentRejected: func(orderID, conversationID string) {
        waHandler.HandlePaymentRejected(ctx, orderID, conversationID)
    },
}); err != nil {
```

- [ ] **Step 3: Full build check — must be clean**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: **Zero errors.**

- [ ] **Step 4: Run full test suite**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass, including the new storage tests.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go backend-go/main.go
git commit -m "feat(go): payment lifecycle — proof upload, HandlePaymentVerified, HandlePaymentRejected, fix HandleApprovedOrder"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `PAYMENT_REJECTED` enum value — Task 1
- ✅ `wa_recipients` table with RLS — Task 1
- ✅ `notify_payment_verified` trigger — Task 1
- ✅ `notify_payment_rejected` trigger — Task 1
- ✅ `payment-proofs` Storage bucket (manual step) — Task 1
- ✅ `OrderStatusPaymentRejected` constant — Task 2
- ✅ `WaRecipient` struct — Task 2
- ✅ `UploadPaymentProof` with PUT + public URL — Task 3
- ✅ `GetActiveRecipients` — Task 4
- ✅ `UpdatePaymentProof` sets `PAYMENT_UPLOADED` — Task 4
- ✅ `RejectPayment` resets to `WAITING_PAYMENT` — Task 4
- ✅ `OnPaymentVerified` / `OnPaymentRejected` in `NotifyHandlers` — Task 5
- ✅ `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` config — Task 6
- ✅ `DownloadMedia` on Sender — Task 7
- ✅ `handleMediaMessage` — checks `WAITING_PAYMENT`, downloads, uploads, acks customer, notifies recipients — Task 8
- ✅ `HandleApprovedOrder` — uses `GetActiveBankConfig`, notifies recipients, sets `WAITING_PAYMENT` (not `COMPLETED`), sets `StateBooked` — Task 8
- ✅ `HandlePaymentVerified` — WA to customer, `COMPLETED`, `StateCompleted`, `LeadStatusOrdered` — Task 8
- ✅ `HandlePaymentRejected` — WA to customer, `RejectPayment` resets status — Task 8
- ✅ `NewHandler` gains `supabaseURL`, `supabaseServiceKey` — Task 8
- ✅ `main.go` wires `OnPaymentVerified` and `OnPaymentRejected` — Task 8

**No placeholders found.**

**Type consistency:**
- `storage.UploadPaymentProof` signature in Task 3 matches call in Task 8 handler ✅
- `h.sender.DownloadMedia(img)` defined in Task 7 matches call in Task 8 ✅
- `h.db.GetActiveRecipients()` defined in Task 4 matches calls in Task 8 ✅
- `h.db.UpdatePaymentProof(order.ID, proofURL)` defined in Task 4 matches call in Task 8 ✅
- `h.db.RejectPayment(orderID)` defined in Task 4 matches call in Task 8 ✅
- `models.OrderStatusWaitingPayment` / `models.OrderStatusCompleted` used as `string(...)` in `UpdateOrderStatus` calls — consistent with `UpdateOrderStatus(orderID, status string)` signature ✅
- `buildInvoiceMessage` gains `bank *models.BankConfig` param in Task 8 — all calls pass `bank` from `GetActiveBankConfig()` ✅
