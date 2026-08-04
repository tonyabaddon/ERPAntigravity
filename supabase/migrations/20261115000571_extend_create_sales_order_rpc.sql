-- ============================================================================
-- Extend create_sales_order to persist Penawaran template fields.
-- MINIMAL DIFF applied to current body: adds 8 new nullable columns to the
-- INSERT list; ALL existing validation / find-or-create / counter reservation
-- logic preserved verbatim from 20260725000003_create_sales_order_rpc.sql.
--
-- - No RPC signature change; still takes jsonb.
-- - No OWNER change (miss-log Entry #4: OWNER stays as-is; no new auth.*
--   reads added — client supplies created_by_name).
-- - Backward compatible: callers omitting new keys get NULLs persisted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_sales_order(p_payload jsonb)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so             public.sales_orders%ROWTYPE;
  v_channel        text;
  v_date           date;
  v_items          jsonb;
  v_subtotal       numeric;
  v_customer_id    text;
  v_customer_name  text;
  v_customer_phone text;
  v_customer_company text;
  v_notes          text;
  v_counter        int;
  v_prefix         text;
  v_so_number      text;
  v_actor          uuid;
BEGIN
  v_actor   := auth.uid();
  v_channel := COALESCE(p_payload->>'channel', '');
  v_date    := COALESCE((p_payload->>'date')::date, CURRENT_DATE);
  v_items   := COALESCE(p_payload->'items', '[]'::jsonb);
  v_subtotal := COALESCE((p_payload->>'subtotal')::numeric, 0);
  v_customer_id      := NULLIF(p_payload->>'customer_id', '');
  v_customer_name    := COALESCE(p_payload->>'customer_name', '');
  v_customer_phone   := NULLIF(p_payload->>'customer_phone', '');
  v_customer_company := NULLIF(p_payload->>'customer_company', '');
  v_notes            := NULLIF(p_payload->>'notes', '');

  PERFORM public.validate_sales_channel(v_channel);
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'p_items must contain at least one line';
  END IF;
  IF length(btrim(v_customer_name)) = 0 THEN
    RAISE EXCEPTION 'customer_name is required';
  END IF;

  -- Find-or-create customer (mirror record_kasir_sale lines 73-93)
  IF v_customer_id IS NULL
     AND v_customer_phone IS NOT NULL AND length(btrim(v_customer_phone)) > 0 THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE wa_number = btrim(v_customer_phone)
    LIMIT 1;
    IF v_customer_id IS NULL THEN
      v_customer_id := gen_random_uuid()::text;
      INSERT INTO public.customers (id, wa_number, name, company)
      VALUES (
        v_customer_id,
        btrim(v_customer_phone),
        btrim(v_customer_name),
        COALESCE(btrim(v_customer_company), '')
      )
      ON CONFLICT (wa_number) DO UPDATE
        SET name = EXCLUDED.name
      RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  -- Reserve SO number
  v_counter := public.next_sales_order_number(v_channel, v_date);
  v_prefix := CASE v_channel
    WHEN 'walkin'    THEN 'WLK'
    WHEN 'grosir'    THEN 'GSR'
    WHEN 'sales'     THEN 'SLS'
    WHEN 'expo'      THEN 'EXP'
    WHEN 'tokopedia' THEN 'TPD'
    WHEN 'shopee'    THEN 'SHP'
    WHEN 'lazada'    THEN 'LZD'
    WHEN 'blibli'    THEN 'BLB'
    WHEN 'bukalapak' THEN 'BKL'
    WHEN 'ralali'    THEN 'RLI'
    WHEN 'bhinneka'  THEN 'BHN'
    WHEN 'whatsapp'  THEN 'WAM'
    WHEN 'instagram' THEN 'IGM'
    WHEN 'website'   THEN 'WEB'
  END;
  v_so_number := 'SO-' || v_prefix
    || '-' || to_char(v_date, 'YYYYMMDD')
    || '-' || lpad(v_counter::text, 3, '0');

  INSERT INTO public.sales_orders (
    -- ORIGINAL 12 COLUMNS — preserved verbatim
    so_number, date, channel, items, subtotal,
    customer_id, customer_name, customer_phone, customer_company,
    notes, status, created_by,
    -- ADDED 8 NEW COLUMNS for Penawaran template (all nullable)
    customer_salutation,
    customer_contact_person,
    created_by_name,
    opening_greeting_override,
    payment_terms_override,
    lead_time_override,
    so_notes_override,
    valid_until_override
  ) VALUES (
    -- ORIGINAL 12 VALUES — preserved verbatim
    v_so_number, v_date, v_channel, v_items, v_subtotal,
    v_customer_id, v_customer_name, v_customer_phone, v_customer_company,
    v_notes, 'OPEN', v_actor,
    -- 8 NEW VALUES — read from p_payload with NULL fallback
    NULLIF(p_payload->>'customer_salutation', ''),
    NULLIF(p_payload->>'customer_contact_person', ''),
    NULLIF(p_payload->>'created_by_name', ''),
    NULLIF(p_payload->>'opening_greeting_override', ''),
    NULLIF(p_payload->>'payment_terms_override', ''),
    NULLIF(p_payload->>'lead_time_override', ''),
    NULLIF(p_payload->>'so_notes_override', ''),
    NULLIF(p_payload->>'valid_until_override', '')::date
  )
  RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sales_order(jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.create_sales_order(jsonb) IS
  'Create Penawaran/SO. Extended 2026-08-04 for template rework: added 8 nullable snapshot + override columns to the INSERT. All existing validation / find-or-create / counter logic preserved verbatim. created_by_name is client-supplied (see spec §4.3, miss-log Entry #4 avoidance). No new auth.* reads.';
