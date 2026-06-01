# Schema & ID System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Supabase schema and Go models into full alignment with the Garindo Jaya Panel spec — adding the GJP customer/lead ID system, expanded order statuses, ai_active flag, bank_config table, and wiring customer/lead creation into the message handler.

**Architecture:** A single new migration file adds all schema changes idempotently. Go models in `types.go` are extended with new types and structs. Three new DB files handle the new tables. Existing `conversations.go` and `orders.go` are updated to scan new columns. `handler.go` calls `GetOrCreateCustomer` + `CreateLead` on every new conversation's first message.

**Tech Stack:** Go 1.25, PostgreSQL (Supabase), `database/sql`, `github.com/lib/pq`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260601000001_schema_id_system.sql` | **Create** | All schema changes: enums, tables, columns, sequences, RLS, realtime |
| `backend-go/internal/models/types.go` | **Modify** | Add new types/constants/structs; add fields to Conversation and Order |
| `backend-go/internal/db/customers.go` | **Create** | `GetOrCreateCustomer` — upsert by WA number, return GJP-CUST-XXXX |
| `backend-go/internal/db/leads.go` | **Create** | `CreateLead`, `UpdateLeadStatus` |
| `backend-go/internal/db/bank_config.go` | **Create** | `GetActiveBankConfig` |
| `backend-go/internal/db/conversations.go` | **Modify** | Scan `ai_active`; `GetOrCreateConversation` returns `(conv, created bool, err)` |
| `backend-go/internal/db/orders.go` | **Modify** | Scan/insert new columns; default status → `PENDING_ADMIN_CONFIRMATION` |
| `backend-go/internal/whatsapp/handler.go` | **Modify** | Wire `GetOrCreateCustomer` + `CreateLead`; update `handleBooking` signature |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `machine_test.go`, any React files.

---

## Task 1: Write and apply the Supabase migration

**Files:**
- Create: `supabase/migrations/20260601000001_schema_id_system.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260601000001_schema_id_system.sql

-- 1. Expand order_status enum with spec-compliant business statuses.
--    Existing values (PENDING, APPROVED) remain but are unused going forward.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_ADMIN_CONFIRMATION';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_PRICE_NEGO';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_STOCK_CHECK';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_CUSTOM_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_WIRING_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'WAITING_PAYMENT';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_UPLOADED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_VERIFIED';

-- 2. Add ai_active to conversations (false = admin has taken over, AI is silent).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_active boolean NOT NULL DEFAULT true;
-- Extend the existing anon UPDATE grant to cover ai_active.
GRANT UPDATE (state, ai_active) ON conversations TO anon;

-- 3. Sequences for GJP ID generation (global counters; gaps are acceptable).
CREATE SEQUENCE IF NOT EXISTS gjp_cust_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_lead_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_ord_seq  START 1;

-- 4. customers table — one row per WA number, permanent identity.
CREATE TABLE IF NOT EXISTS customers (
  id         text        PRIMARY KEY,   -- GJP-CUST-XXXX
  wa_number  text        NOT NULL,
  name       text        NOT NULL DEFAULT '',
  company    text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_customers_wa'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);
  END IF;
END $$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'anon_select_customers'
  ) THEN
    CREATE POLICY "anon_select_customers" ON customers FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 5. leads table — one row per conversation, lifecycle NEW→IN_PROGRESS→ESCALATED|ORDERED|DROPPED.
CREATE TABLE IF NOT EXISTS leads (
  id                 text        PRIMARY KEY,   -- GJP-LEAD-YYYYMMDD-XXXX
  customer_id        text        NOT NULL REFERENCES customers(id),
  conversation_id    uuid        NOT NULL REFERENCES conversations(id),
  wa_number          text        NOT NULL,
  status             text        NOT NULL DEFAULT 'NEW',
  confirmed_order_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_customer      ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_conversation  ON leads(conversation_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'anon_select_leads'
  ) THEN
    CREATE POLICY "anon_select_leads" ON leads FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_leads_updated_at' AND event_object_table = 'leads'
  ) THEN
    CREATE TRIGGER trg_leads_updated_at
      BEFORE UPDATE ON leads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 6. bank_config table — admin edits payment details here; only one row is_active=true at a time.
