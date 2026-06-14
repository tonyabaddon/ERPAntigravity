-- Stok Opname Blind-Count — supporting infra:
-- Generic audit_log table for cross-module forensic events.
--
-- Used by opname_auto_commit / opname_owner_commit / opname_owner_reject
-- (Tasks 6 + 8) and the Pengawasan Catatan Audit Opname UI (Task 17).
-- Designed to support future event types beyond opname; payload is JSONB
-- so each event family can carry its own structure.
--
-- Why a new generic table (vs. extending warehouse_audit_log):
--   warehouse_audit_log mandates warehouse_id (NOT NULL) and has fixed
--   before/after slots — wrong shape for opname events that span N
--   warehouses and carry counter/witness names. A dedicated event-typed
--   log is cleaner.
--
-- RLS: not enabled here; only SECURITY DEFINER RPCs will INSERT. Reads
-- exposed via dedicated RPCs (Task 17) with Owner-only role check.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,
  actor_user_id UUID,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_event_type
  ON public.audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON public.audit_log (actor_user_id, created_at DESC);
