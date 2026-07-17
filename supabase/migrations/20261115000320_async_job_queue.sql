-- P2-E: Async job infrastructure — Postgres-backed queue
-- Zero-cost, tenant-scoped, poll-based worker.
-- Migration slot: 320

CREATE TABLE IF NOT EXISTS t_jobs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    job_type text NOT NULL,               -- 'export_data' | 'import_data' | 'reindex_opname' | future types
    status text NOT NULL DEFAULT 'QUEUED', -- QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELED
    priority int NOT NULL DEFAULT 100,     -- lower = higher priority
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,  -- job-specific input
    result jsonb,                          -- job-specific output on success
    error_code text,                       -- on failure
    error_message text,                    -- on failure
    created_by uuid,                       -- user_id who submitted
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    attempts int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 3,
    idempotency_key text,                  -- optional: prevent duplicate submissions

    PRIMARY KEY (tenant_id, id),
    CONSTRAINT t_jobs_status_valid CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED')),
    CONSTRAINT t_jobs_idem_unique UNIQUE (tenant_id, job_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_t_jobs_status_priority
    ON t_jobs (status, priority, created_at)
    WHERE status IN ('QUEUED', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_t_jobs_tenant_status
    ON t_jobs (tenant_id, status, created_at DESC);

COMMENT ON TABLE t_jobs IS 'P2-E: async job queue. Tenant-scoped. Worker polls status=QUEUED ordered by priority,created_at.';

-- RLS: tenant reads own jobs; platform_admin reads all
ALTER TABLE t_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "t_jobs_tenant_select" ON t_jobs;
CREATE POLICY "t_jobs_tenant_select" ON t_jobs
    FOR SELECT TO authenticated
    USING (tenant_id = public._resolve_tenant_id());

DROP POLICY IF EXISTS "t_jobs_admin_select" ON t_jobs;
CREATE POLICY "t_jobs_admin_select" ON t_jobs
    FOR SELECT TO authenticated
    USING (public.is_platform_admin());

-- Writes go through SECDEF RPCs — no direct client insert/update
GRANT SELECT ON t_jobs TO authenticated;

-- vosi_rpc_owner bypass: SECDEF RPCs (claim_next_job, complete_job, enqueue_job)
-- run as vosi_rpc_owner; they need full access to t_jobs and t_job_runs.
-- Pattern: same as t_tenant_cost_daily in migration 318 (memory: secdef_returning_gap).
DROP POLICY IF EXISTS "t_jobs_secdef_owner" ON t_jobs;
CREATE POLICY "t_jobs_secdef_owner" ON t_jobs
  FOR ALL TO vosi_rpc_owner
  USING (true)
  WITH CHECK (true);

-- Job run log for debugging + observability (append-only)
CREATE TABLE IF NOT EXISTS t_job_runs (
    id bigserial PRIMARY KEY,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    run_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL,  -- STARTED | SUCCEEDED | FAILED
    worker_id text,        -- hostname or Cloud Run instance ID
    duration_ms int,
    log_message text
);

CREATE INDEX IF NOT EXISTS idx_t_job_runs_job ON t_job_runs (job_id, run_at DESC);

ALTER TABLE t_job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "t_job_runs_tenant_select" ON t_job_runs;
CREATE POLICY "t_job_runs_tenant_select" ON t_job_runs
    FOR SELECT TO authenticated
    USING (tenant_id = public._resolve_tenant_id());
GRANT SELECT ON t_job_runs TO authenticated;

-- vosi_rpc_owner bypass for t_job_runs (INSERT from claim_next_job/complete_job)
DROP POLICY IF EXISTS "t_job_runs_secdef_owner" ON t_job_runs;
CREATE POLICY "t_job_runs_secdef_owner" ON t_job_runs
  FOR ALL TO vosi_rpc_owner
  USING (true)
  WITH CHECK (true);
