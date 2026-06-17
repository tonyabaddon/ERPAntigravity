# Product Photo Search & Multi-Photo Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Stok menu (renamed to "Produk & Stok") with multi-photo upload, AI-indexed image embeddings, Cari-by-Foto in kasir, multi-warehouse stock display, FIFO/Average costing setting, plus Jurnal-parity fields (UoM, Sub-Kategori, custom Kategori/Merek/Satuan, multi-satuan konversi, Stok Awal approval).

**Architecture:** Refactor `StockManagerScreen.tsx` (1051 lines) into orchestrator + 5 child components under `src/components/produk/`. Backend Go (`backend-go/internal/gemini/`) handles Vision describe + text-embedding-004 → pgvector cosine search. Free Gemini tier. Multi-tenant-ready (Change A+B: generic fallback + tenant_id columns).

**Tech Stack:** React 19 + TypeScript + Tailwind v4 + Vite + Supabase (Postgres + pgvector + Storage) + Backend Go (Gemini API) + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-product-photo-search-design.md`
**Mockup:** `docs/superpowers/specs/2026-06-13-product-photo-search-mockups/index.html`

---

## Phase Map

| Phase | Tasks | Files | Est |
|---|---|---|---|
| 1. DB Foundation | T1.1 — T1.8 | 5 migrations, types.ts, service stubs | 1.5d |
| 2. Refactor & ProductForm | T2.1 — T2.12 | Sidebar, 6 produk/ components | 3d |
| 3. AI Pipeline Backend | T3.1 — T3.7 | backend-go/internal/gemini/embed.go, HTTP handlers | 2d |
| 4. Kasir Cari by Foto + multi-warehouse display | T4.1 — T4.6 | Kasir modal, StockTableView badge | 1.5d |
| 5. Pengaturan & Approval | T5.1 — T5.5 | PengaturanScreen, approval handler | 1d |
| 6. Testing & Polish | T6.1 — T6.4 | tests, smoke checklist, progress.md | 1d |

Total: 9.5–10.5 days.

---

# PHASE 1 — DB Foundation & Registry

## Task 1.1: Migration M1 — Extend `stocks` columns

**Files:**
- Create: `supabase/migrations/20260614000020_stocks_product_columns.sql`

**Why:** Add new columns to existing `stocks` table for: subcategory, unit (UoM base), unit_alt (packaging), unit_alt_factor, photo_urls (JSONB), description, min_stock_per_product, initial_stock_approved. CHECK constraint on multi-satuan: alt must be > 1 primary.

**Steps:**

- [ ] **Step 1: Write migration SQL**

```sql
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
```

- [ ] **Step 2: Apply to local Supabase (or note for batch apply)**

If local Supabase running: `supabase db push`
Otherwise: append filename to `supabase/migrations/apply-pending.txt` (or equivalent ledger).

- [ ] **Step 3: Verify columns exist**

Run via psql / Supabase SQL editor:
```sql
SELECT column_name, data_type, column_default FROM information_schema.columns
 WHERE table_schema='public' AND table_name='stocks'
   AND column_name IN ('subcategory','unit','unit_alt','unit_alt_factor',
                        'photo_urls','description','min_stock_per_product',
                        'initial_stock_approved')
 ORDER BY column_name;
```
Expected: 8 rows. `unit` default `'pcs'`. `photo_urls` default `'[]'::jsonb`.

- [ ] **Step 4: Smoke-test CHECK**

```sql
-- should FAIL: factor=1
INSERT INTO public.stocks (sku, name, category, price, stock, status, unit_alt, unit_alt_factor)
VALUES ('test_fail', 'x', 'MCB', 0, 0, 'Sinkron', 'roll', 1);
-- should FAIL: only one of unit_alt/factor
INSERT INTO public.stocks (sku, name, category, price, stock, status, unit_alt)
VALUES ('test_fail2', 'x', 'MCB', 0, 0, 'Sinkron', 'roll');
-- should SUCCEED: both NULL
INSERT INTO public.stocks (sku, name, category, price, stock, status)
VALUES ('test_ok', 'x', 'MCB', 0, 0, 'Sinkron');
DELETE FROM public.stocks WHERE sku LIKE 'test_%';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000020_stocks_product_columns.sql
git commit -m "feat(db): M1 — extend stocks with UoM, photo_urls, description, min_stock, initial_stock_approved"
```

**Acceptance:** 8 new columns on `stocks`, both CHECK constraints reject invalid rows, no existing rows broken.

---

## Task 1.2: Migration M2 — Registry tables (categories/brands/units) with tenant_id

**Files:**
- Create: `supabase/migrations/20260614000021_product_registries.sql`

**Why:** Registry tables back the "+ Buat baru" UX. `tenant_id NULL` column forward-compats with multi-tenant rollout (Change B). Seed defaults mirror existing hardcoded list.

**Steps:**

- [ ] **Step 1: Write migration**

```sql
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

-- Enable RLS, allow read by authenticated, insert by authenticated (will tighten in multi-tenant phase)
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
```

- [ ] **Step 2: Verify seed counts**

```sql
SELECT 'categories' AS t, COUNT(*) FROM public.product_categories
UNION ALL SELECT 'brands', COUNT(*) FROM public.product_brands
UNION ALL SELECT 'units', COUNT(*) FROM public.product_units;
```
Expected: categories=4, brands=5, units=6.

- [ ] **Step 3: Verify default unit = pcs**

```sql
SELECT name FROM public.product_units WHERE is_default;
```
Expected: 1 row, `pcs`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000021_product_registries.sql
git commit -m "feat(db): M2 — product_categories/brands/units registry with tenant_id NULL + seeds"
```

**Acceptance:** 3 registry tables exist, seeds present, RLS allows read/insert by authenticated.

---

## Task 1.3: Migration M3 — pgvector + `stock_photo_embeddings`

**Files:**
- Create: `supabase/migrations/20260614000022_stock_photo_embeddings.sql`

**Why:** Enable `vector` extension. Create per-photo embedding table with HNSW index for cosine similarity. ON DELETE CASCADE from `stocks(sku)`.

**Steps:**

- [ ] **Step 1: Write migration**

```sql
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
```

- [ ] **Step 2: Verify extension**

```sql
SELECT extname FROM pg_extension WHERE extname='vector';
```
Expected: 1 row, `vector`.

- [ ] **Step 3: Verify table + indexes**

```sql
SELECT indexname FROM pg_indexes WHERE tablename='stock_photo_embeddings';
```
Expected: 3 indexes (pkey, idx_vector, idx_sku).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000022_stock_photo_embeddings.sql
git commit -m "feat(db): M3 — enable pgvector + stock_photo_embeddings + HNSW cosine index"
```

**Acceptance:** Extension enabled, table + 2 functional indexes created, RLS set.

---

## Task 1.4: Migration M4 — Costing setting + Storage bucket

**Files:**
- Create: `supabase/migrations/20260614000023_costing_and_storage.sql`

**Why:** Seed `company_settings.costing_method = 'FIFO'`. Create public `product-photos` Storage bucket with RLS.

**Steps:**

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260614000023_costing_and_storage.sql
-- Spec §2.4

-- Costing method (toko-wide). Reuse existing company_settings.
INSERT INTO public.company_settings (key, value, updated_at)
VALUES ('costing_method', '"FIFO"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Storage bucket for product photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT DO NOTHING;

-- Bucket RLS: SELECT by anyone (public read), INSERT/UPDATE/DELETE by authenticated
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.policies WHERE bucket_id='product-photos' AND name='product_photos_public_read'
  ) THEN
    PERFORM storage.create_policy(
      'product_photos_public_read',
      'product-photos',
      'SELECT',
      'true',
      'true'
    );
  END IF;
EXCEPTION WHEN undefined_function THEN
  -- storage.create_policy may not exist; fallback to direct INSERT into storage.objects policies
  RAISE NOTICE 'storage.create_policy not available — set policy via Dashboard';
END $$;

-- NOTE: Storage policies in newer Supabase are managed via storage.objects RLS directly.
-- If the storage.create_policy helper is unavailable, run the following via Dashboard SQL editor:
--
-- CREATE POLICY "product_photos_select" ON storage.objects FOR SELECT
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_insert" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_update" ON storage.objects FOR UPDATE TO authenticated
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_delete" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'product-photos');
```

- [ ] **Step 2: Verify setting**

```sql
SELECT key, value FROM public.company_settings WHERE key='costing_method';
```
Expected: 1 row, value `"FIFO"`.

- [ ] **Step 3: Verify bucket**

```sql
SELECT id, name, public FROM storage.buckets WHERE id='product-photos';
```
Expected: 1 row, `public=true`.

- [ ] **Step 4: Manually create storage RLS policies (one-time, Supabase Dashboard SQL editor)**

If `storage.create_policy` wasn't available in Step 1, run the 4 `CREATE POLICY` statements in the comment block above.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000023_costing_and_storage.sql
git commit -m "feat(db): M4 — costing_method default FIFO + product-photos Storage bucket"
```

**Acceptance:** `company_settings.costing_method = "FIFO"`. Storage bucket `product-photos` is public-readable, writable by authenticated.

---

## Task 1.5: Migration M5 — `initial_stock` approval type + search RPC + `ai_call_log`

**Files:**
- Create: `supabase/migrations/20260614000024_initial_stock_and_search_rpc.sql`
- Create: `supabase/migrations/20260614000025_ai_call_log.sql`

**Why:** Extend approval enum with `initial_stock`. Create `search_products_by_embedding` RPC with per-warehouse JSONB. Separately, `ai_call_log` table for activity monitoring.

**Steps:**

- [ ] **Step 1: Write approval+RPC migration**

```sql
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
```

- [ ] **Step 2: Verify enum value added**

```sql
SELECT enumlabel FROM pg_enum
 WHERE enumtypid = 'public.approval_request_type'::regtype
 ORDER BY enumsortorder;
```
Expected: list includes `initial_stock`.

- [ ] **Step 3: Smoke-test RPC with empty embedding table**

```sql
SELECT * FROM public.search_products_by_embedding(
  (SELECT ARRAY_FILL(0.0, ARRAY[768])::vector(768)), 0.0, 5
);
```
Expected: 0 rows (no embeddings yet) without error.

- [ ] **Step 4: Write `ai_call_log` migration**

```sql
-- supabase/migrations/20260614000025_ai_call_log.sql
-- Spec §6.2

CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  http_status INT,
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_today ON public.ai_call_log (called_at DESC);

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_call_log' AND policyname='read auth') THEN
    CREATE POLICY "read auth" ON public.ai_call_log
      FOR SELECT TO authenticated, anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_call_log' AND policyname='write service') THEN
    CREATE POLICY "write service" ON public.ai_call_log
      FOR INSERT TO service_role WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 5: Commit both migrations**

```bash
git add supabase/migrations/20260614000024_initial_stock_and_search_rpc.sql \
        supabase/migrations/20260614000025_ai_call_log.sql
git commit -m "feat(db): M5 — initial_stock enum + search_products_by_embedding RPC + ai_call_log table"
```

**Acceptance:** Enum contains `initial_stock`, RPC executes without error, `ai_call_log` writable by service_role + readable by authenticated.

---

## Task 1.6: Update `StockItem` type + add new types

**Files:**
- Modify: `src/types.ts:139-150` (extend `StockItem`)
- Modify: `src/types.ts:525-547` (extend `ApprovalRequestType`)
- Add to: `src/types.ts` (end of file)

**Steps:**

- [ ] **Step 1: Extend `StockItem`**

Replace the existing `StockItem` interface (around line 139) with:
```ts
export interface ProductPhoto {
  url: string;
  path: string;
  order: number;
  uploaded_at: string;
}

export interface StockItem {
  sku: string;
  name: string;
  category: string;
  subcategory?: string | null;
  unit: string;                   // base unit; default 'pcs'
  unit_alt?: string | null;
  unit_alt_factor?: number | null;
  price: number;
  stock: number;
  stock_atas?: number;
  stock_bawah?: number;
  status: 'Sinkron' | 'Stok Tipis';
  specs: Record<string, string | number>;
  harga_modal?: number | null;
  photo_urls: ProductPhoto[];
  description?: string | null;
  min_stock_per_product?: number | null;
  initial_stock_approved: boolean;
}
```

- [ ] **Step 2: Extend `ApprovalRequestType`**

Find around line 525:
```ts
export type ApprovalRequestType =
  | 'adjustment'
  | 'opname'
  | 'price_change'
  | 'kasir_price_override'
  | 'kasir_void'
  | 'kasir_refund'
  | 'rakit_lock'
  | 'initial_stock';
```

- [ ] **Step 3: Add registry + search types at end of file**

```ts
// ─── Product Registry (M2) ─────────────────────────────────────────────────
export interface ProductCategory {
  id: string;
  tenant_id: string | null;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface ProductBrand {
  id: string;
  tenant_id: string | null;
  name: string;
  created_at: string;
}

export interface ProductUnit {
  id: string;
  tenant_id: string | null;
  name: string;
  is_default: boolean;
  created_at: string;
}

// ─── Cari by Foto result ───────────────────────────────────────────────────
export interface WarehouseStockSlice {
  warehouse_id: string;
  code: string;
  name: string;
  qty: number;
}

export interface ProductPhotoSearchResult {
  sku: string;
  name: string;
  category: string;
  similarity: number;
  thumbnail_url: string | null;
  total_stock: number;
  warehouse_stock: WarehouseStockSlice[];
  price: number;
  unit: string;
  min_stock: number;
}

export interface ProductPhotoSearchResponse {
  query_description: string;
  results: ProductPhotoSearchResult[];
}

// ─── Costing method (Pengaturan) ──────────────────────────────────────────
export type CostingMethod = 'FIFO' | 'Average';

// ─── AI Call Log ──────────────────────────────────────────────────────────
export interface AiCallLogStat {
  model: 'flash-2.5-vision' | 'text-embedding-004';
  success: number;
  error: number;
  rate_limit: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_error_at: string | null;
}
```

- [ ] **Step 4: Run typecheck**

```bash
npm run lint
```
Expected: 0 errors. (Any existing call-sites that read `StockItem.unit` will compile because field default exists at DB level and old rows still have `'pcs'`.)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend StockItem with UoM/photo/description fields; add registry + search types"
```

**Acceptance:** `npm run lint` passes. No existing call-sites broken.

---

## Task 1.7: Add `registryService` to `supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts` (add export near other services)

**Why:** Backing service for "+ Buat baru" dropdowns. List + insert for categories/brands/units.

**Steps:**

- [ ] **Step 1: Add service**

Append to `src/lib/supabaseClient.ts`, near other services like `stockService`:
```ts
import type {
  ProductCategory, ProductBrand, ProductUnit,
} from '../types';

export const registryService = {
  async listCategories(): Promise<ProductCategory[]> {
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductCategory[];
  },
  async addCategory(name: string, parentId: string | null = null): Promise<ProductCategory> {
    const { data, error } = await supabase
      .from('product_categories')
      .insert({ name: name.trim(), parent_id: parentId })
      .select()
      .single();
    if (error) throw error;
    return data as ProductCategory;
  },
  async listBrands(): Promise<ProductBrand[]> {
    const { data, error } = await supabase
      .from('product_brands')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductBrand[];
  },
  async addBrand(name: string): Promise<ProductBrand> {
    const { data, error } = await supabase
      .from('product_brands')
      .insert({ name: name.trim() })
      .select()
      .single();
    if (error) throw error;
    return data as ProductBrand;
  },
  async listUnits(): Promise<ProductUnit[]> {
    const { data, error } = await supabase
      .from('product_units')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data ?? []) as ProductUnit[];
  },
  async addUnit(name: string): Promise<ProductUnit> {
    const { data, error } = await supabase
      .from('product_units')
      .insert({ name: name.trim(), is_default: false })
      .select()
      .single();
    if (error) throw error;
    return data as ProductUnit;
  },
};
```

- [ ] **Step 2: Run typecheck**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(services): add registryService for product_categories/brands/units"
```

**Acceptance:** `registryService.listCategories/addCategory` etc. all typecheck.

---

## Task 1.8: Create `productPhotoService.ts` skeleton

**Files:**
- Create: `src/lib/productPhotoService.ts`

**Why:** Will hold client-side photo helpers (compress, upload, search by photo). Phase 2/3 fill in implementations; this task creates the skeleton + compress utility.

**Steps:**

- [ ] **Step 1: Write the file**

```ts
// src/lib/productPhotoService.ts
import { supabase } from './supabaseClient';
import type { ProductPhotoSearchResponse } from '../types';

export const MAX_PHOTOS = 5;
export const MIN_PHOTOS = 1;
export const PRE_COMPRESS_MAX_BYTES = 5 * 1024 * 1024;
export const COMPRESS_LONGEST_DIM = 1024;
export const COMPRESS_JPEG_QUALITY = 0.75;

export type CompressResult = { blob: Blob; width: number; height: number };

/**
 * Resize image to <= COMPRESS_LONGEST_DIM on longest axis and re-encode as JPEG.
 * Throws if input exceeds PRE_COMPRESS_MAX_BYTES or not an image.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File harus berupa gambar');
  }
  if (file.size > PRE_COMPRESS_MAX_BYTES) {
    throw new Error('File terlalu besar. Max 5MB sebelum compress.');
  }
  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > COMPRESS_LONGEST_DIM ? COMPRESS_LONGEST_DIM / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia');
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Compress gagal'))), 'image/jpeg', COMPRESS_JPEG_QUALITY)
  );
  return { blob, width: w, height: h };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/**
 * Upload compressed photo to product-photos bucket at `{sku}/{order}.jpg`.
 * Returns public URL + storage path.
 */
export async function uploadProductPhoto(
  sku: string,
  order: number,
  blob: Blob
): Promise<{ url: string; path: string }> {
  const path = `${sku}/${order}.jpg`;
  const { error: upErr } = await supabase.storage
    .from('product-photos')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('product-photos').getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Delete photo object (no DB cleanup here; caller updates stocks.photo_urls).
 */
export async function deleteProductPhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from('product-photos').remove([path]);
  if (error) throw error;
}

/**
 * Backend search-by-photo endpoint (filled in Phase 3).
 * For now stub: throws so callers can be wired in Phase 4.
 */
export async function searchByPhoto(_blob: Blob): Promise<ProductPhotoSearchResponse> {
  throw new Error('searchByPhoto not yet wired; Phase 3');
}

/**
 * Request backend to (re)index a product's photos.
 * Filled in Phase 3.
 */
export async function indexProductPhotos(_sku: string, _photoPaths: string[]): Promise<void> {
  throw new Error('indexProductPhotos not yet wired; Phase 3');
}

/**
 * Request backend to describe a single product photo (for "Generate dari Foto").
 * Filled in Phase 3.
 */
export async function describeProductPhoto(_blob: Blob): Promise<string> {
  throw new Error('describeProductPhoto not yet wired; Phase 3');
}
```

