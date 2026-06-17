-- supabase/migrations/20260614000022_stock_photo_embeddings.sql
-- Enable pgvector + per-photo embeddings for Cari by Foto.
-- Spec §2.3.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.stock_photo_embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          VARCHAR(50) NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  photo_path   TEXT NOT NULL,
  description  TEXT NOT NULL,
  embedding    VECTOR(768) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku, photo_path)
);

CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_vector
  ON public.stock_photo_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_sku
  ON public.stock_photo_embeddings (sku);

ALTER TABLE public.stock_photo_embeddings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Read by authenticated (kasir needs to invoke search RPC which reads this)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_photo_embeddings' AND policyname='read all') THEN
    CREATE POLICY "read all" ON public.stock_photo_embeddings
      FOR SELECT TO authenticated, anon USING (true);
  END IF;
  -- Insert/update/delete by service role only (backend Go uses service role key)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_photo_embeddings' AND policyname='write service') THEN
    CREATE POLICY "write service" ON public.stock_photo_embeddings
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
