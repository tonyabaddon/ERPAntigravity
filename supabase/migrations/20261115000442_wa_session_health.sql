-- Migration slot 442: wa_session_health table
-- Sprint 5 Task 5.4: stores per-tenant WA session poll results;
-- used by SessionHealthPoller to detect offline sessions and throttle
-- ops-email alerts to once per hour.

CREATE TABLE IF NOT EXISTS public.wa_session_health (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  polled_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_connected BOOLEAN NOT NULL,
  alerted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wa_session_health_tenant_time
  ON public.wa_session_health (tenant_id, polled_at DESC);
