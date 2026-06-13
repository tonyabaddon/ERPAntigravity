-- Phase 1A: persistent per-model cooldown registry.
-- The router holds an in-memory cache as the hot path. This table is the
-- source of truth across daemon restarts — without it, a restart would wipe
-- cooldown knowledge and cause a 429 storm.

CREATE TABLE IF NOT EXISTS public.model_cooldowns (
    model_slug text PRIMARY KEY,
    cooldown_until timestamptz,
    last_error text,
    consecutive_failures int NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.model_cooldowns ENABLE ROW LEVEL SECURITY;

-- RLS read policy uses `authenticated` role with USING (true). In this project,
-- only admin users authenticate to Supabase — end customers never do — so
-- `authenticated` is effectively admin-only. Writes go through the backend
-- service_role which bypasses RLS by design. No write policy is needed.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='model_cooldowns' AND policyname='model_cooldowns_admin_read'
    ) THEN
        CREATE POLICY model_cooldowns_admin_read ON public.model_cooldowns
            FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

COMMENT ON TABLE public.model_cooldowns IS
  'Phase 1A: per-model cooldown state, persisted across daemon restarts (spec §5.1).';
