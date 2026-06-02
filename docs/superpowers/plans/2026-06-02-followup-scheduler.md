# Follow-up Scheduler (C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automatic WA follow-up messages for conversations where the customer has gone silent — every 4 hours, max 2× per day (WIB), with special payment reminders for BOOKED-state orders.

**Architecture:** A Postgres trigger keeps `conversations.last_ai_message_at` up-to-date on every AI message insert. An in-process Go goroutine polls the DB every minute, finds eligible conversations, sends WA messages, and updates per-day counters atomically. Customer replies reset the counter via a call in `processMessage`.

**Tech Stack:** Go 1.25, PostgreSQL (Supabase), `database/sql`, `github.com/lib/pq`, whatsmeow (WA send via existing `Sender`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260602000002_followup_scheduler.sql` | **Create** | Add 3 columns to `conversations`; trigger to maintain `last_ai_message_at` |
| `backend-go/internal/models/types.go` | **Modify** | Add `LastAIMessageAt`, `FollowupCountToday`, `LastFollowupDate` to `Conversation` |
| `backend-go/internal/db/conversations.go` | **Modify** | Scan 3 new columns in `findActiveConversation` and `createConversation` |
| `backend-go/internal/db/followup.go` | **Create** | `GetEligibleForFollowup`, `IncrementFollowup`, `ResetFollowupCounter` |
| `backend-go/internal/followup/poller.go` | **Create** | Polling goroutine + message builder |
| `backend-go/internal/followup/poller_test.go` | **Create** | Unit tests for `buildFollowupMessage` and `isNewWIBDay` |
| `backend-go/internal/whatsapp/handler.go` | **Modify** | Call `ResetFollowupCounter` in `processMessage` |
| `backend-go/main.go` | **Modify** | Start the poller after `waHandler` is assigned |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `orders.go`, `customers.go`, `leads.go`, `bank_config.go`, `wa_recipients.go`, `payment.go`, `storage/`, `machine_test.go`, any React files.

---

## Task 1: Write and commit the migration file

**Files:**
- Create: `supabase/migrations/20260602000002_followup_scheduler.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260602000002_followup_scheduler.sql

-- 1. Add follow-up tracking columns to conversations.
--    last_ai_message_at  — maintained by trigger below; never written directly by Go.
--    followup_count_today — how many follow-ups sent on last_followup_date (WIB).
--    last_followup_date  — WIB date of last follow-up; NULL means never sent.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_ai_message_at   timestamptz,
  ADD COLUMN IF NOT EXISTS followup_count_today  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_followup_date    date;

-- 2. Trigger function: update last_ai_message_at on every AI message insert.
--    Covers all existing and future InsertMessage(SenderAI) calls automatically.
CREATE OR REPLACE FUNCTION update_last_ai_message_at() RETURNS trigger AS $$
BEGIN
  IF NEW.sender = 'ai' THEN
    UPDATE conversations
    SET last_ai_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_update_last_ai_message_at'
      AND event_object_table = 'messages'
  ) THEN
    CREATE TRIGGER trg_update_last_ai_message_at
      AFTER INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION update_last_ai_message_at();
  END IF;
