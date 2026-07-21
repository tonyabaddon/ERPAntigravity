-- Migration 20261115000508: auto-expire stale platform_admin impersonation locks
--
-- Context: 2026-07-11 founder impersonated tenant "garindo" and never called
-- stop_impersonation. Row survived 11 days in public.platform_admin_active_impersonation.
-- Every login re-injected impersonating=true into the JWT via custom_access_token_hook,
-- redirecting admin.caleo.id to /t/garindo/dashboard via AdminRouteGuard.tsx:87.
--
-- Fix: reap impersonation rows older than 8 hours via pg_cron. No legitimate
-- support case needs to impersonate one tenant continuously beyond a work day.
-- If that assumption ever changes (e.g. more platform admins with long support
-- sessions), move the TTL into a settings row.
--
-- SECDEF + owned by vosi_rpc_owner per CLAUDE.md SECDEF guardrails so the cron
-- runner (which authenticates as postgres) can DELETE from the table under its
-- p_platform_admin_only RLS policy without the admin.uid check.

CREATE OR REPLACE FUNCTION public.expire_stale_impersonations()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    DELETE FROM public.platform_admin_active_impersonation
    WHERE started_at < now() - interval '8 hours'
    RETURNING 1
  )
  SELECT count(*)::int FROM d;
$$;

ALTER FUNCTION public.expire_stale_impersonations() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.expire_stale_impersonations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_impersonations() TO postgres;

-- Schedule: every hour on the 15th minute. Idempotent — cron.schedule replaces
-- an existing schedule with the same name.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('expire_impersonations')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire_impersonations');

SELECT cron.schedule(
  'expire_impersonations',
  '15 * * * *',
  $$SELECT public.expire_stale_impersonations();$$
);
