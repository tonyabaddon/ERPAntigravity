-- Sprint 5.2: Add scheduled_for to t_jobs for quiet-hours delay + consolidation window.
-- Migration slot: 441

-- Add scheduled_for column (nullable = immediate, non-null = deferred)
ALTER TABLE public.t_jobs
    ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NULL;

-- Index: worker polls QUEUED jobs respecting scheduled_for
DROP INDEX IF EXISTS idx_t_jobs_scheduled;
CREATE INDEX IF NOT EXISTS idx_t_jobs_scheduled
    ON public.t_jobs (status, scheduled_for, priority, created_at)
    WHERE status = 'QUEUED';

-- Partial unique: at most one open broadcast_consolidated job per tenant.
-- Prevents two concurrent BroadcastToStaff calls from both INSERTing a
-- consolidation job — the second INSERT gets a unique-violation and falls
-- through to the append-or-skip path instead.
DROP INDEX IF EXISTS idx_t_jobs_one_consolidation_per_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS idx_t_jobs_one_consolidation_per_tenant
    ON public.t_jobs (tenant_id)
    WHERE job_type = 'broadcast_consolidated' AND status = 'QUEUED';

-- Update claim_next_job to respect scheduled_for.
-- A job with scheduled_for > now() stays QUEUED but is skipped until its
-- window opens. All other semantics (SKIP LOCKED, priority, SECDEF) unchanged.
CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS TABLE (job_id uuid, tenant_id uuid, job_type text, payload jsonb, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claimed_id uuid;
    v_claimed_tenant uuid;
    v_claimed_type text;
    v_claimed_payload jsonb;
    v_claimed_attempts int;
BEGIN
    -- Atomically claim one QUEUED job that is either unscheduled or due now.
    UPDATE t_jobs j
    SET status = 'RUNNING',
        started_at = now(),
        attempts = j.attempts + 1
    WHERE j.id = (
        SELECT j2.id FROM t_jobs j2
        WHERE j2.status = 'QUEUED'
          AND (j2.scheduled_for IS NULL OR j2.scheduled_for <= now())
        ORDER BY j2.priority ASC, j2.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j.tenant_id, j.job_type, j.payload, j.attempts
    INTO v_claimed_id, v_claimed_tenant, v_claimed_type, v_claimed_payload, v_claimed_attempts;

    IF v_claimed_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id)
    VALUES (v_claimed_tenant, v_claimed_id, 'STARTED', p_worker_id);

    job_id     := v_claimed_id;
    tenant_id  := v_claimed_tenant;
    job_type   := v_claimed_type;
    payload    := v_claimed_payload;
    attempts   := v_claimed_attempts;
    RETURN NEXT;
END;
$$;

ALTER FUNCTION public.claim_next_job(text) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC, anon, authenticated;
-- service_role only (worker uses service_role DB connection)

COMMENT ON COLUMN public.t_jobs.scheduled_for IS
  'NULL = run immediately. Non-null = do not claim before this timestamp. '
  'Used by broadcast_quiet_delay (held until morning) and '
  'broadcast_consolidated (held N seconds for message coalescing).';
