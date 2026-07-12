-- 20261115000124_promo_read_rpcs.sql
-- Item #4b: read RPCs for Promo Produk consumed by kasir wizard,
-- Promo Produk page, and Dashboard maintenance card.
-- See docs/superpowers/specs/2026-07-13-promo-produk-design.md §5.3-5.4

-- ── list_active_promos ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_active_promos(
  p_filter TEXT DEFAULT 'active'
) RETURNS TABLE(
  sku                    TEXT,
  name                   TEXT,
  category               TEXT,
  price                  NUMERIC,
  promo_discount_type    TEXT,
  promo_discount_value   NUMERIC,
  promo_expires_at       TIMESTAMPTZ,
  status                 TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_filter TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RETURN;
  END IF;

  v_filter := COALESCE(p_filter, 'active');
  IF v_filter NOT IN ('active','expiring_7d','expired','all') THEN
    v_filter := 'active';
  END IF;

  RETURN QUERY
  SELECT
    s.sku::TEXT,
    s.name::TEXT,
    s.category::TEXT,
    s.price::NUMERIC,
    s.promo_discount_type::TEXT,
    s.promo_discount_value::NUMERIC,
    s.promo_expires_at::TIMESTAMPTZ,
    (CASE
      WHEN s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now() THEN 'expired'
      WHEN s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now() + INTERVAL '7 days' THEN 'expiring_7d'
      ELSE 'active'
    END)::TEXT AS status
  FROM public.stocks s
  WHERE s.tenant_id = v_tenant
    AND s.promo_discount_type IS NOT NULL
    AND (
      (v_filter = 'active' AND (s.promo_expires_at IS NULL OR s.promo_expires_at > now()))
      OR (v_filter = 'expiring_7d' AND s.promo_expires_at BETWEEN now() AND now() + INTERVAL '7 days')
      OR (v_filter = 'expired' AND s.promo_expires_at IS NOT NULL AND s.promo_expires_at <= now())
      OR (v_filter = 'all')
    )
  ORDER BY s.promo_expires_at NULLS LAST, s.sku
  LIMIT 5000;
END $$;

ALTER FUNCTION public.list_active_promos(TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.list_active_promos(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_promos(TEXT) TO authenticated;

COMMENT ON FUNCTION public.list_active_promos IS
  'Item #4b: return Promo Produk rows for tenant. Filter: active|expiring_7d|expired|all. Cap 5000.';


-- ── get_promo_summary ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_promo_summary()
RETURNS TABLE(
  total_active INT,
  expiring_7d  INT,
  expired_30d  INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    total_active := 0; expiring_7d := 0; expired_30d := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE promo_expires_at IS NULL OR promo_expires_at > now())::INT,
    COUNT(*) FILTER (WHERE promo_expires_at BETWEEN now() AND now() + INTERVAL '7 days')::INT,
    COUNT(*) FILTER (WHERE promo_expires_at <= now() AND promo_expires_at > now() - INTERVAL '30 days')::INT
  INTO total_active, expiring_7d, expired_30d
  FROM public.stocks
  WHERE tenant_id = v_tenant AND promo_discount_type IS NOT NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_promo_summary() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_promo_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_promo_summary() TO authenticated;

COMMENT ON FUNCTION public.get_promo_summary IS
  'Item #4b: dashboard card metrics for Promo Produk.';
