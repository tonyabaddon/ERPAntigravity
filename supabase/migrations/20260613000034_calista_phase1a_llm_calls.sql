-- Phase 1A: telemetry table for every LLM call the router makes.
-- Source of truth for: success rate per model, latency p95, tripwire alerts,
-- chain exhaustion rate, future cost tracking when Layer 2 (paid) activates.

CREATE TABLE IF NOT EXISTS public.llm_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    model_slug text NOT NULL,
    tier text NOT NULL DEFAULT 'layer1_free',
    was_forced_swap boolean NOT NULL DEFAULT false,
    state_boundary boolean NOT NULL DEFAULT false,
    prompt_tokens int NOT NULL DEFAULT 0,
    completion_tokens int NOT NULL DEFAULT 0,
    latency_ms int NOT NULL DEFAULT 0,
    cost_idr_estimated numeric(12,4) NOT NULL DEFAULT 0,
    status text NOT NULL,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT llm_calls_tier_check CHECK (tier IN (
        'layer1_free', 'layer2_paid_gemini_flash', 'layer3_direct_gemini', 'escalate_admin'
    )),
    CONSTRAINT llm_calls_status_check CHECK (status IN (
        'success', 'rate_limited', 'error', 'tripwire_alert',
        'escalated_chain_exhausted', 'context_overflow', 'timeout'
    ))
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_model_created
    ON public.llm_calls(model_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_conversation_created
    ON public.llm_calls(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_status
    ON public.llm_calls(status) WHERE status != 'success';

ALTER TABLE public.llm_calls ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='llm_calls' AND policyname='llm_calls_admin_read'
    ) THEN
        CREATE POLICY llm_calls_admin_read ON public.llm_calls
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

COMMENT ON TABLE public.llm_calls IS
  'Phase 1A: per-LLM-call telemetry. Retained indefinitely for ML training corpus (see spec §13).';
