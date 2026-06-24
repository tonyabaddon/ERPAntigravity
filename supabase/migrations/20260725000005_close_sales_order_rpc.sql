-- Manually close a Sales Order (lost deal, stale, customer ghosted).
-- Terminal state — closed SO cannot be reopened or converted.

CREATE OR REPLACE FUNCTION public.close_sales_order(
  p_so_id  text,
  p_reason text
)
RETURNS public.sales_orders
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_so public.sales_orders%ROWTYPE;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Close reason is required';
  END IF;

  SELECT * INTO v_so FROM public.sales_orders WHERE id = p_so_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sales Order % not found', p_so_id;
  END IF;
  IF v_so.status <> 'OPEN' THEN
    RAISE EXCEPTION 'Sales Order % status is %, expected OPEN', p_so_id, v_so.status;
  END IF;

  UPDATE public.sales_orders
    SET status = 'CLOSED', closed_reason = btrim(p_reason)
    WHERE id = p_so_id
    RETURNING * INTO v_so;

  RETURN v_so;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_sales_order(text, text) TO anon, authenticated;
