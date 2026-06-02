# Follow-up Scheduler Design Spec

**Date:** 2026-06-02
**Sub-project:** C2 of C (Follow-up Scheduler)
**Status:** Approved for implementation

---

## Problem

The system prompt specifies an automatic follow-up system: if a customer stops replying, Calista should re-engage them every 4 hours, up to 2 times per day, resetting the next day. Currently no follow-up mechanism exists — silent customers are simply never contacted again.

---

## Goal

Implement automatic follow-up WA messages for conversations where:
- Calista has sent a message but the customer hasn't replied in 4 hours
- The conversation is still active (not completed or escalated)
- The daily quota (2 per day, WIB timezone) has not been exhausted

BOOKED state (order confirmed, waiting payment proof) is included per business decision — customers who haven't sent payment after confirmation should also be nudged.

---

## Decisions

- **In-process polling goroutine (Option A)** — ticks every minute, queries eligible conversations from DB. Restart-safe because all state is persisted in Postgres. No external infrastructure required. Suitable for single-daemon architecture.
- **`last_ai_message_at` maintained by Postgres trigger** — fires on INSERT into `messages` where `sender = 'ai'`, updates `conversations.last_ai_message_at`. No Go code needs to manually track this; all existing and future AI message sends are covered automatically.
- **Daily reset handled atomically in `IncrementFollowup`** — when recording a follow-up, the function detects if `last_followup_date < today(WIB)` and resets the count to 1 (rather than incrementing). No midnight cron job needed.
- **Customer reply resets counter** — `ResetFollowupCounter` called at the start of every `processMessage`. Any customer reply (in any state) wipes the follow-up state so the customer starts fresh the next time Calista sends a message.
- **Name is mandatory** — `conv.CollectedData.Name` is used directly in all follow-up messages. No fallback needed.
- **BOOKED state gets a payment-specific message** — distinct from the standard re-engagement messages, referencing the pending payment proof upload.

---

## Files Changed

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/20260602000002_followup_scheduler.sql` | Add 3 columns to `conversations`; trigger to maintain `last_ai_message_at` |
| `backend-go/internal/db/followup.go` | `GetEligibleForFollowup`, `IncrementFollowup`, `ResetFollowupCounter` |
| `backend-go/internal/followup/poller.go` | Polling goroutine — tick every minute, query eligible, send WA, update DB |

### Modified files

| File | Change |
|---|---|
| `backend-go/internal/models/types.go` | Add `LastAIMessageAt`, `FollowupCountToday`, `LastFollowupDate` to `Conversation` |
| `backend-go/internal/db/conversations.go` | Scan three new columns in `findActiveConversation` and `createConversation` |
| `backend-go/internal/whatsapp/handler.go` | Call `db.ResetFollowupCounter(conv.ID)` in `processMessage` after `GetOrCreateConversation` |
| `backend-go/main.go` | Start `followup.NewPoller(dbClient, sender).Start(ctx)` |

**Not changing:** `engine/`, `gemini/`, `scheduler/`, `rules/`, `parser.go`, `machine.go`, `machine_test.go`, any React files, `orders.go`, `customers.go`, `leads.go`, `bank_config.go`, `wa_recipients.go`, `payment.go`, `storage/`.

---

## Section 1: Database Migration

**File:** `supabase/migrations/20260602000002_followup_scheduler.sql`

### 1a. New columns on `conversations`

```sql
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_ai_message_at   timestamptz,
  ADD COLUMN IF NOT EXISTS followup_count_today  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_followup_date    date;
