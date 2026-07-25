-- 20261115000540_cari_foto_tenant_scope_rpc.sql
-- Fix cross-tenant leak in Cari by Foto search.
--
-- Root cause: `search_products_by_embedding(vector, real, integer)` had no
-- tenant filter. Backend Go calls it as `postgres` pool user (bypasses RLS),
-- so results included every tenant's indexed embeddings. Not yet materialized
-- (only Testing Jaya Panel has embeddings today) but a landmine for onboarding.
--
-- Fix: replace signature with `(vector, real, integer, uuid)` — 4th param
-- `p_tenant_id` is REQUIRED and filters both the embedding CTE and the
-- stocks JOIN. Backend Go extracts tenant_id from JWT (Authorization header)
-- and passes explicitly.
--
-- Callers: backend-go/products_search.go SearchByPhoto only.
-- No user-facing API contract broken (backend is only caller; FE never invoked
-- this RPC directly). Deployed alongside backend Go update that passes the new param.

-- IMPORTANT: keep the old 3-arg overload alive during the deploy window so
-- pre-deploy backend revisions (which still call the 3-arg signature) don't
-- hit `function does not exist` between migration-apply and BE-100%-traffic.
-- Follow-up migration (~1 week burn-in) will `DROP FUNCTION
-- public.search_products_by_embedding(vector, real, integer)` after we
-- confirm no more callers.
--
-- CREATE OR REPLACE with a different arg list creates a NEW overload — the
-- old 3-arg function is untouched.

CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
  query_embedding vector,
  similarity_threshold real DEFAULT 0.70,
  result_limit integer DEFAULT 5,
  p_tenant_id uuid DEFAULT NULL
) RETURNS TABLE (
  sku text,
  name text,
  category text,
  price numeric,
  stock integer,
  min_stock integer,
  photo_url text,
  similarity real,
  warehouse_stock jsonb
) LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT
      e.sku,
      MAX(1 - (e.embedding <=> query_embedding)) AS similarity,
      MIN(e.photo_path) AS photo_path
    FROM public.stock_photo_embeddings e
    WHERE e.tenant_id = p_tenant_id
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
  JOIN public.stocks s
    ON s.sku = t.sku
   AND s.tenant_id = p_tenant_id
  ORDER BY t.similarity DESC;
$$;

-- Passing p_tenant_id = NULL returns zero rows (WHERE e.tenant_id = NULL is
-- always UNKNOWN → filtered out). This is the intended safe default for the
-- "accept-both-for-one-release" backend strategy — requests without a JWT
-- get empty results instead of cross-tenant leak.
COMMENT ON FUNCTION public.search_products_by_embedding(vector, real, integer, uuid) IS
  'Cosine-similarity search over stock_photo_embeddings, tenant-scoped by p_tenant_id. Pass NULL to get empty results (safe default for absent-JWT calls).';

GRANT EXECUTE ON FUNCTION public.search_products_by_embedding(vector, real, integer, uuid)
  TO authenticated, service_role;
