-- 20261115000153_fix_service_delivery_helper.sql
-- Item #2 hotfix: _process_service_line_delivery had 2 signature bugs
-- discovered during E2E smoke test.
--
-- Bug 1: called deduct_stock_fifo(sku, uuid, qty, warehouse) — wrong.
--        Real signature is (sku TEXT, qty INT, warehouse TEXT,
--        related_doc_type TEXT, related_doc_id TEXT) RETURNS NUMERIC.
--        Return value is total weighted cost (unit_cost × qty summed
--        across lots), not a JSONB.
--
-- Bug 2: did NOT decrement stocks.stock_atas / stock_bawah — only
--        stock_lots via FIFO. So invoices posted JE + FIFO-walked lots
--        but the physical stock counter stayed at pre-sale value.
--        Fixed by inlining a stock update (GREATEST(0, X - qty)) —
--        matches decrement_stock behavior. Named-args call to
--        decrement_stock hit an overload ambiguity (3 variants with
--        same param names but different types); inline is safer.
--
-- Verified via SQL smoke: stock_atas 10→7, hpp balanced, JE 6 lines
-- Debit=Credit=Rp 751.500 for 1 unit × Rp 500k service with 3× Rp 500
-- component + Rp 250k labor.

CREATE OR REPLACE FUNCTION public._process_service_line_delivery(
  p_order_id UUID, p_tenant UUID, p_user UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_line RECORD; v_comp RECORD; v_fifo_total_cost NUMERIC;
  v_total_material_cost NUMERIC := 0; v_total_labor NUMERIC := 0; v_total_revenue NUMERIC := 0;
  v_je_lines JSONB := '[]'::jsonb; v_je_result JSONB; v_je_id UUID;
  v_service_lines_count INT := 0; v_order_date DATE;
  v_customer_debit_account TEXT; v_line_material_cost NUMERIC;
  v_line_labor NUMERIC; v_line_revenue NUMERIC; v_line_hpp NUMERIC;
  v_warehouse TEXT;
BEGIN
  SELECT (created_at)::date INTO v_order_date FROM kasir_transactions WHERE id = p_order_id;
  SELECT CASE WHEN payment_type = 'TEMPO' THEN '1-1400' ELSE '1-1100' END
    INTO v_customer_debit_account FROM kasir_transactions WHERE id = p_order_id;

  FOR v_line IN
    SELECT rjl.*, sc.revenue_coa_code, sc.labor_cost_coa_code, sc.name AS service_name
    FROM rakit_job_lines rjl
    JOIN service_catalog sc ON sc.id = rjl.service_catalog_id
    WHERE rjl.transaction_id = p_order_id
      AND rjl.service_catalog_id IS NOT NULL
      AND rjl.hpp_final IS NULL
  LOOP
    v_service_lines_count := v_service_lines_count + 1;
    v_line_material_cost := 0;

    FOR v_comp IN
      SELECT * FROM rakit_components
      WHERE rakit_line_id = v_line.id AND sku IS NOT NULL AND qty > 0
    LOOP
      v_warehouse := COALESCE(v_comp.warehouse, 'atas');

      v_fifo_total_cost := public.deduct_stock_fifo(
        p_sku := v_comp.sku,
        p_qty := v_comp.qty::INTEGER,
        p_warehouse := v_warehouse,
        p_related_doc_type := 'service_delivery',
        p_related_doc_id := p_order_id::TEXT
      );

      -- Inline stock update (avoids decrement_stock overload ambiguity)
      IF v_warehouse = 'atas' THEN
        UPDATE public.stocks
          SET stock_atas = GREATEST(0, stock_atas - v_comp.qty::INTEGER),
              updated_at = now()
          WHERE sku = v_comp.sku AND tenant_id = p_tenant;
      ELSIF v_warehouse = 'bawah' THEN
        UPDATE public.stocks
          SET stock_bawah = GREATEST(0, stock_bawah - v_comp.qty::INTEGER),
              updated_at = now()
          WHERE sku = v_comp.sku AND tenant_id = p_tenant;
      END IF;

      UPDATE rakit_components
        SET fifo_cost_snapshot = v_fifo_total_cost / NULLIF(v_comp.qty, 0)
      WHERE id = v_comp.id;

      v_line_material_cost := v_line_material_cost + v_fifo_total_cost;
    END LOOP;

    v_line_labor := COALESCE(v_line.labor_cost, 0);
    v_line_revenue := COALESCE(v_line.final_price, 0);
    v_line_hpp := v_line_material_cost + v_line_labor;

    UPDATE rakit_job_lines SET hpp_final = v_line_hpp WHERE id = v_line.id;

    v_total_material_cost := v_total_material_cost + v_line_material_cost;
    v_total_labor := v_total_labor + v_line_labor;
    v_total_revenue := v_total_revenue + v_line_revenue;

    IF v_line_revenue > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_line.revenue_coa_code, 'side', 'CREDIT',
        'amount', v_line_revenue, 'description', 'Pendapatan ' || v_line.service_name));
    END IF;
    IF v_line_labor > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_line.labor_cost_coa_code, 'side', 'DEBIT',
        'amount', v_line_labor, 'description', 'Beban Tenaga Kerja ' || v_line.service_name));
    END IF;
    IF v_line_material_cost > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '5-1100', 'side', 'DEBIT',
        'amount', v_line_material_cost, 'description', 'HPP material ' || v_line.service_name));
    END IF;
  END LOOP;

  IF v_service_lines_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no service lines');
  END IF;

  IF v_total_revenue > 0 THEN
    v_je_lines := jsonb_build_array(jsonb_build_object(
      'account_code', v_customer_debit_account, 'side', 'DEBIT',
      'amount', v_total_revenue, 'description', 'Piutang order ' || p_order_id::text
    )) || v_je_lines;
  END IF;
  IF v_total_material_cost > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '1-1500', 'side', 'CREDIT',
      'amount', v_total_material_cost, 'description', 'Persediaan konsumsi ' || p_order_id::text));
  END IF;
  IF v_total_labor > 0 THEN
    v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '2-2100', 'side', 'CREDIT',
      'amount', v_total_labor, 'description', 'Utang gaji tenaga kerja ' || p_order_id::text));
  END IF;

  v_je_result := public._post_journal_entry(
    v_order_date, 'SERVICE_DELIVERY'::journal_entry_source,
    'Pengiriman layanan order ' || p_order_id::text,
    v_je_lines, 'kasir_transactions', p_order_id, p_tenant, NULL);
  v_je_id := (v_je_result->>'entry_id')::UUID;

  RETURN jsonb_build_object('ok', true, 'je_id', v_je_id,
    'total_revenue', v_total_revenue,
    'total_material_cost', v_total_material_cost,
    'total_labor', v_total_labor,
    'service_lines_count', v_service_lines_count);
END $function$;

ALTER FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._process_service_line_delivery(UUID, UUID, UUID) TO authenticated;
