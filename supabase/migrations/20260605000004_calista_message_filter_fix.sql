-- supabase/migrations/20260605000004_calista_message_filter_fix.sql

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
