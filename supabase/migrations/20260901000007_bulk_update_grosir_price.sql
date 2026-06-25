-- Task 10: bulk_update_grosir_price RPC
-- Bulk-updates stocks.price_grosir from CSV upload and writes audit ledger rows.
-- Auth: SECURITY DEFINER; caller must be Owner, Admin Stok, or Admin.
-- Modul guard: modul_multi_tier_price must be enabled in tenant_settings.

CREATE OR REPLACE FUNCTION public.bulk_update_grosir_price(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       text;
  v_role        text;
  v_modul_on    boolean;
  v_row         jsonb;
  v_sku         text;
  v_new_price   numeric;
  v_old_price   numeric;
  v_applied     int := 0;
  v_skipped     jsonb := '[]'::jsonb;
BEGIN
  -- Auth: caller role check via admin_users (id IS the auth uuid)
  SELECT au.name, au.role INTO v_actor, v_role
    FROM admin_users au
    WHERE au.id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: unknown caller';
  END IF;
  IF v_role NOT IN ('Owner','Admin Stok','Admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: role % cannot bulk-update prices', v_role;
  END IF;

  -- Modul guard
  SELECT modul_multi_tier_price INTO v_modul_on FROM tenant_settings LIMIT 1;
  IF NOT v_modul_on THEN
    RAISE EXCEPTION 'MODUL_OFF: modul_multi_tier_price is disabled';
  END IF;

  -- Process each row
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows->'rows') LOOP
    v_sku := v_row->>'sku';

    -- Validate numeric price
    BEGIN
      v_new_price := (v_row->>'price_grosir')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_numeric');
      CONTINUE;
    END;

    IF v_new_price IS NULL OR v_new_price <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_numeric');
      CONTINUE;
    END IF;

    -- Lookup current price_grosir; skip if sku not found
    SELECT s.price_grosir INTO v_old_price FROM stocks s WHERE s.sku = v_sku;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'sku_not_found');
      CONTINUE;
    END IF;

    -- Update + audit
    UPDATE stocks SET price_grosir = v_new_price WHERE sku = v_sku;
    INSERT INTO product_price_audit (sku, field, old_value, new_value, source, actor)
      VALUES (v_sku, 'price_grosir', v_old_price, v_new_price, 'bulk_csv', COALESCE(v_actor, 'unknown'));
    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_grosir_price(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_update_grosir_price(jsonb) TO authenticated;

COMMENT ON FUNCTION public.bulk_update_grosir_price IS
  'Bulk-update stocks.price_grosir from CSV upload. Returns {applied, skipped:[{sku, reason}]}.';
