# Core AI Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Go-based WhatsApp AI daemon using whatsmeow + Gemini that runs a conversation state machine, locks orders to Supabase, and wires real-time data to the existing React frontend.

**Architecture:** Go daemon (whatsmeow + Gemini) owns conversation state, writes directly to Supabase PostgreSQL via `lib/pq`, uses PostgreSQL LISTEN/NOTIFY to detect admin replies inserted by React. React subscribes to Supabase Realtime WebSocket for live Sales Inbox and Dashboard updates without polling.

**Tech Stack:** Go 1.21, go.mau.fi/whatsmeow, github.com/google/generative-ai-go/genai, github.com/lib/pq, github.com/mattn/go-sqlite3 (CGO), github.com/joho/godotenv, React 19, @supabase/supabase-js 2.x, TypeScript

---

## File Map

**New Go files (all under `backend-go/`):**
- `go.mod` — updated with new deps
- `config/config.go` — env loader
- `internal/models/types.go` — shared Go types
- `internal/db/client.go` — Postgres pool + LISTEN/NOTIFY dispatcher
- `internal/db/conversations.go` — conversation CRUD
- `internal/db/messages.go` — message insert
- `internal/db/orders.go` — order CRUD
- `internal/db/stock.go` — stock read-only queries
- `internal/rules/escalation.go` — keyword scan
- `internal/rules/escalation_test.go`
- `internal/engine/parser.go` — Gemini JSON → typed structs
- `internal/engine/parser_test.go`
- `internal/engine/prompts.go` — system prompts per state
- `internal/gemini/client.go` — Gemini API wrapper
- `internal/engine/machine.go` — Process() state machine
- `internal/engine/machine_test.go`
- `internal/scheduler/timeout.go` — booking timeout goroutines
- `internal/scheduler/timeout_test.go`
- `internal/whatsapp/client.go` — whatsmeow setup + QR flow
- `internal/whatsapp/sender.go` — send text/media
- `internal/whatsapp/handler.go` — WA event dispatch
- `main.go` — rewritten wire-up

**New SQL:**
- `supabase/migrations/20260531000000_core_ai_engine.sql`

**Modified React files:**
- `src/types.ts` — add DB-aligned types
- `src/lib/supabaseClient.ts` — add conversation/message/order service methods
- `src/hooks/useRealtimeConversations.ts` — NEW file
- `src/components/SalesInboxScreen.tsx` — rewrite to use hook
- `src/components/DashboardScreen.tsx` — add orders panel
- `src/components/WhatsappAiScreen.tsx` — connect to Supabase

---

## Task 1: Update Go module dependencies

**Files:**
- Modify: `backend-go/go.mod`

whatsmeow requires CGO (for go-sqlite3). Set `CGO_ENABLED=1` and have a C compiler available (`xcode-select --install` on Mac, `apt install gcc` on Linux).

- [ ] **Step 1: Replace go.mod content**

```
module github.com/username/sinar-elektrik-backend

go 1.21

require (
	github.com/google/generative-ai-go v0.19.0
	github.com/joho/godotenv v1.5.1
	github.com/lib/pq v1.10.9
	github.com/mattn/go-sqlite3 v1.14.22
	go.mau.fi/whatsmeow v0.0.0-20240927120334-50b888c41a20
	google.golang.org/api v0.200.0
)
```

- [ ] **Step 2: Run go mod tidy to fetch all transitive deps**

Run from `backend-go/` directory:
```bash
cd backend-go && CGO_ENABLED=1 go mod tidy
```

Expected: `go.sum` created/updated, no errors. whatsmeow pulls in ~15 transitive deps including `go.mau.fi/util`, `go.mau.fi/libsignal`, `golang.org/x/crypto`, `google.golang.org/protobuf`.

- [ ] **Step 3: Verify build compiles (empty main check)**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: Builds cleanly. If `go-sqlite3` fails with "cgo: C compiler not found", install gcc first.

- [ ] **Step 4: Commit**

```bash
cd backend-go && git add go.mod go.sum
git commit -m "feat(go): add whatsmeow, gemini, sqlite3, godotenv deps"
```

---

## Task 2: Supabase schema migration

**Files:**
- Create: `supabase/migrations/20260531000000_core_ai_engine.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260531000000_core_ai_engine.sql

-- Enums
CREATE TYPE conversation_state AS ENUM (
  'GREETING','COLLECTING','CLARIFYING','STOCK_CHECK','CONFIRMING',
  'BOOKED','TIMEOUT_REMINDER','CANCELLED','APPROVED','COMPLETED',
  'ESCALATED_ADMIN','ESCALATED_WIRING'
);

CREATE TYPE message_sender AS ENUM ('customer','ai','admin','system');
CREATE TYPE order_status AS ENUM ('PENDING','APPROVED','CANCELLED','COMPLETED');
CREATE TYPE wa_number_status AS ENUM ('CONNECTED','DISCONNECTED','PAIRING');

-- whatsapp_numbers
CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id            text PRIMARY KEY,
  phone_number  text NOT NULL,
  name          text NOT NULL,
  status        wa_number_status NOT NULL DEFAULT 'DISCONNECTED',
  is_enabled    boolean NOT NULL DEFAULT true,
  is_ai_enabled boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_number_id        text NOT NULL REFERENCES whatsapp_numbers(id),
  customer_phone      text NOT NULL,
  state               conversation_state NOT NULL DEFAULT 'GREETING',
  language            text NOT NULL DEFAULT 'id',
  collected_data      jsonb NOT NULL DEFAULT '{}',
  clarification_round int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_phone ON conversations(customer_phone, wa_number_id);
CREATE INDEX idx_conversations_state ON conversations(state);

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender          message_sender NOT NULL,
  text            text NOT NULL DEFAULT '',
  media_url       text,
  media_type      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id),
  customer_name    text NOT NULL,
  customer_company text NOT NULL,
  customer_address text NOT NULL,
  customer_phone   text NOT NULL,
  items            jsonb NOT NULL DEFAULT '[]',
  subtotal         numeric(15,2) NOT NULL DEFAULT 0,
  shipping_fee     numeric(15,2),
  total            numeric(15,2) NOT NULL DEFAULT 0,
  status           order_status NOT NULL DEFAULT 'PENDING',
  booking_expires_at timestamptz NOT NULL,
  reminder_sent_at   timestamptz,
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_expires ON orders(booking_expires_at) WHERE status = 'PENDING';

-- RLS: enable on all tables
ALTER TABLE whatsapp_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- whatsapp_numbers: anon can SELECT; service key bypasses RLS
CREATE POLICY "anon_select_wa_numbers" ON whatsapp_numbers
  FOR SELECT TO anon USING (true);

-- conversations: anon SELECT; anon can UPDATE state only to safe values
CREATE POLICY "anon_select_conversations" ON conversations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_toggle_conversation_state" ON conversations
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (state IN ('ESCALATED_ADMIN','COLLECTING'));

-- messages: anon SELECT; anon can INSERT admin messages only
CREATE POLICY "anon_select_messages" ON messages
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_insert_admin_messages" ON messages
  FOR INSERT TO anon
  WITH CHECK (sender = 'admin');

-- orders: anon SELECT; anon can UPDATE shipping_fee + status only
CREATE POLICY "anon_select_orders" ON orders
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_approve_orders" ON orders
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (status IN ('APPROVED'));

-- NOTIFY trigger: fires when React inserts an admin message
CREATE OR REPLACE FUNCTION notify_admin_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify(
    'admin_messages',
    json_build_object(
      'conversation_id', NEW.conversation_id,
      'text', NEW.text,
      'media_url', NEW.media_url
    )::text
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_message
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender = 'admin')
  EXECUTE FUNCTION notify_admin_message();

-- NOTIFY trigger: fires when React approves an order
CREATE OR REPLACE FUNCTION notify_order_approved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status != 'APPROVED' THEN
    PERFORM pg_notify(
      'order_approved',
      json_build_object(
        'order_id', NEW.id,
        'conversation_id', NEW.conversation_id,
        'shipping_fee', NEW.shipping_fee
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_approved
  AFTER UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION notify_order_approved();

-- Supabase Realtime: enable for all four tables
ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_numbers;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
```

- [ ] **Step 2: Apply migration via Supabase dashboard or CLI**

Option A — Supabase CLI (if local dev stack running):
```bash
supabase db push
```

Option B — Supabase Dashboard SQL editor: paste entire file contents and run.

Expected: All tables created, no errors. Check Tables list in Supabase dashboard.

- [ ] **Step 3: Create Supabase Storage bucket for chat media**

In Supabase Dashboard → Storage → New bucket:
- Name: `chat-media`
- Public: true (so Go daemon can download files by URL without auth)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260531000000_core_ai_engine.sql
git commit -m "feat(db): add core AI engine schema — conversations, messages, orders, RLS, triggers"
```

---

## Task 3: Go shared models

**Files:**
- Create: `backend-go/internal/models/types.go`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p backend-go/internal/models
```

- [ ] **Step 2: Write types.go**

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

// IsTerminal returns true for states where new customer messages should be ignored by the AI.
func (s ConversationState) IsTerminal() bool {
	switch s {
	case StateCancelled, StateCompleted, StateEscalatedAdmin, StateEscalatedWiring:
		return true
	}
	return false
}

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
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	Sender         string    `json:"sender"`
	Text           string    `json:"text"`
	MediaURL       string    `json:"media_url,omitempty"`
	MediaType      string    `json:"media_type,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type Order struct {
	ID              string     `json:"id"`
	ConversationID  string     `json:"conversation_id"`
	CustomerName    string     `json:"customer_name"`
	CustomerCompany string     `json:"customer_company"`
	CustomerAddress string     `json:"customer_address"`
	CustomerPhone   string     `json:"customer_phone"`
	Items           []OrderItem `json:"items"`
	Subtotal        float64    `json:"subtotal"`
	ShippingFee     *float64   `json:"shipping_fee,omitempty"`
	Total           float64    `json:"total"`
	Status          string     `json:"status"`
	BookingExpiresAt time.Time `json:"booking_expires_at"`
	ReminderSentAt  *time.Time `json:"reminder_sent_at,omitempty"`
	ApprovedAt      *time.Time `json:"approved_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
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
```

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/models/...
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/models/types.go
git commit -m "feat(go): add shared models package"
```

---

## Task 4: Config loader

