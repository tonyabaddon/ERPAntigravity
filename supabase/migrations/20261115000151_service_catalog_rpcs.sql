-- 20261115000151_service_catalog_rpcs.sql
-- Item #2: Service Catalog CRUD + attach-to-order RPCs.
-- All SECDEF owned by vosi_rpc_owner + REVOKE anon + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.save_service_catalog(p_data JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_user UUID; v_id UUID; v_bom JSONB; v_item JSONB;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  v_id := NULLIF(p_data->>'id', '')::UUID;
  IF v_id IS NULL THEN
    INSERT INTO public.service_catalog (
      tenant_id, name, description, category,
      default_labor_amount, default_include_material,
      invoice_display, revenue_coa_code, labor_cost_coa_code,
      is_active, created_by, updated_by
    ) VALUES (
      v_tenant, p_data->>'name', NULLIF(p_data->>'description', ''),
      NULLIF(p_data->>'category', ''),
      COALESCE((p_data->>'default_labor_amount')::NUMERIC, 0),
      COALESCE((p_data->>'default_include_material')::BOOLEAN, TRUE),
      COALESCE(p_data->>'invoice_display', 'lump_sum'),
      p_data->>'revenue_coa_code', p_data->>'labor_cost_coa_code',
      COALESCE((p_data->>'is_active')::BOOLEAN, TRUE), v_user, v_user
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.service_catalog SET
      name = p_data->>'name',
      description = NULLIF(p_data->>'description', ''),
      category = NULLIF(p_data->>'category', ''),
      default_labor_amount = COALESCE((p_data->>'default_labor_amount')::NUMERIC, 0),
      default_include_material = COALESCE((p_data->>'default_include_material')::BOOLEAN, TRUE),
      invoice_display = COALESCE(p_data->>'invoice_display', 'lump_sum'),
      revenue_coa_code = p_data->>'revenue_coa_code',
      labor_cost_coa_code = p_data->>'labor_cost_coa_code',
      is_active = COALESCE((p_data->>'is_active')::BOOLEAN, TRUE),
      updated_at = now(), updated_by = v_user
    WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'service_catalog % tidak ditemukan atau bukan tenant Anda', v_id;
    END IF;
  END IF;
  DELETE FROM public.service_catalog_bom WHERE service_catalog_id = v_id;
  v_bom := COALESCE(p_data->'bom', '[]'::JSONB);
  FOR v_item IN SELECT jsonb_array_elements(v_bom) LOOP
    INSERT INTO public.service_catalog_bom (
      service_catalog_id, component_sku, default_qty, notes, sort_order
    ) VALUES (
      v_id, v_item->>'component_sku', (v_item->>'default_qty')::NUMERIC,
      NULLIF(v_item->>'notes', ''), COALESCE((v_item->>'sort_order')::INT, 0)
    );
  END LOOP;
  RETURN v_id;
END $function$;

ALTER FUNCTION public.save_service_catalog(JSONB) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.save_service_catalog(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_catalog(JSONB) TO authenticated;


CREATE OR REPLACE FUNCTION public.soft_delete_service_catalog(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant UUID; v_user UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  UPDATE public.service_catalog SET is_active = FALSE, updated_at = now(), updated_by = v_user
  WHERE id = p_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_catalog % tidak ditemukan', p_id; END IF;
END $function$;

ALTER FUNCTION public.soft_delete_service_catalog(UUID) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.soft_delete_service_catalog(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_service_catalog(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.attach_service_to_order(
  p_order_id UUID, p_service_catalog_id UUID, p_qty NUMERIC,
  p_override_bom JSONB DEFAULT NULL, p_override_labor NUMERIC DEFAULT NULL,
  p_final_price NUMERIC DEFAULT NULL, p_invoice_display_override TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_user UUID; v_service RECORD; v_line_id UUID;
  v_labor NUMERIC; v_bom JSONB; v_item JSONB;
  v_effective_price NUMERIC; v_line_number INT; v_sku_name TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'qty harus > 0, got %', p_qty; END IF;
  SELECT * INTO v_service FROM public.service_catalog
    WHERE id = p_service_catalog_id AND tenant_id = v_tenant AND is_active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service_catalog % tidak ditemukan atau nonaktif', p_service_catalog_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kasir_transactions WHERE id = p_order_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'order % tidak ditemukan', p_order_id;
  END IF;
  v_labor := COALESCE(p_override_labor, v_service.default_labor_amount * p_qty, 0);
  v_effective_price := COALESCE(p_final_price, v_labor);
  IF v_effective_price <= 0 THEN RAISE EXCEPTION 'harga jual (final_price) harus > 0'; END IF;
  IF p_override_bom IS NOT NULL THEN
    v_bom := p_override_bom;
  ELSE
    SELECT jsonb_agg(jsonb_build_object(
      'component_sku', b.component_sku, 'qty', b.default_qty * p_qty,
      'service_catalog_bom_id', b.id
    ) ORDER BY b.sort_order) INTO v_bom
    FROM public.service_catalog_bom b WHERE b.service_catalog_id = p_service_catalog_id;
  END IF;
  v_bom := COALESCE(v_bom, '[]'::JSONB);
  SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_line_number
    FROM public.rakit_job_lines WHERE transaction_id = p_order_id;
  INSERT INTO public.rakit_job_lines (
    tenant_id, transaction_id, line_number, service_type, description,
    estimated_price, final_price, tracking_mode,
    labor_cost, lump_sum_hpp, service_catalog_id, invoice_display_override
  ) VALUES (
    v_tenant, p_order_id, v_line_number, 'jasa_custom_panel', v_service.name,
    v_effective_price, v_effective_price, 'detail',
    v_labor, 0, p_service_catalog_id, p_invoice_display_override
  ) RETURNING id INTO v_line_id;
  FOR v_item IN SELECT jsonb_array_elements(v_bom) LOOP
    SELECT name INTO v_sku_name FROM public.stocks WHERE sku = v_item->>'component_sku';
    IF v_sku_name IS NULL THEN v_sku_name := v_item->>'component_sku'; END IF;
    INSERT INTO public.rakit_components (
      tenant_id, rakit_line_id, sku, name, qty, service_catalog_bom_id
    ) VALUES (
      v_tenant, v_line_id, v_item->>'component_sku', v_sku_name,
      (v_item->>'qty')::NUMERIC,
      NULLIF(v_item->>'service_catalog_bom_id', '')::UUID
    );
  END LOOP;
  RETURN v_line_id;
END $function$;

ALTER FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_service_to_order(UUID, UUID, NUMERIC, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated;
