-- Stock Fraud Prevention Phase 2 Task 4: commit_approved_adjustment +
-- reject_adjustment RPCs.
--
-- These are the two RPCs that close out the adjustment approval flow opened by
-- request_adjustment (Task 3 …009). They are SECURITY DEFINER and routed
-- through the established encapsulation primitives:
--
--   * _transition_approval (Task 1 …007) is the ONLY sanctioned path to flip
--     approval_requests.status. The commit/reject RPCs in this file do NOT
--     UPDATE approval_requests directly — that's done out-of-band by the
--     caller (Owner PIN RPC, WA-button webhook handler, or app-inbox button).
--     This RPC just verifies the state has already been transitioned and then
--     mutates stock + the satellite stock_adjustments row.
--
--   * _log_stock_movement (Phase 1 …001b) is the ONLY sanctioned path to write
--     a stock_movements row. commit_approved_adjustment hands it the SKU,
--     warehouse, qty_delta, the qty_before captured under the SELECT…FOR
--     UPDATE row lock, source='adjustment', and the related-doc pointer back
--     to stock_adjustments.id so a ledger drill-down lands on the request.
--
-- COMMIT FLOW (commit_approved_adjustment):
--   1. Row-lock approval_requests for the given id and assert status='approved'.
--      If still pending we raise 'not approved' — the test asserts that exact
--      string. The lock prevents a concurrent reject from flipping the gate
--      out from under us mid-commit.
--   2. Row-lock the satellite stock_adjustments row, assert it has not already
--      been committed (committed_at IS NULL), and pull the qty_before by
--      row-locking the stocks row too.
--   3. Update stocks.stock_<warehouse> using format()+EXECUTE because the
--      column name is data-dependent. Guard against negative stock — even an
--      approved adjustment should not drive inventory below zero (an Owner
--      keying a wrong number is a foreseeable mistake).
--   4. Write ONE ledger row via _log_stock_movement with the source enum value
--      'adjustment' and the SKU's reason_code carried through verbatim. The
--      adjustment's evidence_urls flow into the ledger too so the audit drill
--      surfaces the same photos the Owner approved.
--   5. UPDATE the satellite row: status='approved', committed_at=now(),
--      committed_movement_id=<the id returned by _log_stock_movement>.
--
-- REJECT FLOW (reject_adjustment):
--   1. Row-lock approval_requests for the id. We do NOT require status='rejected'
--      here — the caller may transition the gate first (preferred) or after
--      (legacy app-inbox path). We accept either order so the satellite row
--      can be marked rejected even if the gate flip happened in a separate
--      transaction.
--   2. UPDATE the satellite stock_adjustments row to status='rejected' and
--      append/replace the reason_note. No stocks write. No ledger row. Once
--      rejected the satellite stays terminal and committed_at stays NULL —
--      that's how a downstream report tells reject apart from an expired or
--      stillborn request.
--
-- NUMBERING: Phase 2 Tasks 1-3 took …007/…008/…009. This is …010 because past
-- migrations are immutable in this project — appending DDL to Task 2's …008
-- file would not re-run on the live DB. Subsequent Phase 2 tasks shift forward.

CREATE OR REPLACE FUNCTION public.commit_approved_adjustment(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa          RECORD;
  v_ar          RECORD;
  v_before      INT;
  v_movement_id BIGINT;
BEGIN
  -- Step 1: lock and verify the approval gate.
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  -- Step 2: lock the satellite row and guard against double-commit.
  SELECT * INTO v_sa
    FROM public.stock_adjustments
   WHERE approval_request_id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no stock_adjustment for approval_request %', p_approval_id;
  END IF;
  IF v_sa.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_adjustment % already committed', v_sa.id;
  END IF;

  -- Step 3: capture qty_before under row lock; guard against negative stock.
  EXECUTE format(
    'SELECT stock_%I FROM public.stocks WHERE sku=$1 FOR UPDATE',
    v_sa.warehouse
  ) INTO v_before USING v_sa.sku;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sku % not found in stocks', v_sa.sku;
  END IF;
  IF v_before + v_sa.qty_delta < 0 THEN
    RAISE EXCEPTION 'adjustment would drive stock negative (before=%, delta=%)',
      v_before, v_sa.qty_delta;
  END IF;

  -- Step 4: write the stocks UPDATE — column name is data-dependent so we
  -- have to format() it, but the value flows through a parameter.
  EXECUTE format(
    'UPDATE public.stocks SET stock_%I = stock_%I + $2 WHERE sku=$1',
    v_sa.warehouse, v_sa.warehouse
  ) USING v_sa.sku, v_sa.qty_delta;

  -- Step 5: write the ledger row through the Phase 1 helper. source='adjustment'
  -- pins the audit story; related_doc_type/id let the drill-down land on the
  -- specific stock_adjustments row. evidence_urls + reason_code are carried
  -- verbatim from the satellite so the photos the Owner approved show up in
  -- the ledger drawer too.
  v_movement_id := public._log_stock_movement(
    p_sku              => v_sa.sku,
    p_warehouse        => v_sa.warehouse,
    p_qty_delta        => v_sa.qty_delta,
    p_qty_before       => v_before,
    p_source           => 'adjustment'::public.stock_movement_source,
    p_related_doc_type => 'stock_adjustment',
    p_related_doc_id   => v_sa.id::text,
    p_reason_code      => v_sa.reason_code::text,
    p_reason_note      => v_sa.reason_note,
    p_actor_user_id    => v_sa.requested_by,
    p_actor_role       => 'adjustment_commit',
    p_evidence_urls    => v_sa.evidence_urls
  );

  -- Step 6: close the satellite row.
  UPDATE public.stock_adjustments
     SET status                = 'approved',
         committed_at          = now(),
         committed_movement_id = v_movement_id
   WHERE id = v_sa.id;

  RETURN v_movement_id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_adjustment(BIGINT) TO authenticated;


CREATE OR REPLACE FUNCTION public.reject_adjustment(
  p_approval_id BIGINT,
  p_reason_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar RECORD;
BEGIN
  -- Lock the approval row to serialize with concurrent commit attempts. We do
  -- NOT require status='rejected' here — the gate transition is the caller's
  -- responsibility (Owner PIN RPC / WA-button webhook), and the satellite
  -- close-out is a separate concern. If the gate hasn't been flipped yet the
  -- next commit attempt will still observe status='pending' and refuse.
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;

  -- Flip the satellite. The committed_at IS NULL guard prevents rewriting a
  -- terminal already-committed row (defensive; the gate lock above should
  -- already prevent the race, but layered guards are cheap).
  UPDATE public.stock_adjustments
     SET status      = 'rejected',
         reason_note = COALESCE(p_reason_note, reason_note)
   WHERE approval_request_id = p_approval_id
     AND committed_at IS NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.reject_adjustment(BIGINT, TEXT) TO authenticated;
