-- Atomic transition: walk-in order goes from WAITING_PAYMENT (or DP_VERIFIED)
-- to PAYMENT_VERIFIED, AND inserts the paired kasir_transactions income row
-- so the daily cashbook stays accurate.
--
-- Returns the new kasir_transactions row.

CREATE OR REPLACE FUNCTION public.mark_walkin_order_paid(
  p_order_id        uuid,
  p_payment_method  text,
  p_invoice_number  text,
  p_paid_date       date DEFAULT CURRENT_DATE
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql
AS $$
DECLARE
  v_order   public.orders%ROWTYPE;
  v_kasir   public.kasir_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF v_order.sales_channel <> 'walkin' THEN
    RAISE EXCEPTION 'order % is not a walk-in order (channel=%)',
      p_order_id, v_order.sales_channel;
  END IF;
  IF v_order.status = 'PAYMENT_VERIFIED' THEN
    RAISE EXCEPTION 'order % already paid', p_order_id;
  END IF;

  UPDATE public.orders
  SET status              = 'PAYMENT_VERIFIED',
      payment_verified_at = now(),
      updated_at          = now()
  WHERE id = p_order_id;

  INSERT INTO public.kasir_transactions (
    date, type, channel, items, subtotal, hpp_total,
    payment_method, customer_id, customer_name, customer_phone, customer_company,
    invoice_number
  ) VALUES (
    p_paid_date,
    'income',
    'walkin',
    COALESCE(v_order.items, '[]'::jsonb),
    COALESCE(v_order.total, 0),
    COALESCE(v_order.hpp_total, 0),
    p_payment_method::kasir_payment_method,
    v_order.customer_id,
    v_order.customer_name,
    v_order.customer_phone,
    v_order.customer_company,
    p_invoice_number
  )
  RETURNING * INTO v_kasir;

  RETURN v_kasir;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_walkin_order_paid(uuid, text, text, date) TO anon;
