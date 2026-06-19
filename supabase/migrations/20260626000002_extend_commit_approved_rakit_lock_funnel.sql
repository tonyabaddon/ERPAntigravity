-- 20260626000002_extend_commit_approved_rakit_lock_funnel.sql
-- Phase 1B follow-up: keeps Sales funnel position in sync after Owner approves
-- a rakit cost lock. Idempotent CREATE OR REPLACE. The only change vs
-- migration 20260609000010 is the single UPDATE near the end of the body.

CREATE OR REPLACE FUNCTION public.commit_approved_rakit_lock(
  p_approval_id    BIGINT,
  p_hpp_overrides  JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ar          RECORD;
  v_rr          RECORD;
  v_tx_id       UUID;
  v_dp          NUMERIC;
  v_total       NUMERIC;
  v_new_status  TEXT;
  v_line        RECORD;
  v_comp        RECORD;
  v_qty_before  INT;
  v_hpp_final   NUMERIC;
BEGIN
  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.status != 'approved' THEN
    RAISE EXCEPTION 'commit_approved_rakit_lock: approval % is in status %, expected approved', p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_rr FROM rakit_lock_requests WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF v_rr.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'commit_approved_rakit_lock: rakit_lock_request % already committed', v_rr.id;
  END IF;

  v_tx_id := v_rr.transaction_id;

  SELECT COALESCE(dp_amount, 0), total_amount INTO v_dp, v_total
  FROM kasir_transactions WHERE id = v_tx_id FOR UPDATE;

  v_new_status := CASE WHEN v_total - v_dp > 0 THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  FOR v_line IN SELECT * FROM rakit_job_lines WHERE transaction_id = v_tx_id LOOP
    IF v_line.tracking_mode = 'detail' THEN
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        (SELECT COALESCE(SUM(fifo_cost_snapshot), 0) FROM rakit_components WHERE rakit_line_id = v_line.id)
          + COALESCE(v_line.labor_cost, 0)
      );

      FOR v_comp IN SELECT * FROM rakit_components WHERE rakit_line_id = v_line.id LOOP
        SELECT CASE WHEN v_comp.warehouse = 'atas' THEN stock_atas ELSE stock_bawah END
          INTO v_qty_before
        FROM stocks WHERE sku = v_comp.sku FOR UPDATE;

        IF v_qty_before IS NULL OR v_qty_before < v_comp.qty THEN
          RAISE EXCEPTION 'commit_approved_rakit_lock: insufficient stock for SKU % in % (have %, need %)',
                          v_comp.sku, v_comp.warehouse, COALESCE(v_qty_before, 0), v_comp.qty;
        END IF;

        PERFORM public._log_stock_movement(
          p_sku              => v_comp.sku,
          p_warehouse        => v_comp.warehouse,
          p_qty_delta        => -v_comp.qty::INT,
          p_qty_before       => v_qty_before,
          p_source           => 'rakit_usage'::stock_movement_source,
          p_related_doc_type => 'rakit_lock_request',
          p_related_doc_id   => v_rr.id::TEXT,
          p_reason_code      => NULL,
          p_reason_note      => 'Pemakaian rakit ' || v_line.description,
          p_actor_user_id    => v_ar.decided_by,
          p_actor_role       => 'owner',
          p_evidence_urls    => NULL
        );

        UPDATE stocks
        SET stock_atas  = CASE WHEN v_comp.warehouse = 'atas'  THEN stock_atas  - v_comp.qty ELSE stock_atas  END,
            stock_bawah = CASE WHEN v_comp.warehouse = 'bawah' THEN stock_bawah - v_comp.qty ELSE stock_bawah END
        WHERE sku = v_comp.sku;
      END LOOP;

      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;

    ELSE  -- lumpsum
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        v_line.lump_sum_hpp
      );
      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  UPDATE rakit_lock_requests SET status = 'approved', committed_at = now() WHERE id = v_rr.id;
  UPDATE kasir_transactions  SET status = v_new_status WHERE id = v_tx_id;

  -- Phase 1B integration: advance Sales funnel to 3h atomically.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3h'
   WHERE id = v_tx_id;
END $$;
GRANT EXECUTE ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) IS
  'Owner-approved rakit lock commit. Writes stock_movements, locks HPP, sets kasir_transactions.status, and advances Sales funnel to 3h.';
