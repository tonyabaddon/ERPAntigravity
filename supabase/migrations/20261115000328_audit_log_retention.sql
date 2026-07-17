-- audit_log retention: keep 180 days, drop older.
-- Scale-critical: audit_log grows unbounded. At 100 tenants × 10 events/day
-- = 1000 rows/day = 180k rows in 180 days. Manageable for free tier (500MB).
--
-- Strategy: SECDEF RPC callable by service_role. Cloud Scheduler triggers
-- daily via Cloud Run Job (see infra/backup/prune_audit_log.sh if built).
-- For 2026-07-17 initial ship, just create the function; scheduler wiring
-- happens in Cost Backfill Schedule follow-up (Task 10 completion bundle).
--
-- Migration slot 328 (326=rehearsal comment, 327=rehearsal revert).

CREATE OR REPLACE FUNCTION public.prune_audit_log(p_retention_days int DEFAULT 180)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_cutoff timestamptz;
    v_deleted bigint;
BEGIN
    v_cutoff := now() - make_interval(days => p_retention_days);
    DELETE FROM public.audit_log WHERE created_at < v_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'Pruned % rows from audit_log older than % (%)', v_deleted, v_cutoff, p_retention_days;
    RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.prune_audit_log(int) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.prune_audit_log(int) FROM PUBLIC, anon, authenticated;
-- service_role only

COMMENT ON FUNCTION public.prune_audit_log(int) IS
  'Task 10 follow-up 2026-07-17: delete audit_log rows older than N days. Call daily via Cloud Scheduler. Zero-cost retention.';
