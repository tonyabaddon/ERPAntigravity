-- 20260810000001 — deduct_stock_fifo: stop writing a second stock_movements row
--
-- Root cause of the audit-trail 2× doubling for every Kasir/WA sale, discovered
-- via full-commit E2E on 2026-07-01 (invoice WLK-20260701-001 → 2 movement rows
-- for a qty=1 sale; historical SKU 0671d9fd → 8 sale_kasir rows for 4 units
-- actually sold; ratio holds across every sale since Phase 1 shipped).
--
-- The producer:
--   record_kasir_sale calls two helpers per aggregated (sku, warehouse) group:
--     1. decrement_stock(...)   — UPDATEs stocks.stock_<warehouse>, INSERTs 1 truthful
--        ledger row (qty_before/qty_after reflect the real column transition).
--     2. deduct_stock_fifo(...) — walks stock_lots for COGS, INSERTs 1 SECOND ledger
--        row whose qty_before is read from stocks AFTER (1) already decremented
--        it. That row's qty_delta = -p_qty is arithmetically correct but its
--        qty_before/qty_after describe a "phantom column move" — the column
--        does not change in this call at all.
--
-- Impact of the second row:
--   * stocks.stock_atas / stock_bawah master column        — NOT affected (already correct).
--   * stock_lots.qty_remaining FIFO layers                 — NOT affected (already correct).
--   * journal_entries HPP/COGS                             — NOT affected (reads from lots).
--   * stock_movements audit trail                          — 2× rows per sale (this bug).
--   * Any analytic that SUMs stock_movements.qty_delta     — reports 2× real outflow.
--
-- The tech debt was recorded verbatim in the header of
--   20260607000006_wrap_decrement_stock.sql (lines 5-45)
-- as "FOLLOW-UP (Phase 2/3, NOT this task)" with two options:
--   (i)  drop the PERFORM _log_stock_movement call from deduct_stock_fifo and
--        let decrement_stock be the sole ledger writer, or
--   (ii) refactor DeductStockAndGetHPP into a single unified RPC.
-- This migration ships option (i) — the smaller diff.
--
-- Historical rows: kept as-is. stock_movements is append-only
-- (deny_stock_movement_mutation trigger blocks DELETE / UPDATE); attempting
-- a bulk-scrub of the phantom rows is not supported and not desirable — the
-- audit trail is meant to be immutable even when it recorded confused numbers.
-- Any BI/reporting layer that consumed sum(qty_delta) must be re-baselined:
-- for every sale_kasir / sale_wa row before this migration ships, the "real"
-- outflow is qty_delta / 2. A concrete compensation query:
--
--   SELECT sku, SUM(qty_delta)::int / 2 AS real_sale_outflow
--   FROM   public.stock_movements
--   WHERE  source IN ('sale_kasir', 'sale_wa')
--     AND  created_at < '2026-08-10'  -- ship date of this migration
--   GROUP  BY sku;
--
-- Signature preserved verbatim from 20260607000004_wrap_deduct_stock_fifo.sql
-- (6-arg: p_sku, p_qty, p_warehouse, p_related_doc_type, p_related_doc_id,
-- p_source). All callers (record_kasir_sale, backend-go DeductStockAndGetHPP,
-- src/lib/pembelianService.ts) continue to work — they still get the same
-- returned v_total_cost; only the side-effect ledger insert goes away.
--
-- After ship, `record_kasir_sale` writes 1 ledger row per aggregated (sku,
-- warehouse) group (from decrement_stock only). Tests in
-- backend-go/internal/db/record_kasir_sale_test.go that previously asserted
-- `count = 2` are updated to `count = 1` in the same PR.

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
BEGIN
  IF p_warehouse NOT IN ('atas', 'bawah') THEN
    RAISE EXCEPTION 'deduct_stock_fifo: p_warehouse must be atas|bawah, got %', p_warehouse;
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

  -- INTENTIONALLY REMOVED (was in 20260607000004): the second
  -- _log_stock_movement call that produced the phantom ledger row. See the
  -- migration header for the full rationale. p_related_doc_type,
  -- p_related_doc_id, and p_source parameters are retained in the signature
  -- for backward compatibility with callers that were passing them; they now
  -- have no effect inside this function body.

  RETURN v_total_cost;
END;
$$;

-- Signature unchanged, but restate the grant to keep permissions explicit.
GRANT EXECUTE ON FUNCTION public.deduct_stock_fifo(
  TEXT, INT, TEXT, TEXT, TEXT, public.stock_movement_source
) TO anon, authenticated;