END $$;
```

- [ ] **Step 2: Apply the migration manually**

Open Supabase dashboard → SQL Editor → paste the entire file → Run.

Verify: In Table Editor → conversations, the three new columns appear. In Database → Triggers, `trg_update_last_ai_message_at` appears on the `messages` table.

Quick smoke test in SQL Editor:
```sql
-- Insert a test AI message and verify the trigger fires.
-- (Use a real conversation_id from your conversations table.)
-- After insert, check: SELECT last_ai_message_at FROM conversations WHERE id = '<conv_id>';
```

- [ ] **Step 3: Commit**

```bash
cd /path/to/ERPAntigravity
git add supabase/migrations/20260602000002_followup_scheduler.sql
git commit -m "feat(sql): add follow-up scheduler migration — columns and last_ai_message_at trigger"
```

---

## Task 2: Update Go models

**Files:**
- Modify: `backend-go/internal/models/types.go`

- [ ] **Step 1: Add three fields to the `Conversation` struct**

In `backend-go/internal/models/types.go`, locate the `Conversation` struct (currently ends with `UpdatedAt time.Time`). Add the three new fields after `UpdatedAt`:

```go
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
	LastAIMessageAt    *time.Time        `json:"last_ai_message_at,omitempty"`
	FollowupCountToday int               `json:"followup_count_today"`
	LastFollowupDate   *time.Time        `json:"last_followup_date,omitempty"`
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
git add backend-go/internal/models/types.go
git commit -m "feat(go): add LastAIMessageAt, FollowupCountToday, LastFollowupDate to Conversation"
```

---

## Task 3: Update db/conversations.go to scan new columns

**Files:**
- Modify: `backend-go/internal/db/conversations.go`

The three new columns must be included in every SELECT that returns a full `Conversation`. Two functions need updating: `findActiveConversation` and `createConversation`. (`ListConversationsByPhone` is used by the dashboard and does not need to be updated for correctness — the poller uses its own query.)

- [ ] **Step 1: Update `findActiveConversation`**

Replace the current function body:

```go
func (c *Client) findActiveConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	var lastAIAt sql.NullTime
	var lastFollowupDate sql.NullTime
	err := c.DB.QueryRow(`
		SELECT id, wa_number_id, customer_phone, state, language,
		       collected_data, clarification_round, ai_active, created_at, updated_at,
		       last_ai_message_at, followup_count_today, last_followup_date
		FROM conversations
		WHERE customer_phone = $1 AND wa_number_id = $2
		  AND state NOT IN ('CANCELLED','COMPLETED')
		ORDER BY created_at DESC LIMIT 1
	`, phone, waNumberID).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
		&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	if lastAIAt.Valid {
		conv.LastAIMessageAt = &lastAIAt.Time
	}
	if lastFollowupDate.Valid {
		conv.LastFollowupDate = &lastFollowupDate.Time
	}
	return &conv, nil
}
```

- [ ] **Step 2: Update `createConversation`**

Replace the current function body:

```go
func (c *Client) createConversation(phone, waNumberID string) (*models.Conversation, error) {
	var conv models.Conversation
	var dataJSON []byte
	var lastAIAt sql.NullTime
	var lastFollowupDate sql.NullTime
	err := c.DB.QueryRow(`
		INSERT INTO conversations (wa_number_id, customer_phone, state, language, collected_data, clarification_round)
		VALUES ($1, $2, 'GREETING', 'id', '{}', 0)
		RETURNING id, wa_number_id, customer_phone, state, language,
		          collected_data, clarification_round, ai_active, created_at, updated_at,
		          last_ai_message_at, followup_count_today, last_followup_date
	`, waNumberID, phone).Scan(
		&conv.ID, &conv.WANumberID, &conv.CustomerPhone, &conv.State,
		&conv.Language, &dataJSON, &conv.ClarificationRound,
		&conv.AIActive, &conv.CreatedAt, &conv.UpdatedAt,
		&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
	)
	if err != nil {
		return nil, err
	}
	json.Unmarshal(dataJSON, &conv.CollectedData)
	if lastAIAt.Valid {
		conv.LastAIMessageAt = &lastAIAt.Time
	}
	if lastFollowupDate.Valid {
		conv.LastFollowupDate = &lastFollowupDate.Time
	}
	return &conv, nil
}
```

- [ ] **Step 3: Build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors. The `sql.NullTime` type is already imported via `"database/sql"`.

- [ ] **Step 4: Run tests**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/db/conversations.go
git commit -m "feat(go): scan last_ai_message_at, followup_count_today, last_followup_date in conversations"
```

---

## Task 4: Create db/followup.go

**Files:**
- Create: `backend-go/internal/db/followup.go`

- [ ] **Step 1: Create the file**

