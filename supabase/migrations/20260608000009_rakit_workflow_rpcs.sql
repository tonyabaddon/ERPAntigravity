-- 20260608000009_rakit_workflow_rpcs.sql
-- RPCs for atomic state transitions on rakit workflow.

-- Helper: append audit log row
CREATE OR REPLACE FUNCTION public._rakit_audit(
  p_transaction_id UUID,
  p_rakit_line_id  UUID,
  p_action         TEXT,
  p_field_changed  TEXT,
  p_old_value      JSONB,
  p_new_value      JSONB,
  p_reason         TEXT,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.rakit_audit_log
    (transaction_id, rakit_line_id, action, field_changed, old_value, new_value, reason, actor_id, actor_role)
  VALUES
    (p_transaction_id, p_rakit_line_id, p_action, p_field_changed, p_old_value, p_new_value, p_reason, p_actor_id, p_actor_role)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- RPC: submit_rakit_lock — transition WIP → PENDING_LOCK_APPROVAL
CREATE OR REPLACE FUNCTION public.submit_rakit_lock(
  p_transaction_id UUID,
  p_lines          JSONB,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_status TEXT;
  v_line           JSONB;
  v_line_id        UUID;
  v_comp           JSONB;
BEGIN
  SELECT status INTO v_current_status FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_current_status != 'WIP' THEN
    RAISE EXCEPTION 'submit_rakit_lock: invalid current status %, expected WIP', v_current_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;

    UPDATE public.rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM public.rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO public.rakit_components
          (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES
          (v_line_id,
           v_comp->>'sku',
           v_comp->>'name',
           (v_comp->>'qty')::NUMERIC,
           COALESCE(v_comp->>'warehouse', 'atas'),
           (v_comp->>'fifo_cost')::NUMERIC);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.kasir_transactions
  SET status              = 'PENDING_LOCK_APPROVAL',
      lock_submitted_by   = p_actor_id,
      lock_submitted_at   = now(),
      lock_rejected_reason= NULL,
      lock_rejected_at    = NULL
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'submit', NULL,
    jsonb_build_object('status', 'WIP'),
    jsonb_build_object('status', 'PENDING_LOCK_APPROVAL'),
    NULL, p_actor_id, p_actor_role
  );
END $$;

-- RPC: withdraw_rakit_lock — PENDING_LOCK_APPROVAL → WIP
CREATE OR REPLACE FUNCTION public.withdraw_rakit_lock(
  p_transaction_id UUID,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_current_status TEXT;
BEGIN
  SELECT status INTO v_current_status FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_current_status != 'PENDING_LOCK_APPROVAL' THEN
    RAISE EXCEPTION 'withdraw_rakit_lock: invalid current status %, expected PENDING_LOCK_APPROVAL', v_current_status;
  END IF;

  UPDATE public.kasir_transactions
  SET status            = 'WIP',
      lock_submitted_by = NULL,
      lock_submitted_at = NULL
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'withdraw', NULL,
    jsonb_build_object('status', 'PENDING_LOCK_APPROVAL'),
    jsonb_build_object('status', 'WIP'),
    NULL, p_actor_id, p_actor_role
  );
END $$;

-- RPC: reject_rakit_lock — PENDING_LOCK_APPROVAL → WIP with reason
CREATE OR REPLACE FUNCTION public.reject_rakit_lock(
  p_transaction_id UUID,
  p_reason         TEXT,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_current_status TEXT;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reject_rakit_lock: reason is required';
  END IF;

  SELECT status INTO v_current_status FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_current_status != 'PENDING_LOCK_APPROVAL' THEN
    RAISE EXCEPTION 'reject_rakit_lock: invalid current status %, expected PENDING_LOCK_APPROVAL', v_current_status;
  END IF;

  UPDATE public.kasir_transactions
  SET status               = 'WIP',
      lock_rejected_reason = p_reason,
      lock_rejected_at     = now(),
      lock_submitted_by    = NULL,
      lock_submitted_at    = NULL
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'reject', NULL,
    jsonb_build_object('status', 'PENDING_LOCK_APPROVAL'),
    jsonb_build_object('status', 'WIP'),
    p_reason, p_actor_id, p_actor_role
  );
END $$;

-- RPC: approve_rakit_lock — PENDING_LOCK_APPROVAL → AWAITING_LUNAS or PAID
CREATE OR REPLACE FUNCTION public.approve_rakit_lock(
  p_transaction_id UUID,
  p_hpp_overrides  JSONB,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_status TEXT;
  v_dp             NUMERIC;
  v_total          NUMERIC;
  v_new_status     TEXT;
  v_line           RECORD;
  v_comp           RECORD;
  v_adj_id         UUID;
  v_hpp_final      NUMERIC;
BEGIN
  SELECT status, dp_amount, total_amount
    INTO v_current_status, v_dp, v_total
  FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_current_status != 'PENDING_LOCK_APPROVAL' THEN
    RAISE EXCEPTION 'approve_rakit_lock: invalid current status %, expected PENDING_LOCK_APPROVAL', v_current_status;
  END IF;

  v_new_status := CASE WHEN v_total - COALESCE(v_dp, 0) > 0 THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  FOR v_line IN SELECT * FROM public.rakit_job_lines WHERE transaction_id = p_transaction_id LOOP
    IF v_line.tracking_mode = 'detail' THEN
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        (SELECT COALESCE(SUM(fifo_cost_snapshot), 0) FROM public.rakit_components WHERE rakit_line_id = v_line.id)
          + COALESCE(v_line.labor_cost, 0)
      );

      INSERT INTO public.stock_adjustments
        (adjustment_type, reason, reference_type, reference_id, approved_by, approved_at, created_by)
      VALUES
        ('rakit_usage',
         'Pemakaian Rakit (auto-generated from approval)',
         'rakit_job_line',
         v_line.id,
         p_actor_id,
         now(),
         p_actor_id)
      RETURNING id INTO v_adj_id;

      FOR v_comp IN SELECT * FROM public.rakit_components WHERE rakit_line_id = v_line.id LOOP
        INSERT INTO public.stock_adjustment_lines
          (adjustment_id, sku, qty_delta, warehouse, fifo_cost)
        VALUES
          (v_adj_id, v_comp.sku, -v_comp.qty, v_comp.warehouse, v_comp.fifo_cost_snapshot);

        PERFORM public._log_stock_movement(
          p_sku           := v_comp.sku,
          p_warehouse     := v_comp.warehouse,
          p_qty_delta     := -v_comp.qty,
          p_movement_type := 'adjustment_out',
          p_reference_type:= 'stock_adjustment',
          p_reference_id  := v_adj_id,
          p_unit_cost     := v_comp.fifo_cost_snapshot / NULLIF(v_comp.qty, 0),
          p_actor_id      := p_actor_id
        );

        UPDATE public.stocks
        SET stock_atas  = CASE WHEN v_comp.warehouse = 'atas'  THEN stock_atas  - v_comp.qty ELSE stock_atas  END,
            stock_bawah = CASE WHEN v_comp.warehouse = 'bawah' THEN stock_bawah - v_comp.qty ELSE stock_bawah END
        WHERE sku = v_comp.sku;
      END LOOP;

      UPDATE public.rakit_job_lines
      SET hpp_final           = v_hpp_final,
          hpp_owner_override  = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
          stock_adjustment_id = v_adj_id
      WHERE id = v_line.id;

    ELSE
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        v_line.lump_sum_hpp
      );
      UPDATE public.rakit_job_lines
      SET hpp_final = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  UPDATE public.kasir_transactions
  SET status            = v_new_status,
      lock_approved_by  = p_actor_id,
      lock_approved_at  = now()
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'approve', NULL,
    jsonb_build_object('status', 'PENDING_LOCK_APPROVAL'),
    jsonb_build_object('status', v_new_status),
    NULL, p_actor_id, p_actor_role
  );
