-- Stock Fraud Prevention Phase 1, Task 6:
-- Wrap transfer_warehouse to write TWO stock_movements ledger rows per call —
-- one source='transfer_out' against the source warehouse (qty_delta=-p_qty)
-- and one source='transfer_in' against the destination warehouse
-- (qty_delta=+p_qty) — inside the same transaction as the stocks UPDATE.
--
-- Filename is …000005… (not …000004… as in the original plan) because Task 5
-- already claimed …000004… for wrap_deduct_stock_fifo. Migration filenames
-- are immutable in this project's workflow.
--
-- INTERIM WRAP: Phase 3d will replace transfer_warehouse with a proper
-- two-step state machine (request → confirm) and use real transfer ids on
-- related_doc_id. For this transition window we tag rows with
-- related_doc_type='transfer_legacy' and leave related_doc_id NULL so the
-- ledger stays consistent and these legacy single-shot rows are easy to
-- distinguish from the future two-step audit trail.
--
-- Body is the original CREATE OR REPLACE from
-- 20260605000002_warehouse_columns.sql with these ONLY additions:
--   1. Validate p_from <> p_to (no-op transfer is a bug).
--   2. Read stock_<from> AND stock_<to> into v_from_before / v_to_before
--      BEFORE the UPDATE (needed for the ledger's qty_before column to
--      satisfy chk_qty_math: qty_before + qty_delta = qty_after).
--   3. PERFORM public._log_stock_movement(...) twice AFTER the UPDATE — once
--      for transfer_out (warehouse=from), once for transfer_in (warehouse=to).
-- Existing stock movement behavior (FOR UPDATE lock, insufficiency exception,
-- atomic both-column UPDATE) is preserved verbatim.

CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku       text,
  p_from      text,
  p_to        text,
  p_qty       int
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_from_qty    int;
  v_from_before int;
  v_to_before   int;
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'transfer_warehouse: p_from and p_to must differ (got %)', p_from;
  END IF;

  -- Read BOTH warehouse columns BEFORE the UPDATE. The FOR UPDATE lock on
  -- the source-side read still serializes concurrent transfers on this SKU;
  -- the second SELECT against the same row inherits that lock.
  IF p_from = 'atas' THEN
    SELECT stock_atas, stock_bawah INTO v_from_before, v_to_before
    FROM stocks WHERE sku = p_sku FOR UPDATE;
    v_from_qty := v_from_before;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Atas tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_atas  = stock_atas  - p_qty,
           stock_bawah = stock_bawah + p_qty
     WHERE sku = p_sku;
  ELSE
    SELECT stock_bawah, stock_atas INTO v_from_before, v_to_before
    FROM stocks WHERE sku = p_sku FOR UPDATE;
    v_from_qty := v_from_before;
    IF v_from_qty < p_qty THEN
      RAISE EXCEPTION 'Stok Gudang Bawah tidak cukup: tersedia %, diminta %', v_from_qty, p_qty;
    END IF;
    UPDATE stocks
       SET stock_bawah = stock_bawah - p_qty,
           stock_atas  = stock_atas  + p_qty
     WHERE sku = p_sku;
  END IF;

  -- Phase 1 ledger rows. TWO rows per call (the transfer has two business
  -- events: a -p_qty against the source warehouse and a +p_qty against the
  -- destination). Same transaction as the stocks UPDATE above — any failure
  -- here rolls back the warehouse mutation. Actor capture defaults to the
  -- system bot inside _log_stock_movement (Phase 2 will thread real actor
  -- identity through). related_doc_id is NULL on this legacy path; Phase 3d's
  -- two-step replacement will populate a real transfer id.
  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => p_from,
    p_qty_delta        => -p_qty,
    p_qty_before       => COALESCE(v_from_before, 0),
    p_source           => 'transfer_out'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id   => NULL
  );

  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => p_to,
    p_qty_delta        => p_qty,
    p_qty_before       => COALESCE(v_to_before, 0),
    p_source           => 'transfer_in'::public.stock_movement_source,
    p_related_doc_type => 'transfer_legacy',
    p_related_doc_id   => NULL
  );
END;
$$;