CREATE TABLE IF NOT EXISTS bank_config (
  id             serial      PRIMARY KEY,
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_select_bank_config'
  ) THEN
    CREATE POLICY "anon_select_bank_config" ON bank_config FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_bank_config_updated_at' AND event_object_table = 'bank_config'
  ) THEN
    CREATE TRIGGER trg_bank_config_updated_at
      BEFORE UPDATE ON bank_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 7. Add new columns to orders table.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gjp_order_id        text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type          text        NOT NULL DEFAULT 'STANDARD';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS leads_id            text        REFERENCES leads(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id         text        REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type       text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_url   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by         text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gjp_order_id_key'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_gjp_order_id_key UNIQUE (gjp_order_id);
  END IF;
END $$;

-- 8. Enable Supabase Realtime for new tables.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration to Supabase**

Open the Supabase dashboard → SQL Editor → paste the entire file above → Run.

Expected: All statements execute without error. Verify in Table Editor: `customers`, `leads`, `bank_config` tables exist. In the `conversations` table, `ai_active` column exists. In the `orders` table, `gjp_order_id`, `leads_id`, etc. exist.

**This step must complete before Tasks 3–6 can be tested end-to-end.** The Go build (Tasks 2–6) works without it, but the DB queries will fail at runtime until the migration is applied.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260601000001_schema_id_system.sql
git commit -m "feat(sql): add schema migration — customers, leads, bank_config, ai_active, order status expansion"
```

---

## Task 2: Update Go models

**Files:**
- Modify: `backend-go/internal/models/types.go`

- [ ] **Step 1: Replace the full content of `backend-go/internal/models/types.go`**

```go
package models

import "time"

type ConversationState string

const (
	StateGreeting        ConversationState = "GREETING"
	StateCollecting      ConversationState = "COLLECTING"
	StateClarifying      ConversationState = "CLARIFYING"
	StateStockCheck      ConversationState = "STOCK_CHECK"
	StateConfirming      ConversationState = "CONFIRMING"
	StateBooked          ConversationState = "BOOKED"
	StateTimeoutReminder ConversationState = "TIMEOUT_REMINDER"
	StateCancelled       ConversationState = "CANCELLED"
	StateApproved        ConversationState = "APPROVED"
	StateCompleted       ConversationState = "COMPLETED"
	StateEscalatedAdmin  ConversationState = "ESCALATED_ADMIN"
	StateEscalatedWiring ConversationState = "ESCALATED_WIRING"
)

func (s ConversationState) IsTerminal() bool {
	switch s {
	case StateCancelled, StateCompleted, StateEscalatedAdmin, StateEscalatedWiring:
		return true
	}
	return false
}

type OrderStatus string

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

type LeadStatus string

const (
	LeadStatusNew        LeadStatus = "NEW"
	LeadStatusInProgress LeadStatus = "IN_PROGRESS"
	LeadStatusEscalated  LeadStatus = "ESCALATED"
	LeadStatusOrdered    LeadStatus = "ORDERED"
	LeadStatusDropped    LeadStatus = "DROPPED"
)

type MessageSender string

const (
	SenderCustomer MessageSender = "customer"
	SenderAI       MessageSender = "ai"
	SenderAdmin    MessageSender = "admin"
	SenderSystem   MessageSender = "system"
)

type CollectedData struct {
	Name     string    `json:"name,omitempty"`
	Company  string    `json:"company,omitempty"`
	Address  string    `json:"address,omitempty"`
	Product  string    `json:"product,omitempty"`
	Quantity int       `json:"quantity,omitempty"`
	Specs    SpecsData `json:"specs,omitempty"`
}

func (d CollectedData) AllCoreFieldsFilled() bool {
	return d.Name != "" && d.Company != "" && d.Address != "" && d.Product != ""
}

type SpecsData struct {
	Size  string `json:"size,omitempty"`
	Color string `json:"color,omitempty"`
	Notes string `json:"notes,omitempty"`
}

type Conversation struct {
	ID                 string            `json:"id"`
	WANumberID         string            `json:"wa_number_id"`
	CustomerPhone      string            `json:"customer_phone"`
	State              ConversationState `json:"state"`
	Language           string            `json:"language"`
	CollectedData      CollectedData     `json:"collected_data"`
	ClarificationRound int               `json:"clarification_round"`
	AIActive           bool              `json:"ai_active"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type Message struct {
	ID             string        `json:"id"`
	ConversationID string        `json:"conversation_id"`
	Sender         MessageSender `json:"sender"`
	Text           string        `json:"text"`
	MediaURL       string        `json:"media_url,omitempty"`
	MediaType      string        `json:"media_type,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
}

type Order struct {
	ID               string       `json:"id"`
	ConversationID   string       `json:"conversation_id"`
	GJPOrderID       string       `json:"gjp_order_id,omitempty"`
	OrderType        OrderType    `json:"order_type"`
	LeadsID          string       `json:"leads_id,omitempty"`
	CustomerID       string       `json:"customer_id,omitempty"`
	CustomerName     string       `json:"customer_name"`
	CustomerCompany  string       `json:"customer_company"`
	CustomerAddress  string       `json:"customer_address"`
	CustomerPhone    string       `json:"customer_phone"`
	DeliveryType     DeliveryType `json:"delivery_type,omitempty"`
	Items            []OrderItem  `json:"items"`
	Subtotal         float64      `json:"subtotal"`
	ShippingFee      *float64     `json:"shipping_fee,omitempty"`
	Total            float64      `json:"total"`
	Status           OrderStatus  `json:"status"`
	BookingExpiresAt time.Time    `json:"booking_expires_at"`
	ReminderSentAt   *time.Time   `json:"reminder_sent_at,omitempty"`
	ApprovedAt       *time.Time   `json:"approved_at,omitempty"`
	PaymentProofURL  string       `json:"payment_proof_url,omitempty"`
	PaymentVerifiedAt *time.Time  `json:"payment_verified_at,omitempty"`
	VerifiedBy       string       `json:"verified_by,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

type OrderItem struct {
	SKU       string  `json:"sku"`
	Name      string  `json:"name"`
	Qty       int     `json:"qty"`
	UnitPrice float64 `json:"unit_price"`
	Subtotal  float64 `json:"subtotal"`
}

type StockItem struct {
	SKU      string  `json:"sku"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Price    float64 `json:"price"`
	Stock    int     `json:"stock"`
	Status   string  `json:"status"`
}

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

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors. The old `OrderStatusPending` / `OrderStatusApproved` constants are removed — if anything in the codebase referenced them, the build would fail here. (Nothing should — the only usages were in `orders.go` which we update in Task 5.)

- [ ] **Step 3: Run existing tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/models/types.go
git commit -m "feat(go): expand models — new order statuses, order/delivery types, lead status, customer/lead/bankconfig structs"
```

---

## Task 3: Create new DB files — customers, leads, bank_config

**Files:**
- Create: `backend-go/internal/db/customers.go`
- Create: `backend-go/internal/db/leads.go`
- Create: `backend-go/internal/db/bank_config.go`

- [ ] **Step 1: Create `backend-go/internal/db/customers.go`**

```go
package db

import "github.com/username/sinar-elektrik-backend/internal/models"

// GetOrCreateCustomer finds the customer by WA number or creates a new one.
// Uses INSERT ... ON CONFLICT DO UPDATE so RETURNING always returns a row.
// The sequence nextval advances on every call (gaps are acceptable).
func (c *Client) GetOrCreateCustomer(waNumber string) (*models.Customer, error) {
	var cust models.Customer
	err := c.DB.QueryRow(`
		INSERT INTO customers (id, wa_number)
		VALUES (
			'GJP-CUST-' || lpad(nextval('gjp_cust_seq')::text, 4, '0'),
			$1
		)
		ON CONFLICT (wa_number) DO UPDATE
			SET wa_number = EXCLUDED.wa_number
		RETURNING id, wa_number, name, company, created_at
	`, waNumber).Scan(
		&cust.ID, &cust.WANumber, &cust.Name, &cust.Company, &cust.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cust, nil
}
```

- [ ] **Step 2: Create `backend-go/internal/db/leads.go`**

```go
package db

import (
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// CreateLead inserts a new lead record linked to a customer and conversation.
// Lead ID format: GJP-LEAD-YYYYMMDD-XXXX (date from DB clock, sequence counter).
func (c *Client) CreateLead(customerID, conversationID, waNumber string) (*models.Lead, error) {
	var lead models.Lead
	err := c.DB.QueryRow(`
		INSERT INTO leads (id, customer_id, conversation_id, wa_number)
		VALUES (
			'GJP-LEAD-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('gjp_lead_seq')::text, 4, '0'),
			$1, $2, $3
		)
		RETURNING id, customer_id, conversation_id, wa_number, status,
		          COALESCE(confirmed_order_id, ''), created_at, updated_at
	`, customerID, conversationID, waNumber).Scan(
		&lead.ID, &lead.CustomerID, &lead.ConversationID, &lead.WANumber,
		&lead.Status, &lead.ConfirmedOrderID, &lead.CreatedAt, &lead.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &lead, nil
}

func (c *Client) UpdateLeadStatus(leadID string, status models.LeadStatus) error {
	_, err := c.DB.Exec(`
		UPDATE leads SET status = $1, updated_at = $2 WHERE id = $3
	`, string(status), time.Now(), leadID)
	return err
}
```

- [ ] **Step 3: Create `backend-go/internal/db/bank_config.go`**

```go
package db

import (
	"database/sql"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetActiveBankConfig returns the single active bank config row, or nil if none exists.
func (c *Client) GetActiveBankConfig() (*models.BankConfig, error) {
	var bc models.BankConfig
	err := c.DB.QueryRow(`
		SELECT id, bank_name, account_number, account_name, is_active, updated_at
		FROM bank_config WHERE is_active = true LIMIT 1
	`).Scan(&bc.ID, &bc.BankName, &bc.AccountNumber, &bc.AccountName, &bc.IsActive, &bc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &bc, nil
}
```

- [ ] **Step 4: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 5: Run existing tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/db/customers.go backend-go/internal/db/leads.go backend-go/internal/db/bank_config.go
git commit -m "feat(go): add db layer for customers, leads, bank_config tables"
```

---

## Task 4: Update conversations.go — ai_active + created bool return

**Files:**
- Modify: `backend-go/internal/db/conversations.go`

- [ ] **Step 1: Replace the full content of `backend-go/internal/db/conversations.go`**

```go
package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetOrCreateConversation returns (conversation, created, error).
// created=true means a new conversation row was just inserted.
func (c *Client) GetOrCreateConversation(customerPhone, waNumberID string) (*models.Conversation, bool, error) {
	conv, err := c.findActiveConversation(customerPhone, waNumberID)
	if err == sql.ErrNoRows {
		conv, err = c.createConversation(customerPhone, waNumberID)
		return conv, true, err
	}
	if err != nil {
		return nil, false, err
	}
	return conv, false, nil
}

func (c *Client) findActiveConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, ai_active, created_at, updated_at
		FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, phone, waNumberID).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	return &conv, nil
}

func (c *Client) createConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	err := c.DB.QueryRow(`
		INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
		VALUES ($1, $2, 'GREETING', 'id', '{}', 0)
		RETURNING id, wa_number_id, customer_phone, state, language,
		          collected_data, clarification_round, ai_active, created_at, updated_at
	`, waNumberID, phone).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	return &conv, nil
}

func (c *Client) UpdateConversationState(id string, state models.ConversationState) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET state = $1, updated_at = $2 WHERE id = $3
	`, string(state), time.Now(), id)
	return err
}

func (c *Client) UpdateCollectedData(id string, data models.CollectedData, clarificationRound int) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = c.DB.Exec(`
		UPDATE conversations SET collected_data = $1, clarification_round = $2, updated_at = $3 WHERE id = $4
	`, dataJSON, clarificationRound, time.Now(), id)
	return err
}

func (c *Client) UpdateLanguage(id, language string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET language = $1, updated_at = $2 WHERE id = $3
	`, language, time.Now(), id)
	return err
}

func (c *Client) ListConversationsByPhone(phone string) ([]*models.Conversation, error) {
	rows, err := c.DB.Query(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, ai_active, created_at, updated_at
		FROM conversations WHERE customer_phone = $1 ORDER BY created_at DESC
	`, phone)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		var dataJSON []byte
		rows.Scan(
			&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
			&conv.Language, &dataJSON, &conv.ClarificationRound,
			&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
		)
		json.Unmarshal(dataJSON, &conv.CollectedData)
		result = append(result, &conv)
	}
	return result, nil
}
```

- [ ] **Step 2: Build check — expect compile error in handler.go**

```bash
cd backend-go && CGO_ENABLED=1 go build ./... 2>&1
```

Expected: Build **fails** with errors like:
```
internal/whatsapp/handler.go:69:15: assignment mismatch: 2 variables but h.db.GetOrCreateConversation returns 3 values
```

This is expected — `handler.go` still calls `GetOrCreateConversation` with 2-value assignment. Task 6 fixes this. Note: if the error does NOT appear here, double-check that conversations.go was updated correctly.

- [ ] **Step 3: Commit (even with build broken — the error is expected and tracked)**

```bash
git add backend-go/internal/db/conversations.go
git commit -m "feat(go): conversations.go — scan ai_active, GetOrCreateConversation returns created bool"
```

---

## Task 5: Update orders.go — new columns, new default status

**Files:**
- Modify: `backend-go/internal/db/orders.go`

- [ ] **Step 1: Replace the full content of `backend-go/internal/db/orders.go`**

```go
package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// CreateOrder inserts a new order. leadsID and customerID may be empty strings
// (stored as NULL) if not yet known — sub-project C will populate them.
// deliveryType may be empty (unknown until after customer confirms).
func (c *Client) CreateOrder(
	conv *models.Conversation,
	items []models.OrderItem,
	subtotal float64,
	leadsID, customerID string,
	orderType models.OrderType,
	deliveryType models.DeliveryType,
) (*models.Order, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(48 * time.Hour)

	// Convert empty strings to nil for nullable FK columns.
	var leadsIDVal, customerIDVal, deliveryTypeVal interface{}
	if leadsID != "" {
		leadsIDVal = leadsID
	}
	if customerID != "" {
		customerIDVal = customerID
	}
	if deliveryType != "" {
		deliveryTypeVal = string(deliveryType)
	}

	var order models.Order
	var itemsBack []byte
	err = c.DB.QueryRow(`
		INSERT INTO orders (
			conversation_id, customer_name, customer_company, customer_address,
			customer_phone, items, subtotal, total, status, booking_expires_at,
			leads_id, customer_id, order_type, delivery_type
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'PENDING_ADMIN_CONFIRMATION',$8,$9,$10,$11,$12)
		RETURNING id, conversation_id,
		          COALESCE(gjp_order_id,''), order_type,
		          COALESCE(leads_id,''), COALESCE(customer_id,''),
		          customer_name, customer_company, customer_address, customer_phone,
		          COALESCE(delivery_type,''),
		          items, subtotal, total, status, booking_expires_at,
		          created_at, updated_at
	`,
		conv.ID,
		conv.CollectedData.Name,
		conv.CollectedData.Company,
		conv.CollectedData.Address,
		conv.CustomerPhone,
		itemsJSON,
		subtotal,
		expiresAt,
		leadsIDVal,
		customerIDVal,
		string(orderType),
		deliveryTypeVal,
	).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsBack, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsBack, &order.Items)
	return &order, nil
}