END $$;

-- RPC: cancel_rakit — WIP → CANCELLED
CREATE OR REPLACE FUNCTION public.cancel_rakit(
  p_transaction_id UUID,
  p_refund_amount  NUMERIC,
  p_reason         TEXT,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_status TEXT;
  v_dp             NUMERIC;
  v_forfeit        NUMERIC;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'cancel_rakit: reason is required';
  END IF;

  SELECT status, COALESCE(dp_amount, 0) INTO v_current_status, v_dp
  FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;

  IF v_current_status != 'WIP' THEN
    RAISE EXCEPTION 'cancel_rakit: invalid current status %, expected WIP', v_current_status;
  END IF;

  IF p_refund_amount < 0 OR p_refund_amount > v_dp THEN
    RAISE EXCEPTION 'cancel_rakit: refund amount % must be between 0 and DP %', p_refund_amount, v_dp;
  END IF;

  v_forfeit := v_dp - p_refund_amount;

  UPDATE public.kasir_transactions
  SET status                = 'CANCELLED',
      cancel_refund_amount  = p_refund_amount,
      cancel_forfeit_amount = v_forfeit,
      cancel_reason         = p_reason,
      cancelled_by          = p_actor_id,
      cancelled_at          = now()
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'cancel', NULL,
    jsonb_build_object('status', 'WIP', 'dp_amount', v_dp),
    jsonb_build_object('status', 'CANCELLED', 'refund', p_refund_amount, 'forfeit', v_forfeit),
    p_reason, p_actor_id, p_actor_role
  );
