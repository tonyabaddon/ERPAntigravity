-- supabase/migrations/20260614000009_approval_types_tempo.sql
-- Phase 1A: extend approval_request_type for tempo customer credit flow.
-- Reference: 20260607000007_approval_requests.sql created the enum.
-- ALTER TYPE ADD VALUE cannot run in a transaction block in older PG; use
-- standalone statements without BEGIN.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_activate';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_limit_change';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_deactivate';
