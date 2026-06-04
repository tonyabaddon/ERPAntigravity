# Calista Message Filter & Follow-up Exhaustion Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs that cause Calista to message people who never chatted — group/status message leak, stale @lid conversations, and infinite daily follow-ups.

**Architecture:** Three independent fixes applied in order: DB migration first (schema + data cleanup), then Go code changes, then verification. Each task is self-contained and commits independently.

**Tech Stack:** Go 1.21, PostgreSQL (Supabase), whatsmeow v0 (WhatsApp library), `go test ./...` for unit tests.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `supabase/migrations/20260605000002_calista_message_filter_fix.sql` | Create | Adds `followup_sends_total` column; cancels stale `@lid` conversations |
| `backend-go/internal/whatsapp/handler.go` | Modify | Adds group/broadcast filter at top of `Handle()` |
| `backend-go/internal/db/followup.go` | Modify | Updates `IncrementFollowup` and `ResetFollowupCounter` SQL |

---

### Task 1: DB Migration — followup_sends_total column + @lid cleanup

**Files:**
- Create: `supabase/migrations/20260605000002_calista_message_filter_fix.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260605000002_calista_message_filter_fix.sql

-- 1. Add followup_sends_total to track cumulative follow-ups since last customer reply.
--    When this reaches 6 (3 days × 2/day), ai_active is set false by IncrementFollowup.
--    Resets to 0 whenever ResetFollowupCounter is called (customer replies).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS followup_sends_total INT NOT NULL DEFAULT 0;

-- 2. Cancel stale @lid conversations that have zero customer messages.
--    These were created by group/status message events (Bug 1), not real customers.
--    @lid conversations WITH customer messages are left untouched (legitimate LID accounts).
UPDATE conversations
SET state = 'CANCELLED', ai_active = false
WHERE customer_phone LIKE '%@lid'
  AND id NOT IN (
    SELECT DISTINCT conversation_id FROM messages WHERE sender = 'customer'
  );
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `calista_message_filter_fix`
- `query`: the full SQL from Step 1

Alternatively via Supabase CLI:
```bash
supabase db push --project-ref ekhhojaezdfjfwuxyjkl
```

- [ ] **Step 3: Verify migration applied correctly**

Run this SQL in Supabase:
```sql
-- Should return the new column
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'conversations' AND column_name = 'followup_sends_total';

-- Should show all @lid-with-no-customer-messages as CANCELLED
SELECT customer_phone, state, ai_active
FROM conversations
WHERE customer_phone LIKE '%@lid'
ORDER BY created_at DESC;
```

Expected: column exists with default 0; all `@lid` rows with no customer messages show `state = 'CANCELLED'` and `ai_active = false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260605000002_calista_message_filter_fix.sql
git commit -m "fix(db): add followup_sends_total column and cancel stale @lid conversations"
```

---

### Task 2: Filter Group and Broadcast Messages in Handler

**Files:**
- Modify: `backend-go/internal/whatsapp/handler.go:38-46`

- [ ] **Step 1: Add the filter immediately after the IsFromMe check**

Open `backend-go/internal/whatsapp/handler.go`. The current `Handle()` function starts:

```go
func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}

	text := evt.Message.GetConversation()
