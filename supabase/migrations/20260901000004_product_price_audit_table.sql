-- Audit ledger for price changes (manual edit + bulk CSV).
-- FK to stocks(sku) because this schema does not have products(id).
CREATE TABLE IF NOT EXISTS public.product_price_audit (
  id           BIGSERIAL PRIMARY KEY,
  sku          TEXT NOT NULL REFERENCES public.stocks(sku) ON UPDATE CASCADE,
  field        TEXT NOT NULL,
  old_value    NUMERIC(14,2),
  new_value    NUMERIC(14,2),
  source       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_audit_field_check'
  ) THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_field_check
      CHECK (field IN ('price','price_grosir'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_price_audit_source_check'
  ) THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_source_check
      CHECK (source IN ('manual_edit','bulk_csv','rpc'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_price_audit_sku_time
  ON public.product_price_audit(sku, created_at DESC);

ALTER TABLE public.product_price_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'product_price_audit' AND policyname = 'authenticated read audit'
  ) THEN
    CREATE POLICY "authenticated read audit"
      ON public.product_price_audit FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

GRANT SELECT ON public.product_price_audit TO authenticated;
