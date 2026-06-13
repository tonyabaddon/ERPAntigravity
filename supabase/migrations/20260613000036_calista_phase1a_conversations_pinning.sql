-- Phase 1A: add sticky-pinning columns to existing conversations table.
-- Existing table created in 20260531000000_core_ai_engine.sql.
-- Note: Phase 1B adds mode toggle / dashboard columns; this migration is Phase 1A scope only.

ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS pinned_model_slug text,
    ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
    ADD COLUMN IF NOT EXISTS swap_count int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS first_reply_tone jsonb;

CREATE INDEX IF NOT EXISTS idx_conversations_pinned_model
    ON public.conversations(pinned_model_slug)
    WHERE pinned_model_slug IS NOT NULL;

COMMENT ON COLUMN public.conversations.pinned_model_slug IS
  'Phase 1A: sticky model pin per conversation (spec §5.1 routing decision).';
COMMENT ON COLUMN public.conversations.swap_count IS
  'Phase 1A: forced swaps so far this conversation; cap at 2 → escalate.';
COMMENT ON COLUMN public.conversations.first_reply_tone IS
  'Phase 1A: tone signature {greeting, signoff, formality, sample, model_used} from first AI reply.';
