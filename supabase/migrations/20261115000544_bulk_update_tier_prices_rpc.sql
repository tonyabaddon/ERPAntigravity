-- Task 7 (Phase 1b): bulk_update_tier_prices RPC
-- Widens bulk CSV price update to accept tier_3 + tier_4 in addition to price_grosir.
-- Replaces bulk_update_grosir_price for new CSV format; old RPC kept for backward-compat clients.
-- Auth: SECURITY DEFINER; caller must be Owner, Admin Stok, or Admin.
-- Modul guard: modul_multi_tier_price must be enabled in tenant_settings.

CREATE OR REPLACE FUNCTION public.bulk_update_tier_prices(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       text;
  v_tenant_id   uuid;
  v_role        text;
  v_modul_on    boolean;
  v_row         jsonb;
  v_sku         text;
  v_applied     int := 0;
  v_skipped     jsonb := '[]'::jsonb;
  v_grosir_baru   numeric;
  v_tier3_baru    numeric;
  v_tier4_baru    numeric;
  v_grosir_lama   numeric;
  v_tier3_lama    numeric;
  v_tier4_lama    numeric;
BEGIN
  -- Auth: resolve actor from admin_users
  SELECT au.name, au.role, au.tenant_id INTO v_actor, v_role, v_tenant_id
    FROM admin_users au
    WHERE au.id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: unknown caller';
  END IF;
  IF v_role NOT IN ('Owner','Admin Stok','Admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: role % cannot bulk-update prices', v_role;
  END IF;

  -- Modul guard (tenant-scoped)
  SELECT modul_multi_tier_price INTO v_modul_on
    FROM tenant_settings
   WHERE tenant_id = v_tenant_id;
  IF NOT v_modul_on THEN
    RAISE EXCEPTION 'MODUL_OFF: modul_multi_tier_price is disabled';
  END IF;

  -- Process each row
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows->'rows') LOOP
    v_sku := v_row->>'sku';

    -- Parse optional tier prices (NULL = skip that column)
    BEGIN
      v_grosir_baru := CASE WHEN v_row->>'price_grosir' IS NOT NULL AND v_row->>'price_grosir' <> ''
                            THEN (v_row->>'price_grosir')::numeric ELSE NULL END;
      v_tier3_baru  := CASE WHEN v_row->>'price_tier_3' IS NOT NULL AND v_row->>'price_tier_3' <> ''
                            THEN (v_row->>'price_tier_3')::numeric ELSE NULL END;
      v_tier4_baru  := CASE WHEN v_row->>'price_tier_4' IS NOT NULL AND v_row->>'price_tier_4' <> ''
                            THEN (v_row->>'price_tier_4')::numeric ELSE NULL END;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_numeric');
      CONTINUE;
    END;

    -- Skip row if no column to update
    IF v_grosir_baru IS NULL AND v_tier3_baru IS NULL AND v_tier4_baru IS NULL THEN
      CONTINUE;
    END IF;

    -- Validate prices > 0 when supplied
    IF (v_grosir_baru IS NOT NULL AND v_grosir_baru <= 0)
       OR (v_tier3_baru IS NOT NULL AND v_tier3_baru <= 0)
       OR (v_tier4_baru IS NOT NULL AND v_tier4_baru <= 0)
    THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'price_not_positive');
      CONTINUE;
    END IF;

    -- Lookup current values; skip if sku not found in tenant
    SELECT s.price_grosir, s.price_tier_3, s.price_tier_4
      INTO v_grosir_lama, v_tier3_lama, v_tier4_lama
      FROM stocks s
     WHERE s.sku = v_sku AND s.tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('sku', v_sku, 'reason', 'sku_not_found');
      CONTINUE;
    END IF;

    -- Update only the non-null columns
    UPDATE stocks SET
      price_grosir  = COALESCE(v_grosir_baru, price_grosir),
      price_tier_3  = COALESCE(v_tier3_baru,  price_tier_3),
      price_tier_4  = COALESCE(v_tier4_baru,  price_tier_4)
    WHERE sku = v_sku AND tenant_id = v_tenant_id;

    -- Audit log per updated column
    IF v_grosir_baru IS NOT NULL THEN
      INSERT INTO product_price_audit (sku, field, old_value, new_value, source, actor)
        VALUES (v_sku, 'price_grosir', v_grosir_lama, v_grosir_baru, 'bulk_csv', COALESCE(v_actor, 'unknown'));
    END IF;
    IF v_tier3_baru IS NOT NULL THEN
      INSERT INTO product_price_audit (sku, field, old_value, new_value, source, actor)
        VALUES (v_sku, 'price_tier_3', v_tier3_lama, v_tier3_baru, 'bulk_csv', COALESCE(v_actor, 'unknown'));
    END IF;
    IF v_tier4_baru IS NOT NULL THEN
      INSERT INTO product_price_audit (sku, field, old_value, new_value, source, actor)
        VALUES (v_sku, 'price_tier_4', v_tier4_lama, v_tier4_baru, 'bulk_csv', COALESCE(v_actor, 'unknown'));
    END IF;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_tier_prices(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_update_tier_prices(jsonb) TO authenticated;

COMMENT ON FUNCTION public.bulk_update_tier_prices IS
  'Bulk-update stocks price_grosir/price_tier_3/price_tier_4 from CSV upload. '
  'Each tier column is optional — NULL means "do not update that column for this row". '
  'Returns {applied, skipped:[{sku, reason}]}.';