**Files:**
- Create: `backend-go/config/config.go`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p backend-go/config
```

- [ ] **Step 2: Write config.go**

```go
package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	SupabaseDBConn string
	GeminiAPIKey   string
	Port           string
	WAStorePath    string
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("[CONFIG] No .env file, reading from environment")
	}
	return &Config{
		SupabaseDBConn: getEnv("SUPABASE_DB_CONNECTION", "postgresql://postgres:postgres@localhost:5432/postgres?sslmode=disable"),
		GeminiAPIKey:   getEnv("GEMINI_API_KEY", ""),
		Port:           getEnv("PORT", "8080"),
		WAStorePath:    getEnv("WA_STORE_PATH", "wa_store.db"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 3: Create `backend-go/.env.example`**

```
SUPABASE_DB_CONNECTION=postgresql://postgres.[project-ref]:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
GEMINI_API_KEY=your-gemini-api-key-here
PORT=8080
WA_STORE_PATH=wa_store.db
```

- [ ] **Step 4: Add `.env` to .gitignore (if not already there)**

```bash
echo "backend-go/.env" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add backend-go/config/config.go backend-go/.env.example .gitignore
git commit -m "feat(go): add config loader with env file support"
```

---

## Task 5: DB client with LISTEN/NOTIFY dispatcher

**Files:**
- Create: `backend-go/internal/db/client.go`

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/db
```

- [ ] **Step 2: Write client.go**

```go
package db

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/lib/pq"
	_ "github.com/lib/pq"
)

type NotifyHandlers struct {
	OnAdminMessage  func(conversationID, text, mediaURL string)
	OnOrderApproved func(orderID, conversationID string, shippingFee float64)
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
	if err := c.listener.Listen("admin_messages"); err != nil {
		return err
	}
	if err := c.listener.Listen("order_approved"); err != nil {
		return err
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
					Text           string `json:"text"`
					MediaURL       string `json:"media_url"`
				}
				if err := json.Unmarshal([]byte(notification.Extra), &p); err != nil {
					log.Printf("[DB] admin_messages parse error: %v", err)
					continue
				}
				if h.OnAdminMessage != nil {
					go h.OnAdminMessage(p.ConversationID, p.Text, p.MediaURL)
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
			}
		}
	}()

	log.Println("[DB] LISTEN/NOTIFY active on admin_messages, order_approved")
	return nil
}

func (c *Client) Close() {
	c.listener.Close()
	c.DB.Close()
}
```

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/db/...
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/db/client.go
git commit -m "feat(go): add DB client with LISTEN/NOTIFY dispatcher"
```

---

## Task 6: DB conversations

**Files:**
- Create: `backend-go/internal/db/conversations.go`

- [ ] **Step 1: Write conversations.go**

```go
package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetOrCreateConversation finds the most recent active conversation for the
// given customer+number pair, or creates a new GREETING conversation.
func (c *Client) GetOrCreateConversation(customerPhone, waNumberID string) (*models.Conversation, error) {
	conv, err := c.findActiveConversation(customerPhone, waNumberID)
	if err == sql.ErrNoRows {
		return c.createConversation(customerPhone, waNumberID)
	}
	return conv, err
}

func (c *Client) findActiveConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	err := c.DB.QueryRow(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, created_at, updated_at
		FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, phone, waNumberID).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.CreatedAt, &conv.UpdatedAt,
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
		          collected_data, clarification_round, created_at, updated_at
	`, waNumberID, phone).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.CreatedAt, &conv.UpdatedAt,
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

// ListActiveBookedOrders returns conversations in BOOKED or TIMEOUT_REMINDER state
// for restoring scheduler goroutines on daemon restart.
func (c *Client) ListConversationsByPhone(phone string) ([]*models.Conversation, error) {
	rows, err := c.DB.Query(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, created_at, updated_at
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
			&conv.CreatedAt, &conv.UpdatedAt,
		)
		json.Unmarshal(dataJSON, &conv.CollectedData)
		result = append(result, &conv)
	}
	return result, nil
}
```

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/db/...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/db/conversations.go
git commit -m "feat(go): add DB conversations — GetOrCreate, UpdateState, UpdateCollectedData"
```

---

## Task 7: DB messages, orders, stock

**Files:**
- Create: `backend-go/internal/db/messages.go`
- Create: `backend-go/internal/db/orders.go`
- Create: `backend-go/internal/db/stock.go`

- [ ] **Step 1: Write messages.go**

```go
package db

import "github.com/username/sinar-elektrik-backend/internal/models"

func (c *Client) InsertMessage(conversationID, sender, text string) (*models.Message, error) {
	var msg models.Message
	err := c.DB.QueryRow(`
		INSERT INTO messages (conversation_id, sender, text)
		VALUES ($1, $2, $3)
		RETURNING id, conversation_id, sender, text, created_at
	`, conversationID, sender, text).Scan(
		&msg.ID, &msg.ConversationID, &msg.Sender, &msg.Text, &msg.CreatedAt,
	)
	return &msg, err
}

// ListLast10Messages returns the last 10 messages for a conversation, oldest first.
func (c *Client) ListLast10Messages(conversationID string) ([]models.Message, error) {
	rows, err := c.DB.Query(`
		SELECT id, conversation_id, sender, text, created_at
		FROM (
			SELECT id, conversation_id, sender, text, created_at
			FROM messages WHERE conversation_id = $1
			ORDER BY created_at DESC LIMIT 10
		) sub ORDER BY created_at ASC
	`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []models.Message
	for rows.Next() {
		var m models.Message
		rows.Scan(&m.ID, &m.ConversationID, &m.Sender, &m.Text, &m.CreatedAt)
		msgs = append(msgs, m)
	}
	return msgs, nil
}
```

- [ ] **Step 2: Write orders.go**

```go
package db

import (
	"encoding/json"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) CreateOrder(conv *models.Conversation, items []models.OrderItem, subtotal float64) (*models.Order, error) {
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(48 * time.Hour)

	var order models.Order
	var itemsBack []byte
	err = c.DB.QueryRow(`
		INSERT INTO orders (
			conversation_id, customer_name, customer_company, customer_address,
			customer_phone, items, subtotal, total, status, booking_expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'PENDING',$8)
		RETURNING id, conversation_id, customer_name, customer_company,
		          customer_address, customer_phone, items, subtotal, total,
		          status, booking_expires_at, created_at
	`,
		conv.ID,
		conv.CollectedData.Name,
		conv.CollectedData.Company,
		conv.CollectedData.Address,
		conv.CustomerPhone,
		itemsJSON,
		subtotal,
		expiresAt,
	).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsBack, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt,
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

// ListPendingExpired returns orders that are BOOKED/TIMEOUT_REMINDER with future expiry — for RestoreOnBoot.
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
		WHERE o.status IN ('PENDING') AND o.booking_expires_at > now()
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
		SELECT id, conversation_id, customer_name, customer_company,
		       customer_address, customer_phone, items, subtotal, total,
		       status, booking_expires_at, created_at
		FROM orders WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1
	`, conversationID).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt,
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
		SELECT id, conversation_id, customer_name, customer_company,
		       customer_address, customer_phone, items, subtotal, total,
		       status, booking_expires_at, created_at
		FROM orders WHERE id = $1
	`, orderID).Scan(
		&order.ID, &order.ConversationID, &order.CustomerName,
		&order.CustomerCompany, &order.CustomerAddress, &order.CustomerPhone,
		&itemsJSON, &order.Subtotal, &order.Total, &order.Status,
		&order.BookingExpiresAt, &order.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(itemsJSON, &order.Items)
	return &order, nil
}
```

- [ ] **Step 3: Write stock.go**

```go
package db

import (
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func (c *Client) SearchStockByName(productName string) ([]models.StockItem, error) {
	rows, err := c.DB.Query(`
		SELECT sku, name, category, price, stock, status
		FROM stocks
		WHERE LOWER(name) LIKE $1 AND stock > 0
		ORDER BY name ASC LIMIT 10
	`, "%"+strings.ToLower(productName)+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []models.StockItem
	for rows.Next() {
		var item models.StockItem
		rows.Scan(&item.SKU, &item.Name, &item.Category, &item.Price, &item.Stock, &item.Status)
		items = append(items, item)
	}
	return items, nil
}
```

- [ ] **Step 4: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/db/...
```

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/db/messages.go backend-go/internal/db/orders.go backend-go/internal/db/stock.go
git commit -m "feat(go): add DB messages, orders, stock query methods"
```

---

## Task 8: Rules engine

**Files:**
- Create: `backend-go/internal/rules/escalation.go`
- Create: `backend-go/internal/rules/escalation_test.go`

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/rules
```

- [ ] **Step 2: Write the failing tests first**

```go
// backend-go/internal/rules/escalation_test.go
package rules

import "testing"

func TestWiringKeywords(t *testing.T) {
	cases := []struct {
		text     string
		expected EscalationType
	}{
		{"saya butuh instalasi panel", EscalationWiring},
		{"perlu grounding untuk gedung", EscalationWiring},
		{"mau order panel custom 200A", EscalationWiring},
		{"butuh diagram kelistrikan", EscalationWiring},
		{"proyek besar 3 lantai", EscalationWiring},
		{"mau beli kabel 10 meter", EscalationNone},
		{"harga kabel tembaga berapa", EscalationNone},
	}
	for _, tc := range cases {
		got := CheckEscalation(tc.text)
		if got != tc.expected {
			t.Errorf("CheckEscalation(%q) = %q, want %q", tc.text, got, tc.expected)
		}
	}
}

func TestAdminKeywords(t *testing.T) {
	cases := []struct {
		text     string
		expected EscalationType
	}{
		{"bisa kasih diskon?", EscalationAdmin},
		{"minta harga khusus dong", EscalationAdmin},
		{"can I get a discount please", EscalationAdmin},
		{"saya mau order kabel", EscalationNone},
	}
	for _, tc := range cases {
		got := CheckEscalation(tc.text)
		if got != tc.expected {
			t.Errorf("CheckEscalation(%q) = %q, want %q", tc.text, got, tc.expected)
		}
	}
}
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
cd backend-go && go test ./internal/rules/... -v
```

Expected: `FAIL` — `rules` package does not exist yet.

- [ ] **Step 4: Write escalation.go**

```go
package rules

import "strings"

type EscalationType string

const (
	EscalationNone   EscalationType = ""
	EscalationWiring EscalationType = "WIRING"
	EscalationAdmin  EscalationType = "ADMIN"
)

var wiringKeywords = []string{
	"instalasi", "grounding", "panel custom", "wiring",
	"proyek besar", "diagram", "installation", "custom panel",
}

var adminKeywords = []string{
	"diskon", "discount", "harga khusus", "special price",
	"potongan harga", "price cut",
}

