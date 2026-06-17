-- 20260616000011_clip_inference_log.sql
CREATE TABLE IF NOT EXISTS public.clip_inference_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('index', 'search')),
  status      TEXT NOT NULL CHECK (status IN ('success', 'error', 'cold_start_timeout')),
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_inference_log_today
  ON public.clip_inference_log (called_at DESC);

ALTER TABLE public.clip_inference_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access" ON public.clip_inference_log;
CREATE POLICY "service role full access" ON public.clip_inference_log FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
DROP POLICY IF EXISTS "owner/admin read" ON public.clip_inference_log;
CREATE POLICY "owner/admin read" ON public.clip_inference_log FOR SELECT TO authenticated USING (TRUE);
