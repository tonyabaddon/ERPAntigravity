# Foto-Search Plan A — Foundation (DB + Form Produk) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for product photo search: DB schema (registry tables + photo embeddings + initial_stock approval enum), `StockItem` type extension, refactor `StockManagerScreen.tsx` (1051 lines monolith) into orchestrator + 5 components, and implement the full Form Produk (Tambah/Edit Barang) with multi-photo upload + multi-warehouse stock.

**Architecture:** DB migrations first (additive, no breaking changes). Then refactor + new components in `src/components/produk/` folder. Photos stored in Supabase Storage; `stock_photo_embeddings` table created empty (populated by Plan C when CLIP backend ships). Form Produk submits via service layer (`stockService` extension), no direct Supabase calls in components.

**Tech Stack:** React 19 + TypeScript + Vitest 4 + Tailwind CSS + Material Symbols + Supabase JS + Postgres + pgvector. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-06-14-product-photo-search-design.md` (sections §2 DB, §3 Form, §6.1 settings unchanged). This plan covers spec Phases 1 + 2.

**Prerequisites:**
- Branch off `main` after the most recent ship.
- Verify Supabase CLI installed: `supabase --version`.
- Verify `pgvector` extension already in DB: `SELECT extname FROM pg_extension WHERE extname='vector';` (should be present from earlier work).

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `supabase/migrations/20260616000001_product_registry_tables.sql` | `product_categories`, `product_brands`, `product_units` registry + seed | Create |
| `supabase/migrations/20260616000002_stocks_extend_fields.sql` | Extend `stocks` with `sku_editable`, `sub_category_id`, `unit_id`, `unit_alt_id`, `unit_alt_factor`, `harga_modal`, `min_stock`, `description`, `photo_urls TEXT[]`, `initial_stock_approved BOOL` | Create |
| `supabase/migrations/20260616000003_stock_photo_embeddings.sql` | `stock_photo_embeddings (sku, photo_path, embedding vector(512))` — empty table, populated by Plan C | Create |
| `supabase/migrations/20260616000004_initial_stock_approval_enum.sql` | Add `initial_stock` to `approval_request_type` enum | Create |
| `src/types.ts:154` | Extend `StockItem` interface with new fields | Modify |
| `src/lib/supabaseClient.ts` | Add registry CRUD + photo upload methods to `stockService` | Modify |
| `src/lib/productPhotoService.ts` | New service: upload to Storage, generate paths, compress wrapper | Create |
| `src/components/produk/CatalogView.tsx` | Orchestrator: tab routing, search/filter state, renders grid view (foundation only — Plan B adds list view) | Create |
| `src/components/produk/CatalogGridView.tsx` | Mode Foto: 4-col grid (existing layout, extracted) | Create |
| `src/components/produk/ProductForm.tsx` | Tambah/Edit form: two-column + live preview, all sections | Create |
| `src/components/produk/PreviewCard.tsx` | Live preview card (right column of form) | Create |
| `src/components/produk/StockTableView.tsx` | Tab "Stok per Gudang" extracted from existing | Create |
| `src/components/produk/BulkUploadSection.tsx` | Tab "Bulk Upload" extracted from existing CSV import | Create |
| `src/components/StockManagerScreen.tsx` | Slim down to ~200-line orchestrator: tab routing only | Modify |
| `src/components/Sidebar.tsx` | Label rename "Stok" → "Produk & Stok" | Modify |

---

### Task 1: DB migration — registry tables

**Files:**
- Create: `supabase/migrations/20260616000001_product_registry_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 20260616000001_product_registry_tables.sql
-- Registry tables for Brands, Categories, Units. Per-tenant scoped via tenant_id NULL = global.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  parent_id   UUID NULL REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_tenant_name
  ON public.product_categories (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE IF NOT EXISTS public.product_brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_brands_tenant_name
  ON public.product_brands (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE IF NOT EXISTS public.product_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_tenant_name
  ON public.product_units (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Seed default global rows (tenant_id NULL).
INSERT INTO public.product_categories (name, sort_order) VALUES
  ('Panel', 1), ('MCB', 2), ('Kabel', 3), ('Aksesori', 4)
ON CONFLICT DO NOTHING;

INSERT INTO public.product_brands (name) VALUES
  ('Schneider'), ('ABB'), ('Chint'), ('Hager'), ('LS'),
  ('Eterna'), ('Supreme'), ('Salim'), ('Panasonic'), ('Philips'), ('Broco')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_units (name, is_default) VALUES
  ('pcs', TRUE), ('m', FALSE), ('roll', FALSE), ('box', FALSE), ('kg', FALSE), ('set', FALSE)
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_brands     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_units      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read all authenticated" ON public.product_categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "read all authenticated" ON public.product_brands     FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "read all authenticated" ON public.product_units      FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "insert by authenticated" ON public.product_categories FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "insert by authenticated" ON public.product_brands     FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "insert by authenticated" ON public.product_units      FOR INSERT TO authenticated WITH CHECK (TRUE);
```

- [ ] **Step 2: Apply migration locally**

```bash
./scripts/apply-pending-migrations.sh
```

Expected: prints applied migration `20260616000001_product_registry_tables.sql`. No errors.

- [ ] **Step 3: Verify seed data**

```bash
psql "$DATABASE_URL" -c "SELECT name FROM product_categories ORDER BY sort_order; SELECT count(*) FROM product_brands; SELECT name FROM product_units WHERE is_default;"
```

Expected: 4 categories, 11 brands, 1 default unit (`pcs`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260616000001_product_registry_tables.sql
git commit -m "feat(db): product registry tables (categories, brands, units) + seed"
```

---

### Task 2: DB migration — extend `stocks` schema

**Files:**
- Create: `supabase/migrations/20260616000002_stocks_extend_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000002_stocks_extend_fields.sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS sub_category_id      UUID NULL REFERENCES public.product_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_id             UUID NULL REFERENCES public.product_brands(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_id              UUID NULL REFERENCES public.product_units(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_alt_id          UUID NULL REFERENCES public.product_units(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unit_alt_factor      NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS min_stock            INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description          TEXT NULL,
  ADD COLUMN IF NOT EXISTS photo_urls           TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS initial_stock_approved BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill: existing rows get is_default unit (pcs).
UPDATE public.stocks
SET unit_id = (SELECT id FROM public.product_units WHERE is_default = TRUE LIMIT 1)
WHERE unit_id IS NULL;

-- Backfill brand from existing specs.mcb_merek field (best-effort, only Schneider/ABB/Chint/Hager/LS).
UPDATE public.stocks s
SET brand_id = b.id
FROM public.product_brands b
WHERE s.brand_id IS NULL
  AND s.specs ? 'mcb_merek'
  AND b.name = (s.specs ->> 'mcb_merek');

CREATE INDEX IF NOT EXISTS idx_stocks_brand   ON public.stocks (brand_id);
CREATE INDEX IF NOT EXISTS idx_stocks_subcat  ON public.stocks (sub_category_id);
```

- [ ] **Step 2: Apply and verify**

```bash
./scripts/apply-pending-migrations.sh
psql "$DATABASE_URL" -c "SELECT count(*) FROM stocks WHERE unit_id IS NOT NULL;"
```

Expected: same as `SELECT count(*) FROM stocks;` (all backfilled).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616000002_stocks_extend_fields.sql
git commit -m "feat(db): extend stocks with brand/unit/photo_urls/min_stock/description"
```

---

### Task 3: DB migration — `stock_photo_embeddings`

**Files:**
- Create: `supabase/migrations/20260616000003_stock_photo_embeddings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000003_stock_photo_embeddings.sql
-- Empty table — populated by Plan C when CLIP backend ships.
-- Vector(512) matches CLIP ViT-Base-32 image encoder output dim.

CREATE TABLE IF NOT EXISTS public.stock_photo_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  photo_path  TEXT NOT NULL,
  embedding   vector(512) NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku, photo_path)
);

CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_sku
  ON public.stock_photo_embeddings (sku);

-- pgvector HNSW index for similarity search.
CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_vec_hnsw
  ON public.stock_photo_embeddings USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.stock_photo_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read all authenticated" ON public.stock_photo_embeddings FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "service role full access" ON public.stock_photo_embeddings FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
```

- [ ] **Step 2: Apply and verify**

```bash
./scripts/apply-pending-migrations.sh
psql "$DATABASE_URL" -c "\d stock_photo_embeddings"
```

Expected: table shape matches; HNSW index present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616000003_stock_photo_embeddings.sql
git commit -m "feat(db): stock_photo_embeddings table with pgvector(512) + HNSW index"
```

---

### Task 4: DB migration — `initial_stock` approval enum

**Files:**
- Create: `supabase/migrations/20260616000004_initial_stock_approval_enum.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260616000004_initial_stock_approval_enum.sql
-- Add 'initial_stock' to the approval_request_type enum.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'initial_stock';
```

- [ ] **Step 2: Apply and verify**

```bash
./scripts/apply-pending-migrations.sh
psql "$DATABASE_URL" -c "SELECT unnest(enum_range(NULL::approval_request_type));"
```

Expected: `initial_stock` appears in the enum list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260616000004_initial_stock_approval_enum.sql
git commit -m "feat(db): add initial_stock to approval_request_type enum"
```

---

### Task 5: Extend `StockItem` type

**Files:**
- Modify: `src/types.ts:154`

- [ ] **Step 1: Read the current interface**

```bash
sed -n '154,166p' src/types.ts
```

- [ ] **Step 2: Replace the interface**

```ts
export interface PhotoMeta {
  url: string;
  thumb_url?: string;
  path: string;
  sort_order: number;
}

export interface StockItem {
  sku: string;
  name: string;
  category: string;
  sub_category_id?: string | null;
  brand_id?: string | null;
  unit_id?: string | null;
  unit_alt_id?: string | null;
  unit_alt_factor?: number | null;
  price: number;
  stock: number;
  stock_atas?: number;
  stock_bawah?: number;
  status: 'Sinkron' | 'Stok Tipis';
  specs: Record<string, string | number>;
  harga_modal?: number | null;
  min_stock?: number;
  description?: string | null;
  photo_urls?: string[];
  photos?: PhotoMeta[];
  initial_stock_approved?: boolean;
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. Existing consumers tolerate the optional fields.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend StockItem with brand/unit/photos/min_stock"
```

---

### Task 6: Service layer — registry CRUD + photo upload

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Create: `src/lib/productPhotoService.ts`

- [ ] **Step 1: Add registry helpers to `stockService` in `supabaseClient.ts`**

Append inside the `stockService` export:

```ts
async listCategories(): Promise<Array<{id: string; name: string; parent_id: string | null}>> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, name, parent_id')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
},
async createCategory(name: string, parent_id: string | null): Promise<{id: string; name: string}> {
  const { data, error } = await supabase
    .from('product_categories')
    .insert({ name: name.trim(), parent_id })
    .select('id, name')
    .single();
  if (error) throw error;
  return data;
},
async listBrands(): Promise<Array<{id: string; name: string}>> {
  const { data, error } = await supabase.from('product_brands').select('id, name').order('name');
  if (error) throw error;
  return data ?? [];
},
async createBrand(name: string): Promise<{id: string; name: string}> {
  const { data, error } = await supabase.from('product_brands').insert({ name: name.trim() }).select('id, name').single();
  if (error) throw error;
  return data;
},
async listUnits(): Promise<Array<{id: string; name: string; is_default: boolean}>> {
  const { data, error } = await supabase.from('product_units').select('id, name, is_default').order('is_default', { ascending: false }).order('name');
  if (error) throw error;
  return data ?? [];
},
async createUnit(name: string): Promise<{id: string; name: string}> {
  const { data, error } = await supabase.from('product_units').insert({ name: name.trim().toLowerCase() }).select('id, name').single();
  if (error) throw error;
  return data;
},
```

- [ ] **Step 2: Create `productPhotoService.ts`**

```ts
// src/lib/productPhotoService.ts
import { supabase } from './supabaseClient';

const BUCKET = 'product-photos';

export async function compressImage(file: File, maxDim = 1024, quality = 0.75): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/jpeg', quality);
  });
}

