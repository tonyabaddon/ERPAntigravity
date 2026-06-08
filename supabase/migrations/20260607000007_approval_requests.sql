-- Stock Fraud Prevention Phase 2 Task 1: approval_requests table + state-
-- transition helper.
--
-- One table is the single source of truth for every Owner approval gate:
-- adjustment, opname, price_change, kasir_price_override, kasir_void,
-- kasir_refund. Three satellite tables (stock_adjustments, stock_opname_*,
-- price_change_requests) each carry their own payload and FK to this row.
--
-- IMMUTABILITY TRADE-OFF (different from Phase 1 stock_movements!):
--
-- Unlike stock_movements which is strictly append-only with BOTH triggers
-- enabled, approval_requests legitimately UPDATES on state transitions
-- (pending → approved/rejected/expired). To allow this without giving up
-- defense-in-depth on the client surface, we:
--
--   * REVOKE UPDATE, DELETE from PUBLIC, anon, authenticated → blocks every
--     non-service-role client at the privilege layer.
--   * Create trg_deny_ar_update but DISABLE it at the table level so the
--     _transition_approval SECURITY DEFINER helper (owned by postgres) can
--     execute the legitimate state moves. The trigger definition stays in
--     place so it can be re-enabled in an emergency.
--   * Keep trg_deny_ar_delete ENABLED — there is NO legitimate DELETE path.
--     Even service_role cannot DELETE.
--
-- Per Foundational Decision #1: "service_role retains its bypass; the
-- workflow trust assumption is that the Go backend only writes via approved
-- RPCs." Every commit/reject/expire RPC in subsequent tasks calls
-- _transition_approval rather than UPDATE-ing directly.
--
-- NUMBERING: This file is …007 rather than the …006 the plan originally
-- proposed because Phase 1's wrap_decrement_stock migration claimed …006.
-- Subsequent Phase 2 tasks shift accordingly (stock_adjustments → …008, etc.).

CREATE TYPE public.approval_request_type AS ENUM (
  'adjustment',
  'opname',
  'price_change',
  'kasir_price_override',
  'kasir_void',
  'kasir_refund'
);

CREATE TYPE public.approval_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'expired'
);

CREATE TABLE public.approval_requests (
  id               BIGSERIAL PRIMARY KEY,
  request_type     public.approval_request_type NOT NULL,
  payload          JSONB NOT NULL,
  requested_by     UUID NOT NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  status           public.approval_status NOT NULL DEFAULT 'pending',
  decided_by       UUID,
  decided_at       TIMESTAMPTZ,
  decision_channel TEXT,  -- 'wa_button' | 'owner_pin' | 'app_inbox' | 'auto_expire'
  wa_message_id    TEXT
);

CREATE INDEX idx_ar_status_expires ON public.approval_requests(status, expires_at);
CREATE INDEX idx_ar_requester      ON public.approval_requests(requested_by, requested_at DESC);
CREATE INDEX idx_ar_type_status    ON public.approval_requests(request_type, status);

-- Belt: column-level privilege REVOKE blocks anon + authenticated client roles.
REVOKE UPDATE, DELETE ON public.approval_requests FROM PUBLIC;
REVOKE UPDATE, DELETE ON public.approval_requests FROM anon;
REVOKE UPDATE, DELETE ON public.approval_requests FROM authenticated;
GRANT  SELECT          ON public.approval_requests TO authenticated;

-- Suspenders: trigger fires on UPDATE/DELETE even under service_role. The
-- UPDATE one is DISABLED below (see header note); the DELETE one stays
-- ENABLED so even a compromised service_role cannot purge history.
CREATE OR REPLACE FUNCTION public.deny_approval_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'approval_requests is append-only — state transitions must go through SECURITY DEFINER RPCs';
END $$;

CREATE TRIGGER trg_deny_ar_update BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.deny_approval_mutation();
CREATE TRIGGER trg_deny_ar_delete BEFORE DELETE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.deny_approval_mutation();

-- Disable the UPDATE trigger so legitimate state transitions via the
-- SECURITY DEFINER helper below can succeed. The DELETE trigger stays
-- enabled because no code path should ever DELETE a row.
ALTER TABLE public.approval_requests DISABLE TRIGGER trg_deny_ar_update;

-- _transition_approval: the SOLE sanctioned UPDATE path for approval_requests.
-- Subsequent Task 4 (commit_approved_adjustment), Task 8 (commit_opname),
-- Task 11 (expire_pending_approvals), etc. all call this helper rather than
-- UPDATE-ing the row directly. Owned by postgres; SECURITY DEFINER so RLS is
-- bypassed; search_path pinned to public to defeat shadowing attacks.
--
-- The WHERE clause filters status='pending' so a double-transition (e.g. two
-- approvers racing) raises rather than silently overwriting a settled row.
CREATE OR REPLACE FUNCTION public._transition_approval(
  p_id BIGINT,
  p_new_status public.approval_status,
  p_decided_by UUID,
  p_channel TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.approval_requests
     SET status           = p_new_status,
         decided_by       = p_decided_by,
         decided_at       = now(),
         decision_channel = p_channel
   WHERE id = p_id
     AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_requests % is not pending or does not exist', p_id;
  END IF;
END $$;

-- The helper is internal: only other SECURITY DEFINER RPCs in this codebase
-- should call it. Revoke from every client role so an SDK call cannot reach
-- it directly. (service_role / postgres still execute it by ownership.)
REVOKE EXECUTE ON FUNCTION public._transition_approval(BIGINT, public.approval_status, UUID, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._transition_approval(BIGINT, public.approval_status, UUID, TEXT)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public._transition_approval(BIGINT, public.approval_status, UUID, TEXT)
  FROM authenticated;
