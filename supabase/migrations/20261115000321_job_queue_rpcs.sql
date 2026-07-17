-- P2-E: Enqueue + claim RPCs. Owned by vosi_rpc_owner (SECDEF).
-- Migration slot: 321
--
-- NOTE: Migration 322 supersedes the WHERE clauses in claim_next_job and complete_job
-- (composite PK fix) and the idempotency logic in enqueue_job (partial index fix).
-- The function bodies below are the original forms for historical reference.
-- Always apply 321 THEN 322 — never skip 322 when re-applying this migration sequence.

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

    -- Idempotency: return existing job if key matches
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_id
        FROM t_jobs
        WHERE tenant_id = v_tenant_id
          AND job_type = p_job_type
          AND idempotency_key = p_idempotency_key;
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

-- Worker claim: pick oldest QUEUED job atomically (FOR UPDATE SKIP LOCKED)
-- Called by worker with service_role (bypass RLS for cross-tenant polling)
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
    -- Atomically claim one QUEUED job (SKIP LOCKED = multi-instance safe)
    UPDATE t_jobs j
    SET status = 'RUNNING',
        started_at = now(),
        attempts = j.attempts + 1
    WHERE j.id = (
        SELECT j2.id FROM t_jobs j2
        WHERE j2.status = 'QUEUED'
        ORDER BY j2.priority ASC, j2.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j.tenant_id, j.job_type, j.payload, j.attempts
    INTO v_claimed_id, v_claimed_tenant, v_claimed_type, v_claimed_payload, v_claimed_attempts;

    IF v_claimed_id IS NULL THEN
        RETURN; -- no jobs available
    END IF;

    -- Log run start
    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id)
    VALUES (v_claimed_tenant, v_claimed_id, 'STARTED', p_worker_id);

    -- Return the claimed job row
    job_id := v_claimed_id;
    tenant_id := v_claimed_tenant;
    job_type := v_claimed_type;
    payload := v_claimed_payload;
    attempts := v_claimed_attempts;
    RETURN NEXT;
END;
$$;

ALTER FUNCTION public.claim_next_job(text) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC, anon, authenticated;
-- service_role only (no GRANT to authenticated)

-- Complete job (success or fail)
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

    UPDATE t_jobs
    SET status = p_status,
        completed_at = now(),
        result = p_result,
        error_code = p_error_code,
        error_message = p_error_message
    WHERE id = p_job_id
    RETURNING tenant_id INTO v_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND: %', p_job_id;
    END IF;

    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id, duration_ms, log_message)
    VALUES (v_tenant_id, p_job_id, p_status, p_worker_id, p_duration_ms,
            CASE WHEN p_status = 'FAILED' THEN p_error_message ELSE NULL END);
END;
$$;

ALTER FUNCTION public.complete_job(uuid, text, jsonb, text, text, text, int) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.complete_job(uuid, text, jsonb, text, text, text, int) FROM PUBLIC, anon, authenticated;
-- service_role only (no GRANT to authenticated)
