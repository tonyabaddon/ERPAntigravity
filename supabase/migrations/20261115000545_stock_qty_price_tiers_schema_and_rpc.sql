-- 20261115000545_stock_qty_price_tiers_schema_and_rpc.sql
-- Phase 2 Task 1 — SKU qty-tier pricing schema + owner CRUD RPCs.
--
-- Adds public.stock_qty_price_tiers table (per-tenant, per-SKU, variable
-- cardinality up to 5 tiers). Ships 2 SECDEF RPCs for owner CRUD:
-- set_stock_qty_tiers (atomic DELETE+INSERT replace) + delete_all_stock_qty_tiers.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_stock_qty_tiers(varchar, jsonb);
--   DROP FUNCTION IF EXISTS public.delete_all_stock_qty_tiers(varchar);
--   DROP POLICY IF EXISTS t_select_own_secdef ON public.stock_qty_price_tiers;
--   DROP POLICY IF EXISTS t_select_own ON public.stock_qty_price_tiers;
--   DROP TABLE IF EXISTS public.stock_qty_price_tiers;

-- ─── Schema ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_qty_price_tiers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stock_sku    VARCHAR(50) NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  min_qty      INT NOT NULL CHECK (min_qty >= 2),
  price        NUMERIC NOT NULL CHECK (price > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_qty_price_tiers_sku_min_qty
  ON public.stock_qty_price_tiers (stock_sku, min_qty);

CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_lookup
  ON public.stock_qty_price_tiers (stock_sku, min_qty DESC);

CREATE INDEX IF NOT EXISTS ix_stock_qty_price_tiers_tenant
  ON public.stock_qty_price_tiers (tenant_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_qty_price_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS t_select_own ON public.stock_qty_price_tiers;
CREATE POLICY t_select_own ON public.stock_qty_price_tiers
  FOR SELECT TO authenticated
  USING (tenant_id = public._resolve_tenant_id());

-- Allow vosi_rpc_owner (in case future SECDEF RPCs owned by that role need read).
-- Phase 2 RPCs OWNER TO postgres so they read via superuser bypass, but keeping
-- policy for defense in depth + consistency with kasir_expense_categories pattern.
DROP POLICY IF EXISTS t_select_own_secdef ON public.stock_qty_price_tiers;
CREATE POLICY t_select_own_secdef ON public.stock_qty_price_tiers
  FOR SELECT TO vosi_rpc_owner
  USING (true);

-- No direct client INSERT/UPDATE/DELETE policy — writes only via SECDEF RPCs below.

-- ─── SECDEF RPC: set_stock_qty_tiers ─────────────────────────────────────────
-- Atomic replace of ALL tiers for a stock. Empty JSONB array clears tiers.
-- Error taxonomy:
--   QTP_FORBIDDEN         (P0403) caller not Owner
--   QTP_STOCK_NOT_FOUND   (P0404) stock_sku missing or wrong tenant
--   QTP_TOO_MANY_TIERS    (P0400) > 5 tiers
--   QTP_INVALID_MIN_QTY   (P0400 hint: value) min_qty < 2 or duplicate
--   QTP_INVALID_PRICE     (P0400 hint: value) price <= 0

CREATE OR REPLACE FUNCTION public.set_stock_qty_tiers(
  p_stock_sku VARCHAR(50),
  p_tiers     JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_tenant_id    UUID := public._resolve_tenant_id();
  v_stock_exists BOOLEAN;
  v_tier_count   INT;
  v_tier         JSONB;
  v_seen_qty     INT[] := ARRAY[]::INT[];
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'QTP_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Stock exists + belongs to caller's tenant
  SELECT EXISTS (
    SELECT 1 FROM public.stocks
    WHERE sku = p_stock_sku AND tenant_id = v_tenant_id
  ) INTO v_stock_exists;
  IF NOT v_stock_exists THEN
    RAISE EXCEPTION 'QTP_STOCK_NOT_FOUND' USING errcode = 'P0404';
  END IF;

  -- Cap
  v_tier_count := COALESCE(jsonb_array_length(p_tiers), 0);
  IF v_tier_count > 5 THEN
    RAISE EXCEPTION 'QTP_TOO_MANY_TIERS' USING errcode = 'P0400';
  END IF;

  -- Validate each tier + uniqueness within batch
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tiers) LOOP
    IF (v_tier->>'min_qty')::INT < 2 THEN
      RAISE EXCEPTION 'QTP_INVALID_MIN_QTY' USING errcode = 'P0400', hint = v_tier->>'min_qty';
    END IF;
    IF (v_tier->>'price')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'QTP_INVALID_PRICE' USING errcode = 'P0400', hint = v_tier->>'price';
    END IF;
    IF (v_tier->>'min_qty')::INT = ANY(v_seen_qty) THEN
      RAISE EXCEPTION 'QTP_INVALID_MIN_QTY' USING errcode = 'P0400', hint = 'duplicate min_qty';
    END IF;
    v_seen_qty := array_append(v_seen_qty, (v_tier->>'min_qty')::INT);
  END LOOP;

  -- Atomic replace
  DELETE FROM public.stock_qty_price_tiers
    WHERE stock_sku = p_stock_sku AND tenant_id = v_tenant_id;

  IF v_tier_count > 0 THEN
    INSERT INTO public.stock_qty_price_tiers (tenant_id, stock_sku, min_qty, price)
      SELECT v_tenant_id, p_stock_sku, (t->>'min_qty')::INT, (t->>'price')::NUMERIC
        FROM jsonb_array_elements(p_tiers) t;
  END IF;
END $$;

ALTER FUNCTION public.set_stock_qty_tiers(varchar, jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.set_stock_qty_tiers(varchar, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_stock_qty_tiers(varchar, jsonb) FROM anon;

-- ─── SECDEF RPC: delete_all_stock_qty_tiers ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_all_stock_qty_tiers(
  p_stock_sku VARCHAR(50)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_tenant_id UUID := public._resolve_tenant_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'QTP_FORBIDDEN' USING errcode = 'P0403';
  END IF;
  DELETE FROM public.stock_qty_price_tiers
    WHERE stock_sku = p_stock_sku AND tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.delete_all_stock_qty_tiers(varchar) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(varchar) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_all_stock_qty_tiers(varchar) FROM anon;
