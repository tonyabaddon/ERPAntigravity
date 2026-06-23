-- Create a Sales Order (Penawaran). No stock movement.
-- Find-or-create customer pattern mirrors record_kasir_sale.

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
    so_number, date, channel, items, subtotal,
    customer_id, customer_name, customer_phone, customer_company,
    notes, status, created_by
  ) VALUES (
    v_so_number, v_date, v_channel, v_items, v_subtotal,
    v_customer_id, v_customer_name, v_customer_phone, v_customer_company,
    v_notes, 'OPEN', v_actor
  )
  RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sales_order(jsonb) TO anon, authenticated;
