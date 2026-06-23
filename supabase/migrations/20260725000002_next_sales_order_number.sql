-- Atomic per-(channel, date) sequence for SO numbering.
-- Mirror of next_kasir_number pattern. Used by create_sales_order.

CREATE OR REPLACE FUNCTION public.next_sales_order_number(
  p_channel text,
  p_date    date
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_counter int;
BEGIN
  INSERT INTO public.sales_order_counters (channel, date, counter)
  VALUES (p_channel, p_date, 1)
  ON CONFLICT (channel, date)
    DO UPDATE SET counter = sales_order_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_sales_order_number(text, date) TO anon, authenticated;
