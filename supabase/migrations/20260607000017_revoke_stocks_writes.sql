-- Phase 2, Task 11: REVOKE direct writes on `stocks` + `seed_stock_row` RPC.
--
-- Foundational Decision #1 (Phase 2 spec): client roles (anon, authenticated)
-- must NOT be able to mutate stock value-bearing columns directly from the
-- Supabase JS SDK. The sanctioned paths are SECURITY DEFINER RPCs whose
-- function owner (postgres) retains the privilege the client role lacks:
--
--   * stock-quantity writes flow through:
--       - _log_stock_movement (Phase 1, …001b) — append-only ledger helper
--       - receive_purchase_order (Phase 1, …002)
--       - deduct_stock_fifo     (Phase 1, …004)
--       - transfer_warehouse    (Phase 1, …005)
--       - decrement_stock       (Phase 1, …006)
--       - commit_approved_adjustment / reject_adjustment (Phase 2, …010)
--       - commit_opname         (Phase 2, …014)
--       - seed_stock_row        (THIS migration — brand-new SKU only)
--   * stock-price writes flow through:
--       - commit_approved_price_change (Phase 2, …016)
--       - seed_stock_row              (THIS migration — initial price only)
--
-- service_role (the postgres-owner connection used by the Go backend +
-- supabase-admin tooling) BYPASSES the REVOKE — accepted trade-off per
-- Foundational Decision #1. The Go backend's own write paths are reviewed
-- separately.

-- ─────────────────────────────────────────────────────────────────────────────
-- Belt: column-level privilege denial for anon + authenticated client roles.
-- ─────────────────────────────────────────────────────────────────────────────
-- Postgres privilege model gotcha: a table-level UPDATE grant overrides any
-- column-level REVOKE — they coexist rather than the REVOKE narrowing the
-- grant. Supabase ships `GRANT UPDATE ON public.stocks TO anon, authenticated`
-- by default. So to surgically lock down only {price, harga_modal, stock_atas,
-- stock_bawah}: REVOKE the table-level UPDATE first, then GRANT column-level
-- UPDATE back on the safe columns (name, category, status, stock, specs,
-- updated_at). UI flows that rename / recategorize / edit specs continue to
-- work without routing through an RPC. The four value-bearing columns are
-- now reachable only via SECURITY DEFINER RPCs whose owner (postgres) keeps
-- the privilege.
REVOKE UPDATE ON public.stocks FROM PUBLIC, anon, authenticated;
GRANT  UPDATE (name, category, status, stock, specs, updated_at)
  ON public.stocks TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- seed_stock_row: SECURITY DEFINER path for brand-new SKU creation.
-- ─────────────────────────────────────────────────────────────────────────────
-- Contract:
--   1. INSERT a stocks row with the provided values. RAISE if the SKU
--      already exists — existing rows must change via the approval flow
--      (Phase 2 T9/T10 for price, T1-T4 for qty adjustments). Single-shot
--      semantics by design.
--   2. Write 1 stock_price_history row for each of {price, harga_modal} with
--      source='seed' so the audit log starts immediately at row creation.
--   3. Write 1 stock_movements row per warehouse with a non-zero starting
--      qty (source='seed'), via the Phase 1 _log_stock_movement helper.
--   4. Owner-role gate: caller must supply (or auth.uid() must resolve to)
--      an admin_users row with role='Owner'. Honor-system at the RPC level
--      since service_role can still bypass — but the column REVOKE forces
--      every JS client path through this gate.
--
-- Returns the SKU (TEXT) so the caller can chain "create and select".
CREATE OR REPLACE FUNCTION public.seed_stock_row(
  p_sku           TEXT,
  p_name          TEXT,
  p_category      TEXT,
  p_price         NUMERIC,
  p_harga_modal   NUMERIC,
  p_stock_atas    INT  DEFAULT 0,
  p_stock_bawah   INT  DEFAULT 0,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(p_actor_user_id, auth.uid());
  v_role  TEXT;
  v_inserted BOOLEAN;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'seed_stock_row requires p_actor_user_id (or auth.uid())';
  END IF;

  -- Owner-only gate. SECURITY DEFINER runs as the function owner, so this
  -- SELECT bypasses RLS regardless of the calling JWT.
  SELECT role INTO v_role FROM public.admin_users WHERE id = v_actor;
  IF v_role IS DISTINCT FROM 'Owner' THEN
    RAISE EXCEPTION 'seed_stock_row requires Owner role (actor=% role=%)',
      v_actor, COALESCE(v_role, '<missing>');
  END IF;

  -- INSERT-or-fail: ON CONFLICT DO NOTHING + check rows-affected so we get a
  -- clear "already exists" error rather than silent no-op on dup SKU.
  WITH ins AS (
    INSERT INTO public.stocks
      (sku, name, category, price, harga_modal,
       stock_atas, stock_bawah, stock, status, specs)
    VALUES
      (p_sku, p_name, p_category, p_price, p_harga_modal,
       p_stock_atas, p_stock_bawah, p_stock_atas + p_stock_bawah,
       'Sinkron', '{}'::jsonb)
    ON CONFLICT (sku) DO NOTHING
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM ins) INTO v_inserted;

  IF NOT v_inserted THEN
    RAISE EXCEPTION 'sku % already exists — use the approval flow to change existing rows', p_sku;
  END IF;

  -- Initial price-history audit rows. Old value is 0 (pre-existence baseline).
  INSERT INTO public.stock_price_history
    (sku, field, old_value, new_value, source, actor_user_id, actor_role)
  VALUES
    (p_sku, 'price',       0, p_price,       'seed', v_actor, 'Owner'),
    (p_sku, 'harga_modal', 0, p_harga_modal, 'seed', v_actor, 'Owner');

  -- Initial ledger rows per warehouse with non-zero starting qty. Uses the
  -- Phase 1 helper so qty_after math + actor defaults stay centralized.
  IF p_stock_atas > 0 THEN
    PERFORM public._log_stock_movement(
      p_sku=>p_sku, p_warehouse=>'atas', p_qty_delta=>p_stock_atas,
      p_qty_before=>0, p_source=>'seed'::public.stock_movement_source,
      p_actor_user_id=>v_actor, p_actor_role=>'Owner');
  END IF;
  IF p_stock_bawah > 0 THEN
    PERFORM public._log_stock_movement(
      p_sku=>p_sku, p_warehouse=>'bawah', p_qty_delta=>p_stock_bawah,
      p_qty_before=>0, p_source=>'seed'::public.stock_movement_source,
      p_actor_user_id=>v_actor, p_actor_role=>'Owner');
  END IF;

  RETURN p_sku;
END $$;

GRANT EXECUTE ON FUNCTION public.seed_stock_row(
  TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INT, INT, UUID
) TO authenticated;
