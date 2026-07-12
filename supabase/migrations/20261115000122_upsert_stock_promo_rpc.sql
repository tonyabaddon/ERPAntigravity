-- 20261115000122_upsert_stock_promo_rpc.sql
-- Item #4b: owner set/edit/clear Promo Produk per SKU.
-- Idempotent (repeat with same args = no-op state).
-- See docs/superpowers/specs/2026-07-13-promo-produk-design.md §5.1

CREATE OR REPLACE FUNCTION public.upsert_stock_promo(
  p_sku                  TEXT,
  p_promo_discount_type  TEXT,
  p_promo_discount_value NUMERIC,
  p_promo_expires_at     TIMESTAMPTZ DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant     UUID;
  v_user_id    UUID;
  v_price      NUMERIC;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT price INTO v_price
  FROM public.stocks
  WHERE sku = p_sku AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SKU % tidak ditemukan di tenant', p_sku USING ERRCODE = '22023';
  END IF;

  -- Both NULL = clear promo
  IF p_promo_discount_type IS NULL AND p_promo_discount_value IS NULL THEN
    UPDATE public.stocks
       SET promo_discount_type  = NULL,
           promo_discount_value = NULL,
           promo_expires_at     = NULL,
           promo_updated_at     = now(),
           promo_updated_by     = v_user_id
     WHERE sku = p_sku AND tenant_id = v_tenant;
    RETURN;
  END IF;

  -- Consistency
  IF p_promo_discount_type IS NULL OR p_promo_discount_value IS NULL THEN
    RAISE EXCEPTION 'promo_discount_type dan promo_discount_value harus keduanya NULL atau keduanya isi';
  END IF;

  -- Type validation
  IF p_promo_discount_type NOT IN ('PERCENT','AMOUNT') THEN
    RAISE EXCEPTION 'promo_discount_type harus PERCENT atau AMOUNT';
  END IF;

  -- Value validation per type
  IF p_promo_discount_type = 'PERCENT' THEN
    IF p_promo_discount_value < 0.01 OR p_promo_discount_value > 100 THEN
      RAISE EXCEPTION 'PERCENT value harus 0.01 <= value <= 100';
    END IF;
  ELSIF p_promo_discount_type = 'AMOUNT' THEN
    IF p_promo_discount_value <= 0 THEN
      RAISE EXCEPTION 'AMOUNT value harus > 0';
    END IF;
    IF v_price IS NULL OR p_promo_discount_value > v_price THEN
      RAISE EXCEPTION 'AMOUNT value (Rp %) tidak boleh melebihi harga produk (Rp %)',
        p_promo_discount_value, COALESCE(v_price, 0);
    END IF;
  END IF;

  -- Expiry validation
  IF p_promo_expires_at IS NOT NULL AND p_promo_expires_at <= now() THEN
    RAISE EXCEPTION 'Tanggal berakhir harus di masa depan';
  END IF;

  UPDATE public.stocks
     SET promo_discount_type  = p_promo_discount_type,
         promo_discount_value = p_promo_discount_value,
         promo_expires_at     = p_promo_expires_at,
         promo_updated_at     = now(),
         promo_updated_by     = v_user_id
   WHERE sku = p_sku AND tenant_id = v_tenant;
END $$;

ALTER FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.upsert_stock_promo IS
  'Item #4b: owner set/edit/clear Promo Produk per SKU. Idempotent.';
