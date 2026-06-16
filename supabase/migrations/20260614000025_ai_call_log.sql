-- supabase/migrations/20260614000025_ai_call_log.sql
-- Spec §6.2

CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  http_status INT,
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_today ON public.ai_call_log (called_at DESC);

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_call_log' AND policyname='read auth') THEN
    CREATE POLICY "read auth" ON public.ai_call_log
      FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_call_log' AND policyname='write service') THEN
    CREATE POLICY "write service" ON public.ai_call_log
      FOR INSERT TO service_role WITH CHECK (true);
  END IF;
END $$;
