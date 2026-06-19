-- 20260626000005_audit_log_request_and_approve_rakit_lock.sql
-- Phase 1B follow-up to PR #27: fix RiwayatPersetujuanPanel rendering empty
-- when an order is at 3g/3h via the admin-submit + plain-Owner-approve path.
--
-- PR #27 spec promised audit_log events for all 4 transition paths:
--   * rakit_lock_requested            ← request_rakit_lock (MISSING — added here)
--   * rakit_lock_approved             ← commit_approved_rakit_lock (MISSING — added here)
--   * rakit_lock_approved_with_edit   ← approve_and_amend_rakit_lock (already in migration 004)
--   * rakit_lock_rejected             ← reject_rakit_lock (already in migration 003)
--
-- This migration extends the first two RPCs with INSERTs. Both are idempotent
-- CREATE OR REPLACE; bodies copy the post-migration-001/002 versions verbatim
-- and append a single INSERT INTO audit_log.
--
-- Duplicate-event guard on commit: when approve_and_amend_rakit_lock delegates
-- to commit_approved_rakit_lock, it has already inserted a
-- 'rakit_lock_approved_with_edit' row. To avoid double-logging, the commit
-- INSERT here checks decision_channel: skip if it equals 'owner_app_edit'.

CREATE OR REPLACE FUNCTION public.request_rakit_lock(
  p_transaction_id  UUID,
  p_lines           JSONB,
  p_actor_user_id   UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor    UUID;
  v_status   TEXT;
  v_approval BIGINT;
  v_lock_req BIGINT;
  v_payload  JSONB;
  v_line     JSONB;
  v_line_id  UUID;
  v_comp     JSONB;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'WIP' THEN
    RAISE EXCEPTION 'request_rakit_lock: transaction % is in status %, expected WIP', p_transaction_id, v_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO rakit_components (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES (v_line_id, v_comp->>'sku', v_comp->>'name',
                (v_comp->>'qty')::NUMERIC,
                COALESCE(v_comp->>'warehouse', 'atas'),
                COALESCE((v_comp->>'fifo_cost')::NUMERIC, 0));
      END LOOP;
    END IF;
  END LOOP;

  v_payload := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'lines_count',    jsonb_array_length(p_lines)
  );

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES ('rakit_lock'::approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO rakit_lock_requests
    (transaction_id, approval_request_id, lines_snapshot, requested_by)
  VALUES (p_transaction_id, v_approval, p_lines, v_actor)
  RETURNING id INTO v_lock_req;

  UPDATE kasir_transactions SET status = 'PENDING_LOCK_APPROVAL' WHERE id = p_transaction_id;

  -- Migration 001 added: advance Sales funnel to 3g atomically.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3g'
   WHERE id = p_transaction_id;

  -- Migration 005 adds: audit_log entry so RiwayatPersetujuanPanel can render
  -- the "Admin submit" event in the funnel UI at 3g/3h.
  INSERT INTO public.audit_log(event_type, actor_user_id, payload)
  VALUES (
    'rakit_lock_requested',
    v_actor,
    jsonb_build_object(
      'approval_id', v_approval,
      'order_id', p_transaction_id,
      'admin_submitted', p_lines
    )
  );

  RETURN v_approval;
END $$;
GRANT EXECUTE ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) TO authenticated;


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

    ELSE
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

  -- Migration 002 added: advance Sales funnel to 3h atomically.
  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3h'
   WHERE id = v_tx_id;

  -- Migration 005 adds: audit_log entry for plain approve path. Skip when the
  -- approval was decided via owner_app_edit because approve_and_amend_rakit_lock
  -- (migration 004) already wrote a 'rakit_lock_approved_with_edit' event.
  IF v_ar.decision_channel IS DISTINCT FROM 'owner_app_edit' THEN
    INSERT INTO public.audit_log(event_type, actor_user_id, payload)
    VALUES (
      'rakit_lock_approved',
      v_ar.decided_by,
      jsonb_build_object(
        'approval_id', p_approval_id,
        'order_id', v_tx_id,
        'decision_channel', v_ar.decision_channel
      )
    );
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) TO authenticated;
