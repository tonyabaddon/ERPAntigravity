-- P2-E Fix wave: correctness fixes for job queue RPCs
-- Migration slot: 322 (supersedes parts of 321 — safe to re-run after 321 applied)
--
-- Fix A: claim_next_job — use composite PK (tenant_id, id) in UPDATE WHERE clause.
--        Original 321 did UPDATE WHERE id=... from a correlated subquery; structurally
--        wrong when composite PK requires both columns. New version: SELECT ... INTO
--        v_claimed_tenant, v_claimed_id first, then UPDATE WHERE tenant_id=... AND id=...
--
-- Fix B: complete_job — derive tenant_id explicitly before UPDATE, then filter on
--        composite (tenant_id, id) in the UPDATE WHERE clause. Adds JOB_NOT_FOUND guard.
--
-- Fix C: enqueue_job idempotency — only treat QUEUED/RUNNING/SUCCEEDED as "already in
--        flight". FAILED and CANCELED must allow re-enqueue. The old UNIQUE constraint
--        t_jobs_idem_unique blocked re-inserts regardless of status, so we drop it and
--        replace with a partial unique index covering only active/completed-good statuses.
--
-- All three functions are idempotent (CREATE OR REPLACE).
-- The constraint change: DROP CONSTRAINT IF EXISTS → CREATE UNIQUE INDEX IF NOT EXISTS
-- (partial) is also idempotent.

-- ============================================================
-- Fix C: Replace full UNIQUE constraint with a partial index
-- so FAILED/CANCELED jobs can be re-enqueued with the same key.
-- ============================================================
ALTER TABLE t_jobs DROP CONSTRAINT IF EXISTS t_jobs_idem_unique;

CREATE UNIQUE INDEX IF NOT EXISTS t_jobs_idem_unique_active
    ON t_jobs (tenant_id, job_type, idempotency_key)
    WHERE idempotency_key IS NOT NULL
      AND status IN ('QUEUED', 'RUNNING', 'SUCCEEDED');

-- ============================================================
-- Fix A + C: enqueue_job — idempotency SELECT filters on
-- QUEUED/RUNNING/SUCCEEDED only; INSERT now relies on partial
-- index instead of old full UNIQUE constraint.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_job(
    p_job_type text,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_priority int DEFAULT 100,
    p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid;
    v_job_id uuid;
    v_existing_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;

    v_tenant_id := public._resolve_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'TENANT_NOT_RESOLVED' USING ERRCODE = '42501';
    END IF;

    -- Idempotency: return existing job if key matches AND job is still
    -- in-flight or already succeeded. FAILED/CANCELED jobs may be retried
    -- with the same key (re-enqueue creates a fresh job row).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM t_jobs
        WHERE tenant_id = v_tenant_id
          AND job_type = p_job_type
          AND idempotency_key = p_idempotency_key
          AND status IN ('QUEUED', 'RUNNING', 'SUCCEEDED');
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

    INSERT INTO t_jobs (tenant_id, job_type, payload, priority, created_by, idempotency_key)
    VALUES (v_tenant_id, p_job_type, COALESCE(p_payload, '{}'::jsonb), p_priority, v_user_id, p_idempotency_key)
    RETURNING id INTO v_job_id;

    RETURN v_job_id;
END;
$$;

ALTER FUNCTION public.enqueue_job(text, jsonb, int, text) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, int, text) TO authenticated;

-- ============================================================
-- Fix A: claim_next_job — composite PK (tenant_id, id) in UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS TABLE (job_id uuid, tenant_id uuid, job_type text, payload jsonb, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_claimed_tenant uuid;
    v_claimed_id uuid;
BEGIN
    -- Pick the next QUEUED job, locking with SKIP LOCKED for multi-instance safety.
    -- Use SELECT INTO to capture both PK columns before the UPDATE.
    SELECT j.tenant_id, j.id
    INTO v_claimed_tenant, v_claimed_id
    FROM t_jobs j
    WHERE j.status = 'QUEUED'
    ORDER BY j.priority ASC, j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_claimed_id IS NULL THEN
        RETURN; -- no jobs available
    END IF;

    -- Update using full composite PK — correct for (tenant_id, id) primary key.
    UPDATE t_jobs
    SET status = 'RUNNING',
        started_at = now(),
        attempts = attempts + 1
    WHERE tenant_id = v_claimed_tenant AND id = v_claimed_id;

    -- Log run start.
    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id)
    VALUES (v_claimed_tenant, v_claimed_id, 'STARTED', p_worker_id);

    -- Return the claimed job.
    RETURN QUERY
    SELECT j.id, j.tenant_id, j.job_type, j.payload, j.attempts
    FROM t_jobs j
    WHERE j.tenant_id = v_claimed_tenant AND j.id = v_claimed_id;
END;
$$;

ALTER FUNCTION public.claim_next_job(text) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC, anon, authenticated;
-- service_role only — no GRANT to authenticated

-- ============================================================
-- Fix B: complete_job — composite PK WHERE clause in UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_job(
    p_job_id uuid,
    p_status text,        -- 'SUCCEEDED' or 'FAILED'
    p_result jsonb DEFAULT NULL,
    p_error_code text DEFAULT NULL,
    p_error_message text DEFAULT NULL,
    p_worker_id text DEFAULT NULL,
    p_duration_ms int DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    IF p_status NOT IN ('SUCCEEDED', 'FAILED') THEN
        RAISE EXCEPTION 'INVALID_STATUS: %', p_status;
    END IF;

    -- Derive tenant_id from composite PK first, then filter on both columns in UPDATE.
    -- This is structurally correct for PK (tenant_id, id).
    SELECT tenant_id INTO v_tenant_id
    FROM t_jobs
    WHERE id = p_job_id
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND: %', p_job_id;
    END IF;

    UPDATE t_jobs
    SET status = p_status,
        completed_at = now(),
        result = p_result,
        error_code = p_error_code,
        error_message = p_error_message
    WHERE tenant_id = v_tenant_id AND id = p_job_id;

    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id, duration_ms, log_message)
    VALUES (v_tenant_id, p_job_id, p_status, p_worker_id, p_duration_ms,
            CASE WHEN p_status = 'FAILED' THEN p_error_message ELSE NULL END);
END;
$$;

ALTER FUNCTION public.complete_job(uuid, text, jsonb, text, text, text, int) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.complete_job(uuid, text, jsonb, text, text, text, int) FROM PUBLIC, anon, authenticated;
-- service_role only — no GRANT to authenticated
