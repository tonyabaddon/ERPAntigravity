-- supabase/migrations/20260614000021_product_registries.sql
-- Registry tables for categories, brands, units. All with tenant_id NULL
-- for multi-tenant forward-compat (Spec §2.2 Change B).

CREATE TABLE IF NOT EXISTS public.product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES public.product_categories(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_name_unique_per_tenant
  ON public.product_categories (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.product_brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_brands_name_unique_per_tenant
  ON public.product_brands (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.product_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_units_name_unique_per_tenant
  ON public.product_units (tenant_id, lower(name));

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_brands     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_units      ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='read all') THEN
    CREATE POLICY "read all" ON public.product_categories FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_categories' AND policyname='insert all') THEN
    CREATE POLICY "insert all" ON public.product_categories FOR INSERT TO authenticated, anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_brands' AND policyname='read all') THEN
    CREATE POLICY "read all" ON public.product_brands FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_brands' AND policyname='insert all') THEN
    CREATE POLICY "insert all" ON public.product_brands FOR INSERT TO authenticated, anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_units' AND policyname='read all') THEN
    CREATE POLICY "read all" ON public.product_units FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_units' AND policyname='insert all') THEN
    CREATE POLICY "insert all" ON public.product_units FOR INSERT TO authenticated, anon WITH CHECK (true);
  END IF;
END $$;

-- Seed mirror of existing hardcoded list (StockManagerScreen.tsx CATEGORY_SPECS keys + brand list)
INSERT INTO public.product_categories (name) VALUES
  ('Panel'), ('MCB'), ('Kabel'), ('Aksesori')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_brands (name) VALUES
  ('Schneider'), ('ABB'), ('Chint'), ('Hager'), ('LS')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_units (name, is_default) VALUES
  ('pcs', TRUE), ('meter', FALSE), ('roll', FALSE),
  ('dus', FALSE), ('set', FALSE), ('unit', FALSE)
ON CONFLICT DO NOTHING;
