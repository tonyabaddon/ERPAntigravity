-- 20260630000008 — orders.sales_channel CHECK: expand to full multi-channel set
--
-- Legacy CHECK allowed only ('walkin', 'whatsapp'). The wizard now exposes
-- the full 14-channel list driven by sales_channel_settings, and the TEMPO
-- path (create_tempo_invoice) inserts into orders.sales_channel directly.
-- Any non-(walkin|whatsapp) TEMPO sale fails with orders_sales_channel_check
-- violation.
--
-- The authoritative list lives in sales_channel_settings; mirror that here
-- so the CHECK keeps the column safe without coupling to runtime row reads.
-- Adding a channel = (1) seed sales_channel_settings + (2) extend this CHECK.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_sales_channel_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_sales_channel_check
  CHECK (sales_channel = ANY (ARRAY[
    'walkin', 'grosir', 'sales', 'expo',
    'tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka',
    'whatsapp', 'instagram', 'website'
  ]));