```

Replace that block with:

```go
func (h *Handler) Handle(rawEvt interface{}) {
	evt, ok := rawEvt.(*events.Message)
	if !ok {
		return
	}
	if evt.Info.IsFromMe {
		return
	}

	// Only process direct messages. Skip group chats (g.us), broadcast lists,
	// and WhatsApp Status updates (broadcast server). These are not customer DMs.
	if evt.Info.IsGroup || evt.Info.Chat.Server == "g.us" || evt.Info.Chat.Server == "broadcast" {
		log.Printf("[HANDLER] Skipping non-DM message from chat %s sender %s", evt.Info.Chat, evt.Info.Sender)
		return
	}

	text := evt.Message.GetConversation()
```

- [ ] **Step 2: Run existing unit tests to confirm nothing broke**

```bash
cd backend-go && go test ./... -v 2>&1 | tail -20
```

Expected: all tests pass. The handler has no unit tests (it depends on live whatsmeow events), so this just confirms compilation succeeds and unrelated tests still pass.

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/whatsapp/handler.go
git commit -m "fix(handler): skip group, broadcast, and WhatsApp Status messages"
```

---

### Task 3: Update IncrementFollowup and ResetFollowupCounter SQL

**Files:**
- Modify: `backend-go/internal/db/followup.go`

- [ ] **Step 1: Update IncrementFollowup**

Open `backend-go/internal/db/followup.go`. Replace the entire `IncrementFollowup` function:

```go
// IncrementFollowup records a follow-up send. If it is a new WIB day since the
// last follow-up, the count resets to 1 rather than incrementing.
// After 6 cumulative sends (3 days × 2/day) with no customer reply,
// ai_active is set to false to stop further follow-ups automatically.
func (c *Client) IncrementFollowup(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations SET
		  followup_count_today = CASE
		    WHEN last_followup_date IS NULL
		      OR last_followup_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
		    THEN 1
		    ELSE followup_count_today + 1
		  END,
		  last_followup_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date,
		  followup_sends_total = followup_sends_total + 1,
		  ai_active = CASE
		    WHEN followup_sends_total + 1 >= 6 THEN false
		    ELSE ai_active
		  END
		WHERE id = $1
	`, convID)
	return err
}
```

- [ ] **Step 2: Update ResetFollowupCounter**

In the same file, replace the entire `ResetFollowupCounter` function:

```go
// ResetFollowupCounter clears follow-up tracking when the customer replies.
// Called at the start of processMessage so any customer reply resets the state,
// including the cumulative sends counter so the 3-day auto-disable window restarts.
func (c *Client) ResetFollowupCounter(convID string) error {
	_, err := c.DB.Exec(`
		UPDATE conversations
		SET followup_count_today = 0,
		    last_followup_date = NULL,
		    followup_sends_total = 0
		WHERE id = $1
	`, convID)
	return err
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend-go && go test ./... -v 2>&1 | tail -20
```

Expected: all existing tests pass. No new unit tests for the SQL changes — the auto-disable threshold is verified via Step 4.

- [ ] **Step 4: Verify auto-disable logic with SQL**

Run in Supabase to simulate what happens after 6 follow-ups:

```sql
-- Find any conversation with followup_sends_total >= 6 (should auto-disable)
SELECT id, customer_phone, state, ai_active, followup_sends_total
FROM conversations
WHERE followup_sends_total >= 6;

-- Manually test the CASE expression logic:
SELECT
  CASE WHEN 5 + 1 >= 6 THEN false ELSE true END AS "at 6 disables",
  CASE WHEN 4 + 1 >= 6 THEN false ELSE true END AS "at 5 stays active";
```

Expected: first query returns 0 rows (no one has hit threshold yet in fresh DB). Second query: `at 6 disables = false`, `at 5 stays active = true`.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/db/followup.go
git commit -m "fix(followup): auto-disable ai_active after 6 follow-up sends (3 days no reply)"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd backend-go && go test ./... -v
```

Expected output includes:
```
--- PASS: TestBuildFollowupMessage_StandardID
--- PASS: TestBuildFollowupMessage_StandardEN
--- PASS: TestBuildFollowupMessage_BookedID
--- PASS: TestBuildFollowupMessage_BookedEN
--- PASS: TestIsNewWIBDay_NilIsNewDay
--- PASS: TestIsNewWIBDay_YesterdayIsNewDay
--- PASS: TestIsNewWIBDay_FarFutureIsNotNewDay
ok  	github.com/username/sinar-elektrik-backend/internal/followup
```

- [ ] **Step 2: Verify DB state after migration**

```sql
-- All @lid conversations with no customer messages should be CANCELLED
SELECT COUNT(*) AS should_be_zero
FROM conversations
WHERE customer_phone LIKE '%@lid'
  AND ai_active = true
  AND id NOT IN (
    SELECT DISTINCT conversation_id FROM messages WHERE sender = 'customer'
  );

-- followup_sends_total column should exist with default 0
SELECT AVG(followup_sends_total) FROM conversations;
```

Expected: first query = 0. Second query returns a number ≥ 0.

- [ ] **Step 3: Rebuild and deploy backend**

```bash
cd backend-go && go build ./...
```

Expected: no compilation errors.

Deploy via Cloud Build (push to main triggers deploy).

- [ ] **Step 4: Update progress.md**

Add entry to `progress.md` noting all three bugs fixed.

- [ ] **Step 5: Final commit**

```bash
git add progress.md
git commit -m "fix(calista): comprehensive message filter — group/status block, @lid cleanup, follow-up exhaustion"
```