```go
package db

import (
	"encoding/json"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

// GetEligibleForFollowup returns conversations where Calista has sent at least one
// message, the customer has not replied in 4+ hours, and the daily WIB quota
// (max 2 follow-ups) is not exhausted.
func (c *Client) GetEligibleForFollowup() ([]*models.Conversation, error) {
	rows, err := c.DB.Query(`
		SELECT id, customer_phone, language, state, collected_data, clarification_round,
		       ai_active, last_ai_message_at, followup_count_today, last_followup_date
		FROM conversations
		WHERE ai_active = true
		  AND state NOT IN ('CANCELLED', 'COMPLETED', 'ESCALATED_ADMIN', 'ESCALATED_WIRING')
		  AND last_ai_message_at IS NOT NULL
		  AND last_ai_message_at < NOW() - INTERVAL '4 hours'
		  AND (
		    last_followup_date IS NULL
		    OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		    OR followup_count_today < 2
		  )
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*models.Conversation
	for rows.Next() {
		var conv models.Conversation
		var dataJSON []byte
		var lastAIAt, lastFollowupDate interface{}
		if err := rows.Scan(
			&conv.ID, &conv.CustomerPhone, &conv.Language, &conv.State,
			&dataJSON, &conv.ClarificationRound, &conv.AIActive,
			&lastAIAt, &conv.FollowupCountToday, &lastFollowupDate,
		); err != nil {
			return nil, err
		}
		json.Unmarshal(dataJSON, &conv.CollectedData)
		result = append(result, &conv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// IncrementFollowup records a follow-up send. If it is a new WIB day since the
// last follow-up, the count resets to 1 rather than incrementing.
func (c *Client) IncrementFollowup(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET
		  followup_count_today = CASE
		    WHEN last_followup_date IS NULL
		      OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		    THEN 1
		    ELSE followup_count_today + 1
		  END,
		  last_followup_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		WHERE id = $1
	`, convID)
	return err
}

// ResetFollowupCounter clears follow-up tracking when the customer replies.
// Called at the start of processMessage so any customer reply resets the state.
func (c *Client) ResetFollowupCounter(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations
		SET followup_count_today = 0, last_followup_date = NULL
		WHERE id = $1
	`, convID)
	return err
}
```

Note on `GetEligibleForFollowup` scan: `last_ai_message_at` and `last_followup_date` are scanned into `interface{}` because we don't need them in Go — the SQL query already enforces the eligibility conditions. Only the fields used by `buildFollowupMessage` (`ID`, `CustomerPhone`, `Language`, `State`, `CollectedData`, `FollowupCountToday`) are needed; `LastFollowupDate` is handled by `IncrementFollowup` atomically.

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
git add backend-go/internal/db/followup.go
git commit -m "feat(go): add db followup layer — GetEligibleForFollowup, IncrementFollowup, ResetFollowupCounter"
```

---

## Task 5: Create internal/followup/poller.go with tests (TDD)

**Files:**
- Create: `backend-go/internal/followup/poller_test.go`
- Create: `backend-go/internal/followup/poller.go`

- [ ] **Step 1: Write the failing tests first**

Create `backend-go/internal/followup/poller_test.go`:

```go
package followup

import (
	"testing"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/models"
)

func TestBuildFollowupMessage_StandardID(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateCollecting,
		Language: "id",
		CollectedData: models.CollectedData{Name: "Budi"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if msg1 == "" {
		t.Fatal("expected non-empty message for count=1")
	}
	if msg2 == "" {
		t.Fatal("expected non-empty message for count=2")
	}
	if msg1 == msg2 {
		t.Error("count=1 and count=2 messages should differ")
	}
	// Must contain the customer name
	if !containsString(msg1, "Budi") {
		t.Errorf("message 1 should contain customer name, got: %s", msg1)
	}
	if !containsString(msg2, "Budi") {
		t.Errorf("message 2 should contain customer name, got: %s", msg2)
	}
}

func TestBuildFollowupMessage_StandardEN(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateConfirming,
		Language: "en",
		CollectedData: models.CollectedData{Name: "John"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if !containsString(msg1, "John") {
		t.Errorf("EN message 1 should contain name, got: %s", msg1)
	}
	if !containsString(msg2, "John") {
		t.Errorf("EN message 2 should contain name, got: %s", msg2)
	}
	// English messages should not contain Indonesian words
	if containsString(msg1, "Bapak/Ibu") {
		t.Errorf("EN message should not contain 'Bapak/Ibu', got: %s", msg1)
	}
}

func TestBuildFollowupMessage_BookedID(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateBooked,
		Language: "id",
		CollectedData: models.CollectedData{Name: "Sari"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	msg2 := buildFollowupMessage(conv, 2)

	if !containsString(msg1, "Sari") {
		t.Errorf("BOOKED message 1 should contain name, got: %s", msg1)
	}
	if !containsString(msg2, "Sari") {
		t.Errorf("BOOKED message 2 should contain name, got: %s", msg2)
	}
	// BOOKED messages must reference payment
	if !containsString(msg1, "pembayaran") && !containsString(msg1, "dikonfirmasi") {
		t.Errorf("BOOKED message 1 should reference payment/confirmation, got: %s", msg1)
	}
}

func TestBuildFollowupMessage_BookedEN(t *testing.T) {
	conv := &models.Conversation{
		State:    models.StateBooked,
		Language: "en",
		CollectedData: models.CollectedData{Name: "Alice"},
	}
	msg1 := buildFollowupMessage(conv, 1)
	if !containsString(msg1, "Alice") {
		t.Errorf("BOOKED EN message should contain name, got: %s", msg1)
	}
	if !containsString(msg1, "payment") && !containsString(msg1, "confirmed") {
		t.Errorf("BOOKED EN message should reference payment, got: %s", msg1)
	}
}

func TestIsNewWIBDay_NilIsNewDay(t *testing.T) {
	if !isNewWIBDay(nil) {
		t.Error("nil last_followup_date should be treated as new day")
	}
}

func TestIsNewWIBDay_YesterdayIsNewDay(t *testing.T) {
	yesterday := time.Now().UTC().Add(-24 * time.Hour)
	// Normalise to midnight UTC (how pq scans Postgres date)
	d := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, time.UTC)
	if !isNewWIBDay(&d) {
		t.Error("yesterday's date should be treated as new day")
	}
}

func TestIsNewWIBDay_FarFutureIsNotNewDay(t *testing.T) {
	// A date far in the future relative to WIB today — should NOT be a new day.
	// We use a date 100 years in the future to be timezone-safe.
	future := time.Now().UTC().Add(100 * 365 * 24 * time.Hour)
	d := time.Date(future.Year(), future.Month(), future.Day(), 0, 0, 0, 0, time.UTC)
	if isNewWIBDay(&d) {
		t.Error("future date should not be treated as a new day")
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/followup/... -v 2>&1
```

Expected: FAIL — package `followup` does not exist yet.

- [ ] **Step 3: Create `backend-go/internal/followup/poller.go`**

```go
package followup

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/username/sinar-elektrik-backend/internal/db"
	"github.com/username/sinar-elektrik-backend/internal/models"
	"github.com/username/sinar-elektrik-backend/internal/whatsapp"
)

var wibLocation = time.FixedZone("WIB", 7*3600)

// Poller sends automatic follow-up WA messages to conversations where the
// customer has gone silent. Ticks every minute and respects WIB daily quotas.
type Poller struct {
	db     *db.Client
	sender *whatsapp.Sender
}

func NewPoller(d *db.Client, s *whatsapp.Sender) *Poller {
	return &Poller{db: d, sender: s}
}

// Start launches the polling goroutine. Stops when ctx is cancelled.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				p.poll(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (p *Poller) poll(ctx context.Context) {
	convs, err := p.db.GetEligibleForFollowup()
	if err != nil {
		log.Printf("[FOLLOWUP] GetEligibleForFollowup error: %v", err)
		return
	}

	for _, conv := range convs {
		effectiveCount := conv.FollowupCountToday
		if isNewWIBDay(conv.LastFollowupDate) {
			effectiveCount = 0
		}
		if effectiveCount >= 2 {
			// Race condition guard: DB query already filters, but double-check.
			continue
		}

		msg := buildFollowupMessage(conv, effectiveCount+1)
		if err := p.sender.SendText(ctx, conv.CustomerPhone, msg); err != nil {
			log.Printf("[FOLLOWUP] SendText error for conv %s: %v", conv.ID, err)
			// Do NOT update DB on send failure — avoid phantom follow-up count.
			continue
		}
		if _, err := p.db.InsertMessage(conv.ID, models.SenderAI, msg); err != nil {
			log.Printf("[FOLLOWUP] InsertMessage error for conv %s: %v", conv.ID, err)
		}
		if err := p.db.IncrementFollowup(conv.ID); err != nil {
			log.Printf("[FOLLOWUP] IncrementFollowup error for conv %s: %v", conv.ID, err)
		}
	}
}

// isNewWIBDay returns true if t is nil (never sent) or represents a WIB date
// before today. Postgres date columns are scanned as time.Time at midnight UTC,
// representing the WIB calendar date stored by the SQL.
func isNewWIBDay(t *time.Time) bool {
	if t == nil {
		return true
	}
	now := time.Now().In(wibLocation)
	todayUTC := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return t.Before(todayUTC)
}

func buildFollowupMessage(conv *models.Conversation, count int) string {
	name := conv.CollectedData.Name
	lang := conv.Language

	if conv.State == models.StateBooked {
		return bookedMessage(name, lang, count)
	}
	return standardMessage(name, lang, count)
}

func standardMessage(name, lang string, count int) string {
	if lang == "en" {
		if count == 1 {
			return fmt.Sprintf("Hello %s, we wanted to check if you still need our assistance? 😊\n\nFeel free to reply anytime you're ready, we're here to help! 🙏", name)
		}
		return fmt.Sprintf("Hello %s, we're reaching out again 🙏\n\nIf you have any questions about our products, don't hesitate to reply.\n\nThank you for contacting Garindo Jaya Panel! ⚡", name)
	}
	if count == 1 {
		return fmt.Sprintf("Halo Bapak/Ibu %s, kami ingin memastikan apakah Bapak/Ibu masih membutuhkan bantuan kami? 😊\n\nSilakan balas kapanpun Bapak/Ibu siap, kami siap membantu! 🙏", name)
	}
	return fmt.Sprintf("Halo Bapak/Ibu %s, kami coba menghubungi kembali 🙏\n\nJika ada pertanyaan mengenai produk kami, jangan ragu untuk membalas pesan ini ya.\n\nTerima kasih sudah menghubungi Garindo Jaya Panel! ⚡", name)
}

func bookedMessage(name, lang string, count int) string {
	if lang == "en" {
		if count == 1 {
			return fmt.Sprintf("Hello %s, we'd like to remind you that your order has been confirmed. Please complete the payment and send the transfer proof to this number. 🙏", name)
		}
		return fmt.Sprintf("Hello %s, a reminder about the payment for your order. If you have questions about payment details, please reply to this message. Thank you! ⚡", name)
	}
	if count == 1 {
		return fmt.Sprintf("Halo Bapak/Ibu %s, kami ingin mengingatkan bahwa pesanan Bapak/Ibu sudah dikonfirmasi. Silakan lakukan pembayaran dan kirim foto bukti transfernya ke nomor ini ya. 🙏", name)
	}
	return fmt.Sprintf("Halo Bapak/Ibu %s, kami mengingatkan kembali mengenai pembayaran pesanan Bapak/Ibu. Jika ada pertanyaan mengenai detail pembayaran, silakan balas pesan ini. Terima kasih! ⚡", name)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend-go && CGO_ENABLED=1 go test ./internal/followup/... -v 2>&1
```

Expected:
```
--- PASS: TestBuildFollowupMessage_StandardID (0.00s)
--- PASS: TestBuildFollowupMessage_StandardEN (0.00s)
--- PASS: TestBuildFollowupMessage_BookedID (0.00s)
--- PASS: TestBuildFollowupMessage_BookedEN (0.00s)
--- PASS: TestIsNewWIBDay_NilIsNewDay (0.00s)
--- PASS: TestIsNewWIBDay_YesterdayIsNewDay (0.00s)
--- PASS: TestIsNewWIBDay_FarFutureIsNotNewDay (0.00s)
ok  	github.com/username/sinar-elektrik-backend/internal/followup
```

- [ ] **Step 5: Full build check**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/followup/poller.go backend-go/internal/followup/poller_test.go
git commit -m "feat(go): add followup poller — polling goroutine and WA message builder"
```

---

## Task 6: Wire handler.go and main.go

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go`
- Modify: `backend-go/main.go`

These two changes are independent but committed together for cleanliness.

- [ ] **Step 1: Add `ResetFollowupCounter` call to `processMessage` in `handler.go`**

In `backend-go/internal/whatsapp/handler.go`, locate `processMessage`. After the `GetOrCreateConversation` success block (the `if err != nil { return }` block), add the reset call before any other logic:

Current code (lines ~76–82):
```go
	conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// 3. Ensure customer record exists; create lead on new conversations.
```

Change to:
```go
	conv, created, err := h.db.GetOrCreateConversation(senderPhone, h.waNumberID)
	if err != nil {
		log.Printf("[HANDLER] GetOrCreateConversation error for %s: %v", senderPhone, err)
		return
	}

	// Reset follow-up counter — customer has replied.
	if err := h.db.ResetFollowupCounter(conv.ID); err != nil {
		log.Printf("[HANDLER] ResetFollowupCounter error for conv %s: %v", conv.ID, err)
	}

	// 3. Ensure customer record exists; create lead on new conversations.
```

- [ ] **Step 2: Start the poller in `main.go`**

In `backend-go/main.go`, add the import for the followup package:

```go
import (
    // ... existing imports ...
    "github.com/username/sinar-elektrik-backend/internal/followup"
)
```

Then find the line:
```go
waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey)
waClient.AddEventHandler(waHandler.Handle)
```

Add the poller start immediately after `waClient.AddEventHandler`:
```go
waHandler = whatsapp.NewHandler(dbClient, machine, sender, sched, waNumberID, cfg.SupabaseURL, cfg.SupabaseServiceKey)
waClient.AddEventHandler(waHandler.Handle)
followup.NewPoller(dbClient, sender).Start(ctx)
log.Println("[MAIN] Follow-up poller started (1-minute tick)")
```

- [ ] **Step 3: Full build check — must be zero errors**

```bash
cd backend-go && CGO_ENABLED=1 go build ./...
```

Expected: **Zero errors.**

- [ ] **Step 4: Run full test suite**

```bash
cd backend-go && CGO_ENABLED=1 go test ./...
```

Expected: All pass, including the 7 new followup tests.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go backend-go/main.go
git commit -m "feat(go): wire follow-up poller — ResetFollowupCounter on reply, start poller in main"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Migration with 3 columns + trigger — Task 1
- ✅ `LastAIMessageAt`, `FollowupCountToday`, `LastFollowupDate` on Conversation — Task 2
- ✅ `findActiveConversation` and `createConversation` scan new columns — Task 3
- ✅ `GetEligibleForFollowup` — Task 4
- ✅ `IncrementFollowup` (atomic reset-or-increment) — Task 4
- ✅ `ResetFollowupCounter` — Task 4
- ✅ `Poller.Start` with 1-minute ticker, stops on ctx.Done — Task 5
- ✅ `poll()` skips on send error, does not update DB — Task 5
- ✅ `isNewWIBDay` uses Postgres date UTC-midnight convention — Task 5
- ✅ `buildFollowupMessage` — all 8 variants (standard/BOOKED × count1/2 × id/en) — Task 5
- ✅ `ResetFollowupCounter` called in `processMessage` on every customer reply — Task 6
- ✅ Poller started in `main.go` — Task 6

**No placeholders found.**

**Type consistency:**
- `GetEligibleForFollowup() ([]*models.Conversation, error)` defined in Task 4, called in Task 5 `poll()` ✅
- `IncrementFollowup(convID string) error` defined in Task 4, called in Task 5 `poll()` ✅
- `ResetFollowupCounter(convID string) error` defined in Task 4, called in Task 6 handler ✅
- `NewPoller(d *db.Client, s *whatsapp.Sender) *Poller` defined in Task 5, called in Task 6 main ✅
- `buildFollowupMessage(conv *models.Conversation, count int) string` used internally in Task 5, tested in Task 5 ✅
- `isNewWIBDay(t *time.Time) bool` used in `poll()` Task 5, tested in Task 5 ✅
- `conv.CollectedData.Name` — `CollectedData.Name string` defined in models, present on `Conversation.CollectedData` ✅
