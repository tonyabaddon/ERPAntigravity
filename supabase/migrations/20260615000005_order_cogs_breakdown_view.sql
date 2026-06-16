-- supabase/migrations/20260615000005_order_cogs_breakdown_view.sql
-- View that allocates Order item COGS across linked PI items and falls back to
-- FIFO stock_lots for remainder. Used by Order detail "Sumber Pengadaan" column
-- + profit calc.
--
-- Note: orders.items is JSONB (no public.order_items table). Expand JSONB
-- via jsonb_array_elements WITH ORDINALITY. line_index = 1-based position in
-- the orders.items array, used as stable per-Order line key. Match PI items
-- to Order rows by sku within the same order_id.

BEGIN;

CREATE OR REPLACE VIEW public.order_cogs_breakdown AS
WITH order_lines AS (
  SELECT
    o.id AS order_id,
    idx AS line_index,
    item->>'sku' AS sku,
    COALESCE((item->>'qty')::int, 0) AS order_qty,
    COALESCE(
      (item->>'sell_price')::numeric,
      (item->>'price')::numeric,
      (item->>'unit_price')::numeric,
      0
    ) AS sell_price
  FROM public.orders o,
       jsonb_array_elements(o.items) WITH ORDINALITY AS t(item, idx)
  WHERE item ? 'sku'
),
pi_alloc AS (
  SELECT
    pii.sku,
    pi.order_id,
    pii.qty AS pi_qty,
    pii.unit_cost,
    pi.pi_number,
    pi.created_at AS pi_created_at
  FROM public.purchase_invoices pi
  JOIN public.purchase_invoice_items pii ON pii.pi_id = pi.id
  WHERE pi.voided_at IS NULL
    AND pi.order_id IS NOT NULL
    AND pi.type = 'PASSTHROUGH'
),
matched AS (
  SELECT
    ol.order_id,
    ol.line_index,
    ol.sku,
    ol.order_qty,
    ol.sell_price,
    pa.pi_number,
    pa.unit_cost AS pi_unit_cost,
    pa.pi_qty,
    pa.pi_created_at
  FROM order_lines ol
  LEFT JOIN pi_alloc pa
    ON pa.order_id = ol.order_id
   AND pa.sku = ol.sku
)
SELECT
  order_id,
  line_index,
  sku,
  order_qty,
  sell_price,
  (array_agg(pi_number ORDER BY pi_created_at NULLS LAST))[1] AS source_pi_number,
  (array_agg(pi_unit_cost ORDER BY pi_created_at NULLS LAST))[1] AS pi_unit_cost,
  LEAST(order_qty, COALESCE(SUM(pi_qty), 0)::int) AS qty_from_pi,
  GREATEST(order_qty - COALESCE(SUM(pi_qty), 0)::int, 0) AS qty_from_stock
FROM matched
GROUP BY order_id, line_index, sku, order_qty, sell_price;

GRANT SELECT ON public.order_cogs_breakdown TO authenticated;

COMMIT;
