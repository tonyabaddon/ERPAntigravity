-- supabase/migrations/20260614000020_stocks_product_columns.sql
-- Extend stocks with: UoM base + alt, photo_urls JSONB, description,
-- min_stock_per_product, initial_stock_approved.
-- Spec: docs/superpowers/specs/2026-06-14-product-photo-search-design.md §2.1

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS subcategory            TEXT,
  ADD COLUMN IF NOT EXISTS unit                   TEXT NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS unit_alt               TEXT,
  ADD COLUMN IF NOT EXISTS unit_alt_factor        INT,
  ADD COLUMN IF NOT EXISTS photo_urls             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS min_stock_per_product  INT,
  ADD COLUMN IF NOT EXISTS initial_stock_approved BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_stocks_unit_alt'
  ) THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT chk_stocks_unit_alt CHECK (
        (unit_alt IS NULL AND unit_alt_factor IS NULL)
        OR (unit_alt IS NOT NULL AND unit_alt_factor IS NOT NULL AND unit_alt_factor > 1)
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_stocks_photo_urls_array'
  ) THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT chk_stocks_photo_urls_array CHECK (
        jsonb_typeof(photo_urls) = 'array' AND jsonb_array_length(photo_urls) <= 5
      );
  END IF;
END $$;
