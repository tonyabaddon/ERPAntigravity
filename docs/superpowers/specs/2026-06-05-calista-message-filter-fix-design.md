# Calista Message Filter & Follow-up Exhaustion Fix

**Date:** 2026-06-05  
**Status:** Approved

## Problem

Three distinct bugs cause Calista to message people who should not receive messages:

### Bug 1: Group/Status Messages Processed as Customers

WhatsApp delivers multiple message types to the registered number — including group chat messages, WhatsApp Status updates, and broadcast lists. The handler does not filter these. When a group member posts media (e.g., a photo in a shared group), Calista:
1. Creates a new conversation for their `@lid` JID
2. Replies with "Dokumen Anda telah kami terima..." directly to their DM

Evidence: 8 of 9 conversations in DB have `@lid` format phones. 7 of 8 are `ESCALATED_ADMIN` with zero customer messages. Multiple media events arrive within seconds (group activity pattern).

### Bug 2: Stale @lid Conversations in Database

The `@lid` conversations created by Bug 1 persist in the database. They have `ai_active = true` and `last_ai_message_at` set, making them candidates for future follow-up polling despite never having a real customer interaction.

### Bug 3: Follow-up Runs Indefinitely

`ai_active` is never set to `false` automatically. The follow-up poller sends 2 messages per day to any conversation where the customer has not replied — without any day limit. A customer who messaged once and went silent receives 2 Calista messages every day forever.

## Design

### Fix 1: Filter Non-DM Messages in handler.go

Add a guard at the top of `Handle()`, before any processing:

```go
// Skip group chats, broadcast lists, and WhatsApp Status updates.
if evt.Info.IsGroup || evt.Info.Chat.Server == "g.us" || evt.Info.Chat.Server == "broadcast" {
    log.Printf("[HANDLER] Skipping non-DM message from chat %s", evt.Info.Chat)
    return
}
```

This is the minimal, correct fix. It checks the Chat JID server type rather than the Sender JID, which correctly handles all group and broadcast variants regardless of sender format (`@s.whatsapp.net` or `@lid`).

### Fix 2: Cleanup Existing @lid Conversations

A one-time SQL migration cancels conversations that have `@lid` phone format and zero customer messages — these are confirmed non-customers from Bug 1.

```sql
UPDATE conversations
SET state = 'CANCELLED', ai_active = false
WHERE customer_phone LIKE '%@lid'
  AND id NOT IN (
    SELECT DISTINCT conversation_id FROM messages WHERE sender = 'customer'
  );
```

Conversations with `@lid` phone AND customer messages are left untouched — newer WhatsApp accounts legitimately use LID format for direct messages.

### Fix 3: Auto-disable Follow-up After 3 Days Without Reply

**DB migration:** Add `followup_sends_total INT NOT NULL DEFAULT 0` to `conversations`.

This column tracks total follow-up messages sent since the customer's last reply. It resets to 0 when `ResetFollowupCounter` is called (i.e., when the customer replies).

**Threshold:** 6 sends = 3 days × 2 follow-ups/day. When `followup_sends_total >= 6`, `ai_active` is set to `false` in the same `UPDATE` as the increment.

**`IncrementFollowup` SQL:**
```sql
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
```

**`ResetFollowupCounter` SQL:**
```sql
UPDATE conversations
SET followup_count_today = 0,
    last_followup_date = NULL,
    followup_sends_total = 0
WHERE id = $1
```

If admin wants to re-engage a customer after auto-disable, they can manually re-enable `ai_active` from the Sales Inbox toggle.

## Files Changed

| File | Change |
|---|---|
| `backend-go/internal/whatsapp/handler.go` | Add 4-line group/broadcast filter in `Handle()` |
| `backend-go/internal/db/followup.go` | Update `IncrementFollowup` and `ResetFollowupCounter` SQL |
| `supabase/migrations/20260605000002_calista_message_filter_fix.sql` | Add `followup_sends_total` column + cleanup `@lid` conversations |

## Not in Scope

- Changing how legitimate `@lid` direct-message customers are handled (they continue to work normally)
- Frontend changes (the existing `ai_active` toggle already allows manual re-enable)
- Changes to follow-up message content or timing
