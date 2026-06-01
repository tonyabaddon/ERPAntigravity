# Schema & ID System Design Spec

**Date:** 2026-06-01
**Sub-project:** B of 3 (Schema & ID System Gaps)
**Status:** Approved for implementation

---

## Problem

The current database schema and Go models are incomplete relative to what the Garindo Jaya Panel system prompt specifies:

1. `conversations` has no `ai_active` flag — scheduler and handler cannot distinguish AI mode from admin-takeover mode.
2. `order_status` enum has only 4 placeholder values (PENDING, APPROVED, CANCELLED, COMPLETED) — none of the real business statuses (PENDING_ADMIN_CONFIRMATION, WAITING_PAYMENT, etc.) exist.
3. No `customers` table — the GJP-CUST-XXXX customer identity system is entirely absent.
4. No `leads` table — the GJP-LEAD-YYYYMMDD-XXXX lead tracking system is entirely absent.
5. No `bank_config` table — bank account details for payment instructions are hardcoded placeholders in the system prompt.
6. `orders` table is missing: `gjp_order_id`, `order_type`, `leads_id`, `customer_id`, `delivery_type`, `payment_proof_url`, `payment_verified_at`, `verified_by`.
7. Go models and DB layer do not reflect any of the above.
8. Handler does not create customer or lead records when a conversation starts.

---

## Goal

Add a single Supabase migration that brings the schema into full alignment with the spec. Update Go models and DB layer to match. Wire customer/lead creation into the message handler so the ID system is live from the first message.

---

## Decisions

- **GJP IDs as display columns, UUID as PK** — existing UUID primary keys are kept everywhere. GJP IDs (GJP-CUST-XXXX, GJP-LEAD-YYYYMMDD-XXXX, GJP-ORD-YYYYMMDD-XXXX) are stored as additional text columns, generated via Postgres sequences. No structural breakage to existing code.
- **Replace order_status enum** — Postgres does not support removing enum values. Old values (PENDING, APPROVED) remain in the enum type but are never used going forward. All Go constants and DB queries are updated to use the new values.
- **Handler wires customer/lead creation** — `handler.go` is the right boundary. Machine, engine, and parser are untouched.

---

## Files Changed

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/20260601000001_schema_id_system.sql` | All schema changes in one migration |
| `backend-go/internal/db/customers.go` | `GetOrCreateCustomer` — find or create by WA number |
| `backend-go/internal/db/leads.go` | `CreateLead`, `UpdateLeadStatus` |
| `backend-go/internal/db/bank_config.go` | `GetActiveBankConfig` |

### Modified files

| File | Change |
|---|---|
| `backend-go/internal/models/types.go` | New OrderStatus constants, new structs (Customer, Lead, BankConfig), new fields on Conversation and Order |
| `backend-go/internal/db/conversations.go` | Scan/insert `ai_active`; `GetOrCreateConversation` returns `(conv, created bool, err)` |
| `backend-go/internal/db/orders.go` | Scan/insert new order columns; default status → PENDING_ADMIN_CONFIRMATION |
| `backend-go/internal/whatsapp/handler.go` | Call `GetOrCreateCustomer` + `CreateLead` (on new conversations only) after `GetOrCreateConversation` |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `parser.go`, `machine.go`, all React files.

---

## Section 1: Database Migration

**File:** `supabase/migrations/20260601000001_schema_id_system.sql`

### 1a. Expand order_status enum

Add new values (Postgres cannot remove existing values, so PENDING and APPROVED remain but are unused going forward):

```sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_ADMIN_CONFIRMATION';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_PRICE_NEGO';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_STOCK_CHECK';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_CUSTOM_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_WIRING_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'WAITING_PAYMENT';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_UPLOADED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_VERIFIED';
```

(CANCELLED and COMPLETED already exist.)

### 1b. Add ai_active to conversations

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_active boolean NOT NULL DEFAULT true;
GRANT UPDATE (state, ai_active) ON conversations TO anon;
```

### 1c. Sequences for GJP IDs

```sql
CREATE SEQUENCE IF NOT EXISTS gjp_cust_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_lead_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_ord_seq START 1;
```

`gjp_lead_seq` and `gjp_ord_seq` are global counters (not per-day). The date portion in GJP-LEAD-YYYYMMDD-XXXX comes from the application at insert time, formatted as `to_char(now(), 'YYYYMMDD')`. The sequence provides the collision-safe XXXX suffix.

