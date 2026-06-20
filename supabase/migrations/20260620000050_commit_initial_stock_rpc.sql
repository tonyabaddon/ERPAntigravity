-- 20260620000050_commit_initial_stock_rpc.sql
--
-- Initial-stock approval close-out: commit + reject RPCs for the
-- 'initial_stock' approval_request_type introduced in 20260614000024.
--
-- WHY: ProductForm already creates the SKU row with
-- initial_stock_approved=false and inserts an approval_requests row whose
-- payload is {sku, sku_name, qty, unit, warehouse_id, requested_cost_per_unit}.
-- Owner-facing ApprovalInboxScreen has a row renderer + label + icon but the
-- approve/reject dispatch switch has no handler — clicking Setujui after the
-- PIN flow falls into 'Tipe permintaan tidak dikenali' and the row stays
-- pending forever. Product is invisible in Kasir search (search RPC filters
-- WHERE initial_stock_approved=TRUE) until this RPC closes the loop.
--
-- Convention parity with commit_approved_adjustment + commit_opname (Phase 2c
-- migration 20260613000002c):
--   - Lock approval_requests for the id, assert status='approved' (the Owner
--     PIN modal calls verify_owner_pin → _transition_approval('approved')
--     BEFORE the frontend calls commit_initial_stock). The lock prevents a
--     concurrent reject from flipping the gate mid-commit.
--   - Write a stock_levels mutation (UPSERT — qty starts at 0 for a brand-new
--     SKU × warehouse combo, may already exist if Owner has done other work
--     for this SKU between request + approval; either way ADD the qty).
--   - Write a stock_movements ledger row via _log_stock_movement chokepoint
--     with source='seed' (the only enum value that semantically matches
--     "starting inventory for a new SKU"). Stamp warehouse_id post-insert via
--     the BIGINT-id pattern because _log_stock_movement only writes the
--     legacy text 'warehouse' column.
--   - Write a stock_lots row with NULL source_id/source_type and unit_cost
--     from payload.requested_cost_per_unit (defaulting to 0 if absent). Same
--     shape as the original stock_lots seed migration (20260604000014) used
--     to bootstrap FIFO. Without this row, future Kasir sales of this SKU
--     would fail deduct_stock_fifo since no lot exists to draw from.
--   - Flip stocks.initial_stock_approved = TRUE so the search RPC
--     (search_products_by_embedding, 20260614000024) starts returning it.
--
-- DIFFERENCES from commit_approved_adjustment:
--   - NO satellite table. Payload lives in approval_requests.payload JSONB,
--     so all reads are JSONB extractions instead of a satellite RECORD load.
--   - Idempotency check is on stocks.initial_stock_approved (not a
--     committed_at column on a satellite). If the flag is already TRUE,
--     raise — the catch-up commit attempt would double-insert the lot.
--   - Negative-stock guard is N/A — qty is always added (initial stock is
--     never negative; UI validates qty > 0 at request time, RPC re-checks).
--
-- REJECT FLOW:
--   reject_initial_stock has no satellite to mutate. We transition
--   approval_requests.status='rejected' via _transition_approval and stash
--   the reason in payload.rejection_note (UPDATE allowed under SECURITY
--   DEFINER because the deny_ar_update trigger was permanently disabled in
--   migration 007). The product stays at initial_stock_approved=false and is
--   never visible in Kasir — the row in stocks remains as a soft record of
--   the rejected SKU. Owner can manually DELETE if they want it gone.

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

  -- Step 3: idempotency guard. If the flag is already TRUE, the commit
  -- already ran (or the SKU was created with initial_stock_approved=true
  -- because qty was 0 at form-submit time). Either way, refuse to re-commit
  -- so the lot + ledger aren't double-written.
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

  -- Step 5: capture qty_before from stock_levels under row lock. UPSERT
  -- pattern — the row may not exist yet for a brand-new SKU × warehouse.
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

  -- Step 6: FIFO lot row. NULL source_id/source_type matches the original
  -- stock_lots seed migration (20260604000014) — Owner-approved initial
  -- stock has no PO / no Tagihan, so the source pointer fields stay NULL.
  INSERT INTO public.stock_lots
    (sku, po_id, unit_cost, qty_received, qty_remaining, received_at)
  VALUES
    (v_sku, NULL, v_unit_cost, v_qty, v_qty, now());

  -- Step 7: ledger row via the Phase 1 chokepoint, then stamp warehouse_id
  -- using the BIGINT-id pattern (p_warehouse passed NULL because the
  -- legacy text column is deprecated).
  v_movement_id := public._log_stock_movement(
    p_sku              => v_sku,
    p_warehouse        => NULL,
    p_qty_delta        => v_qty,
    p_qty_before       => v_qty_before,
    p_source           => 'seed'::public.stock_movement_source,
    p_related_doc_type => 'approval_request',
    p_related_doc_id   => p_approval_id::text,
    p_reason_code      => 'initial_stock',
    p_reason_note      => NULL,
    p_actor_user_id    => v_ar.decided_by,
    p_actor_role       => 'initial_stock_commit',
    p_evidence_urls    => '{}'::text[]
  );
  UPDATE public.stock_movements
     SET warehouse_id = v_warehouse_id
   WHERE id = v_movement_id;

  -- Step 8: flip the visibility gate. After this UPDATE the search RPC
  -- (search_products_by_embedding) starts returning the SKU in Cari by Foto
  -- and the row is treated as fully provisioned everywhere else.
  UPDATE public.stocks
     SET initial_stock_approved = TRUE,
         updated_at             = now()
   WHERE sku = v_sku;

  RETURN v_movement_id;
END $$;

GRANT EXECUTE ON FUNCTION public.commit_initial_stock(BIGINT) TO authenticated;


CREATE OR REPLACE FUNCTION public.reject_initial_stock(
  p_approval_id BIGINT,
  p_reason_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar         RECORD;
  v_actor      UUID;
BEGIN
  v_actor := auth.uid();
  -- Allow service_role / postgres test invocations to pass without auth.uid().
  -- For client-role callers (authenticated) auth.uid() will always resolve.

  -- Lock + gate + type check. No satellite to mutate.
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
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'approval_request % is not pending (status=%) — cannot reject',
      p_approval_id, v_ar.status;
  END IF;

  -- Transition status to rejected via the sole-sanctioned helper.
  PERFORM public._transition_approval(
    p_approval_id,
    'rejected'::public.approval_status,
    COALESCE(v_actor, v_ar.requested_by),
    'app_inbox'
  );

  -- Stash the reason on payload. Safe because the deny_ar_update trigger is
  -- disabled and we run as the function owner (postgres). Audit consumers
  -- read payload.rejection_note when status='rejected'.
  IF p_reason_note IS NOT NULL AND p_reason_note <> '' THEN
    UPDATE public.approval_requests
       SET payload = payload || jsonb_build_object(
             'rejection_note', p_reason_note,
             'rejected_at',    now()
           )
     WHERE id = p_approval_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.reject_initial_stock(BIGINT, TEXT) TO authenticated;
