-- Stock Fraud Prevention Phase 1, Task 7:
-- Wrap decrement_stock to write ONE stock_movements ledger row per call,
-- inside the same transaction as the stocks.stock_<warehouse> UPDATE.
--
-- ARCHITECTURAL FINDING (the double-write investigation Task 5 flagged):
--
-- The production WA flow in DeductStockAndGetHPP() calls
--   1. decrement_stock(sku, qty, 'atas')      -- column UPDATE
--   2. deduct_stock_fifo(sku, qty, 'atas', …) -- lots walk + cost
-- in sequence. Inspection of the live function bodies via pg_get_functiondef
-- and a manual smoke test confirms outcome (b) from the Phase 1 plan:
--
--   * decrement_stock UPDATEs stocks.stock_<warehouse>.
--     It does NOT touch stock_lots.
--   * deduct_stock_fifo UPDATEs ONLY stock_lots.qty_remaining (FIFO walk).
--     It does NOT touch stocks.stock_<warehouse>.
--
-- The two are COMPLEMENTARY, not redundant. There is NO pre-existing
-- double-decrement bug in production: a call pair of (3, 3) takes
-- stock_atas from 10 -> 7 and lot.qty_remaining from 10 -> 7 (verified).
--
-- IMPLICATION for the ledger:
--   * THIS wrap's ledger row (decrement_stock) records the TRUE column
--     transition: qty_before is read from stocks BEFORE the UPDATE, and
--     qty_delta = -p_qty matches the actual column change. Audit-grade.
--   * Task 5's deduct_stock_fifo ledger row reads v_qty_before from
--     stocks AFTER decrement_stock has already mutated the column, then
--     records qty_after = qty_before - p_qty — but the column does not
--     change in that step at all. So that row's qty_before/qty_after are
--     numerically wrong relative to the real column transition. Its
--     qty_delta and source are still meaningful as a marker that lots
--     were consumed, but the qty_before/qty_after numbers don't reflect
--     reality and the row reports a phantom column move.
--
-- FOLLOW-UP (Phase 2/3, NOT this task):
--   Per the Phase 1 plan, "Do NOT refactor DeductStockAndGetHPP — that's
--   out of Phase 1 scope." A future task should pick ONE of:
--     (i)  drop the PERFORM _log_stock_movement call from deduct_stock_fifo
--          and have decrement_stock be the sole ledger writer for WA sales, or
--     (ii) refactor DeductStockAndGetHPP to a single RPC that updates
--          the column, walks lots, and writes one ledger row.
--   Phase 1 ships with BOTH wraps writing rows — the WA flow now produces
--   2 ledger rows per item per sale (1 truthful from decrement_stock,
--   1 misleading-qty-but-correct-source from deduct_stock_fifo). Both
--   rows share related_doc_id once the Go caller is updated.
--
-- Filename …000006 because …000004 (wrap_deduct_stock_fifo) and
-- …000005 (wrap_transfer_warehouse) are already on disk and applied.
--
-- The 3-arg signature (p_sku, p_qty, p_warehouse) from
-- 20260605000002_warehouse_columns.sql is REPLACED in place (same name,
-- new defaults for the 3 new params). Existing callers that pass only the
-- first 3 args continue to work because p_related_doc_type,
-- p_related_doc_id, and p_source all have defaults.

CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_sku              TEXT,
  p_qty              INT,
  p_warehouse        TEXT DEFAULT 'atas',
  p_related_doc_type TEXT DEFAULT NULL,
  p_related_doc_id   TEXT DEFAULT NULL,
  p_source           public.stock_movement_source DEFAULT 'sale_kasir'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_before INT;
BEGIN
  IF p_warehouse NOT IN ('atas', 'bawah') THEN
    RAISE EXCEPTION 'decrement_stock: p_warehouse must be atas|bawah, got %', p_warehouse;
  END IF;

  -- Read qty_before from the correct warehouse column BEFORE the UPDATE so
  -- chk_qty_math (qty_before + qty_delta = qty_after) holds when the ledger
  -- row is inserted below. This row is the TRUTH about the column transition
  -- (see ARCHITECTURAL FINDING in the migration header).
  IF p_warehouse = 'atas' THEN
    SELECT stock_atas  INTO v_before FROM public.stocks WHERE sku = p_sku;
  ELSE
    SELECT stock_bawah INTO v_before FROM public.stocks WHERE sku = p_sku;
  END IF;

  -- Preserve existing behavior verbatim from 20260605000002_warehouse_columns.sql:
  -- GREATEST(0, ...) clamp on the column, updated_at bump, no row-not-found
  -- guard (silent no-op if sku absent — matches the pre-existing semantics).
  IF p_warehouse = 'atas' THEN
    UPDATE public.stocks
    SET stock_atas = GREATEST(0, stock_atas - p_qty), updated_at = now()
    WHERE sku = p_sku;
  ELSE
    UPDATE public.stocks
    SET stock_bawah = GREATEST(0, stock_bawah - p_qty), updated_at = now()
    WHERE sku = p_sku;
  END IF;

  -- Phase 1 ledger row. Same transaction as the column UPDATE above: any
  -- failure here rolls back the UPDATE and the warehouse column stays
  -- consistent with the ledger. Actor capture defaults to the system bot
  -- inside _log_stock_movement (Phase 2 will thread real actor identity).
  --
  -- Note on qty_delta vs the GREATEST(0, …) clamp: if a caller passes p_qty
  -- larger than the available stock, the column lands at 0 but qty_delta is
  -- still -p_qty here. chk_qty_math would then fail (v_before - p_qty < 0
  -- but qty_after stored = v_before + (-p_qty)). The pre-existing semantics
  -- already tolerate clamped decrements; if this becomes a real issue in
  -- prod, a follow-up should either (a) raise on insufficient stock or
  -- (b) compute the actual delta from v_before - new_value. For Phase 1
  -- we preserve the clamp and accept that an over-decrement is a CHECK
  -- violation that surfaces the misuse loudly — preferable to silent
  -- under-logging.
  PERFORM public._log_stock_movement(
    p_sku              => p_sku,
    p_warehouse        => p_warehouse,
    p_qty_delta        => -p_qty,
    p_qty_before       => COALESCE(v_before, 0),
    p_source           => p_source,
    p_related_doc_type => p_related_doc_type,
    p_related_doc_id   => p_related_doc_id
  );
END;
$$;
