-- Phase A — Centralized channel whitelist validator.
-- Replaces inline `IF p_channel NOT IN (...)` checks in 3 record_kasir_sale variants.

CREATE OR REPLACE FUNCTION public.validate_sales_channel(p_channel TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_channel NOT IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ) THEN
    RAISE EXCEPTION 'invalid sales channel: % (expected one of 14 canonical channels)', p_channel;
  END IF;
END $$;

COMMENT ON FUNCTION public.validate_sales_channel(TEXT) IS
  'Raises exception if p_channel is not one of the 14 canonical sales channels. Called by record_kasir_sale RPC variants for input validation.';
