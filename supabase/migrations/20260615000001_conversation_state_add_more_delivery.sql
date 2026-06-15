-- Add missing conversation_state enum values for ADD_MORE and DELIVERY phases.
--
-- The Go state machine in backend-go/internal/models/types.go defines:
--   StateAddMore  ConversationState = "ADD_MORE"
--   StateDelivery ConversationState = "DELIVERY"
--
-- but the original 20260531000000_core_ai_engine.sql ENUM never included
-- them, so UpdateConversationState fails with
--   pq: invalid input value for enum conversation_state: "ADD_MORE"
-- causing every conversation to silently stay in CONFIRMING forever and
-- never reach BOOKED. Verified in prod 2026-06-14 17:24 — Calista
-- intelligently adapted replies based on history but the state machine
-- was stuck, no order rows were created.
--
-- ALTER TYPE ADD VALUE is non-transactional in PostgreSQL (it allocates
-- a new OID), so each statement must run on its own. We use IF NOT EXISTS
-- to make the migration idempotent across re-runs.

ALTER TYPE conversation_state ADD VALUE IF NOT EXISTS 'ADD_MORE';
ALTER TYPE conversation_state ADD VALUE IF NOT EXISTS 'DELIVERY';
