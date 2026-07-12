-- 20261115000120_stocks_promo_schema.sql
-- Item #4b: Promo Produk — schema for per-SKU promo (Layer 1 discount).
-- Owner sets in advance; kasir wizard auto-applies at cart line.
-- See docs/superpowers/specs/2026-07-13-promo-produk-design.md §4.

ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS promo_discount_type   TEXT,
  ADD COLUMN IF NOT EXISTS promo_discount_value  NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS promo_expires_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_by      UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_type_check') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_type_check
      CHECK (promo_discount_type IS NULL OR promo_discount_type IN ('PERCENT','AMOUNT'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_value_positive') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_value_positive
      CHECK (promo_discount_value IS NULL OR promo_discount_value > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_type_value_consistency') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_type_value_consistency CHECK (
        (promo_discount_type IS NULL AND promo_discount_value IS NULL)
        OR (promo_discount_type IS NOT NULL AND promo_discount_value IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stocks_promo_percent_range') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT stocks_promo_percent_range CHECK (
        promo_discount_type <> 'PERCENT'
        OR (promo_discount_value >= 0.01 AND promo_discount_value <= 100)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stocks_active_promo
  ON public.stocks (tenant_id, promo_expires_at)
  WHERE promo_discount_type IS NOT NULL;

COMMENT ON COLUMN public.stocks.promo_discount_type IS
  'Item #4b Promo Produk: PERCENT or AMOUNT (Rp per unit). NULL = no active promo.';
COMMENT ON COLUMN public.stocks.promo_discount_value IS
  'Item #4b Promo Produk: value in units of promo_discount_type. PERCENT: 0.01-100. AMOUNT: > 0 and <= stocks.price (enforced at RPC).';
COMMENT ON COLUMN public.stocks.promo_expires_at IS
  'Item #4b Promo Produk: NULL = permanent. Non-NULL = cut-off; after now() > expires_at, promo treated as inactive.';