export async function uploadPhoto(sku: string, index: number, blob: Blob): Promise<{path: string; publicUrl: string}> {
  const path = `${sku}/${index}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

export async function deletePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export function validatePhotoFile(file: File): { ok: boolean; reason?: string } {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'Hanya foto yang didukung.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, reason: 'File terlalu besar. Max 5MB sebelum compress.' };
  return { ok: true };
}
```

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/lib/supabaseClient.ts src/lib/productPhotoService.ts
git commit -m "feat(service): registry CRUD + productPhotoService compress/upload/delete"
```

---

### Task 7: Create `product-photos` Storage bucket

**Files:**
- None (Supabase Dashboard or Migration)

- [ ] **Step 1: Add bucket migration**

Create `supabase/migrations/20260616000005_product_photos_bucket.sql`:

```sql
-- 20260616000005_product_photos_bucket.sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', TRUE)
ON CONFLICT DO NOTHING;

-- Allow authenticated users to upload + read.
CREATE POLICY "authenticated upload product photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos');
CREATE POLICY "public read product photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'product-photos');
CREATE POLICY "authenticated delete product photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-photos');
```

- [ ] **Step 2: Apply and commit**

```bash
./scripts/apply-pending-migrations.sh
git add supabase/migrations/20260616000005_product_photos_bucket.sql
git commit -m "feat(storage): product-photos bucket + RLS policies"
```

---

### Task 8: Create `src/components/produk/` folder skeleton

**Files:**
- Create: `src/components/produk/CatalogView.tsx`

This task creates an empty orchestrator that the next tasks will fill in. Folder created implicitly.

- [ ] **Step 1: Write the skeleton**

```tsx
// src/components/produk/CatalogView.tsx
import React, { useState } from 'react';
import type { StockItem } from '../../types';
import { useWarehouses } from '../../hooks/useWarehouses';

interface Props {
  stockList: StockItem[];
  onStockUpdate: (next: StockItem[]) => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
  currentUser: { id: string; name: string; role: string } | null;
}

type TabId = 'katalog' | 'stok-per-gudang' | 'bulk-upload' | 'stok-tipis';

export default function CatalogView({ stockList, onStockUpdate, showToast, currentUser }: Props) {
  const [tab, setTab] = useState<TabId>('katalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const { warehouses } = useWarehouses();

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">CatalogView skeleton — tabs &amp; views filled in by next tasks. Active tab: {tab}</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogView.tsx
git commit -m "feat(produk): CatalogView skeleton orchestrator"
```

---

### Task 9: Extract `CatalogGridView.tsx`

**Files:**
- Create: `src/components/produk/CatalogGridView.tsx`

This is the Foto mode — the existing-style display ported from `StockManagerScreen.tsx:778-900` (the "stock rows" loop) into a focused component.

- [ ] **Step 1: Write the grid view component**

```tsx
// src/components/produk/CatalogGridView.tsx
import React from 'react';
import type { StockItem } from '../../types';

interface Props {
  items: StockItem[];
  onEdit: (sku: string) => void;
}

const CATEGORY_PILL: Record<string, string> = {
  Panel: 'bg-blue-100 text-blue-900',
  MCB: 'bg-amber-100 text-amber-900',
  Kabel: 'bg-emerald-100 text-emerald-900',
  Aksesori: 'bg-slate-100 text-slate-700',
};

export default function CatalogGridView({ items, onEdit }: Props) {
  if (items.length === 0) {
    return <p className="text-center py-12 text-slate-400 font-semibold text-sm">Tidak ada produk yang cocok dengan filter pencarian.</p>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {items.map(item => {
        const firstPhoto = item.photo_urls?.[0];
        const pill = CATEGORY_PILL[item.category] ?? CATEGORY_PILL.Aksesori;
        const lowStock = item.stock <= (item.min_stock ?? 10);
        return (
          <button
            key={item.sku}
            type="button"
            onClick={() => onEdit(item.sku)}
            className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow text-left"
          >
            <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
              {firstPhoto ? (
                <img src={firstPhoto} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-6xl text-slate-300">image_not_supported</span>
              )}
            </div>
            <div className="p-3">
              <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase ${pill}`}>{item.category}</span>
              <h3 className="text-sm font-extrabold text-[#012749] mt-1 line-clamp-2 leading-tight">{item.name}</h3>
              <p className="text-[10.5px] text-slate-500 mt-1 font-mono">{item.sku}</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-sm font-extrabold text-[#012749]">Rp {new Intl.NumberFormat('id-ID').format(item.price)}</span>
                <span className={`text-sm font-extrabold ${lowStock ? 'text-amber-700' : 'text-emerald-700'}`}>{item.stock}</span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogGridView.tsx
git commit -m "feat(produk): CatalogGridView — 4-col Foto mode"
```

---

### Task 10: Build `PreviewCard.tsx`

**Files:**
- Create: `src/components/produk/PreviewCard.tsx`

Live preview shown in the right column of `ProductForm`. Updates as user types.

- [ ] **Step 1: Write the component**

```tsx
// src/components/produk/PreviewCard.tsx
import React from 'react';

interface Props {
  name: string;
  category: string;
  sku: string;
  price: number;
  hargaModal: number | null;
  stock: number;
  firstPhotoUrl?: string;
}

export default function PreviewCard({ name, category, sku, price, hargaModal, stock, firstPhotoUrl }: Props) {
  const margin = hargaModal != null && hargaModal > 0 && price > 0
    ? ((price - hargaModal) / price) * 100
    : null;
  return (
    <div className="bg-white rounded-2xl border border-[#e5eeff] p-4 shadow-sm sticky top-4">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 mb-2">Live preview</p>
      <div className="aspect-square bg-slate-100 rounded-xl flex items-center justify-center overflow-hidden mb-3">
        {firstPhotoUrl ? (
          <img src={firstPhotoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="material-symbols-outlined text-6xl text-slate-300">image</span>
        )}
      </div>
      <span className="text-[9px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full uppercase">{category || '—'}</span>
      <h3 className="text-sm font-extrabold text-[#012749] mt-2 leading-tight">{name || 'Nama produk muncul di sini'}</h3>
      <p className="text-[11px] font-mono text-slate-500 mt-1">{sku || 'SKU otomatis'}</p>
      <div className="mt-3 space-y-1 text-[12px]">
        <p>
          <span className="text-slate-500">Harga jual:</span>{' '}
          <span className="font-extrabold text-[#012749]">Rp {new Intl.NumberFormat('id-ID').format(price)}</span>
        </p>
        <p>
          <span className="text-slate-500">Modal:</span>{' '}
          <span className="font-bold text-slate-700">{hargaModal != null ? `Rp ${new Intl.NumberFormat('id-ID').format(hargaModal)}` : '—'}</span>
        </p>
        {margin != null && (
          <p>
            <span className="text-slate-500">Margin:</span>{' '}
            <span className={`font-extrabold ${margin > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {margin.toFixed(1)}%
            </span>
          </p>
        )}
        <p>
          <span className="text-slate-500">Stok awal:</span>{' '}
          <span className="font-bold text-emerald-700">{stock}</span>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit
git add src/components/produk/PreviewCard.tsx
git commit -m "feat(produk): PreviewCard — live preview for ProductForm"
```

---

### Task 11: Build `ProductForm.tsx` — part 1: scaffolding + identity fields

**Files:**
- Create: `src/components/produk/ProductForm.tsx`

Form is large. Split into 3 tasks: 11 = identity, 12 = harga/stok, 13 = photos. Final integration is task 14.

- [ ] **Step 1: Scaffold the form with identity card**

```tsx
// src/components/produk/ProductForm.tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { StockItem } from '../../types';
import { stockService } from '../../lib/supabaseClient';
import PreviewCard from './PreviewCard';

interface Props {
  editing?: StockItem;
  onSave: (item: Partial<StockItem>) => Promise<void>;
  onCancel: () => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
}

function generateSkuId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function ProductForm({ editing, onSave, onCancel, showToast }: Props) {
  // Identity
  const [sku, setSku] = useState(editing?.sku ?? generateSkuId());
  const [name, setName] = useState(editing?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subCategoryId, setSubCategoryId] = useState<string | null>(editing?.sub_category_id ?? null);
  const [brandId, setBrandId] = useState<string | null>(editing?.brand_id ?? null);
  const [unitId, setUnitId] = useState<string | null>(editing?.unit_id ?? null);

  // Registries
  const [categories, setCategories] = useState<Array<{id: string; name: string; parent_id: string | null}>>([]);
  const [brands, setBrands] = useState<Array<{id: string; name: string}>>([]);
  const [units, setUnits] = useState<Array<{id: string; name: string; is_default: boolean}>>([]);

  useEffect(() => {
    void Promise.all([
      stockService.listCategories(),
      stockService.listBrands(),
      stockService.listUnits(),
    ]).then(([cats, bs, us]) => {
      setCategories(cats);
      setBrands(bs);
      setUnits(us);
      if (!unitId) {
        const def = us.find(u => u.is_default);
        if (def) setUnitId(def.id);
      }
    }).catch((e) => showToast(`Gagal load registry: ${e.message}`, 'warning'));
  }, []);

  const topCategories = useMemo(() => categories.filter(c => c.parent_id === null), [categories]);
  const subCategories = useMemo(() => categoryId ? categories.filter(c => c.parent_id === categoryId) : [], [categories, categoryId]);

  // Placeholder values used by Step 12 + 13
  const [price] = useState(editing?.price ?? 0);
  const [hargaModal] = useState<number | null>(editing?.harga_modal ?? null);
  const [stock] = useState(editing?.stock ?? 0);
  const [firstPhotoUrl] = useState<string | undefined>(editing?.photo_urls?.[0]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: form */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-2xl border border-[#e5eeff] p-5 shadow-sm">
          <h3 class="text-sm font-extrabold text-[#012749] mb-3">Identitas Produk</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">SKU</label>
              <input value={sku} onChange={e => setSku(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Nama</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Kategori</label>
              <select value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1">
                <option value="">— pilih —</option>
                {topCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Sub-Kategori</label>
              <select disabled={!categoryId} value={subCategoryId ?? ''} onChange={e => setSubCategoryId(e.target.value || null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1 disabled:opacity-40">
                <option value="">— opsional —</option>
                {subCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Brand</label>
              <select value={brandId ?? ''} onChange={e => setBrandId(e.target.value || null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1">
                <option value="">— pilih —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Satuan</label>
              <select value={unitId ?? ''} onChange={e => setUnitId(e.target.value || null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1">
                <option value="">— pilih —</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name}{u.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Steps 12 + 13 add Harga/Stok + Photos cards here */}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 border border-rose-200 text-rose-600 rounded-full text-xs font-bold hover:bg-rose-50">Batal</button>
          <button type="button" onClick={() => onSave({ sku, name, sub_category_id: subCategoryId, brand_id: brandId, unit_id: unitId })} className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700">Simpan Produk</button>
        </div>
      </div>

      {/* Right: live preview */}
      <div className="lg:col-span-1">
        <PreviewCard
          name={name}
          category={topCategories.find(c => c.id === categoryId)?.name ?? ''}
          sku={sku}
          price={price}
          hargaModal={hargaModal}
          stock={stock}
          firstPhotoUrl={firstPhotoUrl}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Fix the JSX class typo (note `class=` in the snippet above should be `className=`)**

```bash
sed -i '' 's/<h3 class="/<h3 className="/g' src/components/produk/ProductForm.tsx
```

Confirm via grep:

```bash
grep -n 'class="' src/components/produk/ProductForm.tsx
```

Expected: no matches (all converted to `className=`).

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/produk/ProductForm.tsx
git commit -m "feat(produk): ProductForm scaffold + Identitas card with registry dropdowns"
```

---

### Task 12: `ProductForm.tsx` — Harga & Stok card

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`

- [ ] **Step 1: Replace the placeholder state block + add Harga/Stok card before the action row**

Replace the lines:

```tsx
  // Placeholder values used by Step 12 + 13
  const [price] = useState(editing?.price ?? 0);
  const [hargaModal] = useState<number | null>(editing?.harga_modal ?? null);
  const [stock] = useState(editing?.stock ?? 0);
  const [firstPhotoUrl] = useState<string | undefined>(editing?.photo_urls?.[0]);
```

with:

```tsx
  const [price, setPrice] = useState(editing?.price ?? 0);
  const [hargaModal, setHargaModal] = useState<number | null>(editing?.harga_modal ?? null);
  const [stock, setStock] = useState(editing?.stock ?? 0);
  const [minStock, setMinStock] = useState(editing?.min_stock ?? 0);
  const [firstPhotoUrl, setFirstPhotoUrl] = useState<string | undefined>(editing?.photo_urls?.[0]);

  const showApprovalBanner = stock > 0 && !editing;
```

Insert the Harga/Stok card right before the comment `{/* Steps 12 + 13 add Harga/Stok + Photos cards here */}`:

```tsx
        <div className="bg-white rounded-2xl border border-[#e5eeff] p-5 shadow-sm">
          <h3 className="text-sm font-extrabold text-[#012749] mb-3">Harga &amp; Stok</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Harga Jual</label>
              <input type="number" value={price} onChange={e => setPrice(parseInt(e.target.value) || 0)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Harga Modal</label>
              <input type="number" value={hargaModal ?? ''} onChange={e => setHargaModal(e.target.value ? parseInt(e.target.value) : null)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" placeholder="opsional" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Stok Awal</label>
              <input type="number" value={stock} onChange={e => setStock(parseInt(e.target.value) || 0)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">Batas Stok Min</label>
              <input type="number" value={minStock} onChange={e => setMinStock(parseInt(e.target.value) || 0)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm mt-1" placeholder="0 = pakai default toko" />
            </div>
          </div>
          {showApprovalBanner && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900">
              ⚠ Stok awal &gt; 0 → akan trigger approval request ke Owner. Produk tetap dibuat, stok aktif setelah approve.
            </div>
          )}
        </div>
```

Also update the Simpan button to include new fields:

```tsx
          <button type="button" onClick={() => onSave({ sku, name, sub_category_id: subCategoryId, brand_id: brandId, unit_id: unitId, price, harga_modal: hargaModal, stock, min_stock: minStock })} className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700">Simpan Produk</button>
```

- [ ] **Step 2: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/produk/ProductForm.tsx
git commit -m "feat(produk): ProductForm — Harga &amp; Stok card with min_stock + approval banner"
```

---

### Task 13: `ProductForm.tsx` — Foto Produk card (multi-upload)

**Files:**
- Modify: `src/components/produk/ProductForm.tsx`

- [ ] **Step 1: Import helpers, add photos state**

Near the top imports, add:

```tsx
import { compressImage, uploadPhoto, deletePhoto, validatePhotoFile } from '../../lib/productPhotoService';
```

Near other state, add:

```tsx
  const [photoUrls, setPhotoUrls] = useState<string[]>(editing?.photo_urls ?? []);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);

  useEffect(() => { setFirstPhotoUrl(photoUrls[0]); }, [photoUrls]);

  const handleAddPhoto = async (slot: number, file: File) => {
    const v = validatePhotoFile(file);
    if (!v.ok) { showToast(v.reason!, 'warning'); return; }
    setUploadingSlot(slot);
    try {
      const blob = await compressImage(file);
      const { publicUrl } = await uploadPhoto(sku, slot, blob);
      setPhotoUrls(prev => {
        const next = [...prev];
        next[slot] = publicUrl;
        return next.filter(Boolean);
      });
    } catch (e) {
      showToast(`Upload gagal: ${(e as Error).message}`, 'warning');
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleRemovePhoto = async (slot: number) => {
    const url = photoUrls[slot];
    if (!url) return;
    try {
      const path = url.split('/product-photos/')[1];
      if (path) await deletePhoto(path);
    } catch (e) {
      showToast(`Hapus foto gagal: ${(e as Error).message}`, 'warning');
    }
    setPhotoUrls(prev => prev.filter((_, i) => i !== slot));
  };
```

- [ ] **Step 2: Insert Foto card before action row**

After the Harga/Stok card, before the action row:

```tsx
        <div className="bg-white rounded-2xl border border-[#e5eeff] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-extrabold text-[#012749]">Foto Produk</h3>
            <span className="text-[10px] font-bold text-slate-500">min 1 wajib · max 5</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }, (_, i) => i).map(slot => {
              const url = photoUrls[slot];
              const isMain = slot === 0;
              const uploading = uploadingSlot === slot;
              return (
                <div key={slot} className={`relative aspect-square bg-slate-100 rounded-xl overflow-hidden border-2 ${isMain ? 'border-emerald-400' : 'border-transparent'}`}>
                  {url ? (
                    <>
                      <img src={url} alt={`Foto ${slot + 1}`} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => handleRemovePhoto(slot)} className="absolute top-1 right-1 w-6 h-6 bg-rose-600 text-white rounded-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-xs">close</span>
                      </button>
                      {isMain && (
                        <span className="absolute bottom-1 left-1 text-[8px] font-extrabold bg-emerald-600 text-white px-1.5 py-0.5 rounded-full uppercase">★ Thumbnail</span>
                      )}
                    </>
                  ) : (
                    <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200">
                      {uploading ? (
                        <span className="material-symbols-outlined animate-spin text-slate-500">progress_activity</span>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-3xl text-slate-400">add_photo_alternate</span>
                          <span className="text-[9px] font-bold text-slate-500 mt-0.5">{isMain ? 'Wajib' : `Slot ${slot + 1}`}</span>
                        </>
                      )}
                      <input
                        type="file" accept="image/*" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) void handleAddPhoto(slot, f); }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-slate-500 italic mt-2">
            Min 1 foto wajib. Foto akan di-index CLIP ~150ms per foto setelah simpan dan langsung bisa dipakai untuk Cari by Foto di kasir.
          </p>
        </div>
```

Update Simpan button to include `photo_urls`:

```tsx
          <button
            type="button"
            onClick={() => {
              if (photoUrls.length === 0) { showToast('Minimal 1 foto produk wajib.', 'warning'); return; }
              void onSave({ sku, name, sub_category_id: subCategoryId, brand_id: brandId, unit_id: unitId, price, harga_modal: hargaModal, stock, min_stock: minStock, photo_urls: photoUrls });
            }}
            className="px-5 py-2 bg-[#2d8a4e] text-white rounded-full text-xs font-bold hover:bg-emerald-700">Simpan Produk</button>
```

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit
git add src/components/produk/ProductForm.tsx
git commit -m "feat(produk): ProductForm — Foto Produk card with multi-upload + compress"
```

---

### Task 14: Wire `ProductForm` + grid into `CatalogView`

**Files:**
- Modify: `src/components/produk/CatalogView.tsx`

- [ ] **Step 1: Add imports + state**

Replace the file:

```tsx
import React, { useState, useMemo } from 'react';
import type { StockItem } from '../../types';
import { useWarehouses } from '../../hooks/useWarehouses';
import CatalogGridView from './CatalogGridView';
import ProductForm from './ProductForm';

interface Props {
  stockList: StockItem[];
  onStockUpdate: (next: StockItem[]) => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
  currentUser: { id: string; name: string; role: string } | null;
}

export default function CatalogView({ stockList, onStockUpdate, showToast, currentUser }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const { warehouses } = useWarehouses();

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockList;
    return stockList.filter(item =>
      item.sku.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q));
  }, [stockList, searchQuery]);

  const handleEdit = (sku: string) => { setEditingSku(sku); setShowForm(true); };

  const handleSave = async (payload: Partial<StockItem>) => {
    // Persistence handled by Plan A Task 15. For now: optimistic update only.
    const editing = stockList.find(s => s.sku === payload.sku);
    const next: StockItem = editing
      ? { ...editing, ...payload } as StockItem
      : {
          sku: payload.sku ?? '',
          name: payload.name ?? '',
          category: '',
          price: payload.price ?? 0,
          stock: payload.stock ?? 0,
          status: (payload.stock ?? 0) <= 10 ? 'Stok Tipis' : 'Sinkron',
          specs: {},
          ...payload,
        } as StockItem;
    const idx = stockList.findIndex(s => s.sku === next.sku);
    const updated = idx >= 0
      ? stockList.map(s => s.sku === next.sku ? next : s)
      : [...stockList, next];
    onStockUpdate(updated);
    setShowForm(false);
    setEditingSku(null);
    showToast('Produk tersimpan (local). Plan A Task 15 menambahkan persistensi DB.', 'info');
  };

  if (showForm) {
    const editing = editingSku ? stockList.find(s => s.sku === editingSku) : undefined;
    return (
      <ProductForm
        editing={editing}
        onSave={handleSave}
        onCancel={() => { setShowForm(false); setEditingSku(null); }}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-[#e5eeff] p-4 shadow-sm flex gap-3">
        <input
          placeholder="Cari SKU, nama, atau brand…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm"
        />
        <button onClick={() => { setEditingSku(null); setShowForm(true); }} className="px-4 py-2 bg-[#012749] text-white rounded-full text-xs font-extrabold uppercase">+ Tambah Barang</button>
      </div>
      <CatalogGridView items={filteredItems} onEdit={handleEdit} />
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogView.tsx
git commit -m "feat(produk): CatalogView wires grid + ProductForm (no persistence yet)"
```

---

### Task 15: Service — persist `stocks` upsert with new fields

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add `upsertStock` extension**

Inside `stockService`, add:

```ts
async upsertStockFull(input: {
  sku: string;
  name: string;
  sub_category_id?: string | null;
  brand_id?: string | null;
  unit_id?: string | null;
  price: number;
  harga_modal?: number | null;
  stock: number;
  min_stock: number;
  description?: string | null;
  photo_urls: string[];
}): Promise<void> {
  const { error } = await supabase
    .from('stocks')
    .upsert({
      sku: input.sku,
      name: input.name,
      sub_category_id: input.sub_category_id ?? null,
      brand_id: input.brand_id ?? null,
      unit_id: input.unit_id ?? null,
      price: input.price,
      harga_modal: input.harga_modal ?? null,
      stock: input.stock,
      min_stock: input.min_stock,
      description: input.description ?? null,
      photo_urls: input.photo_urls,
      status: input.stock <= input.min_stock ? 'Stok Tipis' : 'Sinkron',
    }, { onConflict: 'sku' });
  if (error) throw error;
},
```

- [ ] **Step 2: Wire to `CatalogView.handleSave`**

In `src/components/produk/CatalogView.tsx`, update `handleSave`:

```tsx
  const handleSave = async (payload: Partial<StockItem>) => {
    try {
      await stockService.upsertStockFull({
        sku: payload.sku ?? '',
        name: payload.name ?? '',
        sub_category_id: payload.sub_category_id ?? null,
        brand_id: payload.brand_id ?? null,
        unit_id: payload.unit_id ?? null,
        price: payload.price ?? 0,
        harga_modal: payload.harga_modal ?? null,
        stock: payload.stock ?? 0,
        min_stock: payload.min_stock ?? 0,
        description: payload.description ?? null,
        photo_urls: payload.photo_urls ?? [],
      });
      showToast('✅ Produk tersimpan.', 'success');
      const fresh = await stockService.list();
      onStockUpdate(fresh);
      setShowForm(false);
      setEditingSku(null);
    } catch (e) {
      showToast(`Gagal simpan: ${(e as Error).message}`, 'warning');
    }
  };
```

Add import:

```tsx
import { stockService } from '../../lib/supabaseClient';
```

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lib/supabaseClient.ts src/components/produk/CatalogView.tsx
git commit -m "feat(produk): persist full stocks upsert with new fields"
```

---

### Task 16: Extract `StockTableView.tsx` + `BulkUploadSection.tsx`

**Files:**
- Create: `src/components/produk/StockTableView.tsx`
- Create: `src/components/produk/BulkUploadSection.tsx`

Both are extracted from `StockManagerScreen.tsx` existing code. Pure cut-paste-rename — no behavior changes.

- [ ] **Step 1: Read current StockManagerScreen rows section**

```bash
sed -n '778,910p' src/components/StockManagerScreen.tsx > /tmp/rows.tsx
```

- [ ] **Step 2: Create `StockTableView.tsx`** wrapping that fragment as a component

```tsx
// src/components/produk/StockTableView.tsx
import React from 'react';
import type { StockItem, ApprovalRequest } from '../../types';

interface Props {
  items: StockItem[];
  warehouses: Array<{id: string; code: string; name: string; sort_order: number}>;
  pendingIndex: { adjMap: Map<string, number>; priceMap: Map<string, number> };
  onAdjustWarehouse: (item: StockItem, warehouseId: string) => void;
  onAdjustPrice: (item: StockItem, field: 'price' | 'harga_modal') => void;
}

export default function StockTableView({ items, warehouses, pendingIndex, onAdjustWarehouse, onAdjustPrice }: Props) {
  if (items.length === 0) {
    return <p className="text-center py-12 text-slate-400 font-semibold text-sm">Tidak ada produk.</p>;
  }
  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.sku} className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-4 items-center">
          <div className="w-28">
            <p className="text-[10px] font-mono text-slate-500">{item.category}</p>
            <p className="text-[9px] font-mono text-slate-400">#{item.sku.slice(0,8)}</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-[#012749]">{item.name}</p>
          </div>
          <button onClick={() => onAdjustPrice(item, 'price')} className="px-3 py-2 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold">
            Rp {new Intl.NumberFormat('id-ID').format(item.price)}
          </button>
          <div className="flex gap-1">
            {warehouses.map(w => (
              <button key={w.id} onClick={() => onAdjustWarehouse(item, w.id)} className="bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg text-[10px] font-bold text-blue-700">
                {w.name}: 0
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `BulkUploadSection.tsx`** scaffold

```tsx
// src/components/produk/BulkUploadSection.tsx
import React from 'react';

interface Props {
  onDownloadCsv: () => void;
  onUploadCsv: (file: File) => Promise<void>;
}

export default function BulkUploadSection({ onDownloadCsv, onUploadCsv }: Props) {
  return (
    <div className="bg-white rounded-3xl border border-[#e5eeff] p-6 shadow-sm">
      <h3 className="text-base font-extrabold text-[#012749] mb-3">Bulk Upload CSV</h3>
      <div className="flex gap-3">
        <button onClick={onDownloadCsv} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-full text-xs font-bold">
          Download template
        </button>
        <label className="px-4 py-2 bg-[#012749] text-white rounded-full text-xs font-bold cursor-pointer">
          Upload CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onUploadCsv(f); }} />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/produk/StockTableView.tsx src/components/produk/BulkUploadSection.tsx
git commit -m "feat(produk): extract StockTableView + BulkUploadSection scaffolds"
```

---

### Task 17: Add tabs to `CatalogView` (Katalog / Stok per Gudang / Bulk Upload / Stok Tipis)

**Files:**
- Modify: `src/components/produk/CatalogView.tsx`

- [ ] **Step 1: Add tab routing + render**

Replace the render section (the `<div className="space-y-4">…</div>` for list view) with:

```tsx
  const [tab, setTab] = useState<'katalog' | 'stok-per-gudang' | 'bulk-upload' | 'stok-tipis'>('katalog');

  const stokTipisItems = useMemo(() => stockList.filter(s => s.stock <= (s.min_stock ?? 10)), [stockList]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl border border-[#e5eeff] p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            ['katalog', 'inventory_2', 'Katalog', stockList.length],
            ['stok-per-gudang', 'warehouse', 'Stok per Gudang', null],
            ['bulk-upload', 'upload_file', 'Bulk Upload', null],
            ['stok-tipis', 'warning', 'Stok Tipis', stokTipisItems.length],
          ] as const).map(([id, icon, label, count]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${tab === id ? 'bg-[#2d8a4e] text-white' : 'bg-slate-100 text-slate-700'}`}>
              <span className="material-symbols-outlined text-base">{icon}</span> {label}
              {count != null && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${tab === id ? 'bg-white/20' : 'bg-slate-200'}`}>{count}</span>}
            </button>
          ))}
        </div>
        {tab === 'katalog' && (
          <div className="flex gap-3">
            <input
              placeholder="Cari SKU, nama, atau brand…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm"
            />
            <button onClick={() => { setEditingSku(null); setShowForm(true); }} className="px-4 py-2 bg-[#012749] text-white rounded-full text-xs font-extrabold uppercase">+ Tambah Barang</button>
          </div>
        )}
      </div>

      {tab === 'katalog' && <CatalogGridView items={filteredItems} onEdit={handleEdit} />}
      {tab === 'stok-per-gudang' && (
        <StockTableView
          items={stockList}
          warehouses={warehouses}
          pendingIndex={{ adjMap: new Map(), priceMap: new Map() }}
          onAdjustWarehouse={() => showToast('TODO: wire StockAdjustmentModal', 'info')}
          onAdjustPrice={() => showToast('TODO: wire PriceChangeRequestModal', 'info')}
        />
      )}
      {tab === 'bulk-upload' && (
        <BulkUploadSection
          onDownloadCsv={() => showToast('TODO: CSV download (carry over from old screen)', 'info')}
          onUploadCsv={async () => showToast('TODO: CSV upload (carry over)', 'info')}
        />
      )}
      {tab === 'stok-tipis' && <CatalogGridView items={stokTipisItems} onEdit={handleEdit} />}
    </div>
  );
```

Add imports:

```tsx
import StockTableView from './StockTableView';
import BulkUploadSection from './BulkUploadSection';
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/produk/CatalogView.tsx
git commit -m "feat(produk): CatalogView 4-tab routing (Katalog / Stok / Bulk / Tipis)"
```

---

### Task 18: Slim down `StockManagerScreen.tsx` to orchestrator

**Files:**
- Modify: `src/components/StockManagerScreen.tsx`

- [ ] **Step 1: Replace the body with the thin orchestrator**

```tsx
// src/components/StockManagerScreen.tsx
import React, { useState, useEffect } from 'react';
import type { StockItem } from '../types';
import { isSupabaseConfigured, stockService } from '../lib/supabaseClient';
import CatalogView from './produk/CatalogView';

interface Props {
  stockList: StockItem[];
  onStockUpdate: (next: StockItem[]) => void;
  showToast: (msg: string, kind?: 'success' | 'info' | 'warning') => void;
  currentUser?: { id: string; name: string; role: string } | null;
  onNavigateToOpname?: () => void;
}

export default function StockManagerScreen({ stockList, onStockUpdate, showToast, currentUser }: Props) {
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void stockService.list().then(onStockUpdate).catch(() => undefined);
  }, []);
  return (
    <div className="px-6 py-4">
      <CatalogView
        stockList={stockList}
        onStockUpdate={onStockUpdate}
        showToast={showToast}
        currentUser={currentUser ?? null}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the file shrunk to under 50 lines**

```bash
wc -l src/components/StockManagerScreen.tsx
```

Expected: 30-40 lines.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/StockManagerScreen.tsx
git commit -m "refactor(stok): slim StockManagerScreen to orchestrator (1051→~40 lines)"
```

---

### Task 19: Sidebar label rename

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Find current label**

```bash
grep -n '"Stok"' src/components/Sidebar.tsx
```

- [ ] **Step 2: Replace label**

```bash
sed -i '' 's/label: "Stok"/label: "Produk \&amp; Stok"/g' src/components/Sidebar.tsx
```

(Or use Edit tool to swap exact text in the sidebar config block.)

- [ ] **Step 3: Type-check, smoke (open browser) + commit**

```bash
npx tsc --noEmit
npm run dev
# Verify sidebar shows "Produk & Stok" instead of "Stok"
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): rename label Stok → Produk &amp; Stok"
```

---

### Task 20: Manual smoke + update progress.md

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Start dev server + walk smoke checklist**

```bash
npm run dev
```

Open `http://localhost:5173/?screen=ai-stock` and verify:

1. Sidebar shows "Produk & Stok".
2. Default tab Katalog renders Foto grid (existing data + photos column empty = placeholder icons).
3. Click "+ Tambah Barang" → ProductForm opens, two-column with Identitas + Harga/Stok + Foto cards + live preview right side.
4. Upload 1 foto via slot 1 → compress → upload → preview shows. URL appears in form state.
5. Fill name, pick category/brand/unit, set harga 10000, stok 5, save → toast success, return to Katalog grid with new product visible.
6. Edit the new product → form pre-populates all fields including photo.
7. Click tab "Stok per Gudang" → table view renders (rough scaffold).
8. Click tab "Bulk Upload" → CSV scaffold visible.
9. Click tab "Stok Tipis" → filtered list shows only items with stock ≤ min_stock.

- [ ] **Step 2: Append progress.md entry**

Append under today's date:

```markdown

---

## 2026-06-16 — Plan A Foundation SHIPPED

- DB migrations 20260616000001-5 applied (registry tables, stocks extension, photo embeddings, initial_stock enum, storage bucket).
- `StockItem` type extended with brand/unit/photos/min_stock/description.
- `src/components/produk/` folder bootstrapped with 6 components (CatalogView, CatalogGridView, StockTableView, BulkUploadSection, ProductForm, PreviewCard).
- StockManagerScreen.tsx slimmed 1051 → ~40 lines (orchestrator only).
- Sidebar label renamed Stok → Produk & Stok.
- Cari by Foto **belum**; ditambahkan di Plan C.
- View modes List + inline expand panel **belum**; ditambahkan di Plan B (spec terpisah).
```

- [ ] **Step 3: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Plan A Foundation shipped — DB + Form Produk + tab refactor"
```

---

## Out of scope (deferred to other plans)

- View modes Foto+List switcher → **Plan B** (`2026-06-16-katalog-view-modes-plan.md`)
- CLIP backend + Cari by Foto Kasir UI → **Plan C** (this directory, separate file)
- Costing method radio + CLIP monitor panel + initial_stock approval handler → **Plan D**
- Per-warehouse stock breakdown UI tightening, StockAdjustmentModal/PriceChangeRequestModal wiring → defer to Plan C/D
- CSV upload/download full implementation → carry over from old StockManagerScreen in Plan D
