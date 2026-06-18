-- Phase 1B PR A — reserve_stock + restore_stock RPCs.
--
-- ⚠️  STUB MIGRATION — pending schema decisions before implementation.  ⚠️
--
-- The Phase 1B plan's draft for this migration assumed a simple schema
-- (stocks.qty + stocks.warehouse text + stock_movements.kind/order_id).
-- The actual schema is materially different and several open questions
-- need explicit answers before the real RPCs can be written. Apply-script
-- still includes this file so the controller sees the compile fail clearly
-- (the RAISE EXCEPTION fires at call-time, not at CREATE FUNCTION time —
-- so 015 still compiles and 010/014 still apply).
--
-- ─── Open questions for the controller ─────────────────────────────────
--
-- Q1. stock_movement_source enum has no 'reserve' / 'restore' values. The
--     existing values (from migration 20260607000001 + 20260609000010) are:
--       'purchase_receive','sale_kasir','transfer_in','transfer_out',
--       'adjustment','opname_variance','seed','rakit_usage','rakit_reversal'.
--     Decision needed: ADD VALUE 'sales_reserve' + 'sales_restore' in a
--     prior migration? Repurpose 'rakit_usage' / 'rakit_reversal'? Note:
--     ALTER TYPE ADD VALUE cannot be combined with usage in the same txn,
--     so the enum extension must be its own migration (e.g. 020).
--
-- Q2. Target table for the deduction.
--       Option A: stock_levels(sku, warehouse_id, qty) — canonical post-
--         Phase-1-warehouses (migration 20260613000001). Cleanest.
--       Option B: stocks.stock_atas / stocks.stock_bawah — legacy columns,
--         still present pre-Phase-3-cutover (cutover commented out in
--         apply-script per MEMORY note). Mutating these triggers the SUM
--         sync trigger; also blocked by stocks-write REVOKE.
--     Recommend A. Phase 3 cutover will eventually drop A's legacy peer.
--
-- Q3. Items[] warehouse resolution. kasir_transactions.items[] is JSONB
--     with mixed shapes:
--       • New rows (post-warehouses-phase-2): item.warehouse_id (uuid).
--       • Legacy rows: item.warehouse text ('atas' | 'bawah').
--       • Service lines (sku IS NULL): skip — no stock to reserve.
--     Resolution proposal: prefer item.warehouse_id; fallback to
--     warehouses.code = UPPER(item.warehouse); fallback to the order's
--     default warehouse; error if still NULL.
--
-- Q4. Idempotency key. stock_movements has no order_id column — it has
--     related_doc_type TEXT + related_doc_id TEXT. Use
--     related_doc_type='kasir_tx_reserve' + related_doc_id=p_order_id::text
--     for the reserve marker, and 'kasir_tx_restore' for restore? Or
--     embed both in a single source value? The idempotency check is
--     "have I already inserted a reserve marker for this order?" — needs
--     a stable lookup pattern.
--
-- Q5. Helper reuse. public._log_stock_movement(...) already exists
--     (migration 20260607000001b). It handles qty_before / qty_after /
--     actor_user_id / actor_role correctly. The new RPC should call it
--     rather than INSERT directly into stock_movements — both because
--     of the immutability triggers and because the helper is the
--     project's audited pattern.
--
-- ─── Stub function bodies ──────────────────────────────────────────────
-- These RAISE EXCEPTION so any call surfaces the gap loudly. Once Q1–Q5
-- are answered the stub is replaced with the real implementation in a
-- follow-up migration (likely 20260625000019 or similar).

CREATE OR REPLACE FUNCTION reserve_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'reserve_stock is a stub — pending schema decisions Q1-Q5; see migration 20260625000011 header'
    USING ERRCODE = 'feature_not_supported';
END;
$$;

CREATE OR REPLACE FUNCTION restore_stock(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'restore_stock is a stub — pending schema decisions Q1-Q5; see migration 20260625000011 header'
    USING ERRCODE = 'feature_not_supported';
END;
$$;

REVOKE ALL ON FUNCTION reserve_stock(uuid), restore_stock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_stock(uuid), restore_stock(uuid) TO authenticated;

COMMENT ON FUNCTION reserve_stock IS 'STUB — schema mismatch with plan draft; see header for open Q1-Q5. Phase 1C will replace.';
COMMENT ON FUNCTION restore_stock IS 'STUB — schema mismatch with plan draft; see header for open Q1-Q5. Phase 1C will replace.';