func (c *Client) UpdateOrderStatus(orderID, status string) error {
	var query string
	if status == "CANCELLED" {
		query = `UPDATE orders SET status = $1 WHERE id = $2`
	} else {
		query = `UPDATE orders SET status = $1, approved_at = now() WHERE id = $2`
	}
	_, err := c.DB.Exec(query, status, orderID)
	return err
}

func (c *Client) MarkReminderSent(orderID string) error {
	_, err := c.DB.Exec(`UPDATE orders SET reminder_sent_at = $1 WHERE id = $2`, time.Now(), orderID)
	return err
}

type PendingOrder struct {
	ID             string
	ConversationID string
	CustomerPhone  string
	ExpiresAt      time.Time
}

func (c *Client) ListActiveBookings() ([]PendingOrder, error) {
	rows, err := c.DB.Query(`
		SELECT o.id, o.conversation_id, o.customer_phone, o.booking_expires_at
		FROM orders o
		WHERE o.status IN ('PENDING_ADMIN_CONFIRMATION') AND o.booking_expires_at > now()
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var orders []PendingOrder
	for rows.Next() {
		var o PendingOrder
		rows.Scan(&o.ID, &o.ConversationID, &o.CustomerPhone, &o.ExpiresAt)
		orders = append(orders, o)
	}
	return orders, nil
}

func (c *Client) GetOrderByConversation(conversationID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       created_at, updated_at
		FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1
	`, conversationID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}

func (c *Client) GetOrderByID(orderID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       created_at, updated_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}

// GetOrderByIDWithPayment returns a full order including payment fields.
// Used by the payment verification flow (sub-project C).
func (c *Client) GetOrderByIDWithPayment(orderID string) (*models.Order, error) {
	var order models.Order
	var itemsJSON []byte
	var paymentVerifiedAt sql.NullTime
	err := c.DB.QueryRow(`
		SELECT id, conversation_id,
		       COALESCE(gjp_order_id,''), order_type,
		       COALESCE(leads_id,''), COALESCE(customer_id,''),
		       customer_name, customer_company, customer_address, customer_phone,
		       COALESCE(delivery_type,''),
		       items, subtotal, total, status, booking_expires_at,
		       COALESCE(payment_proof_url,''), payment_verified_at,
		       COALESCE(verified_by,''),
		       created_at, updated_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID,
		&order.GJPOrderID, &order.OrderType,
		&order.LeadsID, &order.CustomerID,
		&order.CustomerName, &order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&order.DeliveryType,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt,
		&order.PaymentProofURL, &paymentVerifiedAt,
		&order.VerifiedBy,
		&order.CreatedAt, &order.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if paymentVerifiedAt.Valid {
		order.PaymentVerifiedAt = &paymentVerifiedAt.Time
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}
```

- [ ] **Step 2: Build check — still expect handler.go compile error**

```bash
cd backend-go && CGO_ENABLED=1 go build ./... 2>&1
```

Expected: Still fails on `handler.go` (`GetOrCreateConversation` mismatch + `CreateOrder` wrong arity). This is expected — Task 6 fixes the handler.

- [ ] **Step 3: Run engine tests (unaffected by DB changes)**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/engine/... ./internal/rules/... ./internal/scheduler/... 2>&1
```

Expected: All pass. Engine tests use mocks and never touch the DB layer.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/orders.go
git commit -m "feat(go): orders.go — new columns, PENDING_ADMIN_CONFIRMATION default, GetOrderByIDWithPayment"
```

---

## Task 6: Update handler.go — wire customer/lead creation

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`

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
)

type Handler struct {
	db         *db.Client
	machine    *engine.Machine
	sender     *Sender
	scheduler  *scheduler.Scheduler
	waNumberID string
	startedAt  time.Time
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID string) *Handler {
	return &Handler{db: d, machine: m, sender: s, scheduler: sc, waNumberID: waNumberID, startedAt: time.Now()}
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
		h.db.UpdateLanguage(conv.ID, result.Language)
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
	h.db.InsertMessage(conv.ID, models.SenderSystem, "[Media received from customer]")
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
	h.db.InsertMessage(conv.ID, models.SenderAI, reply)
	h.sender.SendText(context.Background(), senderPhone, reply)
}

// HandleApprovedOrder is called by the LISTEN/NOTIFY dispatcher when an order is approved.
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
	invoice := buildInvoiceMessage(order, shippingFee, total, lang)

	h.db.InsertMessage(conversationID, models.SenderSystem, "ORDER_APPROVED: invoice sent")
	if err := h.sender.SendText(ctx, order.CustomerPhone, invoice); err != nil {
		log.Printf("[HANDLER] Invoice send error: %v", err)
	}
	h.db.UpdateOrderStatus(orderID, "COMPLETED")
	h.db.UpdateConversationState(conversationID, models.StateCompleted)
}

func buildInvoiceMessage(order *models.Order, shippingFee, total float64, lang string) string {
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
Bank BCA — 1234567890
A/N Garindo Jaya Panel

Payment deadline: 2×24 hours from this message.
Thank you!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
			items, order.Subtotal, shippingFee, total)
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
Bank BCA — 1234567890
A/N Garindo Jaya Panel

Batas pembayaran: 2×24 jam sejak pesan ini.
Terima kasih!`, order.CustomerName, order.CustomerCompany, order.CustomerAddress,
		items, order.Subtotal, shippingFee, total)
}
```

- [ ] **Step 2: Full build check — must be clean now**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: **No errors.** All three places where `GetOrCreateConversation` is called now use the three-value return. `CreateOrder` is called with the new 7-argument signature.

- [ ] **Step 3: Run full test suite**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All tests pass. Engine/rules/scheduler tests use mocks and are unaffected by DB and handler changes.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "feat(go): handler — wire GetOrCreateCustomer + CreateLead on new conversations"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ `order_status` enum expanded with 8 new values — Task 1
- ✅ `conversations.ai_active` added — Task 1 (SQL) + Task 4 (Go)
- ✅ `gjp_cust_seq`, `gjp_lead_seq`, `gjp_ord_seq` sequences — Task 1
- ✅ `customers` table with GJP-CUST-XXXX IDs — Task 1 + Task 3
- ✅ `leads` table with GJP-LEAD-YYYYMMDD-XXXX IDs — Task 1 + Task 3
- ✅ `bank_config` table — Task 1 + Task 3
- ✅ `orders` new columns (gjp_order_id, order_type, leads_id, customer_id, delivery_type, payment_proof_url, payment_verified_at, verified_by) — Task 1 + Task 5
- ✅ Go model types (OrderStatus, OrderType, DeliveryType, LeadStatus, Customer, Lead, BankConfig) — Task 2
- ✅ `GetOrCreateConversation` returns `created bool` — Task 4
- ✅ `GetOrCreateCustomer` + `CreateLead` wired in handler — Task 6
- ✅ `CreateOrder` uses `PENDING_ADMIN_CONFIRMATION` — Task 5
- ✅ `ListActiveBookings` updated to `PENDING_ADMIN_CONFIRMATION` — Task 5
- ✅ Error handling: customer/lead failures log-and-continue — Task 6

**No placeholders found.**

**Type consistency:**
- `models.OrderType` used in `CreateOrder` param and `models.OrderTypeStandard` in handler ✅
- `models.DeliveryType` used consistently — empty string `""` cast works since `DeliveryType("")` is valid Go ✅
- `models.LeadStatus` used in `UpdateLeadStatus` ✅
- `GetOrCreateConversation` returns `(conv, created, err)` — consistent in conversations.go (Task 4) and handler.go (Task 6) ✅
- `CreateOrder` 7-param signature consistent between orders.go (Task 5) and handler.go call site (Task 6) ✅
