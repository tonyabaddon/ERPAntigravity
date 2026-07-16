-- Migration 310: Idempotency store table for SECDEF RPCs.
-- Stores (tenant_id, rpc_name, idempotency_key) → result_json so that
-- retried network calls are short-circuited at the DB layer.
-- TTL cleanup (>30d rows) deferred to Phase 2 cron job.
BEGIN;

CREATE TABLE IF NOT EXISTS t_rpc_idempotency (
  tenant_id uuid NOT NULL,
  rpc_name text NOT NULL,
  idempotency_key uuid NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rpc_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_rpc_idempotency_created
  ON t_rpc_idempotency (created_at);

ALTER TABLE t_rpc_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_rpc_idempotency_owner_all ON t_rpc_idempotency;
CREATE POLICY t_rpc_idempotency_owner_all ON t_rpc_idempotency
  FOR ALL TO vosi_rpc_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS t_rpc_idempotency_tenant_read ON t_rpc_idempotency;
CREATE POLICY t_rpc_idempotency_tenant_read ON t_rpc_idempotency
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

COMMENT ON TABLE t_rpc_idempotency IS
  'Idempotency store per (tenant_id, rpc_name, idempotency_key). Migration 310. TTL cleanup >30d deferred to Phase 2 job.';

COMMIT;
