-- Mark a Sales Order as CONVERTED — called after Sales Invoice saved.
-- Exactly one target FK must be non-null:
--   p_target_kasir_tx_id → kasir_transactions (LUNAS/DP/WIP path)
--   p_target_order_id    → orders (TEMPO path)

CREATE OR REPLACE FUNCTION public.mark_sales_order_converted(
  p_so_id              text,
  p_target_kasir_tx_id uuid DEFAULT NULL,
  p_target_order_id    uuid DEFAULT NULL
)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so public.sales_orders%ROWTYPE;
  v_exists boolean;
BEGIN
  IF (p_target_kasir_tx_id IS NULL AND p_target_order_id IS NULL)
     OR (p_target_kasir_tx_id IS NOT NULL AND p_target_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one of p_target_kasir_tx_id or p_target_order_id must be non-null';
  END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales Order % not found', p_so_id;
  END IF;
  IF v_so.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Sales Order % status is %, expected OPEN', p_so_id, v_so.status;
  END IF;

  IF p_target_kasir_tx_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.kasir_transactions WHERE id = p_target_kasir_tx_id)
      INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'kasir_transactions row % not found', p_target_kasir_tx_id;
    END IF;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.orders WHERE id = p_target_order_id)
      INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'orders row % not found', p_target_order_id;
    END IF;
  END IF;

  UPDATE public.sales_orders
    SET status = 'CONVERTED',
        converted_to_kasir_tx_id = p_target_kasir_tx_id,
        converted_to_order_id = p_target_order_id
    WHERE id = p_so_id
    RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_sales_order_converted(text, uuid, uuid) TO anon, authenticated;
