-- 20260620000051_commit_initial_stock_rpc_fix_movement_insert.sql
--
-- Hotfix to 20260620000050_commit_initial_stock_rpc.sql discovered during
-- production smoke test: the post-insert `UPDATE stock_movements SET
-- warehouse_id = ...` step copied from Phase 2c's commit_approved_adjustment
-- (20260613000002c) is blocked by the `trg_deny_sm_update` deny-trigger
-- defined in 20260607000001_stock_movements.sql, raising
-- "stock_movements is append-only — corrections must be a new compensating
-- row" (SQLSTATE P0001). The whole RPC rolls back, no lot/level/flag flip.
--
-- (Same flaw silently affects Phase 2c — every adjustment/opname commit row
-- in prod has warehouse_id=NULL because the trigger blocks the same UPDATE
-- pattern there too. Out of scope for this fix; tracked separately.)
--
-- Fix: bypass _log_stock_movement for this one call, INSERT directly into
-- stock_movements with warehouse_id included in the VALUES list. Preserves
-- the qty math + actor defaults the helper would have applied. Single
-- responsibility lives in this RPC for initial stock commits — no shared-
-- helper change so other code paths are unaffected.

CREATE OR REPLACE FUNCTION public.commit_initial_stock(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar             RECORD;
  v_sku            TEXT;
  v_qty            INT;
  v_warehouse_id   UUID;
  v_unit_cost      NUMERIC;
  v_qty_before     INT;
  v_already        BOOLEAN;
  v_movement_id    BIGINT;
BEGIN
  -- Step 1: lock + gate check + type check.
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'initial_stock' THEN
    RAISE EXCEPTION 'approval_request % is not initial_stock (request_type=%)',
      p_approval_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  -- Step 2: extract + validate payload.
  v_sku          := v_ar.payload ->> 'sku';
  v_qty          := (v_ar.payload ->> 'qty')::INT;
  v_warehouse_id := (v_ar.payload ->> 'warehouse_id')::UUID;
  v_unit_cost    := COALESCE((v_ar.payload ->> 'requested_cost_per_unit')::NUMERIC, 0);

  IF v_sku IS NULL OR v_sku = '' THEN
    RAISE EXCEPTION 'payload.sku missing or empty for approval_request %', p_approval_id;
  END IF;
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RAISE EXCEPTION 'payload.qty must be > 0 (got %) for approval_request %', v_qty, p_approval_id;
  END IF;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'payload.warehouse_id missing for approval_request %', p_approval_id;
  END IF;

  -- Step 3: idempotency guard.
  SELECT initial_stock_approved INTO v_already
    FROM public.stocks
   WHERE sku = v_sku
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % not found in stocks (was it deleted between request + approve?)', v_sku;
  END IF;
  IF v_already THEN
    RAISE EXCEPTION 'SKU % already has initial_stock_approved=true (approval_request % is stale or a double-commit)',
      v_sku, p_approval_id;
  END IF;

  -- Step 4: warehouse exists.
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_warehouse_id) THEN
    RAISE EXCEPTION 'warehouse_id % not found for approval_request %', v_warehouse_id, p_approval_id;
  END IF;

  -- Step 5: capture qty_before from stock_levels under row lock. UPSERT.
  SELECT qty INTO v_qty_before
    FROM public.stock_levels
   WHERE sku = v_sku AND warehouse_id = v_warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    v_qty_before := 0;
    INSERT INTO public.stock_levels (sku, warehouse_id, qty)
      VALUES (v_sku, v_warehouse_id, v_qty);
  ELSE
    UPDATE public.stock_levels
       SET qty = qty + v_qty,
           updated_at = now()
     WHERE sku = v_sku AND warehouse_id = v_warehouse_id;
  END IF;

  -- Step 6: FIFO lot row.
  INSERT INTO public.stock_lots
    (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
  VALUES
    (v_sku, NULL, v_unit_cost, v_qty, v_qty, now());

  -- Step 7: ledger row. Direct INSERT with warehouse_id stamped at write
  -- time. Cannot use _log_stock_movement(...) + post-UPDATE because the
  -- trg_deny_sm_update trigger blocks UPDATEs on stock_movements (the
  -- helper only writes the legacy text 'warehouse' column).
  INSERT INTO public.stock_movements
    (sku, warehouse, warehouse_id, qty_delta, qty_before, qty_after, source,
     related_doc_type, related_doc_id, reason_code, reason_note,
     actor_user_id, actor_role, evidence_urls)
  VALUES
    (v_sku, NULL, v_warehouse_id, v_qty, v_qty_before,
     v_qty_before + v_qty, 'seed'::public.stock_movement_source,
     'approval_request', p_approval_id::text, 'initial_stock', NULL,
     COALESCE(v_ar.decided_by, '00000000-0000-0000-0000-000000000000'::uuid),
     'initial_stock_commit', '{}'::text[])
  RETURNING id INTO v_movement_id;

  -- Step 8: flip the visibility gate.
  UPDATE public.stocks
     SET initial_stock_approved = TRUE,
         updated_at             = now()
   WHERE sku = v_sku;

  RETURN v_movement_id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_initial_stock(BIGINT) TO authenticated;