```

- `last_ai_message_at` — timestamp of the last message sent by Calista (sender = 'ai'). Maintained by trigger, never written directly by Go.
- `followup_count_today` — how many follow-ups have been sent today (WIB). Reset to 0 atomically when a new day is detected.
- `last_followup_date` — the WIB date on which the last follow-up was sent. Used to detect day boundaries.

### 1b. Trigger to maintain `last_ai_message_at`

```sql
CREATE OR REPLACE FUNCTION update_last_ai_message_at() RETURNS trigger AS $$
BEGIN
  IF NEW.sender = 'ai' THEN
    UPDATE conversations SET last_ai_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_update_last_ai_message_at' AND event_object_table = 'messages'
  ) THEN
    CREATE TRIGGER trg_update_last_ai_message_at
      AFTER INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION update_last_ai_message_at();
  END IF;
END $$;
```

This trigger covers all existing and future AI message sends with no Go changes required.

---

## Section 2: Go Models (`backend-go/internal/models/types.go`)

Three new fields on `Conversation`:

```go
type Conversation struct {
    // ... existing fields ...
    LastAIMessageAt   *time.Time `json:"last_ai_message_at,omitempty"`
    FollowupCountToday int       `json:"followup_count_today"`
    LastFollowupDate  *time.Time `json:"last_followup_date,omitempty"`
}
```

`LastAIMessageAt` and `LastFollowupDate` are pointers (nullable). `FollowupCountToday` defaults to 0.

---

## Section 3: DB Layer (`backend-go/internal/db/followup.go`)

```go
// GetEligibleForFollowup returns active conversations where Calista has sent a message,
// the customer has not replied in 4+ hours, and the daily quota is not exhausted.
func (c *Client) GetEligibleForFollowup() ([]*models.Conversation, error)
```

Query:
```sql
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
```

```go
// IncrementFollowup records a follow-up send. Resets count if it's a new day (WIB).
func (c *Client) IncrementFollowup(convID string) error
```

Query:
```sql
UPDATE conversations SET
  followup_count_today = CASE
    WHEN last_followup_date IS NULL
      OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
    THEN 1
    ELSE followup_count_today + 1
  END,
  last_followup_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
WHERE id = $1
```

```go
// ResetFollowupCounter clears follow-up tracking when the customer replies.
func (c *Client) ResetFollowupCounter(convID string) error
```

Query:
```sql
UPDATE conversations SET followup_count_today = 0, last_followup_date = NULL WHERE id = $1
```

---

## Section 4: DB Layer — Scan changes (`backend-go/internal/db/conversations.go`)

`findActiveConversation` and `createConversation` both scan the three new columns. Scan order must match SELECT order. Use `sql.NullTime` for nullable timestamps and `sql.NullTime` for nullable date (stored as timestamptz midnight, cast in Go).

Concrete: add to SELECT and rows.Scan in both functions:
```go
// In SELECT: ..., last_ai_message_at, followup_count_today, last_followup_date
// In Scan:   &conv.LastAIMessageAt, &conv.FollowupCountToday, &conv.LastFollowupDate
```

Since `LastAIMessageAt` and `LastFollowupDate` are `*time.Time`, use `sql.NullTime` as intermediate and convert.

---

## Section 5: Follow-up Poller (`backend-go/internal/followup/poller.go`)

```go
package followup

type Poller struct {
    db     *db.Client
    sender *whatsapp.Sender
}

func NewPoller(d *db.Client, s *whatsapp.Sender) *Poller

// Start launches the polling goroutine. Stops when ctx is cancelled.
func (p *Poller) Start(ctx context.Context)
```

Internal `poll(ctx)` called every minute:

```
1. db.GetEligibleForFollowup() → convs
2. For each conv:
   a. Compute effectiveCount:
      if conv.LastFollowupDate is nil OR conv.LastFollowupDate < todayWIB(): effectiveCount = 0
      else: effectiveCount = conv.FollowupCountToday
   b. if effectiveCount >= 2: skip (already exhausted today — race condition guard)
   c. msg = buildFollowupMessage(conv, effectiveCount+1)
   d. sender.SendText(ctx, conv.CustomerPhone, msg)
      → on error: log and continue (do NOT update DB — avoid phantom count)
   e. db.InsertMessage(conv.ID, models.SenderAI, msg)
   f. db.IncrementFollowup(conv.ID)
