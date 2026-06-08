-- Phase 2 / Task 14 — decide_via_wa_button + expire_pending_approvals RPCs.
--
-- Two SECURITY DEFINER functions that flip approval_requests state through the
-- ONLY sanctioned channel — public._transition_approval (see …007). Both
-- functions are owned by postgres so they preserve the privilege needed to
-- run the helper, which is REVOKE'd from anon / authenticated by design.
--
--   1. decide_via_wa_button(p_approval_request_id BIGINT,
--                           p_decision TEXT,
--                           p_decided_by_user_id UUID) RETURNS BIGINT
--      The SQL hop behind the Owner's WhatsApp button click. Calista's WA
--      webhook handler (Go) authenticates the payload signature then invokes
--      this RPC under the authenticated role; the RPC itself does the role
--      check against admin_users so the trust boundary stays inside Postgres.
--
--      Steps:
--        (a) Validate p_decision ∈ ('approved','rejected'). Anything else
--            raises BEFORE any state read — narrowest possible validator.
--        (b) Verify the caller is an Owner: EXISTS in admin_users WHERE
--            id = p_decided_by_user_id AND role = 'Owner'. If not, raise
--            'not authorized'. This is the SAME authority gate as the in-app
--            Owner PIN modal — the WA button is just a different channel for
--            the same Owner identity.
--        (c) Call _transition_approval(.., p_decision::approval_status,
--            p_decided_by_user_id, 'wa_button'). The helper itself enforces
--            "row is pending" (raises 'not pending or does not exist') so we
--            don't duplicate that check here.
--        (d) RETURN p_approval_request_id so the Go caller has a stable
--            handle for the audit log and for any subsequent commit RPC.
--
--      Grants: EXECUTE TO authenticated — the Go handler runs under the
--      authenticated role after JWT verification (consistent with
--      verify_owner_pin's grant in …019).
--
--   2. expire_pending_approvals() RETURNS INT
--      Auto-expiry sweeper. The Go backend's poller (one process per
--      deployment, runs under service_role) calls this every minute to flip
--      any pending row whose expires_at window has elapsed. Per
--      approval_requests' design (default expires_at = now() + 30m), this is
--      the bulk-flip path for that timer.
--
--      Iterates SELECT id FROM approval_requests WHERE status='pending' AND
--      expires_at <= now(); calls _transition_approval(id, 'expired', NULL,
--      'auto_expire') per row. The per-row call (vs. a batch UPDATE) is
--      deliberate: it preserves the "_transition_approval is the SOLE
--      sanctioned UPDATE path" invariant from …007. The cost is one PL/pgSQL
--      iteration per row — negligible at MSME scale where the sweeper
--      processes ≪ 100 rows per call.
--
--      Concurrent flips: if a row races between our SELECT and the helper's
--      WHERE id=$1 AND status='pending', the helper raises. We catch + skip
--      so one racing decision doesn't poison the rest of the sweep.
--
--      Grants: EXECUTE TO service_role only. Client SDKs have no business
--      kicking auto-expiry — the timer is a backend concern.
--
-- search_path pinned to public (no pgcrypto needed) — both bodies only touch
-- approval_requests + admin_users which live in public.

CREATE OR REPLACE FUNCTION public.decide_via_wa_button(
  p_approval_request_id BIGINT,
  p_decision            TEXT,
  p_decided_by_user_id  UUID
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- (a) Input validation: narrow allow-list at the door.
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %: must be approved or rejected', p_decision;
  END IF;

  -- (b) Owner role check against admin_users. A non-Owner caller (including
  -- a phantom uuid that does not match any admin_users row) is rejected with
  -- the canonical 'not authorized' message — the UI / log surface should not
  -- distinguish "wrong role" from "no such admin" for the same reason
  -- verify_owner_pin doesn't leak whether the PIN was wrong vs. locked.
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = p_decided_by_user_id
       AND role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'not authorized: caller is not an Owner';
  END IF;

  -- (c) Flip the gate via the sole sanctioned helper. _transition_approval
  -- itself enforces status='pending' and raises on a settled row, so we
  -- inherit double-decision safety for free.
  PERFORM public._transition_approval(
    p_approval_request_id,
    p_decision::public.approval_status,
    p_decided_by_user_id,
    'wa_button'
  );

  -- (d) Return the id so the Go caller has a stable handle.
  RETURN p_approval_request_id;
END $$;

GRANT EXECUTE ON FUNCTION public.decide_via_wa_button(BIGINT, TEXT, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.expire_pending_approvals()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    RECORD;
  v_count  INT := 0;
BEGIN
  -- Per-row loop preserves "_transition_approval is the SOLE sanctioned
  -- UPDATE path" invariant from …007. A direct bulk UPDATE here would
  -- bypass that contract even though the table-level trigger is disabled.
  FOR v_row IN
    SELECT id
      FROM public.approval_requests
     WHERE status = 'pending'
       AND expires_at <= now()
  LOOP
    BEGIN
      PERFORM public._transition_approval(
        v_row.id,
        'expired'::public.approval_status,
        NULL,         -- no human decided this; auto-expiry has no actor
        'auto_expire'
      );
      v_count := v_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        -- Concurrent decision (e.g. an Owner PIN approval landed between
        -- our SELECT and the helper's WHERE) raises out of the helper.
        -- Skip and keep sweeping — one racing flip doesn't poison the rest.
        CONTINUE;
    END;
  END LOOP;

  RETURN v_count;
END $$;

-- Strip every default grant: only service_role (where the Go poller runs)
-- should be able to invoke auto-expiry. Client SDKs have no business here.
REVOKE EXECUTE ON FUNCTION public.expire_pending_approvals() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_pending_approvals() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_pending_approvals() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_pending_approvals() TO service_role;