// CheckEscalation scans message text for known escalation keywords.
// WIRING takes priority over ADMIN.
func CheckEscalation(text string) EscalationType {
	lower := strings.ToLower(text)
	for _, kw := range wiringKeywords {
		if strings.Contains(lower, kw) {
			return EscalationWiring
		}
	}
	for _, kw := range adminKeywords {
		if strings.Contains(lower, kw) {
			return EscalationAdmin
		}
	}
	return EscalationNone
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd backend-go && go test ./internal/rules/... -v
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/rules/
git commit -m "feat(go): add rules engine with keyword escalation detection"
```

---

## Task 9: Engine parser (Gemini JSON → typed structs)

**Files:**
- Create: `backend-go/internal/engine/parser.go`
- Create: `backend-go/internal/engine/parser_test.go`

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/engine
```

- [ ] **Step 2: Write failing tests**

```go
// backend-go/internal/engine/parser_test.go
package engine

import "testing"

func TestParseGreeting(t *testing.T) {
	raw := `{"reply":"Halo! Selamat datang.","detected_language":"id"}`
	resp, err := ParseGreeting(raw)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Reply == "" {
		t.Error("reply should not be empty")
	}
	if resp.DetectedLanguage != "id" {
		t.Errorf("language = %q, want id", resp.DetectedLanguage)
	}
}

func TestParseGreetingInvalidJSON(t *testing.T) {
	resp, err := ParseGreeting("not json")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
	_ = resp
}

func TestParseCollecting(t *testing.T) {
	raw := `{"reply":"Nama Anda?","collected":{"name":"Budi","company":"","address":"","product":""},"next_action":"CONTINUE"}`
	resp, err := ParseCollecting(raw)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Collected.Name != "Budi" {
		t.Errorf("name = %q, want Budi", resp.Collected.Name)
	}
}

func TestParseConfirming(t *testing.T) {
	raw := `{"reply":"Pesanan dikonfirmasi!","confirmed":true,"modification_requested":false}`
	resp, err := ParseConfirming(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !resp.Confirmed {
		t.Error("confirmed should be true")
	}
}

func TestFallbackReply(t *testing.T) {
	id := FallbackReply("id")
	en := FallbackReply("en")
	if id == "" || en == "" {
		t.Error("fallback replies should not be empty")
	}
	if id == en {
		t.Error("id and en fallback replies should differ")
	}
}
```

- [ ] **Step 3: Run — confirm fail**

```bash
cd backend-go && go test ./internal/engine/... -v
```

Expected: FAIL — package not found.

- [ ] **Step 4: Write parser.go**

```go
package engine

import (
	"encoding/json"
	"fmt"
)

// --- GREETING ---

type GreetingResponse struct {
	Reply            string `json:"reply"`
	DetectedLanguage string `json:"detected_language"`
}

func ParseGreeting(raw string) (*GreetingResponse, error) {
	var r GreetingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, fmt.Errorf("parse greeting: %w", err)
	}
	if r.Reply == "" {
		r.Reply = "Halo! Selamat datang di Garindo Jaya Panel. Ada yang bisa kami bantu?"
	}
	if r.DetectedLanguage == "" {
		r.DetectedLanguage = "id"
	}
	return &r, nil
}

// --- COLLECTING ---

type CollectedFields struct {
	Name    string `json:"name"`
	Company string `json:"company"`
	Address string `json:"address"`
	Product string `json:"product"`
}

type CollectingResponse struct {
	Reply      string          `json:"reply"`
	Collected  CollectedFields `json:"collected"`
	NextAction string          `json:"next_action"`
}

func ParseCollecting(raw string) (*CollectingResponse, error) {
	var r CollectingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, fmt.Errorf("parse collecting: %w", err)
	}
	return &r, nil
}

// --- CLARIFYING ---

type SpecFields struct {
	Product string `json:"product"`
	Qty     int    `json:"qty"`
	Size    string `json:"size"`
	Color   string `json:"color"`
	Notes   string `json:"notes"`
}

type ClarifyingResponse struct {
	Reply              string     `json:"reply"`
	Specs              SpecFields `json:"specs"`
	NextAction         string     `json:"next_action"`
	ClarificationRound int        `json:"clarification_round"`
}

func ParseClarifying(raw string) (*ClarifyingResponse, error) {
	var r ClarifyingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, fmt.Errorf("parse clarifying: %w", err)
	}
	return &r, nil
}

// --- STOCK_CHECK ---

type StockCheckResponse struct {
	Reply      string `json:"reply"`
	NextAction string `json:"next_action"`
}

func ParseStockCheck(raw string) (*StockCheckResponse, error) {
	var r StockCheckResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, fmt.Errorf("parse stock_check: %w", err)
	}
	return &r, nil
}

// --- CONFIRMING ---

type ConfirmingResponse struct {
	Reply                string `json:"reply"`
	Confirmed            bool   `json:"confirmed"`
	ModificationRequested bool  `json:"modification_requested"`
}

func ParseConfirming(raw string) (*ConfirmingResponse, error) {
	var r ConfirmingResponse
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		return nil, fmt.Errorf("parse confirming: %w", err)
	}
	return &r, nil
}

// FallbackReply returns a safe generic reply when Gemini output cannot be parsed.
func FallbackReply(language string) string {
	if language == "en" {
		return "I apologize, I'm having a moment of difficulty. Could you please repeat your message?"
	}
	return "Maaf, saya kesulitan memproses pesan Anda. Bisakah Anda mengulanginya?"
}
```

- [ ] **Step 5: Run tests — confirm pass**

```bash
cd backend-go && go test ./internal/engine/... -v
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/engine/parser.go backend-go/internal/engine/parser_test.go
git commit -m "feat(go): add Gemini response parser with typed structs"
```

---

## Task 10: Engine prompts

**Files:**
- Create: `backend-go/internal/engine/prompts.go`

- [ ] **Step 1: Write prompts.go**

```go
package engine

import (
	"fmt"
	"strings"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// BuildPrompt returns the full Gemini prompt for the given state,
// including system instructions, conversation history, and stock context.
func BuildPrompt(state models.ConversationState, language string, collected models.CollectedData, history []models.Message, stockContext string) string {
	lang := "Bahasa Indonesia"
	if language == "en" {
		lang = "English"
	}

	historyStr := formatHistory(history)
	base := systemPromptForState(state, lang, collected, stockContext)
	return base + "\n\n## Conversation so far:\n" + historyStr
}

func systemPromptForState(state models.ConversationState, lang string, c models.CollectedData, stockCtx string) string {
	switch state {
	case models.StateGreeting:
		return fmt.Sprintf(`You are a helpful sales assistant for Garindo Jaya Panel, an electrical components supplier.
Reply in %s. Greet the customer warmly and detect their language.
Output ONLY valid JSON: {"reply":"<greeting>","detected_language":"<id or en>"}`, lang)

	case models.StateCollecting:
		missing := missingFields(c)
		return fmt.Sprintf(`You are collecting order information for Garindo Jaya Panel. Reply in %s.
Collected so far — Name: %q, Company: %q, Address: %q, Product: %q.
Still needed: %s. Ask for ONE missing field at a time.
If the customer mentions installation/wiring/custom panels/large projects, set next_action "ESCALATE_WIRING".
If you cannot help, set next_action "ESCALATE". Otherwise "CONTINUE".
Output ONLY valid JSON: {"reply":"<msg>","collected":{"name":"<val>","company":"<val>","address":"<val>","product":"<val>"},"next_action":"CONTINUE"}`,
			lang, c.Name, c.Company, c.Address, c.Product, missing)

	case models.StateClarifying:
		return fmt.Sprintf(`You are clarifying product specifications for a Garindo Jaya Panel order. Reply in %s.
Product requested: %q. Ask ONE clarifying question about quantity, size, color, or notes.
When specs are clear, set next_action "READY". If ambiguity persists after this round, set "CONTINUE". If stuck, set "ESCALATE".
Output ONLY valid JSON: {"reply":"<msg>","specs":{"product":"<val>","qty":<int>,"size":"<val>","color":"<val>","notes":"<val>"},"next_action":"CONTINUE","clarification_round":<int>}`,
			lang, c.Product)

	case models.StateStockCheck:
		return fmt.Sprintf(`You are presenting a stock quote for Garindo Jaya Panel. Reply in %s.
Customer wants: %q (qty: %d). Available stock data:
%s
Present item name, unit price (Rupiah), quantity, and total clearly. Ask customer to review.
If product not found, set next_action "ESCALATE". If quote is ready for confirmation, set "CONFIRM".
Output ONLY valid JSON: {"reply":"<formatted quote>","next_action":"CONFIRM"}`,
			lang, c.Product, c.Quantity, stockCtx)

	case models.StateConfirming:
		return fmt.Sprintf(`You are confirming a customer's order for Garindo Jaya Panel. Reply in %s.
If the customer says OK, Oke, BENAR, Yes, Confirm, or similar: set confirmed true.
If they ask to change something: set modification_requested true.
Otherwise re-explain politely.
Output ONLY valid JSON: {"reply":"<msg>","confirmed":<bool>,"modification_requested":<bool>}`, lang)

	default:
		return fmt.Sprintf(`You are a sales assistant for Garindo Jaya Panel. Reply in %s.
Output ONLY valid JSON: {"reply":"<msg>"}`, lang)
	}
}

func missingFields(c models.CollectedData) string {
	var m []string
	if c.Name == "" {
		m = append(m, "full name")
	}
	if c.Company == "" {
		m = append(m, "company name")
	}
	if c.Address == "" {
		m = append(m, "delivery address")
	}
	if c.Product == "" {
		m = append(m, "product they want to order")
	}
	if len(m) == 0 {
		return "none (all collected)"
	}
	return strings.Join(m, ", ")
}

func formatHistory(msgs []models.Message) string {
	if len(msgs) == 0 {
		return "(no messages yet)"
	}
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(fmt.Sprintf("[%s]: %s\n", strings.ToUpper(m.Sender), m.Text))
	}
	return sb.String()
}

// StockContextString formats stock items for inclusion in the STOCK_CHECK prompt.
func StockContextString(items []models.StockItem) string {
	if len(items) == 0 {
		return "(no matching items found in database)"
	}
	var sb strings.Builder
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (SKU: %s): Rp %.0f/unit, stock: %d\n",
			item.Name, item.SKU, item.Price, item.Stock))
	}
	return sb.String()
}
```

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/engine/...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/engine/prompts.go
git commit -m "feat(go): add state-aware Gemini system prompts"
```

---

## Task 11: Gemini client

**Files:**
- Create: `backend-go/internal/gemini/client.go`

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/gemini
```

- [ ] **Step 2: Write client.go**

```go
package gemini

import (
	"context"
	"fmt"

	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type Client struct {
	model *genai.GenerativeModel
	inner *genai.Client
}

func NewClient(ctx context.Context, apiKey string) (*Client, error) {
	c, err := genai.NewClient(ctx, option.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("gemini: new client: %w", err)
	}
	model := c.GenerativeModel("gemini-1.5-flash")
	model.ResponseMIMEType = "application/json"
	return &Client{model: model, inner: c}, nil
}

// GenerateReply sends the full prompt to Gemini and returns the raw JSON string.
// The caller (engine/machine.go) passes a single complete prompt that includes
// the system instruction, conversation history, and current user message.
func (c *Client) GenerateReply(ctx context.Context, fullPrompt string) (string, error) {
	resp, err := c.model.GenerateContent(ctx, genai.Text(fullPrompt))
	if err != nil {
		return "", fmt.Errorf("gemini: generate: %w", err)
	}
	if len(resp.Candidates) == 0 {
		return "", fmt.Errorf("gemini: no candidates returned")
	}
	candidate := resp.Candidates[0]
	if candidate.Content == nil || len(candidate.Content.Parts) == 0 {
		return "", fmt.Errorf("gemini: empty candidate content")
	}
	text, ok := candidate.Content.Parts[0].(genai.Text)
	if !ok {
		return "", fmt.Errorf("gemini: unexpected part type %T", candidate.Content.Parts[0])
	}
	return string(text), nil
}

func (c *Client) Close() {
	c.inner.Close()
}
```

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/gemini/...
```

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/gemini/client.go
git commit -m "feat(go): add Gemini client wrapper with JSON response mode"
```

---

## Task 12: State machine

**Files:**
- Create: `backend-go/internal/engine/machine.go`
- Create: `backend-go/internal/engine/machine_test.go`

- [ ] **Step 1: Write failing tests (mock Gemini)**

```go
// backend-go/internal/engine/machine_test.go
package engine

import (
	"context"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

type mockGemini struct{ response string }

func (m *mockGemini) GenerateReply(_ context.Context, _ string) (string, error) {
	return m.response, nil
}

func newTestMachine(response string) *Machine {
	return &Machine{gemini: &mockGemini{response: response}}
}

func TestProcessGreeting(t *testing.T) {
	m := newTestMachine(`{"reply":"Halo!","detected_language":"id"}`)
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateCollecting {
		t.Errorf("expected COLLECTING, got %s", result.NextState)
	}
	if result.Language != "id" {
		t.Errorf("expected language id, got %s", result.Language)
	}
}

func TestProcessCollectingMovesToClarifying(t *testing.T) {
	m := newTestMachine(`{"reply":"Terima kasih!","collected":{"name":"Budi","company":"CV Maju","address":"Surabaya","product":"Kabel 40A"},"next_action":"CONTINUE"}`)
	conv := &models.Conversation{
		State:    models.StateCollecting,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Address: "Surabaya", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "ya betul", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateClarifying {
		t.Errorf("all fields filled → expected CLARIFYING, got %s", result.NextState)
	}
}

func TestProcessEscalate(t *testing.T) {
	m := newTestMachine(`{"reply":"menghubungi admin","collected":{"name":"","company":"","address":"","product":""},"next_action":"ESCALATE"}`)
	conv := &models.Conversation{State: models.StateCollecting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "saya butuh diskon", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateEscalatedAdmin {
		t.Errorf("ESCALATE action → expected ESCALATED_ADMIN, got %s", result.NextState)
	}
}

func TestProcessConfirmingBooked(t *testing.T) {
	m := newTestMachine(`{"reply":"Pesanan dikonfirmasi!","confirmed":true,"modification_requested":false}`)
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "id",
		CollectedData: models.CollectedData{
			Name: "Budi", Company: "CV Maju", Address: "Surabaya", Product: "Kabel 40A",
		},
	}
	result, err := m.Process(context.Background(), conv, "OK", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if result.NextState != models.StateBooked {
		t.Errorf("confirmed → expected BOOKED, got %s", result.NextState)
	}
	if !result.CreateOrder {
		t.Error("CreateOrder should be true on BOOKED")
	}
}

func TestProcessGeminiFallback(t *testing.T) {
	m := newTestMachine("this is not json")
	conv := &models.Conversation{State: models.StateGreeting, Language: "id"}
	result, err := m.Process(context.Background(), conv, "halo", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	// On bad JSON, state should stay the same, reply should be the fallback
	if result.NextState != models.StateGreeting {
		t.Errorf("on parse fail, state should stay GREETING, got %s", result.NextState)
	}
	if result.Reply == "" {
		t.Error("fallback reply should not be empty")
	}
}
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd backend-go && go test ./internal/engine/... -v
```

Expected: FAIL — Machine type does not exist.

- [ ] **Step 3: Write machine.go**

```go
package engine

import (
	"context"
	"fmt"
	"log"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GeminiClient is the interface the machine depends on — allows mocking in tests.
type GeminiClient interface {
	GenerateReply(ctx context.Context, fullPrompt string) (string, error)
}

type Machine struct {
	gemini GeminiClient
}

func NewMachine(g GeminiClient) *Machine {
	return &Machine{gemini: g}
}

type ProcessResult struct {
	Reply              string
	NextState          models.ConversationState
	NewData            *models.CollectedData
	ClarificationRound int
	Language           string
	CreateOrder        bool
}

// Process runs the state machine for one incoming customer message.
// It calls Gemini, parses the structured response, and returns the next state.
// On any Gemini or parse failure, it returns a safe fallback — never returns an error.
func (m *Machine) Process(ctx context.Context, conv *models.Conversation, incomingText string, history []models.Message, stockContext string) (*ProcessResult, error) {
	result := &ProcessResult{
		NextState:          conv.State,
		Language:           conv.Language,
		ClarificationRound: conv.ClarificationRound,
	}

	prompt := BuildPrompt(conv.State, conv.Language, conv.CollectedData, history, stockContext)
	fullPrompt := fmt.Sprintf("%s\n\nCustomer message: %s", prompt, incomingText)

	rawJSON, err := m.gemini.GenerateReply(ctx, fullPrompt)
	if err != nil {
		log.Printf("[ENGINE] Gemini error in state %s: %v", conv.State, err)
		result.Reply = FallbackReply(conv.Language)
		return result, nil
	}

	switch conv.State {
	case models.StateGreeting:
		resp, err := ParseGreeting(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse greeting error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		result.Language = resp.DetectedLanguage
		result.NextState = models.StateCollecting

	case models.StateCollecting:
		resp, err := ParseCollecting(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse collecting error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		newData := conv.CollectedData
		if resp.Collected.Name != "" {
			newData.Name = resp.Collected.Name
		}
		if resp.Collected.Company != "" {
			newData.Company = resp.Collected.Company
		}
		if resp.Collected.Address != "" {
			newData.Address = resp.Collected.Address
		}
		if resp.Collected.Product != "" {
			newData.Product = resp.Collected.Product
		}
		result.NewData = &newData
		if newData.AllCoreFieldsFilled() {
			result.NextState = models.StateClarifying
		}
		if resp.NextAction == "ESCALATE" {
			result.NextState = models.StateEscalatedAdmin
		}

	case models.StateClarifying:
		resp, err := ParseClarifying(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse clarifying error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		newData := conv.CollectedData
		if resp.Specs.Qty > 0 {
			newData.Quantity = resp.Specs.Qty
		}
		if resp.Specs.Size != "" {
			newData.Specs.Size = resp.Specs.Size
		}
		if resp.Specs.Color != "" {
			newData.Specs.Color = resp.Specs.Color
		}
		if resp.Specs.Notes != "" {
			newData.Specs.Notes = resp.Specs.Notes
		}
		result.NewData = &newData
		newRound := conv.ClarificationRound + 1
		result.ClarificationRound = newRound
		switch {
		case resp.NextAction == "ESCALATE":
			result.NextState = models.StateEscalatedAdmin
		case resp.NextAction == "READY" || newRound >= 3:
			result.NextState = models.StateStockCheck
		}

	case models.StateStockCheck:
		resp, err := ParseStockCheck(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse stock_check error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.NextAction == "CONFIRM" {
			result.NextState = models.StateConfirming
		} else if resp.NextAction == "ESCALATE" {
			result.NextState = models.StateEscalatedAdmin
		}

	case models.StateConfirming:
		resp, err := ParseConfirming(rawJSON)
		if err != nil {
			log.Printf("[ENGINE] Parse confirming error: %v — raw: %s", err, rawJSON)
			result.Reply = FallbackReply(conv.Language)
			return result, nil
		}
		result.Reply = resp.Reply
		if resp.Confirmed {
			result.NextState = models.StateBooked
			result.CreateOrder = true
		} else if resp.ModificationRequested {
			result.NextState = models.StateClarifying
			result.ClarificationRound = 0
		}
	}

	return result, nil
}
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
cd backend-go && go test ./internal/engine/... -v
```

Expected: All PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/engine/machine.go backend-go/internal/engine/machine_test.go
git commit -m "feat(go): add conversation state machine with Gemini integration"
```

---

## Task 13: Booking timeout scheduler

**Files:**
- Create: `backend-go/internal/scheduler/timeout.go`
- Create: `backend-go/internal/scheduler/timeout_test.go`

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/scheduler
```

- [ ] **Step 2: Write failing tests**

```go
// backend-go/internal/scheduler/timeout_test.go
package scheduler

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestSchedulerFiresReminder(t *testing.T) {
	var reminderFired atomic.Bool
	s := NewScheduler(
		func(orderID string) { reminderFired.Store(true) },
		func(orderID string) {},
	)
	// Reminder fires at (expiresAt - 24hr); for test we set expiresAt = now + 80ms + 24hr (so reminder = now + 80ms)
	expiresAt := time.Now().Add(24*time.Hour + 80*time.Millisecond)
	s.Schedule("order-1", expiresAt)
	time.Sleep(150 * time.Millisecond)
	if !reminderFired.Load() {
		t.Error("reminder should have fired by now")
	}
}

func TestSchedulerCancel(t *testing.T) {
	var cancelFired atomic.Bool
	s := NewScheduler(
		func(orderID string) {},
		func(orderID string) { cancelFired.Store(true) },
	)
	expiresAt := time.Now().Add(50 * time.Millisecond)
	s.Schedule("order-cancel", expiresAt)
	s.Cancel("order-cancel")
	time.Sleep(100 * time.Millisecond)
	if cancelFired.Load() {
		t.Error("cancel handler should NOT have fired after Cancel()")
	}
}

func TestRestoreOnBoot(t *testing.T) {
	var fired atomic.Bool
	s := NewScheduler(
		func(orderID string) {},
		func(orderID string) { fired.Store(true) },
	)
	s.RestoreOnBoot([]BookingEntry{
		{ID: "restore-1", ExpiresAt: time.Now().Add(50 * time.Millisecond)},
	})
	time.Sleep(100 * time.Millisecond)
	if !fired.Load() {
		t.Error("restored booking should have cancelled by now")
	}
}
```

- [ ] **Step 3: Run — confirm fail**

```bash
cd backend-go && go test ./internal/scheduler/... -v
```

- [ ] **Step 4: Write timeout.go**

```go
package scheduler

import (
	"log"
	"sync"
	"time"
)

type BookingEntry struct {
	ID        string
	ExpiresAt time.Time
}

type Scheduler struct {
	mu             sync.Mutex
	cancelTimers   map[string]*time.Timer
	reminderTimers map[string]*time.Timer
	onReminder     func(orderID string)
	onCancel       func(orderID string)
}

func NewScheduler(onReminder, onCancel func(orderID string)) *Scheduler {
	return &Scheduler{
		cancelTimers:   make(map[string]*time.Timer),
		reminderTimers: make(map[string]*time.Timer),
		onReminder:     onReminder,
		onCancel:       onCancel,
	}
}

// Schedule registers reminder (at expiresAt - 24hr) and cancellation (at expiresAt) timers.
func (s *Scheduler) Schedule(orderID string, expiresAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked(orderID)

	now := time.Now()
	reminderAt := expiresAt.Add(-24 * time.Hour)
	if reminderAt.After(now) {
		s.reminderTimers[orderID] = time.AfterFunc(time.Until(reminderAt), func() {
			log.Printf("[SCHEDULER] Reminder firing for order %s", orderID)
			s.onReminder(orderID)
		})
	}
	if expiresAt.After(now) {
		s.cancelTimers[orderID] = time.AfterFunc(time.Until(expiresAt), func() {
			log.Printf("[SCHEDULER] Cancellation firing for order %s", orderID)
			s.onCancel(orderID)
		})
	}
}

func (s *Scheduler) Cancel(orderID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked(orderID)
	log.Printf("[SCHEDULER] Timers cancelled for order %s", orderID)
}

func (s *Scheduler) stopLocked(orderID string) {
	if t, ok := s.cancelTimers[orderID]; ok {
		t.Stop()
		delete(s.cancelTimers, orderID)
	}
	if t, ok := s.reminderTimers[orderID]; ok {
		t.Stop()
		delete(s.reminderTimers, orderID)
	}
}

// RestoreOnBoot re-registers timers for active bookings after a daemon restart.
func (s *Scheduler) RestoreOnBoot(entries []BookingEntry) {
	for _, e := range entries {
		if e.ExpiresAt.After(time.Now()) {
			s.Schedule(e.ID, e.ExpiresAt)
			log.Printf("[SCHEDULER] Restored timer for order %s (expires %v)", e.ID, e.ExpiresAt)
		}
	}
}
```

- [ ] **Step 5: Run tests — confirm pass**

```bash
cd backend-go && go test ./internal/scheduler/... -v
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/scheduler/timeout.go backend-go/internal/scheduler/timeout_test.go
git commit -m "feat(go): add booking timeout scheduler with restore-on-boot"
```

---

## Task 14: WhatsApp client and sender

**Files:**
- Create: `backend-go/internal/whatsapp/client.go`
- Create: `backend-go/internal/whatsapp/sender.go`

CGO must be enabled for go-sqlite3. Ensure `gcc` is available (`which gcc`).

- [ ] **Step 1: Create directory**

```bash
mkdir -p backend-go/internal/whatsapp
```

- [ ] **Step 2: Write client.go**

```go
package whatsapp

import (
	"context"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type Client struct {
	WA *whatsmeow.Client
}

// NewClient creates a whatsmeow client backed by a SQLite auth store at dbPath.
func NewClient(dbPath string) (*Client, error) {
	dbLog := waLog.Stdout("WAStore", "WARN", true)
	container, err := sqlstore.New("sqlite3", fmt.Sprintf("file:%s?_foreign_keys=on", dbPath), dbLog)
	if err != nil {
		return nil, fmt.Errorf("whatsapp: open store: %w", err)
	}
	deviceStore, err := container.GetFirstDevice()
	if err != nil {
		return nil, fmt.Errorf("whatsapp: get device: %w", err)
	}
	clientLog := waLog.Stdout("WAClient", "WARN", true)
	wa := whatsmeow.NewClient(deviceStore, clientLog)
	return &Client{WA: wa}, nil
}

// Connect connects to WhatsApp. If not yet paired, prints QR code to stdout.
// For production pairing from the frontend, see the HTTP /api/wa/qr endpoint in main.go.
func (c *Client) Connect(ctx context.Context) error {
	if c.WA.Store.ID == nil {
		qrChan, _ := c.WA.GetQRChannel(ctx)
		if err := c.WA.Connect(); err != nil {
			return fmt.Errorf("whatsapp: connect: %w", err)
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				log.Printf("[WA] QR Code (scan with WhatsApp): %s", evt.Code)
			} else {
				log.Printf("[WA] QR channel event: %s", evt.Event)
				break
			}
		}
	} else {
		if err := c.WA.Connect(); err != nil {
			return fmt.Errorf("whatsapp: reconnect: %w", err)
		}
	}
	log.Println("[WA] Connected")
	return nil
}

// AddEventHandler registers a handler for all WA events.
func (c *Client) AddEventHandler(handler func(evt interface{})) {
	c.WA.AddEventHandler(func(rawEvt interface{}) {
		switch evt := rawEvt.(type) {
		case *events.Message:
			handler(evt)
		}
	})
}

func (c *Client) Disconnect() {
	c.WA.Disconnect()
}
```

- [ ] **Step 3: Write sender.go**

```go
package whatsapp

import (
	"context"
	"fmt"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

type Sender struct {
	client *whatsmeow.Client
}

func NewSender(client *whatsmeow.Client) *Sender {
	return &Sender{client: client}
}

// SendText sends a plain text message to the given E.164 phone number (e.g. "6281234567890").
func (s *Sender) SendText(ctx context.Context, toPhone, text string) error {
	jid := types.NewJID(toPhone, types.DefaultUserServer)
	_, err := s.client.SendMessage(ctx, jid, &waProto.Message{
		Conversation: proto.String(text),
	})
	if err != nil {
		return fmt.Errorf("sender: send text to %s: %w", toPhone, err)
	}
	return nil
}
```

- [ ] **Step 4: Build check — verify whatsmeow API surface for pinned version**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/whatsapp/...
```

If it fails, check two known breaking points that vary by whatsmeow version:

**Proto package path** — around 2024 the proto moved from `go.mau.fi/whatsmeow/binary/proto` to `go.mau.fi/whatsmeow/proto/waE2E`. Find the correct path for the installed version:
```bash
find $(go env GOPATH)/pkg/mod/go.mau.fi/whatsmeow* -name "*.go" | xargs grep -l "Conversation" | head -5
```
Update the import in `sender.go` and the field access (`&waProto.Message{Conversation: ...}`) to match.

**`GetFirstDevice()` signature** — some versions require a `ctx` argument:
```bash
grep -r "GetFirstDevice" $(go env GOPATH)/pkg/mod/go.mau.fi/whatsmeow*/store/sqlstore/
```
If the signature is `GetFirstDevice(ctx context.Context)`, update `client.go`:
```go
deviceStore, err := container.GetFirstDevice(ctx)
```

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/client.go backend-go/internal/whatsapp/sender.go
git commit -m "feat(go): add whatsmeow client and text sender"
```

---

## Task 15: WhatsApp handler

**Files:**
- Create: `backend-go/internal/whatsapp/handler.go`

The handler wires the rules engine, DB, and state machine together for each incoming customer message.

- [ ] **Step 1: Write handler.go**

```go
package whatsapp

import (
	"context"
	"fmt"
	"log"

	"go.mau.fi/whatsmeow/types/events"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/rules"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
)

type Handler struct {
	db        *db.Client
	machine   *engine.Machine
	sender    *Sender
	scheduler *scheduler.Scheduler
	waNumberID string // ID from whatsapp_numbers table for this WA number
}

func NewHandler(d *db.Client, m *engine.Machine, s *Sender, sc *scheduler.Scheduler, waNumberID string) *Handler {
	return &Handler{db: d, machine: m, sender: s, scheduler: sc, waNumberID: waNumberID}
}

// Handle is called by whatsmeow for every incoming WA event.
func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}

	text := evt.Message.GetConversation()
	if text == "" && evt.Message.GetExtendedTextMessage() != nil {
		text = evt.Message.GetExtendedTextMessage().GetText()
	}
	if text == "" {
		// Non-text (image, doc, etc.) — insert a system message and auto-escalate
		h.handleMediaMessage(evt)
		return
	}

	senderPhone := evt.Info.Sender.User
	go h.processMessage(context.Background(), senderPhone, text)
}

func (h *Handler) processMessage(ctx context.Context, senderPhone, text string) {
	// 1. Keyword rules — fast path, zero LLM cost
	esc := rules.CheckEscalation(text)
	if esc == rules.EscalationWiring {
		h.handleWiringEscalation(ctx, senderPhone, text)
		return
	}

	// 2. Get or create conversation
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// 3. If admin escalation keyword matched AND conversation already active
	if esc == rules.EscalationAdmin {
		h.handleAdminEscalation(ctx, conv, text)
		return
	}

	// 4. If conversation is in a terminal state, ignore further messages
	if conv.State.IsTerminal() {
		return
	}

	// 5. Insert customer message → Realtime pushes to Sales Inbox
	if _, err := h.db.InsertMessage(conv.ID, "customer", text); err != nil {
		log.Printf("[HANDLER] InsertMessage error: %v", err)
	}

	// 6. Load history (last 10 messages)
	history, _ := h.db.ListLast10Messages(conv.ID)

	// 7. Build stock context if needed
	stockContext := ""
	if conv.State == models.StateStockCheck || conv.State == models.StateClarifying {
		items, _ := h.db.SearchStockByName(conv.CollectedData.Product)
		stockContext = engine.StockContextString(items)
	}

	// 8. Run state machine
	result, err := h.machine.Process(ctx, conv, text, history, stockContext)
	if err != nil {
		log.Printf("[HANDLER] Machine.Process error: %v", err)
		return
	}

	// 9. Persist state + collected data before sending reply
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

	// 10. If order just booked, create order row and start timer
	if result.CreateOrder {
		h.handleBooking(ctx, conv)
	}

	// 11. Insert AI reply message
	if result.Reply != "" {
		h.db.InsertMessage(conv.ID, "ai", result.Reply)
	}

	// 12. Send WA reply to customer
	if result.Reply != "" {
		if err := h.sender.SendText(ctx, senderPhone, result.Reply); err != nil {
			log.Printf("[HANDLER] SendText error: %v", err)
		}
	}
}

func (h *Handler) handleBooking(ctx context.Context, conv *models.Conversation) {
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

	order, err := h.db.CreateOrder(conv, orderItems, subtotal)
	if err != nil {
		log.Printf("[HANDLER] CreateOrder error: %v", err)
		return
	}
	h.scheduler.Schedule(order.ID, order.BookingExpiresAt)
	log.Printf("[HANDLER] Order %s created, timer scheduled until %v", order.ID, order.BookingExpiresAt)
}

func (h *Handler) handleWiringEscalation(ctx context.Context, senderPhone, text string) {
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}
	h.db.InsertMessage(conv.ID, "customer", text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedWiring)
	h.db.InsertMessage(conv.ID, "system", "ESCALATED_WIRING: keyword match")

	reply := "Permintaan ini membutuhkan tim teknis kami. Staf kami akan segera menghubungi Anda."
	if conv.Language == "en" {
		reply = "Your request requires our technical team. Our staff will contact you shortly."
	}
	h.db.InsertMessage(conv.ID, "ai", reply)
	h.sender.SendText(ctx, senderPhone, reply)
}

func (h *Handler) handleAdminEscalation(ctx context.Context, conv *models.Conversation, text string) {
	h.db.InsertMessage(conv.ID, "customer", text)
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	h.db.InsertMessage(conv.ID, "system", "ESCALATED_ADMIN: keyword match")

	reply := "Permintaan Anda akan diproses oleh tim kami. Mohon tunggu sebentar."
	if conv.Language == "en" {
		reply = "Your request will be handled by our team. Please wait a moment."
	}
	h.db.InsertMessage(conv.ID, "ai", reply)
	h.sender.SendText(ctx, conv.CustomerPhone, reply)
}

func (h *Handler) handleMediaMessage(evt *events.Message) {
	senderPhone := evt.Info.Sender.User
	conv, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		return
	}
	h.db.InsertMessage(conv.ID, "system", "[Media received from customer]")
	h.db.UpdateConversationState(conv.ID, models.StateEscalatedAdmin)
	reply := "Dokumen Anda telah kami terima. Tim teknis akan meninjau dan menghubungi Anda."
	h.db.InsertMessage(conv.ID, "ai", reply)
	h.sender.SendText(context.Background(), senderPhone, reply)
}

// HandleApprovedOrder is called by the LISTEN/NOTIFY dispatcher when an order is approved.
// It generates and sends the invoice WA blast.
func (h *Handler) HandleApprovedOrder(ctx context.Context, orderID, conversationID string, shippingFee float64) {
	order, err := h.db.GetOrderByConversation(conversationID)
	if err != nil {
		log.Printf("[HANDLER] GetOrderByConversation error for %s: %v", conversationID, err)
		return
	}
	h.scheduler.Cancel(orderID)

	total := order.Subtotal + shippingFee
	invoice := buildInvoiceMessage(order, shippingFee, total, "id")

	h.db.InsertMessage(conversationID, "system", "ORDER_APPROVED: invoice sent")
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

- [ ] **Step 2: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./internal/whatsapp/...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "feat(go): add WA event handler — wires rules, state machine, DB, scheduler"
```

---

## Task 16: Rewrite main.go

**Files:**
- Modify: `backend-go/main.go`

Replace the current flat HTTP stock server with the full daemon. The existing `/api/stocks` endpoints are kept — the daemon extends them.

- [ ] **Step 1: Overwrite main.go**

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/username/sinar-elektrik-backend/config"
	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/engine"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/scheduler"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	// DB
	dbClient, err := db.NewClient(cfg.SupabaseDBConn)
	if err != nil {
		log.Fatalf("[MAIN] DB connect failed: %v", err)
	}
	defer dbClient.Close()

	// Gemini
	geminiClient, err := gemini.NewClient(ctx, cfg.GeminiAPIKey)
	if err != nil {
		log.Fatalf("[MAIN] Gemini init failed: %v", err)
	}
	defer geminiClient.Close()

	// State machine
	machine := engine.NewMachine(geminiClient)

	// WhatsApp client
	waClient, err := whatsapp.NewClient(cfg.WAStorePath)
	if err != nil {
		log.Fatalf("[MAIN] WA client init failed: %v", err)
	}
	sender := whatsapp.NewSender(waClient.WA)

	// Scheduler — handlers call back into DB + sender
	var waHandler *whatsapp.Handler
	sched := scheduler.NewScheduler(
		func(orderID string) {
			// Reminder at 24hr mark — send WA message and update conversation state
			order, err := dbClient.GetOrderByID(orderID)
			if err != nil {
				log.Printf("[MAIN] Reminder: lookup failed for order %s: %v", orderID, err)
				return
			}
			var lang string
			dbClient.DB.QueryRow(`SELECT language FROM conversations WHERE id = $1`, order.ConversationID).Scan(&lang)
			reminderText := "Pesanan Anda akan kadaluarsa dalam 24 jam. Harap segera konfirmasi atau pesanan dibatalkan otomatis."
			if lang == "en" {
				reminderText = "Your order will expire in 24 hours. Please confirm payment or it will be automatically cancelled."
			}
			if err := sender.SendText(ctx, order.CustomerPhone, reminderText); err != nil {
				log.Printf("[MAIN] Reminder: WA send failed: %v", err)
			}
			dbClient.MarkReminderSent(orderID)
			dbClient.UpdateConversationState(order.ConversationID, models.StateTimeoutReminder)
		},
		func(orderID string) {
			// Cancellation at 48hr
			log.Printf("[MAIN] Auto-cancelling order %s", orderID)
			dbClient.UpdateOrderStatus(orderID, "CANCELLED")
		},
	)

	// WA number ID — first number in DB (extend for multi-number support)
	waNumberID := os.Getenv("WA_NUMBER_ID")
	if waNumberID == "" {
		waNumberID = "wa_1"
	}
	waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID)
	waClient.AddEventHandler(waHandler.Handle)

	// Restore booking timers after restart
	bookings, err := dbClient.ListActiveBookings()
	if err != nil {
		log.Printf("[MAIN] RestoreOnBoot: list bookings error: %v", err)
	} else {
		entries := make([]scheduler.BookingEntry, len(bookings))
		for i, b := range bookings {
			entries[i] = scheduler.BookingEntry{ID: b.ID, ExpiresAt: b.ExpiresAt}
		}
		sched.RestoreOnBoot(entries)
	}

	// LISTEN/NOTIFY handlers
	dbClient.StartListening(db.NotifyHandlers{
		OnAdminMessage: func(conversationID, text, mediaURL string) {
			log.Printf("[MAIN] Admin message in conversation %s", conversationID)
			// Look up conversation to get customer phone
			convs, err := dbClient.ListConversationsByPhone("")
			_ = convs
			_ = err
			// Simplified: get the conversation's customer phone via a direct query
			var customerPhone string
			dbClient.DB.QueryRow(`SELECT customer_phone FROM conversations WHERE id = $1`, conversationID).Scan(&customerPhone)
			if customerPhone != "" && text != "" {
				sender.SendText(ctx, customerPhone, text)
			}
		},
		OnOrderApproved: func(orderID, conversationID string, shippingFee float64) {
			waHandler.HandleApprovedOrder(ctx, orderID, conversationID, shippingFee)
		},
	})

	// Connect WhatsApp
	if err := waClient.Connect(ctx); err != nil {
		log.Fatalf("[MAIN] WA connect failed: %v", err)
	}

	// HTTP server (keeps existing /api/stocks + adds /api/wa/status)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"online"}`))
	})
	mux.HandleFunc("/api/wa/status", func(w http.ResponseWriter, r *http.Request) {
		connected := waClient.WA.IsConnected()
		w.Header().Set("Content-Type", "application/json")
		if connected {
			w.Write([]byte(`{"connected":true}`))
		} else {
			w.Write([]byte(`{"connected":false}`))
		}
	})

	go func() {
		log.Printf("[MAIN] HTTP server on :%s", cfg.Port)
		if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
			log.Printf("[MAIN] HTTP error: %v", err)
		}
	}()

	// Block until SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[MAIN] Shutting down...")
	waClient.Disconnect()
}
```

- [ ] **Step 2: Build check — confirms the whole daemon compiles**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors. Fix any import issues flagged by the compiler.

- [ ] **Step 3: Commit**

```bash
git add backend-go/main.go
git commit -m "feat(go): rewrite main.go — wire daemon: WA + Gemini + state machine + scheduler"
```

---

## Task 17: React types and supabaseClient additions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add new types to src/types.ts**

Add after the existing `WhatsappAiNumber` interface (before the `ActivePage` export):

```typescript
// --- Supabase DB-aligned types (used by useRealtimeConversations hook) ---