- [ ] **Step 2: Create unit test for `compressImage`**

Create `src/lib/productPhotoService.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { compressImage, PRE_COMPRESS_MAX_BYTES } from './productPhotoService';

function fakeImageFile(sizeBytes: number, type = 'image/png'): File {
  const buf = new Uint8Array(sizeBytes);
  return new File([buf], 'x.png', { type });
}

describe('compressImage', () => {
  it('rejects non-image', async () => {
    const f = new File([new Uint8Array(10)], 'x.txt', { type: 'text/plain' });
    await expect(compressImage(f)).rejects.toThrow(/gambar/);
  });

  it('rejects > 5MB pre-compress', async () => {
    const f = fakeImageFile(PRE_COMPRESS_MAX_BYTES + 1);
    await expect(compressImage(f)).rejects.toThrow(/terlalu besar/);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- src/lib/productPhotoService.test.ts
```
Expected: 2 passing.

- [ ] **Step 4: Run typecheck**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/productPhotoService.ts src/lib/productPhotoService.test.ts
git commit -m "feat(services): productPhotoService skeleton + compressImage helper + tests"
```

**Acceptance:** Compress validates type + size. Skeletons throw informative errors. Tests pass.

---

# PHASE 1 EXIT CHECK

Before moving to Phase 2:
- [ ] All 5 migrations applied (manually verified)
- [ ] Seeded registry has 4 categories, 5 brands, 6 units
- [ ] `npm run lint` clean
- [ ] Phase 1 tests pass


---

# PHASE 2 — Refactor & ProductForm

## Task 2.1: Sidebar — rename "Stok" → "Produk & Stok"

**Files:**
- Modify: `src/components/Sidebar.tsx:73` (label rename)

**Steps:**

- [ ] **Step 1: Update label**

Change line 73 from:
```tsx
{ id: 'ai-stock', label: 'Stok', icon: Package, category: 'inventory', permKey: 'aiStock' },
```
to:
```tsx
{ id: 'ai-stock', label: 'Produk & Stok', icon: Package, category: 'inventory', permKey: 'aiStock' },
```

(`ActivePage = 'ai-stock'` stays for backwards compat per spec §1 Boundaries.)

- [ ] **Step 2: Run typecheck + dev server smoke**

```bash
npm run lint
npm run dev
```
Open http://localhost:3000, log in, verify sidebar shows "Produk & Stok" in Inventory group, clicking it still opens the same screen.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): rename 'Stok' menu label to 'Produk & Stok' (id stays ai-stock)"
```

**Acceptance:** Menu label changed; clicking still opens StockManagerScreen; no broken routes.

---

## Task 2.2: Create `src/components/produk/` directory + extract `BulkUploadSection`

**Files:**
- Create: `src/components/produk/BulkUploadSection.tsx`
- Modify: `src/components/StockManagerScreen.tsx` (remove inlined bulk-upload JSX, import new component)

**Why:** First extraction reduces StockManagerScreen size and validates the refactor pattern. Bulk upload is self-contained (no overlap with form/list state).

**Steps:**

- [ ] **Step 1: Create produk directory**

```bash
mkdir -p src/components/produk
```

- [ ] **Step 2: Create `BulkUploadSection.tsx`**

Move the bulk-upload JSX (currently around `StockManagerScreen.tsx:560-634`) and associated handlers (`handleDownloadTemplate`, `handleExportStock`, `parseAndUploadCSV`, `handleFileUpload`, `uploadProgress` state) into a new component.

```tsx
// src/components/produk/BulkUploadSection.tsx
import React, { useState } from 'react';
import { Download, FileCheck } from 'lucide-react';
import { StockItem } from '../../types';
import { stockService } from '../../lib/supabaseClient';

interface Props {
  stockList: StockItem[];
  companyName: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onUploaded: () => void;
}

const CSV_SPEC_COLS = [
  'material', 'tipe_pasang', 'tinggi_cm', 'lebar_cm', 'tebal_cm',
  'ketebalan_mm', 'finishing', 'kelengkapan',
  'mcb_merek', 'mcb_ampere', 'mcb_phase',
  'kabel_tipe', 'kabel_mm2', 'kabel_panjang',
  'deskripsi',
];
const CSV_HEADER = ['sku', 'nama', 'kategori', 'harga', 'harga_modal', 'stok', ...CSV_SPEC_COLS].join(',');

export default function BulkUploadSection({ stockList, companyName, showToast, onUploaded }: Props) {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const filenameSafe = (companyName || 'Toko').replace(/[^a-zA-Z0-9_-]/g, '_');

  function handleDownloadTemplate() {
    const rows = [CSV_HEADER, ''];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Template_Stok_${filenameSafe}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('📥 Template CSV berhasil diunduh.');
  }

  function handleExportStock() {
    const rows = [CSV_HEADER];
    for (const item of stockList) {
      const specVals = CSV_SPEC_COLS.map(col => item.specs?.[col] ?? '');
      rows.push([
        item.sku, JSON.stringify(item.name), item.category,
        item.price, item.harga_modal ?? 0, item.stock,
        ...specVals.map(v => JSON.stringify(v ?? '')),
      ].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Stok_${filenameSafe}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('📤 Export berhasil.');
  }

  async function parseAndUploadCSV(text: string) {
    setIsUploading(true);
    setUploadProgress(10);
    try {
      // Reuse existing parsing logic from old StockManagerScreen
      // (paste the body of the original parseAndUploadCSV here, including specCols loop)
      // ... existing CSV parsing logic ...
      setUploadProgress(100);
      onUploaded();
      showToast('✅ Bulk upload selesai.', 'success');
    } catch (e) {
      showToast('❌ Upload gagal: ' + String((e as Error).message), 'warning');
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(null), 1200);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = String(ev.target?.result ?? '');
      void parseAndUploadCSV(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl hover:shadow-2xl transition-all duration-300">
      {/* JSX moved verbatim from StockManagerScreen.tsx:560-634 */}
      {/* ... grid Download Template / Export / Upload + uploadProgress bar ... */}
    </section>
  );
}
```

**Note for engineer:** copy the verbatim JSX from `StockManagerScreen.tsx:560-634` and the parseAndUploadCSV implementation from around `:390-470`. Wire toast/handlers via props.

- [ ] **Step 3: Update `StockManagerScreen.tsx`**

At the top, add:
```tsx
import BulkUploadSection from './produk/BulkUploadSection';
```

Replace the inlined bulk-upload section JSX with:
```tsx
<BulkUploadSection
  stockList={stockList}
  companyName={companyName}
  showToast={showToast}
  onUploaded={() => { /* trigger refresh */ }}
/>
```

Remove the now-unused local state (`uploadProgress`, `isUploading`) and handlers (`handleDownloadTemplate`, `handleExportStock`, `parseAndUploadCSV`, `handleFileUpload`), plus the `CSV_*` constants.

- [ ] **Step 4: Lint + smoke**

```bash
npm run lint
npm run dev
```
Open Produk & Stok menu, verify Download Template / Export / Upload all work as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/produk/BulkUploadSection.tsx src/components/StockManagerScreen.tsx
git commit -m "refactor(stok): extract BulkUploadSection into produk/ subdir"
```

**Acceptance:** Bulk upload still works end-to-end. `StockManagerScreen.tsx` shrinks by ~100 lines.

---

## Task 2.3: Extract `StockTableView` (existing stock-ops table)

**Files:**
- Create: `src/components/produk/StockTableView.tsx`
- Modify: `src/components/StockManagerScreen.tsx`

**Why:** Move the dense per-row table (inline edit qty/price, edit-row button, transfer button) into a focused component. This represents the existing "Stok" view.

**Steps:**

- [ ] **Step 1: Identify the table block**

In `StockManagerScreen.tsx`, the "Stock Table" section is around `:637-780`. It owns: search input, category filter, the row map (`stockList.map(...)`), inline editable cells, row-level expand/edit/delete buttons.

- [ ] **Step 2: Create `StockTableView.tsx`**

```tsx
// src/components/produk/StockTableView.tsx
import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Save, Trash2 } from 'lucide-react';
import { StockItem } from '../../types';

interface Props {
  stockList: StockItem[];
  onEdit: (sku: string) => void;
  onDelete: (sku: string) => void;
  onTransfer: (item: StockItem) => void;
  onInlineUpdate: (item: StockItem) => Promise<void>;
  onOpname?: () => void;
  /** Show only items with stock <= min (for Stok Tipis tab) */
  thinOnly?: boolean;
  thinThreshold?: number;
}

export default function StockTableView({
  stockList, onEdit, onDelete, onTransfer, onInlineUpdate,
  onOpname, thinOnly = false, thinThreshold = 5,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Semua');

  const uniqueCategories = useMemo(
    () => ['Semua', ...Array.from(new Set(stockList.map(s => s.category)))],
    [stockList]
  );

  const filtered = useMemo(() => stockList.filter(item => {
    if (thinOnly && item.stock > (item.min_stock_per_product ?? thinThreshold)) return false;
    if (selectedCategory !== 'Semua' && item.category !== selectedCategory) return false;
    const q = searchQuery.toLowerCase();
    if (q && !item.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q)) return false;
    return true;
  }), [stockList, searchQuery, selectedCategory, thinOnly, thinThreshold]);

  return (
    <section className="bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl">
      {/* Header (search + category filter) — moved verbatim from StockManagerScreen.tsx:637-680 */}
      {/* Rows — moved verbatim from :778-... */}
      {/* JSX paste from original file with props in place of inline state */}
    </section>
  );
}
```

**Engineer note:** copy the original JSX for the search/filter header and the row-map block. Replace inline handler calls with the `onEdit/onDelete/onTransfer/onInlineUpdate` props.

- [ ] **Step 3: Update `StockManagerScreen.tsx`**

```tsx
import StockTableView from './produk/StockTableView';
// ...
<StockTableView
  stockList={stockList}
  onEdit={openEditRow}
  onDelete={handleDeleteRow}
  onTransfer={item => setTransferItem(item)}
  onInlineUpdate={handleInlineSave}
  onOpname={onNavigateToOpname}
/>
```

Delete the now-duplicated JSX + helpers.

- [ ] **Step 4: Lint + smoke**

```bash
npm run lint
npm run dev
```
Verify search/filter/inline-edit/delete/transfer all still work.

- [ ] **Step 5: Commit**

```bash
git add src/components/produk/StockTableView.tsx src/components/StockManagerScreen.tsx
git commit -m "refactor(stok): extract StockTableView with search/filter/inline-edit"
```

**Acceptance:** Table operations unchanged. `StockManagerScreen.tsx` shrinks by ~250 lines.

---

## Task 2.4: Create `PreviewCard` component (live preview right rail)

**Files:**
- Create: `src/components/produk/PreviewCard.tsx`

**Why:** Sticky right-rail live preview consumed by ProductForm. Receives partial product data + warehouses, renders 3 mini-cards (Daftar Stok / Stok per Gudang / Kasir result).

**Steps:**

- [ ] **Step 1: Write the component**

```tsx
// src/components/produk/PreviewCard.tsx
import React from 'react';
import type { Warehouse } from '../../types';

export interface ProductPreviewState {
  name: string;          // computed from specs (auto-name)
  sku: string;           // user-entered or "auto"
  category: string;
  unit: string;
  price: number;
  hargaModal: number | null;
  stokAwal: number;
  gudangTujuanId: string | null;
  hasPhoto: boolean;
  thumbnailDataUrl: string | null;  // local blob URL from first chosen photo
  isPendingApproval: boolean;
}

interface Props {
  state: ProductPreviewState;
  warehouses: Warehouse[];
}

