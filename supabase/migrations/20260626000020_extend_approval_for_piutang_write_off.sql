-- 20260626000020_extend_approval_for_piutang_write_off.sql
-- Phase 1C task 2 — Piutang write-off groundwork.
-- (a) Register new approval_request_type value.
-- (b) Create satellite table holding the narrative reason.
-- (c) BEFORE INSERT trigger: at most one PENDING write-off per order.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'piutang_write_off';

CREATE TABLE IF NOT EXISTS public.piutang_write_off_requests (
  approval_id BIGINT PRIMARY KEY
              REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  order_id    UUID NOT NULL REFERENCES public.orders(id),
  reason      TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_piutang_write_off_requests_order
  ON public.piutang_write_off_requests(order_id);

-- Enforce "at most one pending write-off request per order".
--
-- Originally planned as a partial unique index:
--   CREATE UNIQUE INDEX ... ON piutang_write_off_requests(order_id)
--   WHERE approval_id IN (SELECT id FROM approval_requests WHERE status='pending');
-- Postgres rejects subqueries inside index predicates (SQLSTATE 0A000:
-- "cannot use subquery in index predicate"). Fallback chosen per plan: a
-- BEFORE INSERT trigger that raises WRITE_OFF_ALREADY_PENDING when a row
-- already exists for the same order_id whose approval is still 'pending'.
-- Plain UNIQUE(order_id) would block resubmission after rejection, so the
-- trigger checks the live status of the linked approval_requests row.
CREATE OR REPLACE FUNCTION public.piutang_write_off_guard_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.piutang_write_off_requests w
      JOIN public.approval_requests a ON a.id = w.approval_id
     WHERE w.order_id = NEW.order_id
       AND a.status = 'pending'
       AND w.approval_id <> NEW.approval_id
  ) THEN
    RAISE EXCEPTION 'WRITE_OFF_ALREADY_PENDING'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_piutang_write_off_guard_pending
  ON public.piutang_write_off_requests;
CREATE TRIGGER trg_piutang_write_off_guard_pending
  BEFORE INSERT ON public.piutang_write_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.piutang_write_off_guard_pending();

GRANT SELECT, INSERT ON public.piutang_write_off_requests TO authenticated;

COMMENT ON TABLE public.piutang_write_off_requests IS
  'Satellite for approval_requests of type piutang_write_off. Carries the narrative reason.';
COMMENT ON FUNCTION public.piutang_write_off_guard_pending() IS
  'BEFORE INSERT guard: raises WRITE_OFF_ALREADY_PENDING when another pending write-off request exists for the same order. Replaces planned partial unique index (Postgres rejects subqueries in index predicates).';
