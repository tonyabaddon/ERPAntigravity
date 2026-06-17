-- supabase/migrations/20260614000024_initial_stock_and_search_rpc.sql
-- Spec §2.5

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'initial_stock';

CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
  query_embedding VECTOR(768),
  match_threshold FLOAT DEFAULT 0.70,
  match_limit INT DEFAULT 5
) RETURNS TABLE (
  sku             VARCHAR(50),
  name            TEXT,
  category        VARCHAR(100),
  similarity      FLOAT,
  thumbnail_url   TEXT,
  total_stock     INT,
  warehouse_stock JSONB,
  price           NUMERIC,
  unit            TEXT,
  min_stock       INT
) LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT DISTINCT ON (e.sku)
      e.sku,
      1 - (e.embedding <=> query_embedding) AS similarity,
      e.embedding <=> query_embedding AS dist
    FROM public.stock_photo_embeddings e
    WHERE 1 - (e.embedding <=> query_embedding) >= match_threshold
    ORDER BY e.sku, e.embedding <=> query_embedding ASC
  ),
  warehouse_agg AS (
    SELECT
      sl.sku,
      jsonb_agg(jsonb_build_object(
        'warehouse_id', sl.warehouse_id,
        'code', w.code,
        'name', w.name,
        'qty', sl.qty
      ) ORDER BY w.sort_order) FILTER (WHERE sl.qty > 0) AS by_warehouse,
      SUM(sl.qty)::INT AS total
    FROM public.stock_levels sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id AND w.is_active = TRUE
    GROUP BY sl.sku
  )
  SELECT
    r.sku,
    s.name,
    s.category,
    r.similarity,
    (s.photo_urls->0->>'url')::TEXT AS thumbnail_url,
    COALESCE(wa.total, 0)::INT AS total_stock,
    COALESCE(wa.by_warehouse, '[]'::jsonb) AS warehouse_stock,
    s.price,
    s.unit,
    COALESCE(s.min_stock_per_product, 5) AS min_stock
  FROM ranked r
  JOIN public.stocks s ON s.sku = r.sku
  LEFT JOIN warehouse_agg wa ON wa.sku = r.sku
  WHERE s.initial_stock_approved = TRUE
  ORDER BY r.dist ASC
  LIMIT match_limit;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_by_embedding(VECTOR(768), FLOAT, INT)
  TO authenticated, anon, service_role;
