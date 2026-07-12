-- 20261115000123_bulk_upsert_stock_promo_rpc.sql
-- Item #4b: bulk apply Promo Produk to up to 500 SKUs (tolerant per-SKU).
-- Returns row-per-SKU status so UI can show partial success.
-- See docs/superpowers/specs/2026-07-13-promo-produk-design.md §5.2

CREATE OR REPLACE FUNCTION public.bulk_upsert_stock_promo(
  p_skus                 TEXT[],
  p_promo_discount_type  TEXT,
  p_promo_discount_value NUMERIC,
  p_promo_expires_at     TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(sku TEXT, ok BOOLEAN, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deduped TEXT[];
  v_sku     TEXT;
BEGIN
  IF p_skus IS NULL OR array_length(p_skus, 1) IS NULL THEN
    RETURN;
  END IF;

  IF array_length(p_skus, 1) > 500 THEN
    RAISE EXCEPTION 'Maksimum 500 SKU per bulk call (input: %)', array_length(p_skus, 1);
  END IF;

  SELECT ARRAY(SELECT DISTINCT unnest(p_skus)) INTO v_deduped;

  FOREACH v_sku IN ARRAY v_deduped LOOP
    BEGIN
      PERFORM public.upsert_stock_promo(v_sku, p_promo_discount_type, p_promo_discount_value, p_promo_expires_at);
      sku := v_sku;
      ok := true;
      error_message := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      sku := v_sku;
      ok := false;
      error_message := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

ALTER FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ)
  TO authenticated;

COMMENT ON FUNCTION public.bulk_upsert_stock_promo IS
  'Item #4b: bulk apply Promo Produk to N SKUs (max 500). Tolerant mode: per-SKU status returned.';