END $$;

-- RPC: material_edit_rakit — AWAITING_LUNAS → PENDING_LOCK_APPROVAL
CREATE OR REPLACE FUNCTION public.material_edit_rakit(
  p_transaction_id UUID,
  p_lines          JSONB,
  p_actor_id       UUID,
  p_actor_role     TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_status TEXT;
  v_line           JSONB;
  v_line_id        UUID;
  v_old_adj_id     UUID;
  v_comp           RECORD;
  v_comp_in        JSONB;
BEGIN
  SELECT status INTO v_current_status FROM public.kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_current_status != 'AWAITING_LUNAS' THEN
    RAISE EXCEPTION 'material_edit_rakit: invalid current status %, expected AWAITING_LUNAS', v_current_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;

    SELECT stock_adjustment_id INTO v_old_adj_id FROM public.rakit_job_lines WHERE id = v_line_id;
    IF v_old_adj_id IS NOT NULL THEN
      FOR v_comp IN SELECT * FROM public.stock_adjustment_lines WHERE adjustment_id = v_old_adj_id LOOP
        PERFORM public._log_stock_movement(
          p_sku           := v_comp.sku,
          p_warehouse     := v_comp.warehouse,
          p_qty_delta     := -v_comp.qty_delta,
          p_movement_type := 'adjustment_reversal',
          p_reference_type:= 'stock_adjustment',
          p_reference_id  := v_old_adj_id,
          p_unit_cost     := v_comp.fifo_cost,
          p_actor_id      := p_actor_id
        );

        UPDATE public.stocks
        SET stock_atas  = CASE WHEN v_comp.warehouse = 'atas'  THEN stock_atas  - v_comp.qty_delta ELSE stock_atas  END,
            stock_bawah = CASE WHEN v_comp.warehouse = 'bawah' THEN stock_bawah - v_comp.qty_delta ELSE stock_bawah END
        WHERE sku = v_comp.sku;
      END LOOP;

      UPDATE public.stock_adjustments
      SET reversed_at = now(),
          reversed_by = p_actor_id
      WHERE id = v_old_adj_id;

      UPDATE public.rakit_job_lines SET stock_adjustment_id = NULL WHERE id = v_line_id;
    END IF;

    UPDATE public.rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        hpp_final     = NULL,
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM public.rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp_in IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO public.rakit_components
          (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES
          (v_line_id,
           v_comp_in->>'sku',
           v_comp_in->>'name',
           (v_comp_in->>'qty')::NUMERIC,
           COALESCE(v_comp_in->>'warehouse', 'atas'),
           (v_comp_in->>'fifo_cost')::NUMERIC);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.kasir_transactions
  SET status              = 'PENDING_LOCK_APPROVAL',
      lock_submitted_by   = p_actor_id,
      lock_submitted_at   = now(),
      lock_approved_by    = NULL,
      lock_approved_at    = NULL
  WHERE id = p_transaction_id;

  PERFORM public._rakit_audit(
    p_transaction_id, NULL, 'edit_material', NULL,
    jsonb_build_object('status', 'AWAITING_LUNAS'),
    jsonb_build_object('status', 'PENDING_LOCK_APPROVAL'),
    NULL, p_actor_id, p_actor_role
  );
END $$;

-- Stock adjustments table — ensure 'reversed_at' / 'reversed_by' columns exist
ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id);