```

`buildFollowupMessage(conv, count int) string`:
- If `conv.State == models.StateBooked`: use BOOKED payment-reminder messages
- Else: use standard re-engagement messages
- `count == 1` → message 1; `count == 2` → message 2
- Language: `conv.Language == "en"` → English variants

### Message templates

**Standard (count=1, id):**
```
Halo Bapak/Ibu [Name], kami ingin memastikan apakah Bapak/Ibu masih membutuhkan bantuan kami? 😊

Silakan balas kapanpun Bapak/Ibu siap, kami siap membantu! 🙏
```

**Standard (count=2, id):**
```
Halo Bapak/Ibu [Name], kami coba menghubungi kembali 🙏

Jika ada pertanyaan mengenai produk kami, jangan ragu untuk membalas pesan ini ya.

Terima kasih sudah menghubungi Garindo Jaya Panel! ⚡
```

**Standard (count=1, en):**
```
Hello [Name], we wanted to check if you still need our assistance? 😊

Feel free to reply anytime you're ready, we're here to help! 🙏
```

**Standard (count=2, en):**
```
Hello [Name], we're reaching out again 🙏

If you have any questions about our products, don't hesitate to reply.

Thank you for contacting Garindo Jaya Panel! ⚡
```

**BOOKED (count=1, id):**
```
Halo Bapak/Ibu [Name], kami ingin mengingatkan bahwa pesanan Bapak/Ibu sudah dikonfirmasi. Silakan lakukan pembayaran dan kirim foto bukti transfernya ke nomor ini ya. 🙏
```

**BOOKED (count=2, id):**
```
Halo Bapak/Ibu [Name], kami mengingatkan kembali mengenai pembayaran pesanan Bapak/Ibu. Jika ada pertanyaan mengenai detail pembayaran, silakan balas pesan ini. Terima kasih! ⚡
```

**BOOKED (count=1, en):**
```
Hello [Name], we'd like to remind you that your order has been confirmed. Please complete the payment and send the transfer proof to this number. 🙏
```

**BOOKED (count=2, en):**
```
Hello [Name], a reminder about the payment for your order. If you have questions about payment details, please reply to this message. Thank you! ⚡
```

---

## Section 6: Handler change (`backend-go/internal/whatsapp/handler.go`)

In `processMessage`, after `GetOrCreateConversation` succeeds, add:

```go
// Reset follow-up counter — customer has replied.
if err := h.db.ResetFollowupCounter(conv.ID); err != nil {
    log.Printf("[HANDLER] ResetFollowupCounter error for conv %s: %v", conv.ID, err)
}
```

This is non-fatal: log and continue if it fails. The reset happens before any other processing so the counter is cleared even if downstream logic errors out.

---

## Section 7: `main.go`

After `waHandler` is assigned and before `waClient.Connect`:

```go
followup.NewPoller(dbClient, sender).Start(ctx)
log.Println("[MAIN] Follow-up poller started")
```

Import: `"github.com/username/sinar-elektrik-backend/internal/followup"`

---

## Success Criteria

1. `CGO_ENABLED=1 go build ./...` passes.
2. `go test ./...` passes — no regressions.
3. Migration applies cleanly to Supabase.
4. Inserting an AI message via the dashboard SQL Editor updates `conversations.last_ai_message_at` automatically (trigger verification).
5. A conversation with `last_ai_message_at > 4 hours ago`, `ai_active = true`, non-terminal state, and `followup_count_today < 2` appears in `GetEligibleForFollowup()` result.
6. After two follow-ups on the same day, the conversation no longer appears in the eligibility query.
7. On the next WIB day, the conversation reappears (count reset).
8. A customer reply (any message) resets `followup_count_today = 0` and `last_followup_date = NULL`.
9. BOOKED state conversations receive payment reminder messages, not standard re-engagement messages.
