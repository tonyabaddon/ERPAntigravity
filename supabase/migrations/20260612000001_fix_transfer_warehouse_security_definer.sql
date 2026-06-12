-- E2E audit 2026-06-12 fix: transfer_warehouse was authored as plain plpgsql
-- (no SECURITY DEFINER) in 20260605000002_warehouse_columns.sql and the
-- Phase 1 wrap in 20260607000005_wrap_transfer_warehouse.sql preserved that
-- oversight. The Phase 2 revoke migration 20260607000017_revoke_stocks_writes.sql
-- removed table-level UPDATE on `public.stocks` from anon + authenticated and
-- explicitly listed transfer_warehouse as one of the sanctioned SECURITY DEFINER
-- paths (see its header comment, lines 8-14) — but the function itself was
-- never tagged. Every UI transfer from an authenticated session has been
-- failing with 42501 / "permission denied for table stocks" and the hint
-- "Grant the required privileges to the current role with: GRANT UPDATE ON
-- public.stocks TO authenticated;" ever since.
--
-- Fix: re-issue the function body verbatim with SECURITY DEFINER + the
-- canonical SET search_path = public guard used elsewhere in this project,
-- and add the explicit EXECUTE grant to authenticated to match
-- seed_stock_row / deduct_stock_fifo / decrement_stock / commit_approved_*.
-- Body bytes are byte-equal to 20260607000005_wrap_transfer_warehouse.sql
-- — same FOR UPDATE locking, same exception messages, same two ledger writes.

CREATE OR REPLACE FUNCTION public.transfer_warehouse(
  p_sku       text,
  p_from      text,
  p_to        text,
  p_qty       int
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_qty    int;
  v_from_before int;
  v_to_before   int;
BEGIN
  IF p_from = p_to THEN
    RAISE EXCEPTION 'transfer_warehouse: p_from and p_to must differ (got %)', p_from;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.transfer_warehouse(text, text, text, int)
  TO authenticated;
