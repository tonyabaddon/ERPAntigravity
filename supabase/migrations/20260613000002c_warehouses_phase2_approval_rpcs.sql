-- supabase/migrations/20260613000002c_warehouses_phase2_approval_rpcs.sql
-- Phase 2c of configurable warehouses: rewrite the two approval-flow commit
-- RPCs to read warehouse_id from their satellite tables instead of the legacy
-- text 'warehouse' column, and mutate stock_levels instead of stocks.stock_atas
-- / stocks.stock_bawah.
--
-- WHAT CHANGES:
--   commit_approved_adjustment:
--     • Reads warehouse_id from stock_adjustments (nullable; guard + actionable
--       error if NULL/legacy-unbackfilled).
--     • Captures qty_before from stock_levels WHERE (sku, warehouse_id) instead
--       of format()-based stocks.stock_<warehouse> dynamic column access.
--     • UPDATEs stock_levels SET qty = qty + qty_delta instead of stocks.
--     • Uses BIGINT-id ledger pattern: captures _log_stock_movement id, then
--       UPDATE stock_movements SET warehouse_id = v_sa.warehouse_id.
--
--   commit_opname:
--     • FOR loop now selects warehouse_id from stock_opname_counts (uuid) in
--       addition to sku, variance, etc.
--     • For each varianced row: captures qty_before from stock_levels, updates
--       stock_levels SET qty = qty + variance (replaces EXECUTE format(..stocks)).
--     • Uses BIGINT-id ledger pattern per-row inside the loop.
--     • Returns INT (same as original — do NOT change return type).
--
-- WHAT DOES NOT CHANGE:
--   • Approval-gate lock (SELECT … FOR UPDATE on approval_requests, assert
--     status='approved') is byte-identical.
--   • Session-lock pattern in commit_opname is byte-identical.
--   • Per-count row ordering and zero/NULL-variance filters are byte-identical.
--   • reject_adjustment is NOT touched (no stock writes, no change needed).
--   • All RAISE messages that were Indonesian stay Indonesian.
--   • SECURITY DEFINER + SET search_path = public + GRANT authenticated.

-- ─── commit_approved_adjustment ─────────────────────────────────────────────

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

  -- Step 3: guard against legacy un-backfilled row, then capture qty_before
  -- under row lock from stock_levels.
  IF v_sa.warehouse_id IS NULL THEN
    RAISE EXCEPTION
      'stock_adjustment % missing warehouse_id (legacy un-backfilled row — jalankan backfill dulu)',
      v_sa.id;
  END IF;

  SELECT qty INTO v_before
    FROM public.stock_levels
   WHERE sku = v_sa.sku
     AND warehouse_id = v_sa.warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SKU % belum ada di stock_levels untuk warehouse %',
      v_sa.sku, v_sa.warehouse_id;
  END IF;

  -- Step 4: guard against negative stock.
  IF v_before + v_sa.qty_delta < 0 THEN
    RAISE EXCEPTION
      'adjustment would drive stock negative (before=%, delta=%)',
      v_before, v_sa.qty_delta;
  END IF;

  -- Step 5: apply the stock_levels mutation.
  UPDATE public.stock_levels
     SET qty        = qty + v_sa.qty_delta,
         updated_at = now()
   WHERE sku          = v_sa.sku
     AND warehouse_id = v_sa.warehouse_id;

  -- Step 6: write the ledger row through the Phase 1 helper, then stamp
  -- warehouse_id using the BIGINT-id pattern (p_warehouse is passed NULL
  -- because the legacy text column is deprecated in Migration 3).
  v_movement_id := public._log_stock_movement(
    p_sku              => v_sa.sku,
    p_warehouse        => NULL,
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
  UPDATE public.stock_movements
     SET warehouse_id = v_sa.warehouse_id
   WHERE id = v_movement_id;

  -- Step 7: close the satellite row.
  UPDATE public.stock_adjustments
     SET status                = 'approved',
         committed_at          = now(),
         committed_movement_id = v_movement_id
   WHERE id = v_sa.id;

  RETURN v_movement_id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_adjustment(BIGINT) TO authenticated;

-- ─── commit_opname ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar               RECORD;
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT    := 0;
  v_movement_id      BIGINT;
  v_qty_before       INT;
BEGIN
  -- Gate check: approval_requests row must already be 'approved' (the Owner
  -- has flipped it via _transition_approval). Lock the row to serialize
  -- against concurrent commit attempts on the same approval.
  SELECT * INTO v_ar FROM public.approval_requests
    WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  -- Find the linked opname session. Lock it FOR UPDATE so a concurrent
  -- caller racing on the same approval is serialized at the session-row
  -- level too (defence in depth on top of the AR lock).
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)',
      v_session.id, v_session.status;
  END IF;

  -- Walk every varianced row. Zero-variance rows (counted_qty matched
  -- snapshot exactly) are filtered out. counted_qty IS NULL rows (counter
  -- never entered a count for this sku × warehouse) are also skipped.
  FOR r IN
    SELECT sku, warehouse_id, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id    = v_session.id
       AND counted_qty   IS NOT NULL
       AND variance      <> 0
  LOOP
    -- Guard against un-backfilled legacy rows in the counts table.
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION
        'stock_opname_counts row for sku % in session % missing warehouse_id (legacy un-backfilled row)',
        r.sku, v_session.id;
    END IF;

    -- Capture qty_before from stock_levels under row lock. qty_before for
    -- the ledger is the system_qty_snapshot (what the count was taken
    -- against), NOT the current live qty — they should be equal at commit
    -- time but the snapshot is the truthful audit baseline.
    SELECT qty INTO v_qty_before
      FROM public.stock_levels
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'SKU % belum ada di stock_levels untuk warehouse %',
        r.sku, r.warehouse_id;
    END IF;

    -- Apply the stock_levels mutation.
    UPDATE public.stock_levels
       SET qty        = qty + r.variance,
           updated_at = now()
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id;

    -- Write the ledger row via the Phase 1 chokepoint, then stamp
    -- warehouse_id using the BIGINT-id pattern.
    v_movement_id := public._log_stock_movement(
      p_sku              => r.sku,
      p_warehouse        => NULL,
      p_qty_delta        => r.variance,
      p_qty_before       => r.system_qty_snapshot,
      p_source           => 'opname_variance'::public.stock_movement_source,
      p_related_doc_type => 'opname_session',
      p_related_doc_id   => v_session.id::text,
      p_reason_code      => 'opname',
      p_reason_note      => NULL,
      p_actor_user_id    => v_session.counted_by_user_id,
      p_actor_role       => 'opname_commit',
      p_evidence_urls    => '{}'::text[]
    );
    UPDATE public.stock_movements
       SET warehouse_id = r.warehouse_id
     WHERE id = v_movement_id;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  -- Finalize: flip the session to committed and stamp the timestamp. The
  -- approval_requests row STAYS at 'approved' (it's the gate, not the
  -- satellite status); only the session moves to its terminal state.
  UPDATE public.stock_opname_sessions
     SET status       = 'committed',
         committed_at = now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname(BIGINT) TO authenticated;
