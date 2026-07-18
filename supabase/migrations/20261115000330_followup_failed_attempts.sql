-- Migration 330: FOLLOWUP safety valve — track consecutive failed SendText attempts.
--
-- Problem discovered 2026-07-18: poller retries SendText every ~30s forever if
-- WhatsApp send fails (invalid number, session not paired, etc). The existing
-- 6-cumulative-send safety valve only advances on SUCCESSFUL sends via
-- IncrementFollowup, so failed sends never trigger auto-disable.
--
-- Fix: separate `followup_failed_attempts` counter incremented on send failure.
-- Auto-disable `ai_active` after 3 consecutive failures per conv_id via
-- IncrementFollowupFailed helper. Successful send resets the failed counter
-- (so intermittent failures don't compound with successes).
--
-- Idempotent per CLAUDE.md.

BEGIN;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS followup_failed_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.conversations.followup_failed_attempts IS
  'Consecutive SendText failures. Reset on any success or customer reply. Poller auto-sets ai_active=false at 3+ consecutive failures.';

COMMIT;