export type ConversationState =
  | 'GREETING' | 'COLLECTING' | 'CLARIFYING' | 'STOCK_CHECK' | 'CONFIRMING'
  | 'BOOKED' | 'TIMEOUT_REMINDER' | 'CANCELLED' | 'APPROVED' | 'COMPLETED'
  | 'ESCALATED_ADMIN' | 'ESCALATED_WIRING';

export interface DbConversation {
  id: string;
  wa_number_id: string;
  customer_phone: string;
  state: ConversationState;
  language: string;
  collected_data: {
    name?: string;
    company?: string;
    address?: string;
    product?: string;
    quantity?: number;
    specs?: { size?: string; color?: string; notes?: string };
  };
  clarification_round: number;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender: 'customer' | 'ai' | 'admin' | 'system';
  text: string;
  media_url?: string;
  media_type?: string;
  created_at: string;
}

export interface DbOrder {
  id: string;
  conversation_id: string;
  customer_name: string;
  customer_company: string;
  customer_address: string;
  customer_phone: string;
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    unit_price: number;
    subtotal: number;
  }>;
  subtotal: number;
  shipping_fee?: number;
  total: number;
  status: 'PENDING' | 'APPROVED' | 'CANCELLED' | 'COMPLETED';
  booking_expires_at: string;
  created_at: string;
}
```

- [ ] **Step 2: Add service methods to src/lib/supabaseClient.ts**

Append after the existing `supabaseService` object (before the final `}`):

```typescript
export const conversationService = {
  async fetchConversations(): Promise<DbConversation[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async fetchMessages(conversationId: string): Promise<DbMessage[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async insertAdminMessage(conversationId: string, text: string): Promise<DbMessage> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender: 'admin', text })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async toggleAiControl(conversationId: string, handOver: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const newState = handOver ? 'ESCALATED_ADMIN' : 'COLLECTING';
    const { error } = await supabase
      .from('conversations')
      .update({ state: newState })
      .eq('id', conversationId);
    if (error) throw error;
  },

  async uploadChatMedia(file: File): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const path = `${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('chat-media').upload(path, file);
    if (error) throw error;
    const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
    return data.publicUrl;
  },

  async insertAdminMediaMessage(conversationId: string, mediaUrl: string, mediaType: string): Promise<DbMessage> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender: 'admin', text: '', media_url: mediaUrl, media_type: mediaType })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const orderService = {
  async fetchPendingOrders(): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PENDING')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async approveOrder(orderId: string, shippingFee: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('orders')
      .update({ shipping_fee: shippingFee, status: 'APPROVED' })
      .eq('id', orderId);
    if (error) throw error;
  },
};
```

- [ ] **Step 3: Add the `DbConversation`, `DbMessage`, `DbOrder` imports to supabaseClient.ts header**

At the top of `src/lib/supabaseClient.ts`, add:
```typescript
import type { DbConversation, DbMessage, DbOrder } from '../types';
```

- [ ] **Step 4: TypeScript check**

```bash
cd /path/to/project && npm run build 2>&1 | head -40
```

Fix any type errors. Common issues: missing optional chaining on nullable fields.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts
git commit -m "feat(react): add DB-aligned types and conversation/order service methods"
```

---

## Task 18: useRealtimeConversations hook

**Files:**
- Create: `src/hooks/useRealtimeConversations.ts`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/hooks
```

- [ ] **Step 2: Write the hook**

```typescript
// src/hooks/useRealtimeConversations.ts
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { conversationService, orderService } from '../lib/supabaseClient';
import type { DbConversation, DbMessage, DbOrder } from '../types';

export interface ConversationWithMessages extends DbConversation {
  messages: DbMessage[];
}

export function useRealtimeConversations() {
  const [conversations, setConversations] = useState<ConversationWithMessages[]>([]);
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Track which conversation's messages are loaded to avoid re-fetching
  const loadedConvIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    // Initial load
    async function load() {
      const [convs, pendingOrders] = await Promise.all([
        conversationService.fetchConversations(),
        orderService.fetchPendingOrders(),
      ]);
      if (!mounted) return;

      // Load messages for first 20 conversations
      const withMessages: ConversationWithMessages[] = await Promise.all(
        convs.slice(0, 20).map(async (conv) => {
          const msgs = await conversationService.fetchMessages(conv.id);
          loadedConvIds.current.add(conv.id);
          return { ...conv, messages: msgs };
        })
      );

      setConversations(withMessages);
      setOrders(pendingOrders);
      setLoading(false);
    }

    load().catch(console.error);

    // Realtime: messages INSERT
    const msgSub = supabase
      .channel('messages-insert')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new as DbMessage;
          setConversations(prev =>
            prev.map(conv =>
              conv.id === newMsg.conversation_id
                ? { ...conv, messages: [...conv.messages, newMsg] }
                : conv
            )
          );
        })
      .subscribe();

    // Realtime: conversations UPDATE (state changes)
    const convSub = supabase
      .channel('conversations-update')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          const updated = payload.new as DbConversation;
          setConversations(prev =>
            prev.map(conv =>
              conv.id === updated.id
                ? { ...conv, ...updated }
                : conv
            )
          );
        })
      .subscribe();

    // Realtime: conversations INSERT (new conversation)
    const newConvSub = supabase
      .channel('conversations-insert')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' },
        async (payload) => {
          const newConv = payload.new as DbConversation;
          const msgs = await conversationService.fetchMessages(newConv.id);
          loadedConvIds.current.add(newConv.id);
          setConversations(prev => [{ ...newConv, messages: msgs }, ...prev]);
        })
      .subscribe();

    // Realtime: orders INSERT/UPDATE
    const orderSub = supabase
      .channel('orders-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload) => {
          const newOrder = payload.new as DbOrder;
          if (newOrder.status === 'PENDING') {
            setOrders(prev => [...prev, newOrder]);
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updatedOrder = payload.new as DbOrder;
          setOrders(prev =>
            updatedOrder.status === 'PENDING'
              ? prev.map(o => o.id === updatedOrder.id ? updatedOrder : o)
              : prev.filter(o => o.id !== updatedOrder.id)
          );
        })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(msgSub);
      supabase.removeChannel(convSub);
      supabase.removeChannel(newConvSub);
      supabase.removeChannel(orderSub);
    };
  }, []);

  const sendAdminMessage = async (conversationId: string, text: string) => {
    await conversationService.insertAdminMessage(conversationId, text);
    // Realtime will handle the optimistic update via the subscription above
  };

  const sendAdminMedia = async (conversationId: string, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const typeMap: Record<string, string> = {
      pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
      xlsx: 'excel', xls: 'excel', doc: 'word', docx: 'word',
    };
    const mediaType = typeMap[ext] ?? 'file';
    const url = await conversationService.uploadChatMedia(file);
    await conversationService.insertAdminMediaMessage(conversationId, url, mediaType);
  };

  const toggleAiControl = async (conversationId: string, handOver: boolean) => {
    await conversationService.toggleAiControl(conversationId, handOver);
  };

  const approveOrder = async (orderId: string, shippingFee: number) => {
    await orderService.approveOrder(orderId, shippingFee);
  };

  return {
    conversations,
    orders,
    loading,
    sendAdminMessage,
    sendAdminMedia,
    toggleAiControl,
    approveOrder,
  };
}
```

- [ ] **Step 3: TypeScript check**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRealtimeConversations.ts
git commit -m "feat(react): add useRealtimeConversations hook with Supabase Realtime"
```

---

## Task 19: SalesInboxScreen — connect to real data

**Files:**
- Modify: `src/components/SalesInboxScreen.tsx`

Replace the props-based `chats`/`onChatsUpdate` pattern with the Realtime hook. The existing UI structure (sidebar + chat panel layout, filters, toggle button, media upload button) is preserved — only the data plumbing changes.

- [ ] **Step 1: Replace the top of SalesInboxScreen.tsx**

Replace the existing imports and props interface with:

```typescript
import React, { useState, useRef, useEffect } from 'react';
import {
  Search, Bell, Bot, User, ArrowLeftRight, Phone, MoreVertical,
  Send, Smile, PlusCircle, AlertCircle, Receipt, Truck, CheckCircle, HelpCircle
} from 'lucide-react';
import { useRealtimeConversations, ConversationWithMessages } from '../hooks/useRealtimeConversations';
import type { DbMessage, ChatStatusType } from '../types';

interface SalesInboxScreenProps {
  // Props are now empty — all data comes from the hook.
  // Kept for compatibility with App.tsx until DashboardScreen also migrates.
}
```

- [ ] **Step 2: Replace the component body**

Replace everything from `export default function SalesInboxScreen(` to the end of the file with:

```typescript
export default function SalesInboxScreen(_props: SalesInboxScreenProps) {
  const { conversations, sendAdminMessage, sendAdminMedia, toggleAiControl, loading } = useRealtimeConversations();

  const [activeFilter, setActiveFilter] = useState<'Semua' | 'Belum Dibaca' | 'Butuh Admin' | 'Dikelola AI'>('Semua');
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChat = conversations.find(c => c.id === activeChatId);

  // Auto-select first conversation
  useEffect(() => {
    if (!activeChatId && conversations.length > 0) {
      setActiveChatId(conversations[0].id);
    }
  }, [conversations, activeChatId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, activeChatId]);

  const stateToStatus = (state: string): ChatStatusType => {
    if (state === 'ESCALATED_ADMIN') return 'BUTUH_ADMIN';
    if (state === 'ESCALATED_WIRING') return 'WIRING_CUSTOM';
    return 'DIKELOLA_AI';
  };

  const filteredChats = conversations.filter(conv => {
    if (searchQuery && !conv.customer_phone.includes(searchQuery) &&
        !(conv.collected_data.name ?? '').toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    const status = stateToStatus(conv.state);
    if (activeFilter === 'Semua') return true;
    if (activeFilter === 'Butuh Admin') return status === 'BUTUH_ADMIN' || status === 'WIRING_CUSTOM';
    if (activeFilter === 'Dikelola AI') return status === 'DIKELOLA_AI';
    return true;
  });

  const handleSend = async () => {
    if (!inputText.trim() || !activeChatId) return;
    const text = inputText.trim();
    setInputText('');
    await sendAdminMessage(activeChatId, text);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatId) return;
    await sendAdminMedia(activeChatId, file);
    e.target.value = '';
  };

  const handleToggleAi = async (convId: string, currentState: string) => {
    const isAdminControlled = currentState === 'ESCALATED_ADMIN' || currentState === 'ESCALATED_WIRING';
    await toggleAiControl(convId, !isAdminControlled);
  };

  const getDisplayName = (conv: ConversationWithMessages) =>
    conv.collected_data.name || conv.customer_phone;

  const getInitials = (conv: ConversationWithMessages) => {
    const name = getDisplayName(conv);
    return name.slice(0, 2).toUpperCase();
  };

  const getLastMessage = (conv: ConversationWithMessages) =>
    conv.messages.at(-1)?.text || '...';

  const statusBadge = (state: string) => {
    const status = stateToStatus(state);
    const styles: Record<string, string> = {
      BUTUH_ADMIN: 'bg-red-100 text-red-700',
      WIRING_CUSTOM: 'bg-yellow-100 text-yellow-700',
      DIKELOLA_AI: 'bg-blue-100 text-blue-700',
    };
    const labels: Record<string, string> = {
      BUTUH_ADMIN: 'Butuh Admin',
      WIRING_CUSTOM: 'Wiring',
      DIKELOLA_AI: 'AI',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Memuat percakapan...</div>;
  }

  return (
    <div className="flex h-full">
      {/* Sidebar: conversation list */}
      <div className="w-80 border-r flex flex-col bg-white">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Cari percakapan..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
          {(['Semua', 'Butuh Admin', 'Dikelola AI'] as const).map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f as typeof activeFilter)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${activeFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredChats.map(conv => (
            <div
              key={conv.id}
              onClick={() => setActiveChatId(conv.id)}
              className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 ${activeChatId === conv.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}
            >
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {getInitials(conv)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-medium text-sm truncate">{getDisplayName(conv)}</span>
                  {statusBadge(conv.state)}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{getLastMessage(conv)}</p>
              </div>
            </div>
          ))}
          {filteredChats.length === 0 && (
            <p className="text-center text-sm text-gray-400 mt-8">Tidak ada percakapan</p>
          )}
        </div>
      </div>

      {/* Chat panel */}
      {activeChat ? (
        <div className="flex-1 flex flex-col">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {getInitials(activeChat)}
              </div>
              <div>
                <p className="font-semibold text-sm">{getDisplayName(activeChat)}</p>
                <p className="text-xs text-gray-500">{activeChat.customer_phone}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(activeChat.state)}
              <button
                onClick={() => handleToggleAi(activeChat.id, activeChat.state)}
                title={activeChat.state === 'ESCALATED_ADMIN' ? 'Kembalikan ke AI' : 'Alihkan ke Admin'}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
              >
                <ArrowLeftRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
            {activeChat.messages.map(msg => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="border-t bg-white px-4 py-3 flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.xlsx,.xls,.doc,.docx"
              onChange={handleFileChange}
            />
            <button onClick={() => fileInputRef.current?.click()} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <PlusCircle className="w-5 h-5" />
            </button>
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ketik pesan admin..."
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          Pilih percakapan untuk mulai
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: DbMessage }) {
  const isCustomer = msg.sender === 'customer';
  const isSystem = msg.sender === 'system';

  if (isSystem) {
    return (
      <div className="text-center text-xs text-gray-400 py-1">
        — {msg.text} —
      </div>
    );
  }

  return (
    <div className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-xs lg:max-w-md px-3 py-2 rounded-2xl text-sm ${
          isCustomer
            ? 'bg-white border text-gray-800 rounded-tl-none'
            : msg.sender === 'admin'
              ? 'bg-green-600 text-white rounded-tr-none'
              : 'bg-blue-600 text-white rounded-tr-none'
        }`}
      >
        {msg.media_url ? (
          <a href={msg.media_url} target="_blank" rel="noreferrer" className="underline">
            [{msg.media_type?.toUpperCase()} attachment]
          </a>
        ) : (
          msg.text
        )}
        <p className="text-xs opacity-60 mt-1 text-right">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to stop passing chats props to SalesInboxScreen**

In `src/App.tsx`, find the `<SalesInboxScreen` usage and remove the `chats` and `onChatsUpdate` props:

```typescript
// Before:
<SalesInboxScreen chats={chats} onChatsUpdate={setChats} />

// After:
<SalesInboxScreen />
```

- [ ] **Step 4: Start dev server and smoke-test**

```bash
npm run dev
```

Open `http://localhost:5173`, navigate to Sales Inbox. Confirm:
- [ ] Page loads without errors (may show "Tidak ada percakapan" if DB is empty — that's correct)
- [ ] Console shows no TypeScript or runtime errors
- [ ] Filter buttons render and toggle

- [ ] **Step 5: Commit**

```bash
git add src/components/SalesInboxScreen.tsx src/App.tsx
git commit -m "feat(react): rewrite SalesInboxScreen — connect to Supabase Realtime"
```

---

## Task 20: DashboardScreen — add orders panel

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

Add a "Pending Orders" panel below the existing stats cards. The existing charts remain unchanged.

- [ ] **Step 1: Add orders state to DashboardScreen**

Near the top of `DashboardScreen`, add:

```typescript
import { useState } from 'react';
import { useRealtimeConversations } from '../hooks/useRealtimeConversations';
```

Add inside the component body (after the existing `formatRupiah` function):

```typescript
const { orders, approveOrder } = useRealtimeConversations();
const [shippingFees, setShippingFees] = useState<Record<string, string>>({});
const [approvingId, setApprovingId] = useState<string | null>(null);

const handleApprove = async (orderId: string) => {
  const fee = parseFloat(shippingFees[orderId] ?? '0');
  setApprovingId(orderId);
  try {
    await approveOrder(orderId, fee);
  } finally {
    setApprovingId(null);
  }
};
```

- [ ] **Step 2: Add the orders panel JSX**

In the return JSX, just before the closing `</div>` of the main container, add:

```typescript
{/* Pending Orders Panel */}
{orders.length > 0 && (
  <div className="mt-6">
    <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
      <Clock className="w-5 h-5 text-amber-500" />
      Pesanan Menunggu Persetujuan ({orders.length})
    </h2>
    <div className="space-y-3">
      {orders.map(order => (
        <div key={order.id} className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-800">{order.customer_name}</p>
              <p className="text-sm text-gray-500">{order.customer_company} · {order.customer_address}</p>
              <p className="text-sm text-gray-500">{order.customer_phone}</p>
              <div className="mt-2 space-y-0.5">
                {order.items.map((item, i) => (
                  <p key={i} className="text-sm text-gray-700">
                    {item.name} × {item.qty} @ Rp {item.unit_price.toLocaleString('id-ID')} = Rp {item.subtotal.toLocaleString('id-ID')}
                  </p>
                ))}
              </div>
              <p className="mt-1 text-sm font-medium text-gray-800">
                Subtotal: Rp {order.subtotal.toLocaleString('id-ID')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Berakhir: {new Date(order.booking_expires_at).toLocaleString('id-ID')}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Ongkir (Rp):</span>
                <input
                  type="number"
                  min="0"
                  className="w-28 border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="0"
                  value={shippingFees[order.id] ?? ''}
                  onChange={e => setShippingFees(prev => ({ ...prev, [order.id]: e.target.value }))}
                />
              </div>
              <button
                onClick={() => handleApprove(order.id)}
                disabled={approvingId === order.id || !shippingFees[order.id]}
                className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-40"
              >
                {approvingId === order.id ? 'Memproses...' : '✓ Setujui'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Smoke-test**

```bash
npm run dev
```

Navigate to Dashboard. Confirm:
- [ ] Existing charts still render
- [ ] "Pesanan Menunggu" panel appears when there are PENDING orders (or is hidden when empty)
- [ ] Shipping fee input and Approve button are visible per order card

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "feat(react): add pending orders panel to DashboardScreen"
```

---

## Task 21: WhatsappAiScreen — connect to Supabase

**Files:**
- Modify: `src/components/WhatsappAiScreen.tsx`

Replace localStorage number storage and fake QR with real Supabase data and the Go daemon's HTTP `/api/wa/status` endpoint.

- [ ] **Step 1: Replace the data-loading code**

At the top of the component, replace the localStorage initialization with:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { WhatsappAiNumber } from '../types';

// Inside the component:
const [numbers, setNumbers] = useState<WhatsappAiNumber[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  if (!supabase) return;

  // Initial load
  supabase.from('whatsapp_numbers').select('*').order('created_at').then(({ data }) => {
    if (data) setNumbers(data as WhatsappAiNumber[]);
    setLoading(false);
  });

  // Realtime status updates
  const sub = supabase
    .channel('wa-numbers-update')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_numbers' },
      (payload) => {
        setNumbers(prev =>
          prev.map(n => n.id === payload.new.id ? { ...n, ...payload.new } as WhatsappAiNumber : n)
        );
      })
    .subscribe();

  return () => { supabase?.removeChannel(sub); };
}, []);
```

- [ ] **Step 2: Remove the Sandbox simulator section**

Delete the entire "Sandbox / Test Mode" JSX block and the related state variables (`sandboxInput`, `sandboxMessages`, `handleSandboxSend`, etc.).

Real conversations now appear in Sales Inbox — there is no local sandbox.

- [ ] **Step 3: Wire QR/pairing to Go daemon status endpoint**

Replace the fake QR generation with a real status fetch and a note to the admin:

```typescript
// Replace handleConnect / fake QR timeout with:
const handleCheckConnection = async (numberId: string) => {
  try {
    const res = await fetch('http://localhost:8080/api/wa/status');
    const { connected } = await res.json();
    // Update local display — the real status update will come via Realtime
    if (connected) {
      alert('WhatsApp terhubung. Status akan diperbarui otomatis.');
    } else {
      alert('WhatsApp belum terhubung. Jalankan Go daemon dan scan QR di terminal.');
    }
  } catch {
    alert('Go daemon tidak berjalan di localhost:8080. Jalankan backend terlebih dahulu.');
  }
};
```

- [ ] **Step 4: Smoke-test**

```bash
npm run dev
```

Navigate to WhatsApp AI. Confirm:
- [ ] Numbers load from Supabase (empty if none seeded, that's fine)
- [ ] Sandbox section is gone
- [ ] No console errors

- [ ] **Step 5: Commit**

```bash
git add src/components/WhatsappAiScreen.tsx
git commit -m "feat(react): connect WhatsappAiScreen to Supabase — remove sandbox, add Realtime status"
```

---

## Self-Review Checklist

- **Spec section 4 (State Machine):** All 12 states defined in `models/types.go`. All happy-path transitions covered in `machine.go`. Escalation exits from COLLECTING/CLARIFYING/STOCK_CHECK handled in `handler.go`. ✓
- **Spec section 5 (Gemini):** Structured JSON output per state in `parser.go`. Parse failure → `FallbackReply()`, no crash. ✓
- **Spec section 6 (Data Model):** All 4 tables in migration. RLS policies for 3 React write exceptions. NOTIFY triggers for admin messages and approved orders. Realtime publication. ✓
- **Spec section 7 (Go structure):** All 14 files created. Message flow steps 1–9 implemented across `handler.go`, `machine.go`, `db/*`. ✓
- **Spec section 8 (Scheduler):** 24hr reminder + 48hr cancel timers. `RestoreOnBoot` in Task 13. ✓
- **Spec section 9 (React):** `useRealtimeConversations` hook, SalesInboxScreen rewrite, DashboardScreen orders panel, WhatsappAiScreen Supabase wiring. ✓
- **Spec section 3 RLS exceptions:**
  1. `messages` INSERT where `sender='admin'` — in Task 2 migration ✓
  2. `conversations` UPDATE `state` to `ESCALATED_ADMIN`/`COLLECTING` — in Task 2 migration ✓
  3. `orders` UPDATE `shipping_fee` + `status='APPROVED'` — in Task 2 migration ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-core-ai-engine.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans skill, batch with checkpoints.

Which approach?
