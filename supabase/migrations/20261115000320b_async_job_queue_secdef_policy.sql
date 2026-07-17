-- P2-E follow-up: add vosi_rpc_owner bypass policy to t_jobs and t_job_runs
-- so claim_next_job (SECDEF owned by vosi_rpc_owner) can read/write rows.
-- Follows the pattern from migration 318 (t_tenant_cost_daily) and
-- memory: secdef_returning_gap.

-- t_jobs: vosi_rpc_owner needs to SELECT (for claim subquery) and UPDATE (claim)
DROP POLICY IF EXISTS "t_jobs_secdef_owner" ON public.t_jobs;
CREATE POLICY "t_jobs_secdef_owner" ON public.t_jobs
  FOR ALL TO vosi_rpc_owner
  USING (true)
  WITH CHECK (true);

-- t_job_runs: vosi_rpc_owner needs to INSERT run log entries
DROP POLICY IF EXISTS "t_job_runs_secdef_owner" ON public.t_job_runs;
CREATE POLICY "t_job_runs_secdef_owner" ON public.t_job_runs
  FOR ALL TO vosi_rpc_owner
  USING (true)
  WITH CHECK (true);
