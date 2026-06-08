-- Walk-in orders polish: relax NOT NULL constraints that the WhatsApp flow
-- required but walk-in drafts cannot satisfy, and harden mark_walkin_order_paid
-- against invalid state transitions and bad payment method input.

-- 1) Allow walk-in draft orders to have no source conversation or booking expiry.
ALTER TABLE public.orders ALTER COLUMN conversation_id    DROP NOT NULL;
ALTER TABLE public.orders ALTER COLUMN booking_expires_at DROP NOT NULL;

-- 2) Replace the RPC with a version that:
--    (a) whitelists source states explicitly,
--    (b) validates payment_method up-front with a clear error.
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
  IF p_payment_method NOT IN ('cash','transfer','qris') THEN
    RAISE EXCEPTION 'invalid payment_method: % (expected cash|transfer|qris)', p_payment_method;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;
  IF v_order.sales_channel <> 'walkin' THEN
    RAISE EXCEPTION 'order % is not a walk-in order (channel=%)',
      p_order_id, v_order.sales_channel;
  END IF;
  IF v_order.status NOT IN (
    'WAITING_PAYMENT', 'PAYMENT_UPLOADED',
    'WAITING_DP',      'DP_UPLOADED', 'DP_VERIFIED'
  ) THEN
    RAISE EXCEPTION 'order % cannot be marked paid from status %',
      p_order_id, v_order.status;
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
