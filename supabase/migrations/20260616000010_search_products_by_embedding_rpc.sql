-- 20260616000010_search_products_by_embedding_rpc.sql
-- pgvector cosine-similarity search over stock_photo_embeddings.

CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
  query_embedding vector(512),
  similarity_threshold REAL DEFAULT 0.70,
  result_limit INT DEFAULT 5
) RETURNS TABLE (
  sku TEXT,
  name TEXT,
  category TEXT,
  price NUMERIC,
  stock INT,
  min_stock INT,
  photo_url TEXT,
  similarity REAL,
  warehouse_stock JSONB
) LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT
      e.sku,
      MAX(1 - (e.embedding <=> query_embedding)) AS similarity,
      MIN(e.photo_path) AS photo_path
    FROM public.stock_photo_embeddings e
    GROUP BY e.sku
  ),
  top AS (
    SELECT * FROM ranked
    WHERE similarity >= similarity_threshold
    ORDER BY similarity DESC
    LIMIT result_limit
  )
  SELECT
    s.sku::TEXT,
    s.name::TEXT,
    s.category::TEXT,
    s.price::NUMERIC,
    s.stock,
    COALESCE(s.min_stock_per_product, 0) AS min_stock,
    t.photo_path AS photo_url,
    t.similarity,
    jsonb_build_object('atas', COALESCE(s.stock_atas, 0), 'bawah', COALESCE(s.stock_bawah, 0)) AS warehouse_stock
  FROM top t
  JOIN public.stocks s ON s.sku = t.sku
  ORDER BY t.similarity DESC;
$$;

GRANT EXECUTE ON FUNCTION public.search_products_by_embedding(vector, REAL, INT) TO authenticated, service_role;