### 1d. customers table

```sql
CREATE TABLE IF NOT EXISTS customers (
  id          text PRIMARY KEY,  -- GJP-CUST-XXXX
  wa_number   text NOT NULL,
  name        text NOT NULL DEFAULT '',
  company     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customers ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_customers" ON customers FOR SELECT TO anon USING (true);
```

### 1e. leads table

```sql
CREATE TABLE IF NOT EXISTS leads (
  id                  text PRIMARY KEY,  -- GJP-LEAD-YYYYMMDD-XXXX
  customer_id         text NOT NULL REFERENCES customers(id),
  conversation_id     uuid NOT NULL REFERENCES conversations(id),
  wa_number           text NOT NULL,
  status              text NOT NULL DEFAULT 'NEW',
  confirmed_order_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leads_customer ON leads(customer_id);
CREATE INDEX idx_leads_conversation ON leads(conversation_id);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_leads" ON leads FOR SELECT TO anon USING (true);

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Lead status lifecycle: `NEW → IN_PROGRESS → ESCALATED | ORDERED | DROPPED`

### 1f. bank_config table

```sql
CREATE TABLE IF NOT EXISTS bank_config (
  id             serial PRIMARY KEY,
  bank_name      text NOT NULL,
  account_number text NOT NULL,
  account_name   text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bank_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select_bank_config" ON bank_config FOR SELECT TO anon USING (true);

CREATE TRIGGER trg_bank_config_updated_at
  BEFORE UPDATE ON bank_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Only one row should have `is_active = true` at a time (enforced by application logic, not DB constraint).

### 1g. Add columns to orders

```sql
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS gjp_order_id      text UNIQUE,
  ADD COLUMN IF NOT EXISTS order_type        text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS leads_id          text REFERENCES leads(id),
  ADD COLUMN IF NOT EXISTS customer_id       text REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS delivery_type     text,
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by       text;
```

`gjp_order_id` is populated when admin approves the order (not at creation time). `order_type` valid values: `STANDARD`, `CUSTOM_PANEL`, `WIRING_PANEL`.

### 1h. Realtime for new tables

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'customers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'leads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  END IF;
END $$;
```

---

## Section 2: Go Models (`backend-go/internal/models/types.go`)

### OrderStatus constants (replace old, add new)

Remove: `OrderStatusPending`, `OrderStatusApproved` (unused going forward).
Add:

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
    OrderStatusCancelled                OrderStatus = "CANCELLED"
    OrderStatusCompleted                OrderStatus = "COMPLETED"
)
```

### OrderType and DeliveryType constants

```go
type OrderType string
const (
    OrderTypeStandard    OrderType = "STANDARD"
    OrderTypeCustomPanel OrderType = "CUSTOM_PANEL"
    OrderTypeWiring      OrderType = "WIRING_PANEL"
)

type DeliveryType string
const (
    DeliveryTypePickup   DeliveryType = "PICKUP"
    DeliveryTypeDelivery DeliveryType = "DELIVERY"
)
```

### LeadStatus constants

```go
type LeadStatus string
const (
    LeadStatusNew       LeadStatus = "NEW"
    LeadStatusInProgress LeadStatus = "IN_PROGRESS"
    LeadStatusEscalated LeadStatus = "ESCALATED"
    LeadStatusOrdered   LeadStatus = "ORDERED"
    LeadStatusDropped   LeadStatus = "DROPPED"
)
```

### Conversation — add AIActive

```go
type Conversation struct {
    // ... existing fields ...
    AIActive           bool              `json:"ai_active"`
}
```

### Order — add new fields

```go
type Order struct {
    // ... existing fields ...
    GJPOrderID        string       `json:"gjp_order_id,omitempty"`
    OrderType         OrderType    `json:"order_type"`
    LeadsID           string       `json:"leads_id,omitempty"`
    CustomerID        string       `json:"customer_id,omitempty"`
    DeliveryType      DeliveryType `json:"delivery_type,omitempty"`
    PaymentProofURL   string       `json:"payment_proof_url,omitempty"`
    PaymentVerifiedAt *time.Time   `json:"payment_verified_at,omitempty"`
    VerifiedBy        string       `json:"verified_by,omitempty"`
}
```

### New structs

```go
type Customer struct {
    ID        string    `json:"id"`
    WANumber  string    `json:"wa_number"`
    Name      string    `json:"name"`
    Company   string    `json:"company"`
    CreatedAt time.Time `json:"created_at"`
}

type Lead struct {
    ID               string     `json:"id"`
    CustomerID       string     `json:"customer_id"`
    ConversationID   string     `json:"conversation_id"`
    WANumber         string     `json:"wa_number"`
    Status           LeadStatus `json:"status"`
    ConfirmedOrderID string     `json:"confirmed_order_id,omitempty"`
    CreatedAt        time.Time  `json:"created_at"`
    UpdatedAt        time.Time  `json:"updated_at"`
}

type BankConfig struct {
    ID            int       `json:"id"`
    BankName      string    `json:"bank_name"`
    AccountNumber string    `json:"account_number"`
    AccountName   string    `json:"account_name"`
    IsActive      bool      `json:"is_active"`
    UpdatedAt     time.Time `json:"updated_at"`
}
```

---

## Section 3: DB Layer

### `backend-go/internal/db/customers.go`

```go
func (c *Client) GetOrCreateCustomer(waNumber string) (*models.Customer, error)
```

Uses `INSERT ... ON CONFLICT (wa_number) DO UPDATE SET wa_number = EXCLUDED.wa_number RETURNING *` — always returns the row whether inserted or found. ID generated as:
```sql
'GJP-CUST-' || lpad(nextval('gjp_cust_seq')::text, 4, '0')
```

### `backend-go/internal/db/leads.go`

```go
func (c *Client) CreateLead(customerID, conversationID, waNumber string) (*models.Lead, error)
func (c *Client) UpdateLeadStatus(leadID string, status models.LeadStatus) error
```

Lead ID generated as:
```sql
'GJP-LEAD-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('gjp_lead_seq')::text, 4, '0')
```

### `backend-go/internal/db/bank_config.go`

```go
func (c *Client) GetActiveBankConfig() (*models.BankConfig, error)
```

Simple `SELECT ... WHERE is_active = true LIMIT 1`.

### `backend-go/internal/db/conversations.go`

- `GetOrCreateConversation` signature changes to return `(conv *models.Conversation, created bool, err error)`.
- `findActiveConversation` and `createConversation` both scan `ai_active`.
- `createConversation` returns `created = true`; `findActiveConversation` path returns `created = false`.

### `backend-go/internal/db/orders.go`

- `CreateOrder` accepts `leadsID, customerID string, orderType models.OrderType, deliveryType models.DeliveryType`; inserts with status `PENDING_ADMIN_CONFIRMATION`.
- `GetOrderByConversation` and `GetOrderByID` scan all new columns.
- `UpdateOrderStatus` signature unchanged — callers now pass new status string values.
- `ListActiveBookings` updated: query changes from `status IN ('PENDING')` to `status IN ('PENDING_ADMIN_CONFIRMATION')`.

---

## Section 4: Handler Wiring (`backend-go/internal/whatsapp/handler.go`)

After `GetOrCreateConversation`, add:

```go
conv, created, err := h.db.GetOrCreateConversation(senderPhone, waNumberID)
if err != nil { /* handle */ }

customer, err := h.db.GetOrCreateCustomer(senderPhone)
if err != nil { /* handle */ }

if created {
    _, err = h.db.CreateLead(customer.ID, conv.ID, senderPhone)
    if err != nil { /* handle */ }
}
```

Error handling: log and continue — a failed customer/lead creation must not drop the incoming message. The conversation still proceeds; the ID records can be backfilled later.

---

## What Does NOT Change

- `engine/machine.go`, `engine/parser.go`, `engine/prompts.go`
- `engine/machine_test.go`
- `internal/gemini/`
- `internal/scheduler/`
- `internal/rules/`
- All React frontend files

---

## Success Criteria

1. `supabase/migrations/20260601000001_schema_id_system.sql` applies cleanly against the Supabase project (no errors).
2. `CGO_ENABLED=1 go build ./...` passes after model and DB changes.
3. `CGO_ENABLED=1 go test ./...` passes — no regressions.
4. Sending a WhatsApp message creates a row in `customers` (GJP-CUST-XXXX) and a row in `leads` (GJP-LEAD-YYYYMMDD-XXXX) visible in the Supabase dashboard.
5. A second message from the same number does NOT create a second customer row (idempotent).
6. `bank_config` table exists and accepts a manual INSERT of bank details via Supabase dashboard.
