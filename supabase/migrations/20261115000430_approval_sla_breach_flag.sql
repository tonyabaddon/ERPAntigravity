-- Sprint 4 Task 4.3: Approval SLA breach alert dedup column.
-- Adds sla_breach_notified_at so the 15-min poller never sends a second alert
-- for an approval that has already been flagged as breached.
--
-- Migration slot 430. Idempotent.

ALTER TABLE public.approval_requests
  ADD COLUMN IF NOT EXISTS sla_breach_notified_at TIMESTAMPTZ;
