-- P2-E Fix wave 2: claim_next_job ambiguous column reference
--
-- Root cause: RETURNS TABLE (job_id, tenant_id, ...) creates OUT params
-- with the same names as t_job_runs columns. The INSERT INTO t_job_runs
-- (tenant_id, job_id, ...) fails column-name resolution because plpgsql
-- can't disambiguate between the target table column and the OUT param.
--
-- Symptom (2026-07-17 prod incident):
--   log: pq: column reference "tenant_id" is ambiguous;
--        message=[JOBS] claim_next_job scan failed
--   every worker poll (5s cycle) → jobs stuck in QUEUED indefinitely.
--
-- Fix: add `#variable_conflict use_column` directive so plpgsql prefers
-- column references over variable names inside SQL statements. Standard
-- Postgres idiom for functions that must reference table columns whose
-- names collide with OUT params.
--
-- Migration slot: 323. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS TABLE (job_id uuid, tenant_id uuid, job_type text, payload jsonb, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_claimed_tenant uuid;
    v_claimed_id uuid;
BEGIN
    -- Pick the next QUEUED job, locking with SKIP LOCKED for multi-instance safety.
    SELECT j.tenant_id, j.id
    INTO v_claimed_tenant, v_claimed_id
    FROM t_jobs j
    WHERE j.status = 'QUEUED'
    ORDER BY j.priority ASC, j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_claimed_id IS NULL THEN
        RETURN;
    END IF;

    -- Update using full composite PK (tenant_id, id).
    UPDATE t_jobs j
    SET status = 'RUNNING',
        started_at = now(),
        attempts = j.attempts + 1
    WHERE j.tenant_id = v_claimed_tenant AND j.id = v_claimed_id;

    -- Log run start. Column names here refer to t_job_runs (use_column directive).
    INSERT INTO t_job_runs (tenant_id, job_id, status, worker_id)
    VALUES (v_claimed_tenant, v_claimed_id, 'STARTED', p_worker_id);

    -- Return the claimed job. Fully qualified — no ambiguity.
    RETURN QUERY
    SELECT j.id, j.tenant_id, j.job_type, j.payload, j.attempts
    FROM t_jobs j
    WHERE j.tenant_id = v_claimed_tenant AND j.id = v_claimed_id;
END;
$$;

ALTER FUNCTION public.claim_next_job(text) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.claim_next_job(text) FROM PUBLIC, anon, authenticated;