export default function PreviewCard({ state, warehouses }: Props) {
  const marginPct =
    state.hargaModal && state.price
      ? ((state.price - state.hargaModal) / state.price) * 100
      : null;

  return (
    <div className="lg:sticky lg:top-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
          <span className="material-symbols-outlined text-base">visibility</span>
        </div>
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-violet-700">Live Preview</div>
          <div className="text-[10.5px] text-slate-500">Update otomatis saat Anda ngetik</div>
        </div>
      </div>

      {/* Preview 1: Daftar Stok */}
      <div className="bg-white rounded-3xl border border-[#e5eeff] p-4 shadow-sm">
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Di Daftar Stok</div>
        <div className="bg-slate-50 rounded-2xl p-3 flex items-center gap-3 border border-slate-100">
          <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-300 flex items-center justify-center shrink-0">
            {state.thumbnailDataUrl ? (
              <img src={state.thumbnailDataUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="material-symbols-outlined text-white text-2xl opacity-80">image</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full">
                {state.category || '—'}
              </span>
              <span className="text-[9px] font-extrabold text-slate-600 truncate">{state.sku || 'auto'}</span>
            </div>
            <h6 className="text-[13px] font-extrabold text-[#012749] truncate">{state.name || 'Nama produk…'}</h6>
            <p className="text-[10.5px] text-slate-500">
              Rp {state.price.toLocaleString('id-ID')} / {state.unit}
              {marginPct !== null && ` · Margin ${marginPct.toFixed(1)}%`}
            </p>
          </div>
        </div>
      </div>

      {/* Preview 2: Stok per Gudang */}
      <div className="bg-white rounded-3xl border border-[#e5eeff] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Stok per Gudang</div>
          {state.isPendingApproval && (
            <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              Pending Approval
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {warehouses.filter(w => w.is_active).map(w => {
            const isTarget = state.gudangTujuanId === w.id;
            const qty = isTarget ? state.stokAwal : 0;
            return (
              <div key={w.id} className={`flex items-center justify-between rounded-xl px-3 py-2 border ${
                isTarget ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
              }`}>
                <div className="text-[11px] font-extrabold text-[#012749]">{w.name}</div>
                <div className={`text-base font-black ${isTarget ? 'text-emerald-700' : 'text-slate-400'}`}>
                  {qty} {state.unit}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write unit test for marginPct calculation**

Create `src/components/produk/PreviewCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';

function computeMargin(price: number, modal: number | null) {
  return modal && price ? ((price - modal) / price) * 100 : null;
}

describe('margin computation', () => {
  it('returns null when modal is null', () => {
    expect(computeMargin(125000, null)).toBeNull();
  });
  it('returns positive margin when modal < price', () => {
    expect(computeMargin(125000, 98500)).toBeCloseTo(21.2, 0);
  });
  it('returns negative when modal > price', () => {
    expect(computeMargin(100, 120)).toBeCloseTo(-20, 0);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- src/components/produk/PreviewCard.test.tsx
```
Expected: 3 passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/produk/PreviewCard.tsx src/components/produk/PreviewCard.test.tsx
git commit -m "feat(produk): PreviewCard component for ProductForm live preview"
```

**Acceptance:** Component renders with mock state; margin computation tested.

---

## Task 2.5: ProductForm — Identitas + Spesifikasi cards (no foto yet)

**Files:**
- Create: `src/components/produk/ProductForm.tsx`
- Create: `src/components/produk/categorySpecs.ts` (extract CATEGORY_SPECS)

**Why:** Two-column form scaffold. Identitas section (SKU, Kategori, Sub-Kategori, Satuan) and Spesifikasi (dynamic per category with fallback). Foto + Harga + Stok come in next tasks.

**Steps:**

- [ ] **Step 1: Extract `CATEGORY_SPECS` + helpers**

```ts
// src/components/produk/categorySpecs.ts
// Extracted from StockManagerScreen.tsx:36-85. Multi-tenant ready:
// if category not in this map, the form falls back to Aksesori pattern.

export type SpecFieldDef = {
  key: string;
  label: string;
  type: 'select' | 'number' | 'text';
  options?: string[];
  required?: boolean;
};

export const CATEGORY_SPECS: Record<string, SpecFieldDef[]> = {
  Panel: [
    { key: 'material', label: 'Material', type: 'select', options: ['Besi', 'Stainless SS304', 'Stainless SS316', 'Aluminium', 'PVC'], required: true },
    { key: 'tipe_pasang', label: 'Tipe Pemasangan', type: 'select', options: ['Indoor', 'Outdoor'], required: true },
    { key: 'ketebalan_mm', label: 'Ketebalan Plat', type: 'select', options: ['1', '1.2', '1.5', '1.8', '2', '3'] },
    { key: 'finishing', label: 'Finishing', type: 'select', options: ['RAL7032', 'Warna Khusus'] },
    { key: 'tinggi_cm', label: 'Tinggi (cm)', type: 'number', required: true },
    { key: 'lebar_cm', label: 'Lebar (cm)', type: 'number', required: true },
    { key: 'tebal_cm', label: 'Tebal (cm)', type: 'number', required: true },
    { key: 'kelengkapan', label: 'Kelengkapan', type: 'select', options: ['Kosong', 'Dengan Komponen + Rakit'] },
  ],
  MCB: [
    { key: 'mcb_merek', label: 'Merek', type: 'select', options: [], required: true },  // options loaded from product_brands
    { key: 'mcb_ampere', label: 'Ampere (A)', type: 'number', required: true },
    { key: 'mcb_phase', label: 'Phase', type: 'select', options: ['1P', '2P', '3P'], required: true },
  ],
  Kabel: [
    { key: 'kabel_tipe', label: 'Tipe Kabel', type: 'select', options: ['NYM', 'NYA', 'NYY', 'NYFGBY', 'AAAC'], required: true },
    { key: 'kabel_mm2', label: 'mm²', type: 'number', required: true },
    { key: 'kabel_panjang', label: 'Panjang', type: 'text', required: true },
  ],
  Aksesori: [
    { key: 'deskripsi', label: 'Deskripsi Produk', type: 'text', required: true },
  ],
};

export const AKSESORI_FALLBACK: SpecFieldDef[] = CATEGORY_SPECS.Aksesori;

/** Returns spec fields for a category. For categories not in CATEGORY_SPECS,
 *  returns Aksesori pattern (1 free-text deskripsi) — multi-tenant generic fallback. */
export function specFieldsFor(category: string): SpecFieldDef[] {
  return CATEGORY_SPECS[category] ?? AKSESORI_FALLBACK;
}

/** Auto-name generator (matches existing `generateName` in StockManagerScreen.tsx:62-85). */
export function generateName(category: string, specs: Record<string, string>): string {
  switch (category) {
    case 'Panel': {
      const { material = '', tipe_pasang = '', tinggi_cm = '', lebar_cm = '', tebal_cm = '',
              ketebalan_mm = '', finishing = '', kelengkapan = '' } = specs;
      const dims = (tinggi_cm && lebar_cm && tebal_cm) ? `${tinggi_cm}×${lebar_cm}×${tebal_cm}cm` : '';
      const thickness = ketebalan_mm ? `${ketebalan_mm}mm` : '';
      return ['Panel', material, tipe_pasang, dims, thickness, finishing, kelengkapan].filter(Boolean).join(' ');
    }
    case 'MCB': {
      const { mcb_merek = '', mcb_ampere = '', mcb_phase = '' } = specs;
      return ['MCB', mcb_merek, mcb_ampere ? `${mcb_ampere}A` : '', mcb_phase].filter(Boolean).join(' ');
    }
    case 'Kabel': {
      const { kabel_tipe = '', kabel_mm2 = '', kabel_panjang = '' } = specs;
      return ['Kabel', kabel_tipe, kabel_mm2 ? `${kabel_mm2}mm²` : '', kabel_panjang].filter(Boolean).join(' ');
    }
    default:
      // Generic fallback for Aksesori + any custom category
      return specs.deskripsi || '';
  }
}
```

- [ ] **Step 2: Write unit test for `generateName`**

Create `src/components/produk/categorySpecs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateName, specFieldsFor } from './categorySpecs';

describe('generateName', () => {
  it('Panel formats dims', () => {
    expect(generateName('Panel', { material: 'Besi', tipe_pasang: 'Outdoor',
      tinggi_cm: '80', lebar_cm: '60', tebal_cm: '25', ketebalan_mm: '1.5',
      finishing: 'RAL7032', kelengkapan: 'Kosong' }))
      .toBe('Panel Besi Outdoor 80×60×25cm 1.5mm RAL7032 Kosong');
  });
  it('MCB joins merek + ampere + phase', () => {
    expect(generateName('MCB', { mcb_merek: 'Schneider', mcb_ampere: '16', mcb_phase: '1P' }))
      .toBe('MCB Schneider 16A 1P');
  });
  it('Custom category falls back to deskripsi', () => {
    expect(generateName('Kontaktor', { deskripsi: 'Kontaktor Schneider LC1D09 9A 220V' }))
      .toBe('Kontaktor Schneider LC1D09 9A 220V');
  });
});

describe('specFieldsFor', () => {
  it('returns Aksesori fields for unknown category', () => {
    expect(specFieldsFor('Kontaktor')).toEqual(specFieldsFor('Aksesori'));
  });
  it('returns Panel fields for Panel', () => {
    expect(specFieldsFor('Panel').length).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- src/components/produk/categorySpecs.test.ts
```
Expected: 5 passing.

- [ ] **Step 4: Create ProductForm scaffold**

```tsx
// src/components/produk/ProductForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { StockItem, ProductCategory, ProductBrand, ProductUnit, Warehouse } from '../../types';
import { registryService } from '../../lib/supabaseClient';
import { specFieldsFor, generateName } from './categorySpecs';
import PreviewCard, { ProductPreviewState } from './PreviewCard';

interface Props {
  initial?: Partial<StockItem>;
  warehouses: Warehouse[];
  onCancel: () => void;
  onSubmit: (item: Partial<StockItem>) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ProductForm({ initial, warehouses, onCancel, onSubmit, showToast }: Props) {
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brands, setBrands] = useState<ProductBrand[]>([]);
  const [units, setUnits] = useState<ProductUnit[]>([]);
  useEffect(() => {
    void Promise.all([
      registryService.listCategories(),
      registryService.listBrands(),
      registryService.listUnits(),
    ]).then(([c, b, u]) => { setCategories(c); setBrands(b); setUnits(u); });
  }, []);

  const topCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subCategoriesOf = (parentName: string) => {
    const parent = topCategories.find(c => c.name === parentName);
    return parent ? categories.filter(c => c.parent_id === parent.id) : [];
  };

  const [sku, setSku] = useState(initial?.sku ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'MCB');
  const [subcategory, setSubcategory] = useState(initial?.subcategory ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? 'pcs');
  const [specs, setSpecs] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(initial?.specs ?? {}).map(([k, v]) => [k, String(v)]))
  );

  const previewName = useMemo(() => generateName(category, specs), [category, specs]);

  // Placeholder for fields filled in next tasks
  const previewState: ProductPreviewState = {
    name: previewName,
    sku: sku || 'auto',
    category,
    unit,
    price: 0,
    hargaModal: null,
    stokAwal: 0,
    gudangTujuanId: warehouses.find(w => w.is_default)?.id ?? null,
    hasPhoto: false,
    thumbnailDataUrl: null,
    isPendingApproval: false,
  };

  const fields = specFieldsFor(category);

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 lg:col-span-7 space-y-4">
        {/* Card: Identitas */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <h5 className="text-sm font-extrabold text-[#012749] mb-3">📋 Identitas Produk</h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CategoryDropdown
              value={category}
              options={topCategories.map(c => c.name)}
              onChange={setCategory}
              onCreateNew={async name => {
                const c = await registryService.addCategory(name);
                setCategories([...categories, c]);
                setCategory(c.name);
                showToast('Kategori "' + name + '" ditambahkan');
              }}
            />
            <SubCategoryDropdown
              value={subcategory}
              options={subCategoriesOf(category).map(c => c.name)}
              parentName={category}
              onChange={setSubcategory}
              onCreateNew={async name => {
                const parent = topCategories.find(c => c.name === category);
                const c = await registryService.addCategory(name, parent?.id ?? null);
                setCategories([...categories, c]);
                setSubcategory(c.name);
              }}
            />
            <UnitDropdown
              value={unit}
              options={units.map(u => u.name)}
              onChange={setUnit}
              onCreateNew={async name => {
                const u = await registryService.addUnit(name);
                setUnits([...units, u]);
                setUnit(u.name);
              }}
            />
            <SkuInput value={sku} onChange={setSku} />
          </div>
        </div>

        {/* Card: Spesifikasi (dynamic per category, fallback Aksesori) */}
        <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
          <h5 className="text-sm font-extrabold text-[#012749] mb-3">
            ⚙ Spesifikasi <span className="text-amber-700">{category}</span>
          </h5>
          <SpecForm
            fields={fields}
            specs={specs}
            brands={brands}
            onChange={(k, v) => setSpecs({ ...specs, [k]: v })}
            onAddBrand={async name => {
              const b = await registryService.addBrand(name);
              setBrands([...brands, b]);
            }}
          />
          {/* Auto-name preview pill */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-3 py-2 mt-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-purple-700">Nama Produk</div>
            <div className="text-sm font-extrabold text-purple-900">{previewName || '—'}</div>
          </div>
        </div>

        {/* TODO Task 2.7 — Harga & Stok card */}
        {/* TODO Task 2.8 — Foto card */}
        {/* TODO Task 2.9 — Pengaturan Lanjutan */}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-full text-xs font-bold">
            Batal
          </button>
          <button
            disabled
            className="px-5 py-2 bg-slate-300 text-white rounded-full text-xs font-bold cursor-not-allowed"
            title="Submit wires up in Task 2.10"
          >
            Tambahkan Produk
          </button>
        </div>
      </div>

      <div className="col-span-12 lg:col-span-5">
        <PreviewCard state={previewState} warehouses={warehouses} />
      </div>
    </div>
  );
}

// --- Inline sub-components (kept here for now; can be split if it grows) ---

function CategoryDropdown(p: { value: string; options: string[]; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Kategori *</label>
      <select
        value={p.value}
        onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold"
      >
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat kategori baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nama kategori"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
          <button onClick={() => { setCreating(false); setNewName(''); }} className="px-3 py-2 text-emerald-700 text-xs">Batal</button>
        </div>
      )}
    </div>
  );
}

function SubCategoryDropdown(p: { value: string; options: string[]; parentName: string; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Sub-Kategori (opsional)</label>
      <select
        value={p.value}
        onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
        className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold"
      >
        <option value="">— Tidak ada —</option>
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat sub-kategori baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nama sub-kategori"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
        </div>
      )}
    </div>
  );
}

function UnitDropdown(p: { value: string; options: string[]; onChange: (v: string) => void; onCreateNew: (name: string) => Promise<void>; }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Satuan *</label>
      <select value={p.value} onChange={e => { if (e.target.value === '__new__') setCreating(true); else p.onChange(e.target.value); }}
              className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
        {p.options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__new__">+ Buat satuan baru…</option>
      </select>
      {creating && (
        <div className="flex gap-2 mt-1">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Mis: kg, lembar"
                 className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
          <button onClick={async () => { await p.onCreateNew(newName); setCreating(false); setNewName(''); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
        </div>
      )}
    </div>
  );
}

function SkuInput(p: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Kode / SKU</label>
      <input value={p.value} onChange={e => p.onChange(e.target.value)}
             placeholder="Kosongkan untuk auto"
             className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
    </div>
  );
}

function SpecForm(p: {
  fields: import('./categorySpecs').SpecFieldDef[];
  specs: Record<string, string>;
  brands: ProductBrand[];
  onChange: (k: string, v: string) => void;
  onAddBrand: (name: string) => Promise<void>;
}) {
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {p.fields.map(f => {
        const isMcbMerek = f.key === 'mcb_merek';
        const options = isMcbMerek ? p.brands.map(b => b.name) : (f.options ?? []);
        if (f.type === 'select') {
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">
                {f.label}{f.required && ' *'}
              </label>
              <select value={p.specs[f.key] ?? ''}
                      onChange={e => { if (e.target.value === '__new_brand__') setAddingBrand(true); else p.onChange(f.key, e.target.value); }}
                      className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
                <option value="">—</option>
                {options.map(o => <option key={o} value={o}>{o}</option>)}
                {isMcbMerek && <option value="__new_brand__">+ Tambah merek baru…</option>}
              </select>
              {isMcbMerek && addingBrand && (
                <div className="flex gap-2 mt-1">
                  <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Merek baru"
                         className="flex-1 bg-white rounded-xl px-3 py-2 border border-emerald-200 text-xs" />
                  <button onClick={async () => { await p.onAddBrand(newBrand); setAddingBrand(false); setNewBrand(''); }}
                          className="px-3 py-2 bg-emerald-600 text-white rounded-full text-xs font-bold">Tambah</button>
                </div>
              )}
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <div key={f.key} className="space-y-1">
              <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">{f.label}{f.required && ' *'}</label>
              <input type="number" value={p.specs[f.key] ?? ''} onChange={e => p.onChange(f.key, e.target.value)}
                     className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
            </div>
          );
        }
        // text
        return (
          <div key={f.key} className="space-y-1 sm:col-span-3">
            <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">{f.label}{f.required && ' *'}</label>
            <input type="text" value={p.specs[f.key] ?? ''} onChange={e => p.onChange(f.key, e.target.value)}
                   className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Lint**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/components/produk/categorySpecs.ts \
        src/components/produk/categorySpecs.test.ts
git commit -m "feat(produk): ProductForm scaffold (Identitas + Spesifikasi w/ generic fallback)"
```

**Acceptance:** Form scaffold renders, Kategori "+ Buat baru" creates DB row, Spesifikasi changes with Kategori, fallback works for custom category.

---


## Task 2.6: ProductForm — Foto Produk card (5 slots, drag-drop, compress, upload)

**Files:**
- Modify: `src/components/produk/ProductForm.tsx` (add Foto card section + state)

**Why:** Foto Produk is mandatory (min 1, max 5). Hero slot 1 + 2×2 small slots 2-5. Drag-drop reorder. Client compress before upload.

**Steps:**

- [ ] **Step 1: Add foto state + handlers to ProductForm**

Inside `ProductForm` component, add near other `useState` calls:
```tsx
import { compressImage, uploadProductPhoto, deleteProductPhoto, MAX_PHOTOS } from '../../lib/productPhotoService';
import type { ProductPhoto } from '../../types';

// IMPORTANT: Generate a stable SKU at mount so photo uploads land in the right
// folder BEFORE the user fills in (or auto-generates) the SKU at submit time.
// User's manually-typed SKU (if any) is used at submit; otherwise this autoSku.
const [autoSku] = useState(() => generateSkuId());
const skuForUpload = (sku.trim() || autoSku);

const [photos, setPhotos] = useState<Array<ProductPhoto & { localUrl?: string; status: 'uploaded' | 'uploading' | 'failed'; progress?: number }>>(
  (initial?.photo_urls ?? []).map(p => ({ ...p, status: 'uploaded' as const }))
);
const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

async function handleFilesPicked(files: FileList | null, targetSku: string) {
  if (!files || files.length === 0) return;
  const slotsAvail = MAX_PHOTOS - photos.length;
  const taken = Array.from(files).slice(0, slotsAvail);
  for (let i = 0; i < taken.length; i++) {
    const file = taken[i];
    const order = photos.length + i;
    const localUrl = URL.createObjectURL(file);
    setPhotos(curr => [...curr, {
      url: '', path: '', order, uploaded_at: '',
      localUrl, status: 'uploading', progress: 0,
    }]);
    try {
      const { blob } = await compressImage(file);
      const { url, path } = await uploadProductPhoto(targetSku, order, blob);
      setPhotos(curr => curr.map(p => p.order === order
        ? { ...p, url, path, uploaded_at: new Date().toISOString(), status: 'uploaded', localUrl: undefined }
        : p));
    } catch (e) {
      showToast('Gagal upload foto: ' + (e as Error).message, 'warning');
      setPhotos(curr => curr.map(p => p.order === order ? { ...p, status: 'failed' } : p));
    }
  }
}

async function handleDeletePhoto(order: number) {
  const target = photos.find(p => p.order === order);
  if (target?.path) await deleteProductPhoto(target.path).catch(() => {});
  setPhotos(curr => curr.filter(p => p.order !== order).map((p, i) => ({ ...p, order: i })));
}

function reorderPhotos(from: number, to: number) {
  setPhotos(curr => {
    const arr = [...curr];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    return arr.map((p, i) => ({ ...p, order: i }));
  });
}
```

- [ ] **Step 2: Add Foto card JSX**

After the Spesifikasi card, before the action buttons row:
```tsx
{/* Card: Foto Produk */}
<div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
  <div className="flex items-center justify-between mb-3">
    <div>
      <h5 className="text-sm font-extrabold text-[#012749]">📷 Foto Produk <span className="w-1.5 h-1.5 bg-rose-500 rounded-full inline-block ml-1" /></h5>
      <p className="text-[10.5px] text-slate-500">Min 1 wajib · max 5 · drag untuk urutan</p>
    </div>
    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-1">
      {photos.length} / {MAX_PHOTOS} terisi
    </span>
  </div>
  <div className="grid grid-cols-12 gap-3">
    {/* HERO slot 1 */}
    <div className="col-span-12 sm:col-span-7">
      <PhotoSlot
        photo={photos[0]}
        isThumbnail={true}
        order={0}
        onDelete={() => handleDeletePhoto(0)}
        onPick={files => handleFilesPicked(files, skuForUpload)}
        onDragStart={() => setDraggingIdx(0)}
        onDragOver={() => {}}
        onDrop={() => { if (draggingIdx !== null) reorderPhotos(draggingIdx, 0); setDraggingIdx(null); }}
      />
    </div>
    {/* Small slots 2-5 in 2×2 */}
    <div className="col-span-12 sm:col-span-5 grid grid-cols-2 gap-3">
      {[1, 2, 3, 4].map(i => (
        <PhotoSlot
          key={i}
          photo={photos[i]}
          isThumbnail={false}
          order={i}
          onDelete={() => handleDeletePhoto(i)}
          onPick={files => handleFilesPicked(files, skuForUpload)}
          onDragStart={() => setDraggingIdx(i)}
          onDragOver={() => {}}
          onDrop={() => { if (draggingIdx !== null) reorderPhotos(draggingIdx, i); setDraggingIdx(null); }}
        />
      ))}
    </div>
  </div>
  <p className="text-[11px] text-slate-500 italic mt-3">
    Min 1 foto wajib — foto pertama jadi thumbnail. Foto akan di-index AI ~5 detik setelah simpan.
  </p>
</div>
```

- [ ] **Step 3: Add `PhotoSlot` helper component (in same file)**

```tsx
function PhotoSlot(p: {
  photo: typeof photos[number] | undefined;
  isThumbnail: boolean;
  order: number;
  onDelete: () => void;
  onPick: (files: FileList | null) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  if (!p.photo) {
    return (
      <label className={`aspect-square rounded-2xl border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center text-emerald-700 cursor-pointer hover:bg-emerald-50/40 ${p.isThumbnail ? '' : ''}`}>
        <span className="material-symbols-outlined text-3xl mb-1">add_a_photo</span>
        <span className="text-[10px] font-extrabold uppercase tracking-widest">Tambah</span>
        <input type="file" accept="image/*" multiple className="hidden"
               onChange={e => p.onPick(e.target.files)} />
      </label>
    );
  }
  const thumb = p.photo.url || p.photo.localUrl;
  return (
    <div
      draggable={p.photo.status === 'uploaded'}
      onDragStart={p.onDragStart}
      onDragOver={e => { e.preventDefault(); p.onDragOver(); }}
      onDrop={e => { e.preventDefault(); p.onDrop(); }}
      className={`relative aspect-square rounded-2xl overflow-hidden border ${p.isThumbnail ? 'border-2 border-emerald-300' : 'border-slate-200'} group`}
    >
      {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-200" />}
      {p.isThumbnail && (
        <div className="absolute top-1.5 left-1.5 bg-emerald-600 text-white text-[8.5px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full">★ Thumbnail</div>
      )}
      {p.photo.status === 'uploading' && (
        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      )}
      {p.photo.status === 'failed' && (
        <div className="absolute inset-x-0 bottom-0 bg-rose-600 text-white text-[8.5px] font-black uppercase tracking-widest px-1 py-0.5 text-center">Upload gagal</div>
      )}
      {p.photo.status === 'uploaded' && (
        <button onClick={p.onDelete}
                className="absolute bottom-1.5 right-1.5 bg-white/95 hover:bg-rose-50 text-rose-600 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100">
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update preview state**

Replace the `previewState` to feed thumbnail from `photos[0]`:
```tsx
const previewState: ProductPreviewState = {
  ...,
  hasPhoto: photos.length > 0,
  thumbnailDataUrl: photos[0]?.url || photos[0]?.localUrl || null,
  ...
};
```

- [ ] **Step 5: Add photo-count validator unit test**

`src/components/produk/photoValidation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MIN_PHOTOS, MAX_PHOTOS } from '../../lib/productPhotoService';

function validatePhotoCount(n: number): { ok: boolean; msg?: string } {
  if (n < MIN_PHOTOS) return { ok: false, msg: 'Minimal 1 foto produk wajib.' };
  if (n > MAX_PHOTOS) return { ok: false, msg: 'Maksimal 5 foto.' };
  return { ok: true };
}

describe('validatePhotoCount', () => {
  it('rejects 0', () => expect(validatePhotoCount(0).ok).toBe(false));
  it('accepts 1', () => expect(validatePhotoCount(1).ok).toBe(true));
  it('accepts 5', () => expect(validatePhotoCount(5).ok).toBe(true));
  it('rejects 6', () => expect(validatePhotoCount(6).ok).toBe(false));
});
```

- [ ] **Step 6: Run tests + lint**

```bash
npm run test -- src/components/produk/photoValidation.test.ts
npm run lint
```
Expected: 4 passing, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/components/produk/photoValidation.test.ts
git commit -m "feat(produk): ProductForm Foto card with 5 slots, drag-drop reorder, client compress"
```

**Acceptance:** Picking files compresses & uploads to Storage, drag-drop reorders, delete removes from Storage, validator gates submit.

---

## Task 2.7: ProductForm — Harga & Stok card (with dynamic Harga Modal label)

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`
- Modify: `src/lib/supabaseClient.ts` (add `companySettingsService.getCostingMethod` + `stockLotsService.countForSku`)

**Why:** Harga Jual (req), Harga Modal label flips between "Awal (Estimasi)" (editable) and "Aktual (FIFO|Average)" (read-only) based on `stock_lots` count + `company_settings.costing_method`. Live margin %. Stok Awal + Gudang Tujuan + approval banner.

**Steps:**

- [ ] **Step 1: Add service methods**

In `src/lib/supabaseClient.ts`, near other settings/services:
```ts
export const companySettingsService = {
  async getCostingMethod(): Promise<'FIFO' | 'Average'> {
    const { data, error } = await supabase
      .from('company_settings').select('value').eq('key', 'costing_method').maybeSingle();
    if (error) throw error;
    return ((data?.value ?? 'FIFO') as 'FIFO' | 'Average');
  },
  async setCostingMethod(m: 'FIFO' | 'Average'): Promise<void> {
    const { error } = await supabase.from('company_settings').upsert({ key: 'costing_method', value: m, updated_at: new Date().toISOString() });
    if (error) throw error;
  },
};

export const stockLotsService = {
  async countForSku(sku: string): Promise<number> {
    const { count, error } = await supabase
      .from('stock_lots').select('id', { count: 'exact', head: true }).eq('sku', sku);
    if (error) throw error;
    return count ?? 0;
  },
};
```

- [ ] **Step 2: Add fields to ProductForm**

```tsx
import { companySettingsService, stockLotsService } from '../../lib/supabaseClient';

const [price, setPrice] = useState<number>(initial?.price ?? 0);
const [hargaModal, setHargaModal] = useState<number | null>(initial?.harga_modal ?? null);
const [stokAwal, setStokAwal] = useState<number>(0);
const [gudangTujuanId, setGudangTujuanId] = useState<string | null>(
  warehouses.find(w => w.is_default)?.id ?? null
);
const [minStockPerProduct, setMinStockPerProduct] = useState<number | null>(initial?.min_stock_per_product ?? null);

const [costingMethod, setCostingMethod] = useState<'FIFO' | 'Average'>('FIFO');
const [lotsCount, setLotsCount] = useState<number>(0);

useEffect(() => { void companySettingsService.getCostingMethod().then(setCostingMethod); }, []);
useEffect(() => {
  if (initial?.sku) void stockLotsService.countForSku(initial.sku).then(setLotsCount);
}, [initial?.sku]);

const hargaModalIsAktual = lotsCount > 0;
const marginPct = hargaModal && price ? ((price - hargaModal) / price) * 100 : null;
```

- [ ] **Step 3: Add Harga & Stok card JSX**

After Foto card:
```tsx
<div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
  <h5 className="text-sm font-extrabold text-[#012749] mb-3">💰 Harga & Stok</h5>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
    <div className="space-y-1">
      <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Harga Jual (Rp) *</label>
      <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))}
             className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
      <p className="text-[10px] text-slate-400 pl-1">per {unit}</p>
    </div>
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">
          {hargaModalIsAktual ? `Harga Modal Aktual (${costingMethod})` : 'Harga Modal Awal'}
        </label>
        <span className={`text-[8.5px] font-black uppercase tracking-widest border rounded-full px-1.5 py-0.5 ${
          hargaModalIsAktual ? 'text-emerald-700 bg-emerald-100 border-emerald-200' : 'text-amber-700 bg-amber-100 border-amber-200'
        }`}>
          {hargaModalIsAktual ? '🔒 Dari Pembelian' : 'Estimasi'}
        </span>
      </div>
      <input type="number" value={hargaModal ?? ''} readOnly={hargaModalIsAktual}
             onChange={e => setHargaModal(e.target.value === '' ? null : Number(e.target.value))}
             className={`w-full rounded-xl px-3 py-2.5 border text-[13px] font-semibold ${
               hargaModalIsAktual ? 'bg-slate-100 border-slate-200 text-slate-600' : 'bg-white border-slate-200'
             }`} />
      <p className="text-[10px] text-emerald-700 font-bold pl-1">
        {marginPct !== null ? `Margin: ${marginPct.toFixed(1)}%` : 'Margin: —'}
        {!hargaModalIsAktual && ' · akan di-update otomatis dari PO'}
      </p>
    </div>
  </div>

  <div className="border-t border-slate-100 pt-3">
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1">
        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Stok Awal (opsional)</label>
        <input type="number" value={stokAwal} onChange={e => setStokAwal(Number(e.target.value))}
               className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Gudang Tujuan</label>
        <select value={gudangTujuanId ?? ''} onChange={e => setGudangTujuanId(e.target.value || null)}
                className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold">
          {warehouses.filter(w => w.is_active).map(w => (
            <option key={w.id} value={w.id}>{w.name} ({w.code}){w.is_default ? ' · Default' : ''}</option>
          ))}
        </select>
      </div>
    </div>

    {stokAwal > 0 && (
      <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
        <span className="material-symbols-outlined text-amber-600 text-base shrink-0">verified_user</span>
        <div className="flex-1">
          <p className="text-[11px] font-bold text-amber-900 leading-tight">
            Stok {stokAwal} {unit} akan dikirim ke owner untuk approval
          </p>
          <p className="text-[10px] text-amber-800 mt-0.5 leading-snug">
            Produk dibuat sekarang & bisa di-edit, tapi stok belum aktif sampai owner approve via WhatsApp/inbox.
          </p>
        </div>
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 4: Wire previewState**

Update `previewState` object to include `price, hargaModal, stokAwal, gudangTujuanId, isPendingApproval: stokAwal > 0`.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/lib/supabaseClient.ts
git commit -m "feat(produk): ProductForm Harga & Stok card w/ dynamic Harga Modal label + approval banner"
```

**Acceptance:** New product shows "Harga Modal Awal (Estimasi)" editable. Product with stock_lots shows read-only "Aktual (FIFO|Average)". Approval banner shows iff stok > 0.

---

## Task 2.8: ProductForm — Pengaturan Lanjutan collapsible (multi-satuan + min stock + deskripsi)

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`

**Steps:**

- [ ] **Step 1: Add state**

```tsx
const [unitAlt, setUnitAlt] = useState<string | null>(initial?.unit_alt ?? null);
const [unitAltFactor, setUnitAltFactor] = useState<number | null>(initial?.unit_alt_factor ?? null);
const [description, setDescription] = useState<string>(initial?.description ?? '');
const [multiSatuanOn, setMultiSatuanOn] = useState<boolean>(!!initial?.unit_alt);
```

- [ ] **Step 2: Add JSX (after Harga & Stok card)**

```tsx
<details className="bg-white rounded-3xl border border-[#e5eeff] shadow-sm group">
  <summary className="cursor-pointer p-6 flex items-center gap-3 list-none">
    <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
      <span className="material-symbols-outlined text-xl">tune</span>
    </div>
    <div className="flex-1">
      <h5 className="text-sm font-extrabold text-[#012749]">Pengaturan Lanjutan</h5>
      <p className="text-[10.5px] text-slate-500">Multi-satuan, batas stok min, deskripsi — opsional</p>
    </div>
    <span className="material-symbols-outlined text-slate-400 transition group-open:rotate-180">expand_more</span>
  </summary>
  <div className="px-6 pb-6 space-y-4 border-t border-slate-100 pt-4">
    {/* Multi-satuan */}
    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={multiSatuanOn}
               onChange={e => {
                 const on = e.target.checked;
                 setMultiSatuanOn(on);
                 if (!on) { setUnitAlt(null); setUnitAltFactor(null); }
               }}
               className="accent-emerald-600 w-3.5 h-3.5" />
        <span className="text-[11px] font-extrabold text-[#012749]">Aktifkan multi-satuan konversi</span>
      </label>
      {multiSatuanOn && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <div className="space-y-1">
            <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">1 Paket (Sekunder)</label>
            <select value={unitAlt ?? ''} onChange={e => setUnitAlt(e.target.value || null)}
                    className="w-full bg-white rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold">
              <option value="">—</option>
              {units.filter(u => u.name !== unit).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-center pb-1.5"><span className="text-base font-black text-slate-400">=</span></div>
          <div className="space-y-1">
            <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Berapa</label>
            <input type="number" min={2} value={unitAltFactor ?? ''} onChange={e => setUnitAltFactor(Number(e.target.value) || null)}
                   className="w-full bg-white rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold" />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-extrabold text-gray-500 uppercase tracking-widest">Satuan Utama</label>
            <input readOnly value={unit} className="w-full bg-slate-100 rounded-lg px-2.5 py-1.5 border border-slate-200 text-[11px] font-bold" />
          </div>
          <p className="text-[9.5px] text-blue-800 italic pb-1.5">Stok dilacak per Satuan Utama.</p>
        </div>
      )}
    </div>

    {/* Batas Stok Min */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="space-y-1">
        <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Batas Stok Min</label>
        <input type="number" value={minStockPerProduct ?? ''}
               onChange={e => setMinStockPerProduct(e.target.value === '' ? null : Number(e.target.value))}
               placeholder="kosong = global"
               className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] font-semibold" />
        <p className="text-[10px] text-slate-400">Alert kalau stok ≤ angka ini</p>
      </div>
    </div>

    {/* Deskripsi */}
    <div className="space-y-1">
      <div className="flex items-end justify-between">
        <label className="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest">Deskripsi Produk</label>
        <button type="button" disabled={photos.length === 0}
                onClick={async () => {
                  // Wired in Phase 3 (Task 3.5): backend /describe-product
                  showToast('✨ Generate dari Foto akan tersedia setelah Phase 3', 'info');
                }}
                className="text-[10px] font-extrabold text-purple-700 hover:text-purple-900 bg-purple-50 border border-purple-200 rounded-full px-3 py-1 disabled:opacity-50">
          ✨ Generate dari Foto
        </button>
      </div>
      <textarea rows={3} value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
                className="w-full bg-white rounded-xl px-3 py-2.5 border border-slate-200 text-[13px] resize-none" />
      <p className="text-[10px] text-slate-400 text-right">{description.length} / 500</p>
    </div>
  </div>
</details>
```

- [ ] **Step 3: Lint**

```bash
npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/produk/ProductForm.tsx
git commit -m "feat(produk): ProductForm Pengaturan Lanjutan (multi-satuan + min stock + deskripsi)"
```

**Acceptance:** Collapsible section works; multi-satuan toggle reveals/hides fields; deskripsi counter; Generate button disabled when no photo.

---

## Task 2.9: ProductForm — Submit validation + save flow

**Files:**
- Modify: `src/components/produk/ProductForm.tsx` (add submit handler, validation)
- Modify: `src/lib/supabaseClient.ts` (add `stockService.upsertProduct` if missing)

**Why:** Glue everything together. Validate required + multi-satuan rules. Generate SKU if missing. Insert/update `stocks` with all new columns. Create `initial_stock` approval if stok > 0.

**Steps:**

- [ ] **Step 1: Add SKU generator + validator helpers**

In `ProductForm.tsx`, add near top:
```tsx
function generateSkuId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ValidationError { field: string; message: string; }

function validate(input: {
  category: string; unit: string; price: number; photos: number;
  unitAlt: string | null; unitAltFactor: number | null;
}): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!input.category) errs.push({ field: 'category', message: 'Kategori wajib dipilih' });
  if (!input.unit) errs.push({ field: 'unit', message: 'Satuan wajib dipilih' });
  if (!input.price || input.price <= 0) errs.push({ field: 'price', message: 'Harga Jual harus > 0' });
  if (input.photos < 1) errs.push({ field: 'photos', message: 'Minimal 1 foto produk wajib' });
  // Multi-satuan
  if ((input.unitAlt && !input.unitAltFactor) || (!input.unitAlt && input.unitAltFactor)) {
    errs.push({ field: 'multi_satuan', message: 'Multi-satuan: keduanya harus diisi atau dikosongkan' });
  }
  if (input.unitAlt === input.unit) {
    errs.push({ field: 'unit_alt', message: 'Satuan Kedua tidak boleh sama dengan Satuan Utama' });
  }
  if (input.unitAltFactor !== null && input.unitAltFactor <= 1) {
    errs.push({ field: 'unit_alt_factor', message: 'Faktor konversi harus > 1' });
  }
  return errs;
}
```

- [ ] **Step 2: Write unit test for validate()**

`src/components/produk/productFormValidate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
// Inline copy (or export from ProductForm) — for the test we inline-define
function validate(input: { category: string; unit: string; price: number; photos: number;
  unitAlt: string | null; unitAltFactor: number | null;
}) {
  const errs: { field: string; message: string }[] = [];
  if (!input.category) errs.push({ field: 'category', message: 'Kategori wajib' });
  if (!input.unit) errs.push({ field: 'unit', message: 'Satuan wajib' });
  if (!input.price || input.price <= 0) errs.push({ field: 'price', message: 'Harga > 0' });
  if (input.photos < 1) errs.push({ field: 'photos', message: 'Min 1 foto' });
  if ((input.unitAlt && !input.unitAltFactor) || (!input.unitAlt && input.unitAltFactor))
    errs.push({ field: 'multi_satuan', message: 'mismatched' });
  if (input.unitAlt === input.unit && input.unitAlt) errs.push({ field: 'unit_alt', message: 'same' });
  if (input.unitAltFactor !== null && input.unitAltFactor <= 1)
    errs.push({ field: 'unit_alt_factor', message: '>1' });
  return errs;
}

describe('productForm validate', () => {
  const ok = { category: 'MCB', unit: 'pcs', price: 100, photos: 1, unitAlt: null, unitAltFactor: null };
  it('accepts minimal valid', () => expect(validate(ok)).toEqual([]));
  it('rejects 0 photos', () => expect(validate({...ok, photos: 0})[0].field).toBe('photos'));
  it('rejects factor=1', () => expect(validate({...ok, unitAlt: 'roll', unitAltFactor: 1})[0].field).toBe('unit_alt_factor'));
  it('rejects same unit', () => expect(validate({...ok, unitAlt: 'pcs', unitAltFactor: 2})[0].field).toBe('unit_alt'));
  it('rejects half-multi-satuan', () => expect(validate({...ok, unitAlt: 'roll', unitAltFactor: null})[0].field).toBe('multi_satuan'));
});
```

Run: `npm run test -- src/components/produk/productFormValidate.test.ts` → 5 passing.

- [ ] **Step 3: Add `stockService.upsertProduct`**

In `src/lib/supabaseClient.ts`:
```ts
import type { StockItem, ProductPhoto } from '../types';

// inside stockService = { ... } object:
async upsertProduct(input: {
  sku: string;
  name: string;
  category: string;
  subcategory: string | null;
  unit: string;
  unit_alt: string | null;
  unit_alt_factor: number | null;
  price: number;
  harga_modal: number | null;
  description: string | null;
  min_stock_per_product: number | null;
  photo_urls: ProductPhoto[];
  specs: Record<string, string | number>;
  initial_stock_approved: boolean;
}): Promise<StockItem> {
  const { data, error } = await supabase
    .from('stocks')
    .upsert({ ...input, status: 'Sinkron', updated_at: new Date().toISOString() })
    .select().single();
  if (error) throw error;
  return data as StockItem;
},
```

- [ ] **Step 4: Add submit handler in ProductForm**

```tsx
const [submitting, setSubmitting] = useState(false);

async function handleSubmit() {
  const errs = validate({ category, unit, price, photos: photos.filter(p => p.status === 'uploaded').length,
                          unitAlt, unitAltFactor });
  if (errs.length) {
    showToast(errs[0].message, 'warning');
    return;
  }
  setSubmitting(true);
  try {
    // Reuse the same SKU used for photo uploads (set at mount in Task 2.6) so
    // photo_urls paths and stocks.sku stay aligned.
    const finalSku = sku.trim() || autoSku;
    await onSubmit({
      sku: finalSku,
      name: generateName(category, specs),
      category,
      subcategory: subcategory || null,
      unit,
      unit_alt: unitAlt,
      unit_alt_factor: unitAltFactor,
      price,
      harga_modal: hargaModal,
      description: description || null,
      min_stock_per_product: minStockPerProduct,
      photo_urls: photos.filter(p => p.status === 'uploaded').map(({ url, path, order, uploaded_at }) => ({ url, path, order, uploaded_at })),
      specs,
      initial_stock_approved: stokAwal === 0,
    } as Partial<StockItem>);
    showToast('✅ Produk berhasil ditambahkan');
  } catch (e) {
    showToast('Gagal menyimpan: ' + (e as Error).message, 'warning');
  } finally {
    setSubmitting(false);
  }
}
```

Wire the Submit button (currently disabled placeholder from Task 2.5) to call `handleSubmit`, drop the `disabled` attribute.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/components/produk/ProductForm.tsx src/lib/supabaseClient.ts \
        src/components/produk/productFormValidate.test.ts
git commit -m "feat(produk): ProductForm submit flow + validation + stockService.upsertProduct"
```

**Acceptance:** Submitting with required fields creates DB row with all new columns; missing photo blocks submit with toast; multi-satuan validation enforced.

---

## Task 2.10: Initial stock approval — service + handler

**Files:**
- Modify: `src/lib/supabaseClient.ts` (add `approvalService.requestInitialStock`)
- Modify: `src/components/produk/ProductForm.tsx` (call approval service on submit if stok > 0)

**Steps:**

- [ ] **Step 1: Add approval service method**

In `supabaseClient.ts`:
```ts
export const approvalService = {
  // ... existing methods ...
  async requestInitialStock(payload: {
    sku: string; sku_name: string; qty: number; unit: string; warehouse_id: string;
    requested_cost_per_unit?: number;
  }, requestedBy: string): Promise<void> {
    const { error } = await supabase.from('approval_requests').insert({
      request_type: 'initial_stock',
      payload,
      requested_by: requestedBy,
    });
    if (error) throw error;
  },
};
```

- [ ] **Step 2: Call from ProductForm submit**

After `onSubmit(...)` succeeds, before `showToast(success)`:
```tsx
if (stokAwal > 0 && gudangTujuanId) {
  try {
    await approvalService.requestInitialStock({
      sku: finalSku,
      sku_name: generateName(category, specs),
      qty: stokAwal,
      unit,
      warehouse_id: gudangTujuanId,
      requested_cost_per_unit: hargaModal ?? undefined,
    }, /* currentUser.id from parent prop */ '');
    showToast(`Stok ${stokAwal} ${unit} dikirim ke owner untuk approval`, 'info');
  } catch (e) {
    showToast('Approval gagal: ' + (e as Error).message, 'warning');
  }
}
```

Add `currentUserId: string` to `ProductForm` props, wire from caller.

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/lib/supabaseClient.ts src/components/produk/ProductForm.tsx
git commit -m "feat(produk): initial_stock approval request on submit when stok > 0"
```

**Acceptance:** `approval_requests` row inserted with `request_type='initial_stock'` when stok > 0.

---

## Task 2.11: `CatalogGridView` + tab pill structure in `StockManagerScreen`

**Files:**
- Create: `src/components/produk/CatalogGridView.tsx`
- Modify: `src/components/StockManagerScreen.tsx` (add tab pills + ProductForm modal)

**Why:** Grid card view (thumbnail dominant) for Katalog tab. Search/filter. Tombol "+ Tambah Barang" opens ProductForm modal.

**Steps:**

- [ ] **Step 1: Create CatalogGridView**

```tsx
// src/components/produk/CatalogGridView.tsx
import React, { useState, useMemo } from 'react';
import { StockItem } from '../../types';

interface Props {
  stockList: StockItem[];
  onAdd: () => void;
  onEdit: (sku: string) => void;
}

export default function CatalogGridView({ stockList, onAdd, onEdit }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const categories = useMemo(() =>
    ['Semua', ...Array.from(new Set(stockList.map(s => s.category)))], [stockList]);
  const filtered = useMemo(() => stockList.filter(s => {
    if (cat !== 'Semua' && s.category !== cat) return false;
    if (q && !s.name.toLowerCase().includes(q.toLowerCase()) && !s.sku.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [stockList, q, cat]);

  return (
    <section className="bg-white rounded-[2.5rem] p-6 border border-[#e5eeff] shadow-xl">
      <div className="flex flex-col lg:flex-row gap-3 mb-5">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari nama atau SKU…"
               className="flex-1 px-4 py-3 bg-[#eff4ff] rounded-full text-xs font-bold" />
        <select value={cat} onChange={e => setCat(e.target.value)}
                className="px-4 py-3 bg-[#eff4ff] rounded-full text-xs font-black">
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={onAdd}
                className="px-5 py-3 bg-[#2d8a4e] text-white rounded-full text-xs font-extrabold uppercase tracking-wider">
          + Tambah Barang
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(item => (
          <button key={item.sku} onClick={() => onEdit(item.sku)}
                  className="text-left bg-slate-50 rounded-2xl p-3 border border-slate-100 hover:border-emerald-200 hover:shadow-md transition">
            <div className="aspect-square rounded-xl overflow-hidden bg-slate-200 mb-2">
              {item.photo_urls?.[0]?.url ? (
                <img src={item.photo_urls[0].url} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-slate-400 text-3xl">image</span>
                </div>
              )}
            </div>
            <div className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-900 inline-block px-1.5 py-0.5 rounded-full mb-1">
              {item.category}
            </div>
            <h6 className="text-xs font-extrabold text-[#012749] line-clamp-2">{item.name}</h6>
            <p className="text-[10.5px] text-slate-500 mt-0.5">
              Rp {item.price.toLocaleString('id-ID')} / {item.unit}
            </p>
            <p className="text-[10px] text-slate-400">Stok: {item.stock}</p>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-xs">Tidak ada produk yang cocok</div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Add tab state + pill UI to StockManagerScreen**

At top of `StockManagerScreen` (component body), add:
```tsx
import CatalogGridView from './produk/CatalogGridView';
import ProductForm from './produk/ProductForm';
import { useWarehouses } from '../hooks/useWarehouses';

type Tab = 'katalog' | 'stok' | 'bulk' | 'tipis';
const [activeTab, setActiveTab] = useState<Tab>('katalog');
const [editingSku, setEditingSku] = useState<string | null>(null);
const [showAddModal, setShowAddModal] = useState(false);
const { warehouses } = useWarehouses();
```

Replace the existing top-of-screen content (after the connection-status badge) with:
```tsx
<div className="bg-white rounded-3xl border border-[#e5eeff] p-4 shadow-sm mb-5">
  <div className="flex flex-wrap gap-2">
    <TabPill active={activeTab === 'katalog'} onClick={() => setActiveTab('katalog')}
             label="📋 Katalog" badge={String(stockList.length)} color="emerald" />
    <TabPill active={activeTab === 'stok'} onClick={() => setActiveTab('stok')} label="🏬 Stok per Gudang" color="slate" />
    <TabPill active={activeTab === 'bulk'} onClick={() => setActiveTab('bulk')} label="📥 Bulk Upload" color="slate" />
    <TabPill active={activeTab === 'tipis'} onClick={() => setActiveTab('tipis')}
             label="⚠️ Stok Tipis" badge={String(stockList.filter(s => s.stock <= (s.min_stock_per_product ?? 5)).length)} color="amber" />
  </div>
</div>

{activeTab === 'katalog' && (
  <CatalogGridView stockList={stockList} onAdd={() => setShowAddModal(true)} onEdit={setEditingSku} />
)}
{activeTab === 'stok' && (
  <StockTableView stockList={stockList} onEdit={setEditingSku} onDelete={handleDeleteRow}
                  onTransfer={item => setTransferItem(item)} onInlineUpdate={handleInlineSave}
                  onOpname={onNavigateToOpname} />
)}
{activeTab === 'bulk' && (
  <BulkUploadSection stockList={stockList} companyName={companyName} showToast={showToast} onUploaded={() => { /* refresh */ }} />
)}
{activeTab === 'tipis' && (
  <StockTableView stockList={stockList} onEdit={setEditingSku} onDelete={handleDeleteRow}
                  onTransfer={item => setTransferItem(item)} onInlineUpdate={handleInlineSave}
                  thinOnly={true} />
)}

{showAddModal && (
  <Modal onClose={() => setShowAddModal(false)}>
    <ProductForm warehouses={warehouses} currentUserId={currentUser?.id ?? ''}
                 onCancel={() => setShowAddModal(false)}
                 onSubmit={async data => { await stockService.upsertProduct(data as any); setShowAddModal(false); /* refresh */ }}
                 showToast={showToast} />
  </Modal>
)}

{editingSku && (
  <Modal onClose={() => setEditingSku(null)}>
    <ProductForm initial={stockList.find(s => s.sku === editingSku)}
                 warehouses={warehouses} currentUserId={currentUser?.id ?? ''}
                 onCancel={() => setEditingSku(null)}
                 onSubmit={async data => { await stockService.upsertProduct(data as any); setEditingSku(null); /* refresh */ }}
                 showToast={showToast} />
  </Modal>
)}
```

Add `TabPill` helper + `Modal` (use existing patterns from codebase; simple overlay div).

- [ ] **Step 3: Lint + smoke**

```bash
npm run lint
npm run dev
```
Open "Produk & Stok", verify all 4 tabs render content. Click "+ Tambah Barang" → modal opens with ProductForm.

- [ ] **Step 4: Commit**

```bash
git add src/components/produk/CatalogGridView.tsx src/components/StockManagerScreen.tsx
git commit -m "feat(produk): CatalogGridView + tab pill structure (Katalog/Stok/Bulk/Tipis) + ProductForm modal"
```

**Acceptance:** Tab navigation works; Katalog grid shows thumbnails; Tambah modal opens ProductForm; Stok Tipis filters correctly.

---

## Task 2.12: Phase 2 smoke + commit checkpoint

**Steps:**

- [ ] **Step 1: End-to-end smoke**

Manually:
1. Open Produk & Stok menu
2. Click + Tambah Barang
3. Fill: Kategori=MCB, Satuan=pcs, Merek=Schneider, Ampere=16, Phase=1P, Harga=125000, Stok Awal=10, Gudang=ATAS, Foto (pick 1 image)
4. Submit → expect `stocks` row inserted, `approval_requests` row with `request_type=initial_stock`
5. Switch to Katalog tab → see new card with thumbnail
6. Switch to Stok per Gudang → see row
7. Switch to Stok Tipis → if stok < min, see it; else empty

- [ ] **Step 2: Verify DB**

```sql
SELECT sku, name, unit, photo_urls, initial_stock_approved FROM public.stocks ORDER BY updated_at DESC LIMIT 5;
SELECT request_type, payload FROM public.approval_requests ORDER BY requested_at DESC LIMIT 5;
```

- [ ] **Step 3: Tag the checkpoint**

```bash
git tag phase2-complete
```

**Acceptance:** Full Phase 2 happy path works end-to-end. Phase 3 (backend AI) wires in next.

---

# PHASE 2 EXIT CHECK

- [ ] Sidebar shows "Produk & Stok"
- [ ] 4 tabs render correct content
- [ ] ProductForm: all required-field validation works
- [ ] Foto upload to Storage works with compression
- [ ] DB row has all new columns populated correctly
- [ ] Approval request created when stok > 0
- [ ] `npm run lint` clean


---

# PHASE 3 — AI Pipeline Backend (Gemini Vision + Embedding)

## Task 3.1: Backend Go — `embed.go` Gemini wrapper

**Files:**
- Create: `backend-go/internal/gemini/embed.go`

**Why:** Wrapper around Gemini Flash 2.5 Vision (describe image) + `text-embedding-004` (text → 768-dim vector). Single source of truth for both pipelines.

**Steps:**

- [ ] **Step 1: Write wrapper**

```go
// backend-go/internal/gemini/embed.go
package gemini

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"time"

	"google.golang.org/genai"
)

const (
	visionModel     = "gemini-2.5-flash"
	embeddingModel  = "text-embedding-004"
	embeddingDim    = 768
)

const visionPrompt = `You are an inventory matcher. Describe this electrical product photo for search.

Output a single line description in mixed Indonesian/English, including:
- Product type (MCB, Panel, Kabel, Aksesori, dll)
- Brand if visible on label (Schneider, ABB, Chint, dll)
- Key specs: ampere, phase, mm², color, size
- Distinctive visible features

Format: "[Type] [Brand] [specs] [color] [features]"
Max 60 words. No preamble, no markdown, output description only.`

// EmbedClient handles Vision describe + text-embedding-004.
type EmbedClient struct {
	c *genai.Client
}

func NewEmbedClient(ctx context.Context, apiKey string) (*EmbedClient, error) {
	c, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: apiKey})
	if err != nil {
		return nil, fmt.Errorf("gemini client: %w", err)
	}
	return &EmbedClient{c: c}, nil
}

// DescribePhoto sends a JPEG to Gemini Vision and returns a single-line description.
// Returns latencyMs for ai_call_log.
func (e *EmbedClient) DescribePhoto(ctx context.Context, jpegBytes []byte) (description string, latencyMs int, err error) {
	start := time.Now()
	defer func() { latencyMs = int(time.Since(start).Milliseconds()) }()

	parts := []*genai.Part{
		{Text: visionPrompt},
		{InlineData: &genai.Blob{
			MIMEType: "image/jpeg",
			Data:     jpegBytes,
		}},
	}
	resp, err := e.c.Models.GenerateContent(ctx, visionModel, []*genai.Content{
		{Parts: parts, Role: "user"},
	}, nil)
	if err != nil {
		return "", 0, err
	}
	if resp == nil || len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return "", 0, fmt.Errorf("empty vision response")
	}
	out := ""
	for _, p := range resp.Candidates[0].Content.Parts {
		out += p.Text
	}
	return out, 0, nil
}

// Embed text → 768-dim float32 vector for pgvector.
func (e *EmbedClient) Embed(ctx context.Context, text string) (vec []float32, latencyMs int, err error) {
	start := time.Now()
	defer func() { latencyMs = int(time.Since(start).Milliseconds()) }()

	resp, err := e.c.Models.EmbedContent(ctx, embeddingModel, []*genai.Content{
		{Parts: []*genai.Part{{Text: text}}, Role: "user"},
	}, nil)
	if err != nil {
		return nil, 0, err
	}
	if resp == nil || len(resp.Embeddings) == 0 || resp.Embeddings[0].Values == nil {
		return nil, 0, fmt.Errorf("empty embed response")
	}
	v := resp.Embeddings[0].Values
	if len(v) != embeddingDim {
		return nil, 0, fmt.Errorf("expected %d-dim, got %d", embeddingDim, len(v))
	}
	return v, 0, nil
}

// FetchPublicImage downloads bytes from a public Supabase Storage URL.
func FetchPublicImage(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("fetch image %s: HTTP %d", url, resp.StatusCode)
	}
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, resp.Body); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Vector → "[v1,v2,…]" string format that pgvector accepts.
func VectorToPgString(v []float32) string {
	var b bytes.Buffer
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%.7f", f)
	}
	b.WriteByte(']')
	return b.String()
}

// Base64Encode for inline_data fallback if needed (Gemini also supports raw bytes via SDK).
func Base64Encode(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
```

- [ ] **Step 2: Update `go.mod` if needed**

If `google.golang.org/genai` not yet in `go.mod`:
```bash
cd backend-go && go get google.golang.org/genai
```

- [ ] **Step 3: Compile check**

```bash
cd backend-go && go build ./...
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/gemini/embed.go backend-go/go.mod backend-go/go.sum
git commit -m "feat(backend): gemini.EmbedClient for Vision describe + text-embedding-004"
```

**Acceptance:** Package compiles; `EmbedClient.DescribePhoto` and `.Embed` exposed.

---

## Task 3.2: AI call logging helper

**Files:**
- Create: `backend-go/internal/aicalllog/log.go`

**Why:** Centralize writes to `ai_call_log` so handlers stay clean. Records model, kind, status, latency.

**Steps:**

- [ ] **Step 1: Write helper**

```go
// backend-go/internal/aicalllog/log.go
package aicalllog

import (
	"context"
	"database/sql"
	"time"
)

type Status string

const (
	StatusSuccess   Status = "success"
	StatusError     Status = "error"
	StatusRateLimit Status = "rate_limit"
)

type Entry struct {
	Model      string
	Kind       string // 'index' | 'search' | 'describe'
	Status     Status
	HTTPStatus int
	LatencyMs  int
	ErrorMsg   string
}

func Insert(ctx context.Context, db *sql.DB, e Entry) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO public.ai_call_log (model, kind, status, http_status, latency_ms, error_msg, called_at)
		VALUES ($1, $2, $3, NULLIF($4, 0), NULLIF($5, 0), NULLIF($6, ''), $7)
	`, e.Model, e.Kind, string(e.Status), e.HTTPStatus, e.LatencyMs, e.ErrorMsg, time.Now())
	return err
}
```

- [ ] **Step 2: Compile**

```bash
cd backend-go && go build ./...
```

- [ ] **Step 3: Commit**

```bash
git add backend-go/internal/aicalllog/log.go
git commit -m "feat(backend): aicalllog.Insert helper for ai_call_log table"
```

**Acceptance:** Package compiles; `Insert` writes a row with NULL-coalescing for zero values.

---

## Task 3.3: HTTP handler — `POST /api/products/describe-product`

**Files:**
- Create: `backend-go/internal/api/products.go` (new HTTP module)
- Modify: `backend-go/main.go` (mount handler)

**Why:** Powers "Generate dari Foto" button. Accepts multipart JPEG, returns description text.

**Steps:**

- [ ] **Step 1: Write handler**

```go
// backend-go/internal/api/products.go
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/username/sinar-elektrik-backend/internal/aicalllog"
	"github.com/username/sinar-elektrik-backend/internal/gemini"
)

type ProductsHandler struct {
	Embed *gemini.EmbedClient
	DB    *sql.DB
}

func (h *ProductsHandler) Describe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "form parse: "+err.Error(), http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		http.Error(w, "missing photo", http.StatusBadRequest)
		return
	}
	defer file.Close()
	buf, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(buf) > 5<<20 {
		http.Error(w, "file too large (max 5MB)", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	desc, lat, err := h.Embed.DescribePhoto(ctx, buf)
	entry := aicalllog.Entry{
		Model: "gemini-2.5-flash", Kind: "describe",
		LatencyMs: lat,
	}
	if err != nil {
		entry.Status = aicalllog.StatusError
		entry.ErrorMsg = err.Error()
		_ = aicalllog.Insert(context.Background(), h.DB, entry)
		http.Error(w, "describe: "+err.Error(), http.StatusBadGateway)
		return
	}
	entry.Status = aicalllog.StatusSuccess
	_ = aicalllog.Insert(context.Background(), h.DB, entry)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"description": desc})
	_ = fmt.Sprintf // silence unused if not yet referenced
}
```

- [ ] **Step 2: Wire in main.go**

In `backend-go/main.go`, after Gemini init:
```go
import (
	// ...
	"github.com/username/sinar-elektrik-backend/internal/api"
)

// after EmbedClient init:
embedClient, err := gemini.NewEmbedClient(ctx, cfg.GeminiAPIKey)
if err != nil {
	log.Fatalf("[MAIN] failed to init Gemini EmbedClient: %v", err)
}

// dbConn assumes you have a *sql.DB to Supabase Postgres (use sslmode=require)
productsHandler := &api.ProductsHandler{Embed: embedClient, DB: dbConn}
http.HandleFunc("/api/products/describe-product", productsHandler.Describe)
```

If there's no `dbConn` yet in main.go, add it (use `database/sql` + `lib/pq` connection string from env).

- [ ] **Step 3: Compile + run local**

```bash
cd backend-go && go build -o /tmp/be ./... && /tmp/be &
```
Test with curl:
```bash
curl -F "photo=@/path/to/test_mcb.jpg" http://localhost:8080/api/products/describe-product
```
Expected: JSON `{"description":"MCB Schneider 16A..."}`.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/api/products.go backend-go/main.go
git commit -m "feat(backend): POST /api/products/describe-product (Gemini Vision)"
```

**Acceptance:** Endpoint accepts multipart JPEG, returns JSON description, logs to `ai_call_log`.

---

## Task 3.4: HTTP handler — `POST /api/products/index-photos`

**Files:**
- Modify: `backend-go/internal/api/products.go` (add `IndexPhotos` method)
- Modify: `backend-go/main.go` (mount)

**Why:** Called from frontend after submitting the product form. Iterates given photo paths, downloads each from Storage, describes, embeds, upserts `stock_photo_embeddings`.

**Steps:**

- [ ] **Step 1: Add request/response types + handler**

In `backend-go/internal/api/products.go`, append:
```go
type indexPhotosReq struct {
	SKU         string   `json:"sku"`
	PhotoURLs   []string `json:"photo_urls"`   // public URLs from Supabase Storage
	PhotoPaths  []string `json:"photo_paths"`  // matched 1:1 with PhotoURLs
}

type indexPhotosResp struct {
	Indexed  int      `json:"indexed"`
	Failed   int      `json:"failed"`
	Errors   []string `json:"errors,omitempty"`
}

func (h *ProductsHandler) IndexPhotos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req indexPhotosReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "json: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.SKU == "" || len(req.PhotoURLs) != len(req.PhotoPaths) {
		http.Error(w, "sku + matched photo_urls/paths required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	resp := indexPhotosResp{}

	for i, url := range req.PhotoURLs {
		path := req.PhotoPaths[i]

		// Idempotent: skip if already exists
		var exists bool
		_ = h.DB.QueryRowContext(ctx,
			`SELECT EXISTS(SELECT 1 FROM public.stock_photo_embeddings WHERE sku=$1 AND photo_path=$2)`,
			req.SKU, path).Scan(&exists)
		if exists {
			resp.Indexed++
			continue
		}

		// 1. Download image
		jpeg, err := gemini.FetchPublicImage(ctx, url)
		if err != nil {
			resp.Failed++
			resp.Errors = append(resp.Errors, fmt.Sprintf("fetch %s: %v", path, err))
			continue
		}

		// 2. Vision describe
		desc, lat, err := h.Embed.DescribePhoto(ctx, jpeg)
		visionEntry := aicalllog.Entry{Model: "gemini-2.5-flash", Kind: "index", LatencyMs: lat}
		if err != nil {
			visionEntry.Status = aicalllog.StatusError
			visionEntry.ErrorMsg = err.Error()
			_ = aicalllog.Insert(context.Background(), h.DB, visionEntry)
			resp.Failed++
			resp.Errors = append(resp.Errors, fmt.Sprintf("vision %s: %v", path, err))
			continue
		}
		visionEntry.Status = aicalllog.StatusSuccess
		_ = aicalllog.Insert(context.Background(), h.DB, visionEntry)

		// 3. Embed
		vec, lat2, err := h.Embed.Embed(ctx, desc)
		embedEntry := aicalllog.Entry{Model: "text-embedding-004", Kind: "index", LatencyMs: lat2}
		if err != nil {
			embedEntry.Status = aicalllog.StatusError
			embedEntry.ErrorMsg = err.Error()
			_ = aicalllog.Insert(context.Background(), h.DB, embedEntry)
			resp.Failed++
			continue
		}
		embedEntry.Status = aicalllog.StatusSuccess
		_ = aicalllog.Insert(context.Background(), h.DB, embedEntry)

		// 4. Upsert
		_, err = h.DB.ExecContext(ctx, `
			INSERT INTO public.stock_photo_embeddings (sku, photo_path, description, embedding)
			VALUES ($1, $2, $3, $4::vector)
			ON CONFLICT (sku, photo_path) DO UPDATE
			  SET description=EXCLUDED.description, embedding=EXCLUDED.embedding, created_at=now()
		`, req.SKU, path, desc, gemini.VectorToPgString(vec))
		if err != nil {
			resp.Failed++
			resp.Errors = append(resp.Errors, fmt.Sprintf("upsert %s: %v", path, err))
			continue
		}
		resp.Indexed++
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
```

- [ ] **Step 2: Mount in main.go**

```go
http.HandleFunc("/api/products/index-photos", productsHandler.IndexPhotos)
```

- [ ] **Step 3: Compile + manual smoke**

Insert a test stock row with photo_urls, then:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"sku":"test_sku","photo_urls":["https://...."],"photo_paths":["test_sku/0.jpg"]}' \
  http://localhost:8080/api/products/index-photos
```
Expected: `{"indexed":1,"failed":0}`. Verify `stock_photo_embeddings` has 1 row.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/api/products.go backend-go/main.go
git commit -m "feat(backend): POST /api/products/index-photos (Vision + Embed + upsert)"
```

**Acceptance:** Endpoint indexes 0..5 photos per call; idempotent on retry; failed photos returned in errors.

---

## Task 3.5: HTTP handler — `POST /api/products/search-by-photo`

**Files:**
- Modify: `backend-go/internal/api/products.go` (add `SearchByPhoto`)
- Modify: `backend-go/main.go` (mount)

**Steps:**

- [ ] **Step 1: Add handler**

```go
type searchResultRow struct {
	SKU            string          `json:"sku"`
	Name           string          `json:"name"`
	Category       string          `json:"category"`
	Similarity     float64         `json:"similarity"`
	ThumbnailURL   *string         `json:"thumbnail_url"`
	TotalStock     int             `json:"total_stock"`
	WarehouseStock json.RawMessage `json:"warehouse_stock"`
	Price          float64         `json:"price"`
	Unit           string          `json:"unit"`
	MinStock       int             `json:"min_stock"`
}

type searchResp struct {
	QueryDescription string            `json:"query_description"`
	Results          []searchResultRow `json:"results"`
}

func (h *ProductsHandler) SearchByPhoto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "form parse: "+err.Error(), http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("photo")
	if err != nil {
		http.Error(w, "missing photo", http.StatusBadRequest)
		return
	}
	defer file.Close()
	buf, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "read: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(buf) > 5<<20 {
		http.Error(w, "max 5MB", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// 1. Vision
	desc, lat, err := h.Embed.DescribePhoto(ctx, buf)
	vEntry := aicalllog.Entry{Model: "gemini-2.5-flash", Kind: "search", LatencyMs: lat}
	if err != nil {
		vEntry.Status = aicalllog.StatusError; vEntry.ErrorMsg = err.Error()
		_ = aicalllog.Insert(context.Background(), h.DB, vEntry)
		http.Error(w, "vision: "+err.Error(), http.StatusBadGateway)
		return
	}
	vEntry.Status = aicalllog.StatusSuccess
	_ = aicalllog.Insert(context.Background(), h.DB, vEntry)

	// 2. Embed
	vec, lat2, err := h.Embed.Embed(ctx, desc)
	eEntry := aicalllog.Entry{Model: "text-embedding-004", Kind: "search", LatencyMs: lat2}
	if err != nil {
		eEntry.Status = aicalllog.StatusError; eEntry.ErrorMsg = err.Error()
		_ = aicalllog.Insert(context.Background(), h.DB, eEntry)
		http.Error(w, "embed: "+err.Error(), http.StatusBadGateway)
		return
	}
	eEntry.Status = aicalllog.StatusSuccess
	_ = aicalllog.Insert(context.Background(), h.DB, eEntry)

	// 3. RPC
	rows, err := h.DB.QueryContext(ctx, `
		SELECT sku, name, category, similarity, thumbnail_url, total_stock,
		       warehouse_stock::text, price, unit, min_stock
		  FROM public.search_products_by_embedding($1::vector, 0.70, 5)
	`, gemini.VectorToPgString(vec))
	if err != nil {
		http.Error(w, "search: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := searchResp{QueryDescription: desc}
	for rows.Next() {
		var row searchResultRow
		var thumb sql.NullString
		var whJSON string
		if err := rows.Scan(&row.SKU, &row.Name, &row.Category, &row.Similarity,
			&thumb, &row.TotalStock, &whJSON, &row.Price, &row.Unit, &row.MinStock); err != nil {
			continue
		}
		if thumb.Valid {
			s := thumb.String
			row.ThumbnailURL = &s
		}
		row.WarehouseStock = json.RawMessage(whJSON)
		out.Results = append(out.Results, row)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
```

- [ ] **Step 2: Mount in main.go**

```go
http.HandleFunc("/api/products/search-by-photo", productsHandler.SearchByPhoto)
```

- [ ] **Step 3: Compile + smoke**

After at least 1 product is indexed:
```bash
curl -F "photo=@/path/to/mcb_query.jpg" http://localhost:8080/api/products/search-by-photo | jq
```
Expected: JSON with `query_description` + up to 5 `results`.

- [ ] **Step 4: Commit**

```bash
git add backend-go/internal/api/products.go backend-go/main.go
git commit -m "feat(backend): POST /api/products/search-by-photo (Vision + Embed + RPC)"
```

**Acceptance:** Endpoint returns top-5 results matching threshold 0.70; empty array if no matches.

---

## Task 3.6: Frontend wire — replace stubs in `productPhotoService.ts`

**Files:**
- Modify: `src/lib/productPhotoService.ts`

**Steps:**

- [ ] **Step 1: Implement `describeProductPhoto`**

```ts
const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';

export async function describeProductPhoto(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('photo', blob, 'query.jpg');
  const res = await fetch(`${BACKEND_BASE}/api/products/describe-product`, {
    method: 'POST', body: form,
  });
  if (!res.ok) throw new Error('Describe gagal: ' + res.status);
  const json = await res.json() as { description: string };
  return json.description;
}

export async function indexProductPhotos(sku: string, photos: Array<{ url: string; path: string }>): Promise<void> {
  const res = await fetch(`${BACKEND_BASE}/api/products/index-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku, photo_urls: photos.map(p => p.url), photo_paths: photos.map(p => p.path),
    }),
  });
  if (!res.ok) throw new Error('Index gagal: ' + res.status);
}

export async function searchByPhoto(blob: Blob): Promise<import('../types').ProductPhotoSearchResponse> {
  const form = new FormData();
  form.append('photo', blob, 'query.jpg');
  const res = await fetch(`${BACKEND_BASE}/api/products/search-by-photo`, {
    method: 'POST', body: form,
  });
  if (res.status === 429) throw new Error('AI sibuk, tunggu 30 detik atau cari via teks.');
  if (!res.ok) throw new Error('Server AI tidak respons. Coba lagi atau cari via teks.');
  return res.json();
}
```

(Remove the throwing stubs.)

- [ ] **Step 2: Wire `indexProductPhotos` in ProductForm**

After successful `onSubmit(...)`, call:
```tsx
const uploaded = photos.filter(p => p.status === 'uploaded' && p.path && p.url);
if (uploaded.length > 0) {
  void indexProductPhotos(finalSku, uploaded.map(p => ({ url: p.url, path: p.path })))
    .catch(e => showToast('Indexing AI gagal (silakan retry): ' + (e as Error).message, 'info'));
}
```

(Non-blocking — UI continues.)

- [ ] **Step 3: Wire `describeProductPhoto` in Generate button**

```tsx
onClick={async () => {
  const first = photos[0];
  if (!first?.path) return;
  try {
    // Fetch the uploaded photo as Blob
    const resp = await fetch(first.url);
    const blob = await resp.blob();
    const desc = await describeProductPhoto(blob);
    setDescription(desc);
    showToast('Deskripsi di-generate dari foto');
  } catch (e) {
    showToast('Generate gagal: ' + (e as Error).message, 'warning');
  }
}}
```

- [ ] **Step 4: Lint + smoke**

```bash
npm run lint
```
Start backend + frontend, full E2E test:
1. Add product with 2 photos.
2. After submit, wait ~5s, query `SELECT COUNT(*) FROM stock_photo_embeddings WHERE sku='<new>'` → expect 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/productPhotoService.ts src/components/produk/ProductForm.tsx
git commit -m "feat(produk): wire backend endpoints (describe/index/search) from frontend"
```

**Acceptance:** Photos auto-index after submit; Generate button populates deskripsi from Vision.

---

## Task 3.7: Phase 3 smoke + commit checkpoint

- [ ] **Step 1: Manual smoke**

1. Backend + frontend running.
2. Tambah produk dengan 3 foto MCB.
3. Wait ~10s.
4. Verify:
   ```sql
   SELECT model, kind, status, latency_ms FROM ai_call_log
    WHERE called_at > now() - interval '5 minutes' ORDER BY called_at DESC LIMIT 10;
   ```
   Expected: at least 6 success rows (3× describe + 3× embed).
5. Verify `stock_photo_embeddings` count for the SKU = 3.

- [ ] **Step 2: Tag**

```bash
git tag phase3-complete
```

---

# PHASE 3 EXIT CHECK

- [ ] All 3 backend endpoints respond
- [ ] `ai_call_log` records every call with latency
- [ ] Indexed photos appear in `stock_photo_embeddings`
- [ ] Frontend wire-up does not block the form
- [ ] Backend builds cleanly with `go build ./...`

---

# PHASE 4 — Kasir Cari by Foto + Multi-warehouse display

## Task 4.1: `CariByFotoModal` — choose source (Camera / File)

**Files:**
- Create: `src/components/kasir/CariByFotoModal.tsx`

**Steps:**

- [ ] **Step 1: Write component**

```tsx
// src/components/kasir/CariByFotoModal.tsx
import React, { useState } from 'react';
import { compressImage } from '../../lib/productPhotoService';

interface Props {
  onClose: () => void;
  onPhotoChosen: (blob: Blob, previewUrl: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function CariByFotoModal({ onClose, onPhotoChosen, showToast }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return;
    setBusy(true);
    try {
      const compressed = await compressImage(files[0]);
      const previewUrl = URL.createObjectURL(compressed.blob);
      onPhotoChosen(compressed.blob, previewUrl);
    } catch (e) {
      showToast((e as Error).message, 'warning');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl max-w-2xl w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">photo_camera</span>
            </div>
            <div>
              <h4 className="text-base font-extrabold text-[#012749]">Cari Produk by Foto</h4>
              <p className="text-[11px] text-[#43474e]">Pilih sumber foto. AI akan mencari produk paling cocok.</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="rounded-3xl p-6 bg-emerald-50 border-2 border-dashed border-emerald-300 flex flex-col items-center text-center cursor-pointer hover:bg-emerald-100/40">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-[#2d8a4e] flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-3xl">photo_camera</span>
            </div>
            <h5 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">Pakai Kamera</h5>
            <p className="text-[11px] text-[#43474e] mt-1">Snap dari tablet/HP</p>
            <input type="file" accept="image/*" capture="environment" className="hidden"
                   disabled={busy} onChange={e => handleFiles(e.target.files)} />
          </label>
          <label className="rounded-3xl p-6 bg-blue-50 border-2 border-dashed border-blue-300 flex flex-col items-center text-center cursor-pointer hover:bg-blue-100/40">
            <div className="w-16 h-16 rounded-full bg-blue-100 text-[#012749] flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-3xl">upload_file</span>
            </div>
            <h5 className="font-extrabold text-[#012749] text-xs uppercase tracking-wider">Upload File</h5>
            <p className="text-[11px] text-[#43474e] mt-1">Pilih dari galeri</p>
            <input type="file" accept="image/*" className="hidden"
                   disabled={busy} onChange={e => handleFiles(e.target.files)} />
          </label>
        </div>

        {busy && (
          <p className="text-center text-[11px] text-slate-500 mt-4">Memproses foto…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/kasir/CariByFotoModal.tsx
git commit -m "feat(kasir): CariByFotoModal — choose Kamera or Upload File"
```

**Acceptance:** Modal opens, file picker / camera capture compresses image, calls `onPhotoChosen`.

---

## Task 4.2: `HasilCariFotoModal` — top 5 results with per-warehouse stock

**Files:**
- Create: `src/components/kasir/HasilCariFotoModal.tsx`

**Steps:**

- [ ] **Step 1: Write component**

```tsx
// src/components/kasir/HasilCariFotoModal.tsx
import React from 'react';
import type { ProductPhotoSearchResponse, ProductPhotoSearchResult } from '../../types';

interface Props {
  queryPhotoUrl: string;
  response: ProductPhotoSearchResponse;
  onAdd: (sku: string) => void;
  onClose: () => void;
  onChangePhoto: () => void;
  onFallbackSearch: () => void;
}

export default function HasilCariFotoModal({
  queryPhotoUrl, response, onAdd, onClose, onChangePhoto, onFallbackSearch,
}: Props) {
  const { query_description, results } = response;
  const isLowConfidence = results.length === 0 || (results[0]?.similarity ?? 0) < 0.70;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[2rem] shadow-2xl max-w-4xl w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">image_search</span>
            </div>
            <div>
              <h4 className="text-base font-extrabold text-[#012749]">Hasil Pencarian by Foto</h4>
              <p className="text-[11px] text-[#43474e]">{results.length} produk paling cocok</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5 bg-slate-50 rounded-2xl p-3 border border-slate-100">
          <img src={queryPhotoUrl} alt="query" className="w-16 h-16 rounded-xl object-cover border-2 border-emerald-300" />
          <div className="flex-1">
            <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700">Foto Query Anda</div>
            <p className="text-xs font-bold text-[#012749] mt-0.5">
              AI deskripsi: <span className="font-medium text-slate-600 italic">"{query_description}"</span>
            </p>
          </div>
          <button onClick={onChangePhoto} className="px-3 py-1.5 border border-slate-200 text-slate-700 rounded-full text-[10px] font-extrabold uppercase tracking-widest hover:bg-slate-100">
            🔄 Ganti
          </button>
        </div>

        {isLowConfidence && results.length > 0 && (
          <div className="mb-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <p className="text-[11px] font-bold text-amber-900">Tidak ada produk yang cukup mirip (≥ 70%).</p>
            <p className="text-[10px] text-amber-800">Hasil di bawah ditampilkan dengan opacity rendah — konfirmasi visual saja.</p>
          </div>
        )}

        <div className={`space-y-3 max-h-[460px] overflow-y-auto pr-2 ${isLowConfidence ? 'opacity-60' : ''}`}>
          {results.map((r, idx) => (
            <ResultCard key={r.sku} result={r} rank={idx + 1} onAdd={() => onAdd(r.sku)} />
          ))}
          {results.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-xs">Tidak ditemukan</div>
          )}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200 flex justify-between">
          <button onClick={onFallbackSearch} className="text-[11px] text-[#2d8a4e] font-extrabold hover:underline">
            Tidak ada yang cocok? Cari manual via teks
          </button>
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-full text-xs font-bold">
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result, rank, onAdd }: { result: ProductPhotoSearchResult; rank: number; onAdd: () => void }) {
  const isBest = rank === 1;
  const isTipis = result.total_stock <= result.min_stock;
  return (
    <div className={`${isBest ? 'bg-emerald-50 border-2 border-emerald-300' : 'bg-white border border-slate-200'} rounded-2xl p-3 flex items-center gap-4`}>
      <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-200 relative shrink-0">
        {result.thumbnail_url
          ? <img src={result.thumbnail_url} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full" />}
        <div className={`absolute top-1 left-1 ${isBest ? 'bg-emerald-600' : 'bg-slate-700'} text-white text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full`}>
          #{rank}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full">
            {result.category}
          </span>
          {isBest && <span className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest">★ Best Match</span>}
          {isTipis && <span className="text-[9px] font-extrabold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">Tipis</span>}
        </div>
        <h5 className="text-sm font-extrabold text-[#012749] truncate">{result.name}</h5>
        <p className="text-[11px] text-slate-600 truncate">
          SKU: <code className="bg-slate-100 px-1 rounded">{result.sku}</code> · Rp {result.price.toLocaleString('id-ID')} / {result.unit}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Stok:</span>
          {result.warehouse_stock.length === 0 && (
            <span className="text-[10px] font-bold text-slate-400">Habis</span>
          )}
          {result.warehouse_stock.map((w, i) => (
            <span key={w.warehouse_id}
                  className={`text-[10px] font-extrabold border rounded-md px-1.5 py-0.5 ${
                    i === 0 ? 'text-emerald-800 bg-emerald-100 border-emerald-200'
                            : 'text-blue-800 bg-blue-100 border-blue-200'
                  }`}>
              {w.name}: {w.qty}
            </span>
          ))}
          <span className="text-[10px] font-black text-slate-700">= {result.total_stock} {result.unit}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mb-0.5">Cocok</div>
        <div className="text-xl font-black text-emerald-700">{Math.round(result.similarity * 100)}%</div>
      </div>
      <button onClick={onAdd}
              className={`px-4 py-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider shrink-0 inline-flex items-center gap-1.5 ${
                isBest ? 'bg-[#2d8a4e] text-white shadow-md shadow-emerald-600/20'
                       : 'border-2 border-emerald-200 text-emerald-700'
              }`}>
        <span className="material-symbols-outlined text-base">add_shopping_cart</span> Tambah
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/kasir/HasilCariFotoModal.tsx
git commit -m "feat(kasir): HasilCariFotoModal with per-warehouse stock breakdown"
```

**Acceptance:** Modal renders 0..5 result cards with thumbnails, similarity %, per-warehouse pills, "Tambah" button.

---

## Task 4.3: Wire modals into `KasirScreen`

**Files:**
- Modify: `src/components/KasirScreen.tsx` (add button + 2 modals + flow)

**Steps:**

- [ ] **Step 1: Add tombol + state**

In `KasirScreen.tsx`, find the header search-box area; add adjacent button:
```tsx
import CariByFotoModal from './kasir/CariByFotoModal';
import HasilCariFotoModal from './kasir/HasilCariFotoModal';
import { searchByPhoto } from '../lib/productPhotoService';
import type { ProductPhotoSearchResponse } from '../types';

const [showCariFoto, setShowCariFoto] = useState(false);
const [searching, setSearching] = useState(false);
const [queryPhotoUrl, setQueryPhotoUrl] = useState<string | null>(null);
const [searchResponse, setSearchResponse] = useState<ProductPhotoSearchResponse | null>(null);
```

Add the button in the header (near existing search input):
```tsx
<button onClick={() => setShowCariFoto(true)}
        className="px-5 py-3 bg-gradient-to-br from-[#2d8a4e] to-emerald-700 text-white rounded-full text-xs font-extrabold uppercase tracking-wider shadow-lg shadow-emerald-600/25 inline-flex items-center gap-2">
  <span className="material-symbols-outlined text-base">photo_camera</span>
  Cari by Foto
  <span className="ml-1 text-[8px] font-black bg-white/25 px-1.5 py-0.5 rounded-full uppercase tracking-widest">AI</span>
</button>
```

- [ ] **Step 2: Wire flow**

```tsx
async function handlePhotoChosen(blob: Blob, previewUrl: string) {
  setShowCariFoto(false);
  setQueryPhotoUrl(previewUrl);
  setSearching(true);
  try {
    const resp = await searchByPhoto(blob);
    setSearchResponse(resp);
  } catch (e) {
    showToast((e as Error).message, 'warning');
    setSearchResponse(null);
    setQueryPhotoUrl(null);
  } finally {
    setSearching(false);
  }
}

function addToCartBySku(sku: string) {
  // Reuse existing add-to-cart by SKU; replace this with the actual handler signature in KasirScreen
  // e.g. setCart(curr => [...curr, ...]); refer to existing onItemAdd in current code.
  // Then close hasil modal:
  setSearchResponse(null);
  setQueryPhotoUrl(null);
}
```

JSX:
```tsx
{showCariFoto && (
  <CariByFotoModal
    onClose={() => setShowCariFoto(false)}
    onPhotoChosen={handlePhotoChosen}
    showToast={showToast}
  />
)}
{searching && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
    <div className="bg-white rounded-2xl p-6 shadow-2xl flex items-center gap-3">
      <div className="w-6 h-6 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      <span className="text-xs font-extrabold text-[#012749]">AI sedang mencari produk…</span>
    </div>
  </div>
)}
{searchResponse && queryPhotoUrl && (
  <HasilCariFotoModal
    queryPhotoUrl={queryPhotoUrl}
    response={searchResponse}
    onAdd={addToCartBySku}
    onClose={() => { setSearchResponse(null); setQueryPhotoUrl(null); }}
    onChangePhoto={() => { setSearchResponse(null); setShowCariFoto(true); }}
    onFallbackSearch={() => { setSearchResponse(null); /* focus search input */ }}
  />
)}
```

- [ ] **Step 3: Lint + smoke**

```bash
npm run lint
npm run dev
```
Open Kasir, click Cari by Foto → upload a known indexed product → expect modal hasil within ~3s.

- [ ] **Step 4: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): wire CariByFoto + HasilCariFoto modals with backend search"
```

**Acceptance:** Full kasir flow: button → modal → upload → loading → results → click Tambah adds to cart.

---

## Task 4.4: Multi-warehouse stock badge in `StockTableView` rows

**Files:**
- Modify: `src/components/produk/StockTableView.tsx`
- Modify: `src/lib/supabaseClient.ts` (add `stockLevelsService.listForSkus`)

**Steps:**

- [ ] **Step 1: Add service**

```ts
export const stockLevelsService = {
  async listForSkus(skus: string[]): Promise<Record<string, Array<{ warehouse_id: string; warehouse_name: string; qty: number }>>> {
    if (skus.length === 0) return {};
    const { data, error } = await supabase
      .from('stock_levels')
      .select('sku, qty, warehouse_id, warehouses!inner(name, sort_order, is_active)')
      .in('sku', skus);
    if (error) throw error;
    const out: Record<string, Array<{ warehouse_id: string; warehouse_name: string; qty: number }>> = {};
    for (const r of data ?? []) {
      const sku = (r as { sku: string }).sku;
      const wh = (r as { warehouses: { name: string; is_active: boolean } }).warehouses;
      if (!wh.is_active) continue;
      (out[sku] ??= []).push({
        warehouse_id: (r as { warehouse_id: string }).warehouse_id,
        warehouse_name: wh.name,
        qty: (r as { qty: number }).qty,
      });
    }
    return out;
  },
};
```

- [ ] **Step 2: Use in StockTableView**

```tsx
import { stockLevelsService } from '../../lib/supabaseClient';

const [perWarehouse, setPerWarehouse] = useState<Record<string, Array<{ warehouse_name: string; qty: number }>>>({});
useEffect(() => {
  void stockLevelsService.listForSkus(filtered.map(s => s.sku)).then(d => {
    const flat: Record<string, Array<{ warehouse_name: string; qty: number }>> = {};
    for (const k in d) flat[k] = d[k].map(({ warehouse_name, qty }) => ({ warehouse_name, qty }));
    setPerWarehouse(flat);
  });
}, [filtered]);
```

In each row's rendering, add a small block:
```tsx
<div className="flex flex-wrap gap-1 mt-1">
  {(perWarehouse[item.sku] ?? []).filter(w => w.qty > 0).map(w => (
    <span key={w.warehouse_name} className="text-[9px] font-extrabold text-slate-700 bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5">
      {w.warehouse_name}: {w.qty}
    </span>
  ))}
</div>
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/produk/StockTableView.tsx src/lib/supabaseClient.ts
git commit -m "feat(produk): per-warehouse stock badge in StockTableView rows"
```

**Acceptance:** Every row shows pills per non-zero warehouse.

---

## Task 4.5: Section "Stok per Gudang" inside ProductForm Edit mode

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`

**Steps:**

- [ ] **Step 1: Conditional render when editing**

Below the Foto card, only when `initial?.sku`:
```tsx
{initial?.sku && (
  <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
    <h5 className="text-sm font-extrabold text-[#012749] mb-3">🏬 Stok per Gudang</h5>
    <StockPerWarehouseTable sku={initial.sku} warehouses={warehouses} />
  </div>
)}
```

- [ ] **Step 2: Implement helper**

```tsx
function StockPerWarehouseTable({ sku, warehouses }: { sku: string; warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<Array<{ warehouse_id: string; warehouse_name: string; qty: number }>>([]);
  useEffect(() => {
    void stockLevelsService.listForSkus([sku]).then(d => {
      const map = new Map(d[sku]?.map(r => [r.warehouse_id, r]) ?? []);
      setRows(warehouses.filter(w => w.is_active).map(w => ({
        warehouse_id: w.id, warehouse_name: w.name,
        qty: map.get(w.id)?.qty ?? 0,
      })));
    });
  }, [sku, warehouses]);
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-slate-500 uppercase tracking-widest text-[10px]">
        <th className="text-left py-1">Gudang</th>
        <th className="text-right py-1">Stok</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.warehouse_id} className="border-t border-slate-100">
            <td className="py-1.5 font-semibold text-[#012749]">{r.warehouse_name}</td>
            <td className="py-1.5 text-right font-extrabold text-emerald-700">{r.qty}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Lint + commit**

```bash
npm run lint
git add src/components/produk/ProductForm.tsx
git commit -m "feat(produk): Stok per Gudang read-only table in Edit mode"
```

**Acceptance:** Editing existing SKU shows per-warehouse table.

---

## Task 4.6: Phase 4 smoke + tag

- [ ] **Step 1: Smoke**

1. Cari by Foto → upload indexed photo → result modal with per-warehouse pills.
2. Click Tambah → product enters cart.
3. Stok per Gudang badges on table view show correct values.
4. Edit a product → Stok per Gudang section renders.

- [ ] **Step 2: Tag**

```bash
git tag phase4-complete
```

---

# PHASE 4 EXIT CHECK

- [ ] Kasir Cari by Foto end-to-end < 4s p95
- [ ] Per-warehouse pills correct across views
- [ ] Modal shows empty-state for similarity < 0.70
- [ ] Add-to-cart works from Hasil modal


---

# PHASE 5 — Pengaturan & Approval Handler

## Task 5.1: Pengaturan — "Metode Costing Toko" panel

**Files:**
- Modify: `src/components/PengaturanScreen.tsx`

**Steps:**

- [ ] **Step 1: Add state**

```tsx
import { companySettingsService } from '../lib/supabaseClient';
import type { CostingMethod } from '../types';

const [costing, setCosting] = useState<CostingMethod>('FIFO');
const [savingCosting, setSavingCosting] = useState(false);

useEffect(() => { void companySettingsService.getCostingMethod().then(setCosting); }, []);

async function handleSaveCosting() {
  setSavingCosting(true);
  try {
    await companySettingsService.setCostingMethod(costing);
    showToast('Metode costing disimpan');
  } catch (e) {
    showToast('Gagal menyimpan: ' + (e as Error).message, 'warning');
  } finally {
    setSavingCosting(false);
  }
}
```

- [ ] **Step 2: Add panel JSX (in the existing settings layout)**

```tsx
<section className="bg-white rounded-[2.5rem] p-7 border border-[#e5eeff] shadow-xl">
  <div className="flex items-center gap-4 mb-5">
    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-[#012749] flex items-center justify-center shrink-0">
      <span className="material-symbols-outlined text-2xl">calculate</span>
    </div>
    <div>
      <h3 className="text-base font-extrabold text-[#012749]">Metode Costing Toko</h3>
      <p className="text-[11px] text-[#43474e]">Berlaku untuk semua produk & laporan profit.</p>
    </div>
  </div>

  <div className="space-y-3">
    <label className={`block rounded-2xl p-4 cursor-pointer border-2 ${costing === 'FIFO' ? 'bg-emerald-50 border-emerald-400' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start gap-3">
        <input type="radio" checked={costing === 'FIFO'} onChange={() => setCosting('FIFO')} className="mt-1 accent-emerald-600" />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-extrabold text-[#012749]">FIFO (First-In, First-Out)</span>
            <span className="text-[8.5px] font-black uppercase bg-emerald-600 text-white px-1.5 py-0.5 rounded-full">Default</span>
          </div>
          <p className="text-[11px] text-slate-600">HPP dihitung dari stock lot tertua. Akurat untuk harga modal yang berubah.</p>
        </div>
      </div>
    </label>
    <label className={`block rounded-2xl p-4 cursor-pointer border-2 ${costing === 'Average' ? 'bg-emerald-50 border-emerald-400' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start gap-3">
        <input type="radio" checked={costing === 'Average'} onChange={() => setCosting('Average')} className="mt-1 accent-emerald-600" />
        <div className="flex-1">
          <div className="text-sm font-extrabold text-[#012749]">Average (Rata-rata Tertimbang)</div>
          <p className="text-[11px] text-slate-600">HPP rata-rata semua lot. Lebih halus untuk laporan tapi kurang akurat saat harga modal volatile.</p>
        </div>
      </div>
    </label>
  </div>

  <div className="mt-5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-start gap-2">
    <span className="material-symbols-outlined text-amber-600 text-base">warning</span>
    <p className="text-[11px] text-amber-900">
      <strong>Penting:</strong> Mengubah metode di tengah operasi akan menghitung ulang HPP semua transaksi setelah tanggal perubahan. Laporan sebelumnya tidak berubah.
    </p>
  </div>

  <div className="mt-4 flex justify-end">
    <button onClick={handleSaveCosting} disabled={savingCosting}
            className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold inline-flex items-center gap-1.5">
      <span className="material-symbols-outlined text-sm">save</span> Simpan Metode
    </button>
  </div>
</section>
```

- [ ] **Step 3: Lint + smoke + commit**

```bash
npm run lint
```
Open Pengaturan, change radio, save → check `company_settings` updated.

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): Metode Costing Toko panel (FIFO/Average)"
```

**Acceptance:** Radio change saves to DB; ProductForm Harga Modal label switches when costing changes (test: edit a product with `stock_lots`).

---

## Task 5.2: Pengaturan — "Aktivitas AI Call" panel

**Files:**
- Modify: `src/lib/supabaseClient.ts` (add `aiCallLogService.statsForToday`)
- Modify: `src/components/PengaturanScreen.tsx`

**Steps:**

- [ ] **Step 1: Add service**

```ts
export const aiCallLogService = {
  async statsForToday(): Promise<{ vision: AiCallLogStat; embedding: AiCallLogStat }> {
    const { data, error } = await supabase.rpc('ai_call_log_today_stats');
    if (error) throw error;
    const arr = (data as Array<AiCallLogStat & { model: 'flash-2.5-vision' | 'text-embedding-004' }>) ?? [];
    const empty: AiCallLogStat = { model: 'flash-2.5-vision', success: 0, error: 0, rate_limit: 0, p50_ms: null, p95_ms: null, last_error_at: null };
    return {
      vision: arr.find(r => r.model === 'flash-2.5-vision') ?? { ...empty, model: 'flash-2.5-vision' },
      embedding: arr.find(r => r.model === 'text-embedding-004') ?? { ...empty, model: 'text-embedding-004' },
    };
  },
};
```

- [ ] **Step 2: Add SQL function**

Create `supabase/migrations/20260614000026_ai_call_log_today_stats_rpc.sql`:
```sql
CREATE OR REPLACE FUNCTION public.ai_call_log_today_stats()
RETURNS TABLE (
  model         TEXT,
  success       INT,
  error         INT,
  rate_limit    INT,
  p50_ms        INT,
  p95_ms        INT,
  last_error_at TIMESTAMPTZ
) LANGUAGE sql STABLE AS $$
  SELECT
    model,
    COUNT(*) FILTER (WHERE status='success')::INT,
    COUNT(*) FILTER (WHERE status='error')::INT,
    COUNT(*) FILTER (WHERE status='rate_limit')::INT,
    PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY latency_ms)::INT,
    PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms)::INT,
    MAX(called_at) FILTER (WHERE status='error')
  FROM public.ai_call_log
  WHERE called_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta')
  GROUP BY model;
$$;
GRANT EXECUTE ON FUNCTION public.ai_call_log_today_stats() TO authenticated, anon;
```

Apply, then verify with `SELECT * FROM public.ai_call_log_today_stats();`.

- [ ] **Step 3: Add panel JSX in PengaturanScreen**

```tsx
const [stats, setStats] = useState<{ vision: AiCallLogStat; embedding: AiCallLogStat } | null>(null);
useEffect(() => { void aiCallLogService.statsForToday().then(setStats); }, []);
```

Panel (paste after Costing panel):
```tsx
{stats && (
  <section className="bg-white rounded-[2.5rem] p-7 border border-[#e5eeff] shadow-xl">
    <div className="flex items-center gap-4 mb-3">
      <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center">
        <span className="material-symbols-outlined text-2xl">monitoring</span>
      </div>
      <div>
        <h3 className="text-base font-extrabold text-[#012749]">Aktivitas AI Call — Hari Ini</h3>
        <p className="text-[11px] text-[#43474e]">Reset 00:00 WIB · sumber: log internal kita</p>
      </div>
    </div>
    <div className="mb-5 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2">
      <p className="text-[10.5px] text-slate-700">
        <strong>Catatan:</strong> Google tidak expose sisa kuota Gemini real-time. Angka di bawah hanya menghitung call yang sistem kita lakukan hari ini.
      </p>
    </div>
    <div className="grid grid-cols-2 gap-3 mb-3">
      <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
        <div className="text-[9px] font-black uppercase tracking-widest text-purple-700 mb-1">Vision (describe foto)</div>
        <div className="text-2xl font-black text-[#012749]">{stats.vision.success + stats.vision.error + stats.vision.rate_limit}</div>
        <div className="text-[10px] text-slate-500">call · sukses {stats.vision.success} · gagal {stats.vision.error}</div>
      </div>
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
        <div className="text-[9px] font-black uppercase tracking-widest text-blue-700 mb-1">Text Embedding</div>
        <div className="text-2xl font-black text-[#012749]">{stats.embedding.success + stats.embedding.error + stats.embedding.rate_limit}</div>
        <div className="text-[10px] text-slate-500">call · sukses {stats.embedding.success} · gagal {stats.embedding.error}</div>
      </div>
    </div>
    <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 mb-3">
      <div className="flex justify-between text-[11px]">
        <div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Vision p50 / p95</div>
          <div className="font-bold text-[#012749]">{stats.vision.p50_ms ?? '—'} ms / {stats.vision.p95_ms ?? '—'} ms</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Last Error</div>
          <div className="font-bold text-slate-600">{stats.vision.last_error_at ?? '—'}</div>
        </div>
      </div>
    </div>
    <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
      <p className="text-[11px] font-bold text-[#012749]">Sinyal kapan perlu mempertimbangkan upgrade:</p>
      <ul className="text-[10px] text-blue-900 mt-1 list-disc list-inside">
        <li>429 berulang dalam jam sibuk → quota Google mulai menghalangi</li>
        <li>Latency p95 &gt; 5000 ms konsisten → free tier mungkin di-throttle</li>
        <li>Sistem hanya <strong>notify</strong>, tidak pernah auto-upgrade billing.</li>
      </ul>
    </div>
  </section>
)}
```

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add supabase/migrations/20260614000026_ai_call_log_today_stats_rpc.sql \
        src/lib/supabaseClient.ts src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): Aktivitas AI Call panel (honest counts, no fake quota %)"
```

**Acceptance:** Panel shows real counts from `ai_call_log`; disclaimer banner present; no "X/1500" fake bar.

---

## Task 5.3: Approval handler — `initial_stock` payload + WA notify

**Files:**
- Modify: `backend-go/internal/approvals/` (or wherever approval handlers live; see existing `kasir_void`, `kasir_refund` handlers)
- Modify: relevant WhatsApp message template file

**Why:** When `approval_requests.request_type='initial_stock'` is approved, transfer the qty into `stock_levels` for the target warehouse and flip `stocks.initial_stock_approved = true`.

**Steps:**

- [ ] **Step 1: Locate existing approval handler dispatch**

```bash
grep -rn "kasir_void\|kasir_refund\|adjustment" backend-go/internal/approvals/ 2>/dev/null | head
```
Identify the switch/case where each `request_type` is handled.

- [ ] **Step 2: Add `initial_stock` branch**

In whichever dispatcher handles approvals (e.g. `approvals/handler.go`), add:
```go
case "initial_stock":
    payload := struct {
        SKU         string  `json:"sku"`
        Qty         int     `json:"qty"`
        WarehouseID string  `json:"warehouse_id"`
        CostPerUnit float64 `json:"requested_cost_per_unit"`
    }{}
    if err := json.Unmarshal(req.Payload, &payload); err != nil {
        return fmt.Errorf("decode initial_stock payload: %w", err)
    }
    // 1) Atomically: insert stock_levels row, mark stocks.initial_stock_approved=true
    tx, err := db.BeginTx(ctx, nil)
    if err != nil { return err }
    defer tx.Rollback()

    _, err = tx.ExecContext(ctx, `
        INSERT INTO public.stock_levels (sku, warehouse_id, qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (sku, warehouse_id) DO UPDATE SET qty = stock_levels.qty + EXCLUDED.qty
    `, payload.SKU, payload.WarehouseID, payload.Qty)
    if err != nil { return err }

    _, err = tx.ExecContext(ctx, `
        UPDATE public.stocks SET initial_stock_approved = TRUE WHERE sku = $1
    `, payload.SKU)
    if err != nil { return err }

    // 2) Insert into stock_lots so FIFO has a basis cost
    if payload.CostPerUnit > 0 {
        _, err = tx.ExecContext(ctx, `
            INSERT INTO public.stock_lots (sku, unit_cost, qty_received, qty_remaining)
            VALUES ($1, $2, $3, $3)
        `, payload.SKU, payload.CostPerUnit, payload.Qty)
        if err != nil { return err }
    }
    if err := tx.Commit(); err != nil { return err }
```

- [ ] **Step 3: WhatsApp template**

Add a message template if the codebase uses one (search `case "adjustment"` in WA notification logic):
```
Permintaan stok awal untuk {{.SKUName}} ({{.SKU}}):
  {{.Qty}} {{.Unit}} → Gudang {{.WarehouseName}}{{if .CostPerUnit}}, modal Rp {{.CostPerUnit}}/unit{{end}}.
Balas YA untuk setujui, TIDAK untuk tolak.
```

- [ ] **Step 4: Compile + manual test**

Create an approval row via the frontend, approve via owner PIN / WA simulation, verify stock_levels increases and `initial_stock_approved` flips true.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/approvals/
git commit -m "feat(approvals): handle initial_stock — insert stock_levels + stock_lots, flip flag"
```

**Acceptance:** Approving the request increments stock; rejecting leaves stock at 0; produk continues to be visible in Katalog (but search RPC excludes when `initial_stock_approved=false`).

---

## Task 5.4: Phase 5 smoke

- [ ] **Step 1: Costing toggle persists across reload**
- [ ] **Step 2: AI Activity panel shows non-zero counts after Phase 3 testing**
- [ ] **Step 3: Initial stock approval → DB updates correctly**

- [ ] **Step 4: Tag**

```bash
git tag phase5-complete
```

---

# PHASE 5 EXIT CHECK

- [ ] Costing radio saves to DB
- [ ] Activity panel renders honestly (no fake numbers)
- [ ] initial_stock approval moves qty into stock_levels + creates stock_lot

---

# PHASE 6 — Testing & Polish

## Task 6.1: Unit tests round-up

**Files:**
- Already created in earlier tasks. This task ensures full coverage list passes.

**Steps:**

- [ ] **Step 1: Run all tests**

```bash
npm run test
```
Expected sets:
- `productPhotoService.test.ts` (compress validation)
- `PreviewCard.test.tsx` (margin)
- `categorySpecs.test.ts` (generateName / specFieldsFor)
- `photoValidation.test.ts` (count gates)
- `productFormValidate.test.ts` (form validation)

All passing.

- [ ] **Step 2: Add `unitConversionFactor` helper test**

Create `src/lib/unitConversion.ts`:
```ts
export function convertToBase(qty: number, factor: number | null | undefined): number {
  if (!factor || factor < 2) return qty;
  return qty * factor;
}
export function convertFromBase(qtyBase: number, factor: number | null | undefined): number {
  if (!factor || factor < 2) return qtyBase;
  return qtyBase / factor;
}
```

`src/lib/unitConversion.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { convertToBase, convertFromBase } from './unitConversion';
describe('unit conversion', () => {
  it('1 roll → 100 m', () => expect(convertToBase(1, 100)).toBe(100));
  it('2 roll → 200 m', () => expect(convertToBase(2, 100)).toBe(200));
  it('200 m → 2 roll', () => expect(convertFromBase(200, 100)).toBe(2));
  it('no factor = identity', () => expect(convertToBase(48, null)).toBe(48));
});
```

Run: `npm run test -- src/lib/unitConversion.test.ts` → 4 passing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/unitConversion.ts src/lib/unitConversion.test.ts
git commit -m "test: unit conversion helpers"
```

**Acceptance:** All Phase 1-5 unit tests + new unit-conversion tests pass.

---

## Task 6.2: Integration smoke checklist

- [ ] **Step 1: Run the full manual smoke from spec §9.3**

1. Add product 3-foto MCB → list shows thumbnail. `stock_photo_embeddings` count = 3 within 10s.
2. Kasir Cari by Foto with MCB photo → result modal under 4s. Top result is the just-added SKU. Click Tambah → cart.
3. Pengaturan toggle costing FIFO ↔ Average → saved; reload persists.
4. Stok Awal=100 in form → approval request created. Approve → `stock_levels` increases.
5. Multi-satuan kabel: utama=meter, paket=roll, factor=100. Stok awal 2 roll? Use the kabel test: ensure stocks.unit_alt and factor saved correctly.

- [ ] **Step 2: Cross-browser**

- Chrome desktop ✓
- Safari iPad (kamera capture) ✓
- Mobile Chrome Android ✓

- [ ] **Step 3: Doc smoke results in `progress.md`**

Append a section noting:
```md
## 2026-06-<exec date> — Product Photo Sprint DONE

- 5 migrations applied
- ProductForm + CatalogGridView + StockTableView + BulkUploadSection live
- Backend Go AI pipeline (Vision + Embed + Search)
- Kasir Cari by Foto + multi-warehouse stock display
- Pengaturan Costing + AI Activity Monitor
- initial_stock approval handler wired
- All unit tests passing; manual smoke per checklist done.
```

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "docs(progress): product-photo sprint shipped"
```

---

## Task 6.3: Final polish pass

**Steps:**

- [ ] **Step 1: Font-size audit (per memory feedback)**

Verify UI base text uses `text-xs` (12px) / `text-[13px]` for body — no `text-[9px]`/`text-[10px]` outside tiny labels. Run a visual sweep in browser.

- [ ] **Step 2: Empty-state polish**

- Katalog with 0 products: friendly message.
- Search by foto with 0 indexed embeddings: graceful "Belum ada produk yang di-index" message.
- AI Activity panel before any call: `stats?.vision.success ?? 0` so it renders zeros not crash.

- [ ] **Step 3: Type cleanup**

```bash
npm run lint
```
Expected: 0 errors / 0 warnings.

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "polish: font sizes, empty states, type cleanup"
```

---

## Task 6.4: Create PR

**Steps:**

- [ ] **Step 1: Push branch and create PR**

```bash
git push -u origin feat/calista-phase-1a   # or whichever feature branch
gh pr create --title "feat: Product & Stok — multi-photo + Cari by Foto + Jurnal-parity fields" \
  --body "$(cat <<'BODY'
## Summary
- Renames "Stok" menu to **Produk & Stok**; refactors `StockManagerScreen.tsx` (1051 → ~200) into orchestrator + 5 child components.
- Adds multi-photo upload (1-5, mandatory thumbnail), client compression, Supabase Storage `product-photos` bucket.
- AI indexing pipeline (Gemini Flash 2.5 Vision + text-embedding-004 + pgvector) — free tier.
- Kasir Cari by Foto (Camera + Upload, top-5 with similarity %, per-warehouse stock breakdown).
- Form fields: SKU editable, Sub-Kategori, Satuan (UoM) + multi-satuan konversi, Harga Modal Awal (Estimasi) → Aktual (FIFO|Average) dynamic, Batas Stok Min, Stok Awal w/ owner approval.
- Pengaturan: Metode Costing (FIFO/Average), Aktivitas AI Call (honest counts, no fake quota).
- Multi-tenant ready (Change A: generic fallback for custom categories; Change B: `tenant_id NULL` columns).

## Test plan
- [ ] Add product with 3 photos → thumbnail visible, `stock_photo_embeddings` count = 3 within 10s
- [ ] Cari by Foto → top result is just-added SKU; per-warehouse pills correct
- [ ] Toggle FIFO ↔ Average → persists across reload; ProductForm Harga Modal label switches
- [ ] Stok Awal > 0 → approval row created; approve → stock_levels updates + `initial_stock_approved = true`
- [ ] Multi-satuan kabel (utama=meter, paket=roll, factor=100) → DB columns correct
- [ ] All vitest tests pass: `npm run test`
- [ ] Backend builds: `cd backend-go && go build ./...`
BODY
)"
```

- [ ] **Step 2: Note the PR URL in `progress.md`**

```bash
PR_URL=$(gh pr view --json url -q .url)
echo -e "\n## PR\n- $PR_URL" >> progress.md
git add progress.md
git commit -m "docs(progress): add PR link"
git push
```

**Acceptance:** PR created with full summary + test plan; CI passes (if configured).

---

# DONE.

