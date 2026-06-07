-- Stock Fraud Prevention Phase 1, Task 5:
-- Wrap deduct_stock_fifo to write ONE stock_movements ledger row per call
-- (an aggregate sale, NOT one row per lot consumed), inside the same
-- transaction as the FIFO walk on public.stock_lots.
--
-- Filename is …000004… (not …000003… as in the original plan) because
-- 20260607000003_company_settings_authenticated_policies.sql already exists
-- and migration filenames are immutable in this project's workflow.
--
-- The pre-existing 2-arg overload (varchar, int) from
-- 20260604000015_fifo_rpcs.sql is DROPped first. Both surviving callers
-- (backend-go/internal/db/stock.go and src/lib/pembelianService.ts) invoke
-- the RPC by name with the 2 named params {p_sku, p_qty}; Postgres resolves
-- those to the new 6-arg signature because p_warehouse, p_related_doc_type,
-- p_related_doc_id, and p_source all have defaults.
--
-- KNOWN WART (out of scope for Task 5, to be resolved when Task 7 wraps
-- decrement_stock or when the caller is rewritten): the production flow in
-- DeductStockAndGetHPP() first calls decrement_stock(sku, qty, 'atas') and
-- then deduct_stock_fifo(sku, qty). Because decrement_stock has already
-- mutated stock_atas by the time we enter this function, qty_before read
-- here equals the POST-decrement value, and qty_after = qty_before - p_qty
-- understates by p_qty. Phase 1 Task 7 (or a caller-collapse refactor) must
-- decide whether to (a) drop this PERFORM and only log inside the eventual
-- decrement_stock wrapper, or (b) collapse the two calls into one. For now
-- we follow the plan literally and log here so the ledger has *some* row
-- for every WA sale, even though the qty math is shifted.

-- 1. Drop the legacy 2-arg overload so the 6-arg version is the sole
--    resolution target. Without this DROP, by-name RPC calls remain
--    ambiguous (same name, both candidates have all named args supplied).
DROP FUNCTION IF EXISTS public.deduct_stock_fifo(character varying, integer);

-- 2. Create the wrapping function. p_warehouse defaults to 'atas' so the
--    existing 2-arg by-name callers continue to work unchanged. p_source
--    defaults to 'sale_kasir' (the closer match for the legacy in-store
--    flow); the WA bot path passes 'sale_wa' explicitly.
CREATE OR REPLACE FUNCTION public.deduct_stock_fifo(
  p_sku              TEXT,
  p_qty              INT,
  p_warehouse        TEXT DEFAULT 'atas',
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_source           public.stock_movement_source DEFAULT 'sale_kasir'
)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_lot          record;
  v_remaining    int     := p_qty;
  v_total_cost   numeric := 0;
  v_deduct       int;
  v_fallback_hpp numeric := 0;
  v_qty_before   int;
BEGIN
  IF p_warehouse NOT IN ('atas', 'bawah') THEN
    RAISE EXCEPTION 'deduct_stock_fifo: p_warehouse must be atas|bawah, got %', p_warehouse;
  END IF;

  -- Read qty_before from the correct warehouse column BEFORE the FIFO walk
  -- so chk_qty_math (qty_before + qty_delta = qty_after) holds when the
  -- ledger row is inserted at the end. See KNOWN WART note above for why
  -- this value may be off by p_qty in the current production flow.
  IF p_warehouse = 'atas' THEN
    SELECT stock_atas  INTO v_qty_before FROM public.stocks WHERE sku = p_sku;
  ELSE
    SELECT stock_bawah INTO v_qty_before FROM public.stocks WHERE sku = p_sku;
  END IF;

  -- FIFO consumption — preserved verbatim from 20260604000015_fifo_rpcs.sql.
  -- Walks lots in received_at ASC order, deducts qty_remaining lot-by-lot,
  -- accumulates total cost. Each lot UPDATE is part of this RPC's
  -- transaction — a downstream failure rolls the lot mutations back.
  FOR v_lot IN
    SELECT id, qty_remaining, unit_cost
    FROM public.stock_lots
    WHERE sku = p_sku AND qty_remaining > 0
    ORDER BY received_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct := LEAST(v_remaining, v_lot.qty_remaining);
    UPDATE public.stock_lots
    SET qty_remaining = qty_remaining - v_deduct
    WHERE id = v_lot.id;
    v_total_cost := v_total_cost + (v_deduct * v_lot.unit_cost);
    v_remaining  := v_remaining - v_deduct;
  END LOOP;

  -- Fallback: lots exhausted before qty satisfied — use stocks.harga_modal.
  -- Preserved verbatim from the original RPC.
  IF v_remaining > 0 THEN
    SELECT COALESCE(harga_modal, 0) INTO v_fallback_hpp
    FROM public.stocks WHERE sku = p_sku;
    v_total_cost := v_total_cost + (v_remaining * v_fallback_hpp);
    RAISE WARNING 'deduct_stock_fifo: % units of SKU % had no lot coverage, used harga_modal fallback', v_remaining, p_sku;
  END IF;

  -- Phase 1 ledger row. ONE row per call (aggregate sale), not one per lot —
  -- the FIFO partitioning is an implementation detail; the audit trail
  -- records the business event (a -p_qty deduction against p_warehouse).
  -- Same transaction as the lot UPDATEs above: any failure here rolls back
  -- the FIFO walk and the warehouse column is left consistent with the
  -- ledger. Actor capture defaults to the system bot inside
  -- _log_stock_movement (Phase 2 will thread real actor identity).
  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => p_warehouse,
    p_qty_delta        => -p_qty,
    p_qty_before       => COALESCE(v_qty_before, 0),
    p_source           => p_source,
    p_related_doc_type => p_related_doc_type,
    p_related_doc_id   => p_related_doc_id
  );

  RETURN v_total_cost;
END;
$$;
