# Product Module Enhancement — Multi-Photo Upload &amp; Cari by Foto (Kasir)

**Status:** Approved (brainstormed 2026-06-13/14, amended 2026-06-16 — CLIP pivot)
**Owner:** tonywei
**Mockups:** `docs/superpowers/specs/2026-06-13-product-photo-search-mockups/index.html` (original)
**Mockups (amended):** `docs/superpowers/mockups/2026-06-16-foto-search-clip-final.html` (CLIP pipeline + drag-drop)
**Estimated effort:** Medium (1 sprint, ~10.5-11.5 hari dev — +1 hari dari CLIP ONNX integration, -0 hari dari drop Generate-dari-Foto)

---

### ⚠️ AMENDMENT 2026-06-16 — Foto-search pipeline pivot: Gemini → CLIP local

Setelah brainstorming session 2026-06-16, beberapa keputusan arsitektural berubah:

1. **Foto-search pipeline pakai CLIP local** (ONNX runtime di backend-go), **bukan** Gemini Vision describe → text-embedding-004. Alasan: zero quota dependency forever, latency ~150ms vs ~2s, image-to-image similarity lebih natural untuk visual product search.
2. **Tombol `✨ Generate dari Foto` di-DROP** dari form Tambah Barang. Konsekuensinya zero Gemini call untuk seluruh foto-search functionality.
3. **Cari by Foto modal tambah drag-and-drop entry point** (selain Camera + File picker).
4. **Cloud Run free tier constraint** — deployment harus stay di free tier (no `min-instances=1`). Implikasinya: cold start risk (~5-10s first request after idle) yang di-mitigate dengan keep-warm via existing kasir traffic.
5. **Future upgrade path Hybrid (CLIP + Gemini re-rank)** di-document sebagai fallback kalau akurasi CLIP murni < 80% di smoke test minggu 4 post-launch.

Section-section yang ter-amend ditandai `[AMENDED 2026-06-16]` di sub-heading. Section yang gak ter-amend tetap relevant.
**Menu rename:** "Stok" → **"Produk &amp; Stok"** (mengikuti convention MSME tools: Jurnal Mekari "Produk &amp; Layanan", Moka/Pawoon "Produk"). Label match isi (catalog + stock ops dalam satu screen).

---

## 1. Scope &amp; Goals

### Goals

1. **Form Stok lebih lengkap (Jurnal-parity)** — extend form "Tambah Barang Baru" yang sudah ada di `StockManagerScreen.tsx:683` dengan field tambahan: SKU editable (auto-suggest + override), Sub-Kategori, Satuan (UoM), multi-satuan konversi opsional, Harga Beli/Modal eksplisit, Batas Stok Min per produk, Stok Awal opsional, Merek "+ Tambah baru", Kategori &amp; Sub-Kategori "+ Buat baru".
2. **Foto Produk multi-upload** — section baru "Foto Produk" (min 1 wajib, max 5), drag-drop reorder, slot pertama otomatis = thumbnail.
3. **Deskripsi Produk [AMENDED 2026-06-16]** — textarea opsional, input manual. **Tombol `✨ Generate dari Foto` di-DROP** untuk hilangkan dependency ke Gemini.
4. **Image indexing pipeline otomatis [AMENDED 2026-06-16]** — setiap foto yang di-upload → background job **CLIP ViT-Base-32 image encoder (ONNX, di backend-go)** → vector(512) → simpan di `pgvector`. Zero external API calls, zero quota dependency.
5. **Kasir: tombol "Cari by Foto"** — di header `KasirScreen.tsx`. Modal **3 entry points: Kamera / Upload File / Drag-drop zone** → top 5 hasil dengan thumbnail, SKU, stok, harga, similarity %. Threshold 70%; di bawah threshold tampilkan warning + fallback search teks.
6. **Costing Method setting** — radio FIFO/Average di `PengaturanScreen`, default FIFO, berlaku toko-wide.
7. **Stok Awal approval flow** — kalau Stok Awal &gt; 0 diisi, buat `approval_request` tipe `initial_stock` ke owner (WhatsApp / app inbox), produk tetap dibuat tapi stok belum aktif sampai approve.
8. **Auto-compress foto** — client-side resize max 1024px + JPEG q=75 sebelum upload ke Supabase Storage.
9. **Monitoring CLIP inference activity [AMENDED 2026-06-16]** — panel honest di `PengaturanScreen` menampilkan: jumlah CLIP inference hari ini (indexing + search), latency p50/p95, error count (model load fail / inference timeout). **Tidak ada Gemini call counter** karena pipeline gak panggil Gemini.

### Non-goals (definitif skip di spec ini)

- **Menu Produk baru terpisah** — tetap extend menu Stok existing (tabel `stocks` ditambah kolom).
- **Variant produk** (warna/ukuran) — **tunda ke sprint terpisah** dengan spec sendiri (alasan: kompleksitas tinggi — parent/child template, attribute registry, migrasi data SKU existing, kasir/PO flow rewrite. Estimasi 5-7 hari sendiri, tidak masuk sprint 8-10 hari ini).
- **Bundle / Composite produk** — sudah ada `Rakit Workflow` untuk assembly; pure bundle (paket) tunda ke spec terpisah.
- **Multi-tier pricing** (retail/grosir) — tunda.
- **Barcode** — toko tidak punya scanner (per konfirmasi user).
- **Pajak (PPN) per produk** — toko belum PKP.
- **Default Supplier per produk** — nice-to-have, tunda.
- **GL accounts mapping** (Pendapatan/HPP/Persediaan) — ERP ini tidak punya general ledger akuntansi; `stock_movements` adalah ledger stok bukan GL.
- **Expiry / Serial / Batch tracking** — tidak relevan untuk MCB/Kabel/Panel.
- **Hybrid CLIP + Gemini Vision re-rank [AMENDED 2026-06-16]** — di-defer ke spec terpisah, di-trigger kalau benchmark CLIP murni < 80% akurasi top-1 di minggu 4 post-launch. Dokumentasi di §10.
- **Generate-dari-Foto auto-describe [AMENDED 2026-06-16]** — fitur di-drop, deskripsi produk input manual. Future bisa di-add kembali sebagai opt-in setting kalau user request.
- **Upgrade ke paid Cloud Run tier [AMENDED 2026-06-16]** — deploy stay di free tier (no `min-instances=1`). Cold start risk di-accept (per memory `cost_upgrade_approval`).
- **Katalog publik / katalog cetak** — non-goal.
- **Schema Builder UI per tenant** — tunda ke spec terpisah saat tenant non-elektrik onboard (lihat Section "Multi-tenant readiness" di bawah).

### Multi-tenant readiness (Change A + B)

Spec ini siap untuk multi-tenant rollout (lihat `2026-06-13-multi-tenant-prerequisites-design.md`) dengan 2 perubahan kecil yang tidak menambah effort:

- **Change A — Generic fallback untuk kategori non-elektrik**: kalau user (atau tenant lain) buat kategori baru tidak ada di `CATEGORY_SPECS`, otomatis pakai pola Aksesori (1 textarea Deskripsi, auto-name dari deskripsi). Lihat Section 3.1.
- **Change B — `tenant_id NULL` columns** di `product_categories`, `product_brands`, `product_units` registry tables. Saat ini semua row NULL (global). Saat multi-tenant Phase 1 ship: backfill `tenant_id = sinar_tenant_id` + tambah RLS filter — tidak ada migrasi data berisiko.

**Tenant timeline asumsi:** tenant #2 elektrik 1-2 bulan ke depan (CATEGORY_SPECS elektrik reusable). Tenant non-elektrik = spec mandiri "Schema Builder per Tenant".

### Boundaries

Semua perubahan masuk ke modul existing:
- Frontend: **`StockManagerScreen.tsx` di-refactor** (1051 baris → screen orchestrator + 5 child components untuk maintainability), `KasirScreen.tsx`, `PengaturanScreen.tsx`, `Sidebar.tsx` (rename label).
- Service: `src/lib/supabaseClient.ts` (stockService extension), new `src/lib/productPhotoService.ts`
- Backend Go [AMENDED 2026-06-16]: new `internal/clip/encoder.go` (ONNX runtime wrapper untuk `clip-vit-base-patch32`) + `internal/clip/model.go` (singleton model loader). Model file (~150MB) di-bundle ke Docker image. **No Gemini package added** untuk foto-search.
- DB: extend tabel `stocks` (kolom baru), tabel baru `stock_photo_embeddings` (vector(512) **[AMENDED: was 768]**), `product_brands`, `product_categories`, `product_units`, extend enum `approval_request_type` dengan `initial_stock`.

### Menu &amp; Tab Structure (post-pivot)

**Sidebar entry baru:** label "Produk &amp; Stok" menggantikan "Stok" di kategori `inventory`. `ActivePage` rename: `'ai-stock'` → `'produk-stok'` (atau biarkan internal `'ai-stock'` untuk kompatibilitas, hanya label berubah — keputusan implementasi).

**Tab structure dalam screen "Produk &amp; Stok"** (tab pill di header screen, default tab = "Katalog"):

| Tab | Isi | File komponen | Existing? |
|---|---|---|---|
| **📋 Katalog** | Grid card produk (thumbnail dominant), search, filter kategori/brand. Tombol "+ Tambah Barang" buka form (modal atau inline). | `CatalogGridView.tsx` (new) + `ProductForm.tsx` (new — full form yang kita design tadi: two-column + live preview) | Form: existing logic, di-extract |
| **🏬 Stok per Gudang** | Tabel padat per produk + qty per warehouse + inline edit, transfer button. View untuk operasi stok harian. | `StockTableView.tsx` (extract dari existing) | Yes (existing) |
| **📥 Bulk Upload** | CSV template download, export, upload. | `BulkUploadSection.tsx` (extract dari existing) | Yes (existing) |
| **⚠️ Stok Tipis** | Filter shortcut produk dengan `stok ≤ min_stock` (per produk atau global). | Reuse `StockTableView.tsx` dengan filter prop | Yes (existing) |

**File refactor `StockManagerScreen.tsx` (1051 baris) → orchestrator + 5 komponen:**
- `StockManagerScreen.tsx` (~200 baris): orchestrator — load state, tab routing, current user, toast
- `components/produk/CatalogGridView.tsx`: grid katalog
- `components/produk/ProductForm.tsx`: form Tambah/Edit (two-column + live preview)
- `components/produk/StockTableView.tsx`: tabel padat stok ops
- `components/produk/BulkUploadSection.tsx`: CSV
- `components/produk/PreviewCard.tsx`: live preview card (re-usable di form)

---

## 2. Data Model

### 2.1. Migrasi `M1` — Extend tabel `stocks`

```sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS subcategory        TEXT,
  ADD COLUMN IF NOT EXISTS unit               TEXT NOT NULL DEFAULT 'pcs',  -- BASE unit (smallest); stock dilacak di sini
  ADD COLUMN IF NOT EXISTS unit_alt           TEXT,                          -- PACKAGING unit (lebih besar); opsional
  ADD COLUMN IF NOT EXISTS unit_alt_factor    INT,                           -- berapa banyak `unit` per 1 `unit_alt` (mis. 1 roll = 100 meter → factor=100)
  ADD COLUMN IF NOT EXISTS photo_urls         JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS description        TEXT,
  ADD COLUMN IF NOT EXISTS min_stock_per_product INT,
  ADD COLUMN IF NOT EXISTS initial_stock_approved BOOLEAN NOT NULL DEFAULT TRUE;

-- Validation: kalau multi-satuan aktif, alt harus &gt; 1 primary (alt selalu LEBIH BESAR dari primary)
ALTER TABLE public.stocks
  ADD CONSTRAINT chk_stocks_unit_alt CHECK (
    (unit_alt IS NULL AND unit_alt_factor IS NULL)
    OR (unit_alt IS NOT NULL AND unit_alt_factor IS NOT NULL AND unit_alt_factor &gt; 1)
  );

-- Validation: photo_urls schema:
-- jsonb_typeof = 'array', max 5 elemen, setiap elemen = {url, path, order, uploaded_at}
-- Enforce di app layer (PostgreSQL jsonb constraint cek terbatas).
```

`photo_urls` shape:
```json
[
  { "url": "https://...supabase.co/.../path.jpg", "path": "{sku}/0.jpg", "order": 0, "uploaded_at": "2026-06-14T10:30:00Z" },
  { "url": "...", "path": "{sku}/1.jpg", "order": 1, "uploaded_at": "..." }
]
```

### 2.2. Migrasi `M2` — Tabel referensi (registry untuk "+ Buat baru" flow)

```sql
-- All three registry tables include `tenant_id UUID NULL` for forward-compat
-- dengan multi-tenant rollout (lihat docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md).
-- Saat ini semua row pakai tenant_id=NULL (global registry). Saat multi-tenant Phase 1 ship,
-- backfill tenant_id = sinar_tenant_id dan tambah RLS policy filter by tenant_id.

CREATE TABLE IF NOT EXISTS public.product_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,                              -- multi-tenant forward-compat; NULL = global
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES public.product_categories(id),  -- untuk sub-kategori (sub = parent_id ≠ NULL)
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, lower(name))                     -- nama unique per tenant scope
);

CREATE TABLE IF NOT EXISTS public.product_brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,                              -- multi-tenant forward-compat
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, lower(name))
);

CREATE TABLE IF NOT EXISTS public.product_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NULL,                              -- multi-tenant forward-compat
  name        TEXT NOT NULL,                          -- pcs, meter, roll, dus, set, unit, …
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, lower(name))
);

-- Seed default values (mirror hardcoded list yg ada di StockManagerScreen.tsx)
INSERT INTO public.product_categories (name) VALUES
  ('Panel'), ('MCB'), ('Kabel'), ('Aksesori')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_brands (name) VALUES
  ('Schneider'), ('ABB'), ('Chint'), ('Hager'), ('LS')
ON CONFLICT DO NOTHING;

INSERT INTO public.product_units (name, is_default) VALUES
  ('pcs', TRUE), ('meter', FALSE), ('roll', FALSE), ('dus', FALSE), ('set', FALSE), ('unit', FALSE)
ON CONFLICT DO NOTHING;
```

**Catatan reuse:** kategori &amp; merek saat ini tidak punya FK ke `stocks` (lookup-by-name). Itu disengaja — registry table hanya untuk autocomplete + traceability "siapa add kapan". Kalau perlu rename, update juga `stocks.category` / `stocks.specs.mcb_merek`.

### 2.3. Migrasi `M3` — Setup pgvector + tabel embedding

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.stock_photo_embeddings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          VARCHAR(50) NOT NULL REFERENCES public.stocks(sku) ON DELETE CASCADE,
  photo_path   TEXT NOT NULL,
  description  TEXT NOT NULL,
  embedding    VECTOR(768) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (sku, photo_path)
);

CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_vector
  ON public.stock_photo_embeddings
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_stock_photo_embeddings_sku
  ON public.stock_photo_embeddings (sku);
```

### 2.4. Migrasi `M4` — Setting tabel + Storage bucket

```sql
-- Costing method setting (reuse existing company_settings)
INSERT INTO public.company_settings (key, value, updated_at)
VALUES ('costing_method', '"FIFO"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Storage bucket: product-photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT DO NOTHING;
```

RLS Storage policy (di Supabase Dashboard atau SQL):
- `INSERT`/`UPDATE`/`DELETE`: authenticated dengan role `admin` atau `staff`.
- `SELECT` (read): semua authenticated (kasir butuh thumbnail).

### 2.5. Migrasi `M5` — Approval type baru + RPC

```sql
-- Add new approval type
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'initial_stock';

-- Create approval payload schema (validated di app layer):
-- { sku, sku_name, qty, unit, requested_cost_per_unit?, requested_total_cost? }

-- RPC: cari produk by embedding (return per-warehouse stock breakdown)
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
  warehouse_stock JSONB,  -- [{warehouse_id, code, name, qty}, ...] non-zero only
  price           NUMERIC,
  unit            TEXT,
  min_stock       INT
) LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT DISTINCT ON (e.sku)
      e.sku,
      1 - (e.embedding &lt;=&gt; query_embedding) AS similarity,
      e.embedding &lt;=&gt; query_embedding AS dist
    FROM public.stock_photo_embeddings e
    WHERE 1 - (e.embedding &lt;=&gt; query_embedding) &gt;= match_threshold
    ORDER BY e.sku, e.embedding &lt;=&gt; query_embedding ASC
  ),
  warehouse_agg AS (
    SELECT
      sl.sku,
      jsonb_agg(jsonb_build_object(
        'warehouse_id', sl.warehouse_id,
        'code', w.code,
        'name', w.name,
        'qty', sl.qty
      ) ORDER BY w.sort_order) FILTER (WHERE sl.qty &gt; 0) AS by_warehouse,
      SUM(sl.qty) AS total
    FROM public.stock_levels sl
    JOIN public.warehouses w ON w.id = sl.warehouse_id AND w.is_active = TRUE
    GROUP BY sl.sku
  )
  SELECT
    r.sku,
    s.name,
    s.category,
    r.similarity,
    (s.photo_urls-&gt;0-&gt;&gt;'url')::TEXT AS thumbnail_url,
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
```

### 2.6. Trade-offs yang diambil

- **Embedding per foto, dedup di query** (bukan averaging) — foto-foto produk yang sama bisa sangat berbeda (front vs side vs label). Averaging blur. HNSW scale baik sampai 100K+ rows.
- **`photo_urls` sebagai JSONB di kolom `stocks`** (denormalized) — bukan tabel terpisah karena selalu query bersama produk; hindari N+1.
- **Registry tables tidak FK ke `stocks`** — keep lookup-by-name supaya tidak break existing rows; registry hanya untuk autocomplete &amp; traceability.
- **`unit` di `stocks` default `'pcs'`** untuk backward compat dengan rows existing.
- **`initial_stock_approved` default TRUE** — semua row existing dianggap approved; hanya row baru dengan stok awal pending yang false.

---

## 3. UI Admin — Form Stok (`StockManagerScreen.tsx`)

### 3.1. Struktur form (extend existing `showAddForm` block, line 683+)

Form di-organize jadi 4 section visual (divider pill style mengikuti pola "Spesifikasi" yang sudah ada):

#### Section 📋 "Identitas Produk"
- **Kode Produk / SKU** (opsional text input) — placeholder `MCB-SCH-16A-1P`, hint *"Kosongkan untuk auto-generate"*, tombol icon `🔄 Auto` untuk regenerate. Kalau kosong saat submit → backend generate 8-digit hex.
- **Kategori** (required dropdown) — opsi dari `product_categories WHERE parent_id IS NULL`, terakhir `+ Buat kategori baru…` → inline emerald panel input nama + tombol Tambah/Batal. Submit panel → `INSERT INTO product_categories` lalu set field dropdown.
- **Sub-Kategori** (opsional dropdown) — dependent on Kategori; opsi dari `product_categories WHERE parent_id = {selected_category_id}`. `+ Buat sub-kategori baru…` sama mekanismenya.
- **Satuan Utama** (required dropdown) — opsi dari `product_units`, default ke `is_default = TRUE` (`pcs`). `+ Buat satuan baru…` inline.

#### Panel "Multi-satuan konversi" (collapsible checkbox)
- Checkbox `Aktifkan multi-satuan konversi` — default OFF.
- Saat ON, tampil row: `1 [select unit_alt — packaging] = [number input] [unit utama — label, dari Satuan Utama]`.
- Caption: *"Stok dilacak dalam **Satuan Utama** (unit terkecil). Satuan Kedua hanya untuk pembelian/penjualan paket; otomatis dikonversi ke Satuan Utama saat masuk/keluar stok."*
- **Convention penting** (untuk dev &amp; UX):
  - Satuan Utama = unit terkecil yang dijual (mis. `meter` untuk kabel, `pcs` untuk MCB).
  - Satuan Kedua = packaging yang lebih besar (mis. `roll` = 100 meter, `dus` = 12 pcs).
  - Factor selalu &gt; 1 (1 packaging berisi banyak primary).
- Validation submit: `unit_alt ≠ unit`; `unit_alt_factor &gt; 1`; kedua keduanya filled atau NULL. Kalau OFF, save NULL.

#### Section ⚙ "Spesifikasi [Kategori]" (existing + generic fallback)
- Render fields dari `CATEGORY_SPECS[category]` seperti existing.
- **Modifikasi:** dropdown `Merek` untuk kategori MCB sekarang punya `+ Tambah merek baru…` inline panel (sama style emerald) — submit → `INSERT INTO product_brands`. List options dari `product_brands` (bukan hardcoded array di `CATEGORY_SPECS`).
- **Auto-name preview** (existing) tetap berfungsi.
- **🆕 Generic fallback (multi-tenant ready):** Saat kategori yang dipilih **tidak ada di `CATEGORY_SPECS`** (mis. user pakai "+ Buat kategori baru…" untuk bikin "Kontaktor", "Saklar Lampu", atau tenant lain bikin "Beras", "Baju") → render **pola Aksesori**: 1 field textarea "Deskripsi Produk" (required), auto-name = isi deskripsi langsung. Implementasi: di `renderSpecForm()`, kalau `CATEGORY_SPECS[category]` undefined → return Aksesori spec form. `generateName()` di-fallback ke `specs.deskripsi || ''`. Pola Aksesori sudah ada di codebase, **tidak ada code baru**, hanya generalize routing.
- **Akibat:** tenant elektrik lain (target onboarding 1-2 bulan) dapat Panel/MCB/Kabel/Aksesori siap pakai. Tenant non-elektrik (mis. sembako, fashion, sparepart) bisa create produk dengan pola Aksesori untuk setiap kategori mereka. Mereka tidak dapat structured field-typed spec untuk kategori spesifik mereka — itu domain spec "Schema Builder per Tenant" (separate spec, sprint berikutnya).

#### Section 💰 "Harga &amp; Persediaan"
- **Harga Jual (Rp)** (required) — hint kecil *"per [unit utama]"*.
- **Harga Modal** (opsional) — label &amp; mode dinamis berdasarkan state produk:
  - **Produk baru / tidak ada `stock_lots`**: label `Harga Modal Awal (Estimasi)`, input editable, hint *"Akan di-overwrite otomatis dari harga PO saat barang diterima (FIFO/Average sesuai pengaturan). Untuk migrasi stok awal saja."*
  - **Produk sudah punya ≥1 `stock_lots`**: label `Harga Modal Aktual ([FIFO|Average] dari Pembelian)` — `[FIFO|Average]` dibaca dari `company_settings.costing_method`. Field **read-only** dengan badge `🔒 Dari Pembelian`. Edit manual hanya lewat `price_change` approval (existing pattern di `bulkUpsert`, `supabaseClient.ts:131`).
  - Hint live margin %: `((harga_jual − harga_modal) / harga_jual) × 100` — selalu compute, baik dari Estimasi maupun Aktual.
- **Stok Awal** (opsional) — placeholder `0`. Empty/0 = skip approval. &gt;0 = trigger approval (lihat 3.3). **Dropdown gudang tujuan**: pilih warehouse target dari `warehouses WHERE is_active=true` (default = `is_default=true`).
- **Batas Stok Min** (opsional) — hint *"Alert kalau stok ≤ [angka]"*. Empty = pakai `NotificationConfig.lowStockAlert` global.
- **Banner kuning approval warning** di bawah row (visible kalau Stok Awal &gt; 0 di-input).

#### Section 🏬 "Stok per Gudang" (di form Edit; di form Create hanya tampil setelah Stok Awal diisi)
- Table view, kolom: Gudang (nama + code badge) | Stok (qty) | Batas Min (per-warehouse override, opsional).
- Saat Create: row hanya 1 (gudang yang dipilih di Stok Awal). Bisa transfer lewat `WarehouseTransferModal` yang sudah ada.
- Saat Edit: row per warehouse aktif, semua produk di-pre-populate dari `stock_levels`.
- Read-only di sini (tidak boleh edit qty langsung dari form Produk — harus lewat Stok Opname / Stock Adjustment / Transfer; reuse existing flow). UI tujuan: **visibility**, bukan input.

#### Section 📷 "Foto Produk (min 1 wajib · max 5)"
- 5-slot grid; slot pertama mandatory dengan badge `★ Thumbnail · Wajib`.
- File picker (`accept=image/*`, multiple) dari slot kosong; click slot terisi = preview modal + tombol hapus.
- Drag-drop reorder; slot pertama (index 0) selalu = thumbnail badge update otomatis.
- Per-slot states: empty / uploading (spinner + %) / uploaded / indexing (emerald pulse banner).
- Validation submit: minimal 1 foto. Kalau kurang → block submit + toast `"Minimal 1 foto produk wajib."`.
- Client compress sebelum upload: `&lt;canvas&gt;` resize longest dim ke 1024px, `toBlob('image/jpeg', 0.75)`. Reject file &gt; 5MB pre-compress.
- Helper info [AMENDED 2026-06-16]: *"Min 1 foto wajib — foto pertama jadi thumbnail. Drag untuk reorder. Foto akan di-index CLIP ~150ms per foto setelah simpan dan langsung bisa dipakai untuk Cari by Foto di kasir."*

#### Section "Deskripsi Produk" (opsional) [AMENDED 2026-06-16]
- Textarea, max 500 char (counter di kanan bawah).
- **Tombol `✨ Generate dari Foto` DIHAPUS** — input manual oleh admin. Field tetap optional; kalau kosong, di-list view fallback ke nama produk auto-generate.

### 3.2. Submit flow (client → server)

1. Validate field di client (Satuan ada, Kategori ada, Harga Jual diisi, ≥1 foto).
2. Upload semua foto baru ke Supabase Storage paralel (concurrency=2), path `{sku_or_temp}/{order}.jpg`. Kalau SKU belum diketahui (auto-generate), generate dulu di client.
3. Insert/update row di `stocks` dengan `photo_urls`, `initial_stock_approved = (qty == 0)`.
4. Kalau Stok Awal &gt; 0: `INSERT INTO approval_requests (request_type='initial_stock', payload={...})` → trigger WhatsApp notify ke owner (reuse pattern existing).
5. Trigger Edge Function `index-product-photos` via DB webhook on `stocks` UPDATE/INSERT WHERE `photo_urls != OLD.photo_urls` (lihat 5.2).
6. UI: tampilkan toast sukses, close form, refresh list. Row baru di list ditandai badge `Indexing…` (polling atau Supabase Realtime) sampai semua foto-nya selesai di-embed.

### 3.3. Edit flow

- Sama dengan add form, pre-populate semua field termasuk foto.
- Hapus foto: remove dari `photo_urls` array → save → backend trigger `DELETE FROM stock_photo_embeddings WHERE sku=... AND photo_path=...` + delete object dari Storage bucket.
- Ganti foto (replace): hapus dulu lalu upload baru.
- Edit Harga Beli / Harga Jual existing tetap pakai flow `price_change` approval pattern yang sudah ada (di luar scope spec ini).

---

## 4. UI Kasir — "Cari by Foto" (`KasirScreen.tsx`)

### 4.1. Tombol di header

Di header KasirScreen (samping search box teks existing), tambah tombol:
```
<button className="px-5 py-3 bg-gradient-to-br from-[#2d8a4e] to-emerald-700 text-white rounded-full ..."&gt;
  📷 Cari by Foto [AI]
&lt;/button&gt;
```
Open modal `CariByFotoModal`.

### 4.2. Modal: pilih sumber foto [AMENDED 2026-06-16]

3 entry points di dalam modal (layout: 2 card di atas + drag-drop zone besar di bawah):

- **Pakai Kamera** (card emerald, kiri-atas) — open kamera live preview (HTML5 `&lt;input type="file" accept="image/*" capture="environment"&gt;` atau MediaDevices API untuk live preview).
- **Upload File** (card biru, kanan-atas) — file picker `accept="image/*"`.
- **Drag-drop zone** (full-width, di bawah 2 card) — area dashed border violet, icon `cloud_upload`, text *"Tarik foto dari folder ke sini"*. Handle event `onDragOver` (prevent default + visual highlight `bg-violet-100`) + `onDrop` (extract `event.dataTransfer.files[0]`, validate `image/*` MIME, lanjut pipeline yang sama dengan file picker).
- Tip kuning: *"Foto produk dari angle depan / label paling jelas memberi hasil paling akurat."*
- ESC / klik luar = close.

**Drag-drop behavior detail:**
- Drag dari OS file manager (Finder/Explorer/Files) langsung → drop ke zone → pre-fill ke pipeline existing.
- Drag dari web page lain (mis. WhatsApp Web image) → kalau browser allow (CORS-dependent), terima. Kalau enggak, tetap fallback ke file picker.
- Validate first file only (skip kalau drop multi-file — toast info *"Cuma 1 foto per search"*).
- Reject kalau file `&gt; 5MB` (sama dengan file picker path).

### 4.3. Pipeline pencarian (client → backend → DB) [AMENDED 2026-06-16]

1. User pick/snap/drag foto → client compress (resize 1024px, JPEG q=75).
2. POST `multipart/form-data` ke backend endpoint `POST /api/products/search-by-photo`.
3. Backend Go:
   - Validate image (size ≤ 5MB, valid `image/*` MIME).
   - Preprocess: decode JPEG/PNG, resize 224×224 (CLIP input spec), normalize ke RGB float32 dengan mean/std CLIP standard.
   - Call **CLIP image encoder (ONNX runtime)** → vector(512). In-process inference, no external API.
   - Call RPC `search_products_by_embedding(query_embedding, 0.70, 5)`.
   - Log inference ke `clip_inference_log` (lihat 6.2).
4. Response: array `[{sku, name, category, similarity, thumbnail_url, stock_per_warehouse, price, unit, min_stock}]`. **No `query_description` field** (CLIP gak generate text deskripsi).
5. Frontend tampilkan modal hasil.

**Latency target [AMENDED]:** p95 &lt; 500ms total saat warm. Breakdown: CLIP inference ~150ms (CPU), DB query ~50ms, network + marshaling ~50ms, client overhead ~250ms. Saat cold start (Cloud Run scale-to-zero recovery): first request bisa 5-10 detik akibat model load — UX di-mitigate dengan banner *"⏱️ Menyiapkan AI… 5 detik"*.

### 4.4. Modal hasil [AMENDED 2026-06-16]

- Banner atas [AMENDED]: thumbnail foto query (foto yang barusan di-drop / snap / upload) + tombol `🔄 Ganti foto`. **Tidak ada AI deskripsi text** — CLIP murni visual similarity, gak generate description.
- List 5 card produk:
  - Thumbnail dari `thumbnail_url`.
  - Pill kategori (color-coded).
  - Nama + SKU + Harga + Satuan.
  - **Stok per gudang inline** (memudahkan tim gudang tahu ambil dari mana): `Gudang Atas: 30 · Gudang Bawah: 18` (warehouse name + qty). Sembunyikan warehouse dengan qty=0. Kalau cuma 1 warehouse aktif, sederhanakan jadi `Stok: 48`.
  - Total stok sebagai summary.
  - Score similarity (right-aligned, %).
  - Tombol `+ Tambah` (primary di best match #1, outline di lainnya).
  - Stok total ≤ `min_stock` → badge kuning `Tipis`.
- Click `Tambah` → push ke kasir cart (reuse existing logic add-to-cart by SKU).
- Footer: link `Tidak ada yang cocok? Cari manual via teks` → close modal, focus ke search box.

### 4.5. Empty state (skor tertinggi &lt; 70%)

- Banner kuning di atas list: *"Tidak menemukan produk yang cukup mirip dengan foto. Coba foto lain atau cari via teks/SKU."*
- Top 5 tetap ditampilkan dengan opacity 60% (untuk near-miss confirmation visual).
- Tombol `Cari Manual` prominent.

### 4.6. Error states [AMENDED 2026-06-16]

- Kamera tidak diijinkan → fallback ke File picker, toast info.
- Drag-drop file bukan image (`text/plain`, dll) → toast *"Hanya foto yang didukung."*
- Drag multi-file → toast info *"Cuma 1 foto per search. Ambil yang pertama."* (terima file pertama, drop sisanya).
- Backend error 500 → toast *"Server AI tidak respons. Coba lagi atau cari via teks."*
- Cold start in-progress (model loading) → banner inline *"⏱️ Menyiapkan AI… 5 detik"* — JANGAN tampilkan sebagai error, ini expected behavior di free tier Cloud Run.
- Cold start exceed 15s (model load fail) → toast *"AI tidak siap, coba lagi atau cari via teks"* + log ke `clip_inference_log` dengan `status='cold_start_timeout'`.
- Foto &gt; 5MB pre-compress → reject di client + toast.
- **Note [AMENDED]**: tidak ada 429 / quota error karena CLIP local — semua tergantung server compute, bukan quota external.

---

## 5. Image Embedding Pipeline (CLIP Local) [AMENDED 2026-06-16]

### 5.1. Architecture choice

**Pilih: CLIP ViT-Base-32 via ONNX runtime di backend-go existing.**

Alasan:
- **Zero quota**: tidak panggil API external sama sekali, lepas dari rate limit Google/OpenAI/dll.
- **Latency**: ~150ms CPU inference per image vs ~2s Gemini Vision describe.
- **Privacy**: foto produk gak keluar server kita, tidak di-share ke Google/third-party.
- **Cost**: free forever; cuma tambahan ~500MB RAM working set di Cloud Run instance existing.
- **Bundled**: model file `clip-vit-base-patch32.onnx` (~150MB) di-bundle di Docker image saat build (`Dockerfile`: `COPY models/clip-vit-base-patch32.onnx /models/`). Gak download saat runtime.

**Architecture detail:**
- `backend-go/internal/clip/model.go` — singleton model loader. Load saat first request (lazy), cache in-process selamanya. Process lifetime = container lifetime.
- `backend-go/internal/clip/encoder.go` — `EncodeImage(imgBytes []byte) ([]float32, error)` wrapper. Pakai library `github.com/yalue/onnxruntime_go` atau alternatif Go ONNX binding.
- `backend-go/internal/clip/preprocess.go` — decode JPEG/PNG → resize 224×224 (CLIP standard) → normalize ke RGB float32 dengan CLIP mean `[0.48145466, 0.4578275, 0.40821073]` dan std `[0.26862954, 0.26130258, 0.27577711]`.

**Cloud Run free tier constraint:**
- No `min-instances=1` (akan exceed free tier 360k vCPU-sec/bulan dalam ~4 hari kalau warm 24/7).
- Konsekuensi: scale-to-zero saat idle, cold start ~5-10s untuk load 150MB model.
- Mitigasi: keep-warm via existing kasir traffic (kalau toko transaksi 30-50x/hari, instance jarang scale to zero saat jam kerja).
- Fallback UX: banner *"⏱️ Menyiapkan AI… 5 detik"* di Cari by Foto modal saat first request after idle.

### 5.2. Indexing pipeline (saat foto upload) [AMENDED 2026-06-16]

Trigger: setelah `stocks` UPDATE/INSERT, frontend call `POST /api/products/index-photos` dengan `{sku, photo_paths: []}`.

Backend handler `index-product-photos`:
```
for each photo_path in body.photo_paths:
  1. Skip kalau sudah ada di stock_photo_embeddings (idempotent on retry).
  2. Download image dari Supabase Storage (signed URL atau direct via service role key).
  3. Preprocess: decode → resize 224×224 → normalize.
  4. Call CLIP encoder ONNX → vector(512).
  5. Upsert ke stock_photo_embeddings (sku, photo_path, embedding).
  6. Log ke clip_inference_log (kind='index', latency_ms, status).
```

**Concurrency:** sequential per request (max 5 foto = ~750ms dengan CLIP 150ms/foto). Multiple request paralel = OK (CLIP encoder thread-safe asal ONNX runtime di-configure dengan multi-threading).

**Retry policy [AMENDED]:** **Tidak ada retry external** (gak ada API call yang bisa 429). Kalau ONNX inference error (mis. corrupt image), log error sekali, mark `error_at`, lanjut foto berikutnya.

**Throttle [AMENDED]:** tidak perlu — CPU bound, kalau melebihi capacity instance Cloud Run akan auto-scale up (sampai max instances default 100 di free tier).

### 5.3. Search pipeline (saat kasir search) [AMENDED 2026-06-16]

Handler `search-products-by-photo`:
```
1. Validate input image (≤ 5MB, valid image/*).
2. Compress server-side kalau perlu (belt-and-suspenders).
3. Preprocess: decode → resize 224×224 → normalize.
4. Call CLIP encoder ONNX → vector(512).
5. Call RPC search_products_by_embedding via Supabase client (service role).
6. Log ke clip_inference_log (kind='search', latency_ms, status).
7. Return JSON: { results: [...] }.   // no query_description
```

### 5.4. CLIP model details [AMENDED 2026-06-16]

**Model**: `clip-vit-base-patch32` (OpenAI CLIP)
- Image encoder ViT-Base, patch size 32
- Output dim: 512
- Input: 224×224 RGB normalized
- File size: ~150MB (image encoder portion)
- License: MIT (OpenAI CLIP)

**Source**: https://huggingface.co/openai/clip-vit-base-patch32
- Convert ke ONNX via `optimum-cli` atau pre-converted `Xenova/clip-vit-base-patch32` ONNX export.
- Verify ONNX checksum di Dockerfile saat build.

**Why not larger CLIP variant** (ViT-Large, ViT-G)?
- ViT-Base sudah cukup akurat untuk product matching skala MSME (~487 SKU per tenant).
- ViT-Large ~600MB + CPU inference ~500ms — over-spec untuk Sinar.
- Bisa upgrade nanti kalau benchmark menunjukkan butuh.

### 5.5. Future: Hybrid CLIP + Gemini upgrade path (deferred)

Kalau smoke test minggu 4 post-launch menunjukkan akurasi CLIP murni < 80% top-1:

- **Stage 1 (CLIP)**: query embed → ambil top-20 visual candidates.
- **Stage 2 (Gemini Vision re-rank)**: describe query foto + describe top-20 candidates (cached dari indexing time), apply text similarity → re-rank.
- **Final**: return top 5.

Trigger sebagai spec terpisah `YYYY-MM-DD-foto-search-hybrid-rerank-design.md`. Estimasi tambahan: 2 hari dev (1 hari indexing tambah Gemini describe + cache, 1 hari Stage 2 + smoke test).

---

## 6. Pengaturan (`PengaturanScreen.tsx`)

### 6.1. Panel "Metode Costing Toko"

- Radio group: `FIFO` (default, badge Default) / `Average`.
- Description per opsi (lihat mockup).
- Warning box: *"Mengubah metode akan menghitung ulang HPP semua transaksi setelah tanggal perubahan. Laporan profit historis sebelum tanggal ini tidak berubah."*
- Tombol Simpan → update `company_settings.value` untuk key `costing_method`.
- Trigger: kalau metode berubah, panggil background job `recompute_hpp_from(timestamp)` (out of scope spec ini — flag TODO).

### 6.2. Panel "Aktivitas CLIP Inference — Hari Ini" [AMENDED 2026-06-16]

Tabel baru:
```sql
CREATE TABLE IF NOT EXISTS public.clip_inference_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,             -- 'index' | 'search'
  status      TEXT NOT NULL,             -- 'success' | 'error' | 'cold_start_timeout'
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clip_inference_log_today
  ON public.clip_inference_log (called_at DESC);
```

Panel UI menampilkan (data per-hari, reset 00:00 WIB):
- **Disclaimer banner [AMENDED]**: *"CLIP berjalan di server kita. Angka di bawah adalah jumlah inference hari ini. Tidak ada quota eksternal — kapasitas dibatasi oleh CPU instance Cloud Run."*
- **2 card**: Search Kasir count (success/fail), Indexing Upload count (success/fail). Tanpa progress bar palsu (gak ada quota Google).
- **2 mini stat**: Average latency (ms), Cold-start hit count.
- **Latency p50/p95** untuk Search (dari `latency_ms` percentile). Target p95 &lt; 500ms warm; &gt; 5s konsisten = sinyal Cloud Run instance kewalahan.
- **Last Error timestamp**.
- **Note "Sinyal kapan upgrade"**: latency p95 &gt; 3s konsisten ATAU error rate &gt; 5% → mungkin perlu bump CPU dari 1 ke 2 vCPU di Cloud Run config (masih free tier kalau total vCPU-sec tidak exceed budget). Atau evaluasi hybrid path (lihat §5.5).

Query:
```sql
SELECT
  kind,
  COUNT(*) FILTER (WHERE status='success') AS success,
  COUNT(*) FILTER (WHERE status='error')   AS error,
  COUNT(*) FILTER (WHERE status='cold_start_timeout') AS cold_start,
  PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
  PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
  MAX(called_at) FILTER (WHERE status='error') AS last_error_at
FROM public.clip_inference_log
WHERE called_at &gt;= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta')
GROUP BY kind;
```

---

## 7. Permissions &amp; RLS

- **Upload foto produk + edit Stok**: role `admin` atau `staff_gudang`.
- **Hapus foto produk**: role `admin`.
- **Cari by Foto di kasir**: role `kasir` atau higher.
- **Approve initial_stock**: role `owner`.
- **Edit costing_method**: role `owner` atau `admin`.
- **Read AI call log panel**: role `owner` atau `admin`.

RLS policy stocks (existing) tetap; tambah policy untuk:
- `product_categories`, `product_brands`, `product_units`: insert oleh admin/staff, read semua authenticated.
- `stock_photo_embeddings`: insert/update oleh service role saja (dari backend); read oleh authenticated.
- `clip_inference_log` [AMENDED 2026-06-16]: insert service role; read owner/admin. (Renamed from `ai_call_log`.)

---

## 8. Error Handling &amp; Edge Cases

| Skenario | Handling |
|---|---|
| Foto &gt; 5MB pre-compress | Reject di client, toast `"File terlalu besar. Max 5MB sebelum compress."` |
| Upload Storage gagal (network) | Retry x2; kalau fail, toast `"Gagal upload foto X. Cek koneksi."` Form tidak submit. |
| CLIP indexing gagal saat upload [AMENDED 2026-06-16] | Foto tetap tersimpan; row di stocks tetap created; `stock_photo_embeddings` row absent. UI menampilkan badge `Indexing gagal — Retry`. Manual retry button. Log ke `clip_inference_log` dengan `status='error'`. |
| Cold start saat search kasir [AMENDED 2026-06-16] | Banner inline `"⏱️ Menyiapkan AI… 5 detik"` di modal (bukan toast error). Auto-retry sekali setelah model loaded. |
| Cold start exceed 15s [AMENDED 2026-06-16] | Toast `"AI tidak siap, coba lagi atau cari via teks."` Modal tetap terbuka. |
| Drag-drop file bukan image [AMENDED 2026-06-16] | Toast `"Hanya foto yang didukung."` Drop diabaikan. |
| Drag multi-file [AMENDED 2026-06-16] | Terima file pertama, toast info `"Cuma 1 foto per search."` |
| Tidak ada produk dengan similarity ≥ 0.70 | Show empty-state variant (banner + top 5 opacity 60%). |
| Produk dihapus tapi foto masih di Storage | Backend job `cleanup_orphaned_photos` (nightly cron) — out of scope; flag TODO. |
| Approval initial_stock expired (30 menit) | Status `expired`, produk tetap ada tapi stok = 0 selamanya kecuali admin re-request adjustment. |
| Multi-satuan: kabel 1 roll = 100 m; beli 2 roll, jual 50 m | Stok selalu dalam satuan utama (m). Pembelian 2 roll → `stock += 2 × 100 = 200 m`. Penjualan 50 m → `stock -= 50`. Tidak ada pecahan karena semua aritmatika integer. |
| User pilih unit yang sama untuk Utama dan Kedua (mis. meter &amp; meter) | Validate di submit form: `unit ≠ unit_alt`. Toast error. |
| User input factor = 1 (sama persis) | Validate `unit_alt_factor &gt; 1`. Toast error. Factor 1 berarti tidak ada konversi — non-sense. |
| User input satuan baru yang duplikasi (case-insensitive `Pcs` vs `pcs`) | Normalize ke lowercase sebelum insert; UNIQUE constraint enforce. |
| Kategori yang dihapus tapi masih dipakai produk | Block delete jika ada `stocks` yang refer (di-cek by name); show toast "Masih dipakai N produk". |

---

## 9. Testing Strategy

### 9.1. Unit tests
- `compressImage()` helper: berbagai ukuran input → output ≤ 1024px, JPEG, q=75.
- `validatePhotoCount()`: 0 foto → error; 1-5 foto → OK; &gt; 5 → error.
- `computeMargin(harga_jual, harga_modal)`: edge cases (modal &gt; jual = negatif margin, modal=0 = N/A).
- `unitConversionFactor()`: stok 0.5 roll konversi ke meter.

### 9.2. Integration tests
- Upload 5 foto → assert `photo_urls` array length = 5, order = 0..4.
- Edit produk: hapus foto index 2 → assert `stock_photo_embeddings` row deleted.
- Submit Stok Awal &gt; 0 → assert `approval_requests` row created with `request_type='initial_stock'`.
- Kasir search dengan foto MCB Schneider → assert top result similarity &gt; 0.70.
- Search foto bukan electrical (mis. kucing) → assert empty state.
- Cold start simulation [AMENDED 2026-06-16] → kill backend-go container, restart, fire search request → assert banner `"⏱️ Menyiapkan AI… 5 detik"` muncul, lalu hasil muncul setelah model loaded.
- Drag-drop foto JPG dari folder local [AMENDED 2026-06-16] → assert search pipeline ke-trigger, hasil muncul. Test juga PNG, JPEG, GIF (terima static frame), HEIC (toast unsupported kalau browser gak decode).
- Drop file bukan image (mis. PDF) [AMENDED 2026-06-16] → assert toast `"Hanya foto yang didukung."` muncul, gak trigger pipeline.

### 9.3. Manual / smoke (per superpowers:verification-before-completion)
- Buka `StockManagerScreen` di browser, klik "Tambah Barang Baru", isi semua field termasuk foto 3 buah, submit. Assert:
  - Produk muncul di list dengan thumbnail dari foto #1.
  - Badge `Indexing…` muncul lalu hilang dalam &lt;10 detik.
  - DB row di `stock_photo_embeddings` = 3.
- Buka `KasirScreen`, klik "Cari by Foto", upload foto MCB. Assert:
  - Modal hasil muncul dalam &lt;4 detik.
  - Top result = produk yang baru di-upload tadi (similarity tinggi).
  - Click "Tambah" → produk masuk cart.
- Buka `PengaturanScreen`, ubah costing FIFO → Average. Assert toast warning + save sukses.
- Set Stok Awal 100 di form Tambah → assert approval request WhatsApp ke owner berhasil terkirim (atau di-mock).

### 9.4. Cross-browser
- Chrome desktop (primary)
- Safari iPad (kasir use case — kamera access)
- Mobile Chrome Android (kasir backup)

---

## 10. Open Questions / TODO Out-of-Scope

- **Recompute HPP saat costing method berubah** — flag TODO, perlu spec terpisah.
- **Cleanup orphaned photos** dari Storage saat produk hard-delete — nightly cron, out of scope.
- **Hybrid CLIP + Gemini Vision re-rank [AMENDED 2026-06-16]** — defer ke spec terpisah, di-trigger kalau benchmark CLIP murni &lt; 80% top-1 akurasi pada minggu 4 post-launch. Estimasi tambahan 2 hari dev. Lihat §5.5 untuk arsitektur.
- **CLIP larger variant (ViT-Large / ViT-G) [AMENDED 2026-06-16]** — kalau ViT-Base-32 akurasi belum cukup, upgrade ke ViT-Base-16 (512-dim sama, ~600MB, ~250ms CPU) sebelum jump ke ViT-Large. Out of scope sekarang.
- **min-instances=1 Cloud Run untuk hilangkan cold start [AMENDED 2026-06-16]** — cost ~$15/bulan, butuh founder approval per `cost_upgrade_approval`. Defer sampai pain dari cold start measurable.
- **Multi-warehouse stock per produk dengan foto sama** — saat ini stok dilacak per produk (stocks.stock_atas + stock_bawah). Sudah cukup untuk scope ini.
- **Bundle / Composite produk** — spec terpisah untuk masa depan.
- **Default supplier per produk** — spec terpisah.
- **Tax (PPN) per produk** — tambahkan kalau toko jadi PKP.

---

## 11. Implementation Phases (preview untuk writing-plans)

**Fase 1 — Foundation DB &amp; Registry (1-2 hari)**
- Migrasi M1-M5
- Seed registry tables
- Update `StockItem` type di `src/types.ts`
- Service methods di `stockService` untuk registry CRUD

**Fase 2 — Refactor &amp; Form Produk (3 hari)**
- Refactor `StockManagerScreen.tsx` (1051 baris) → orchestrator + 5 child components: `CatalogGridView`, `ProductForm`, `StockTableView`, `BulkUploadSection`, `PreviewCard`
- Sidebar rename: "Stok" → "Produk &amp; Stok" + icon update (`Package` tetap atau `Inventory2`)
- Tab pill structure di screen header (Katalog default / Stok per Gudang / Bulk Upload / Stok Tipis)
- ProductForm: two-column layout (form left, sticky live preview right)
- UI: card-stack Identitas (SKU editable, Sub-Kategori, Satuan, multi-satuan)
- UI: card Harga &amp; Stok (margin live, Batas Stok Min, banner approval conditional, warehouse dropdown untuk Stok Awal)
- UI: **Harga Modal dynamic label/mode** — query `stock_lots` count; baca `costing_method` dari `company_settings`; render Estimasi vs Aktual dengan badge + read-only state
- UI: card Foto (HERO slot 1 + 2×2 small slots 2-5, drag-drop, mandatory slot 1, client compress)
- UI: card Spesifikasi (dinamis per kategori dari `CATEGORY_SPECS`, dengan generic fallback Aksesori pattern untuk kategori custom)
- UI: card Pengaturan Lanjutan collapsible (multi-satuan + min stock + deskripsi + Generate from Photo)
- PreviewCard live update: thumbnail, nama auto, harga, stok per gudang (dinamis dari `warehouses`)
- Sticky bottom action bar
- Submit flow + validation (min 1 foto, required fields, multi-satuan factor &gt; 1, unit ≠ unit_alt)

**Fase 3 — CLIP Pipeline Backend (3 hari) [AMENDED 2026-06-16]**
- `backend-go/internal/clip/model.go`: singleton ONNX model loader (lazy load on first request)
- `backend-go/internal/clip/preprocess.go`: image decode + resize 224×224 + normalize
- `backend-go/internal/clip/encoder.go`: `EncodeImage([]byte) ([]float32, error)` wrapper
- Bundle `clip-vit-base-patch32.onnx` ke Docker image (verify checksum)
- Endpoint `POST /api/products/index-photos`
- Endpoint `POST /api/products/search-by-photo`
- ~~Endpoint `POST /api/products/describe-product`~~ **DROPPED** (no Generate dari Foto)
- CLIP inference logging ke `clip_inference_log` (was `ai_call_log`)
- Smoke test: load model, encode 1 foto, verify vector(512) output

**Fase 4 — Kasir Cari by Foto UI + Multi-warehouse stock display (2 hari) [AMENDED 2026-06-16]**
- Tombol di KasirScreen header
- `CariByFotoModal` dengan **3 entry points**: Kamera card + Upload File card + **Drag-drop zone** (full-width dashed border violet)
- `HasilCariFotoModal` (tanpa AI deskripsi banner — CLIP gak generate text)
- Per-warehouse stock breakdown di card hasil (parse `warehouse_stock` JSONB dari RPC response)
- Cold-start banner inline `"⏱️ Menyiapkan AI… 5 detik"` saat first request after idle
- Empty state + error states (drag-drop validation, cold-start timeout)
- Integration dengan add-to-cart existing
- StockManagerScreen: section "Stok per Gudang" di edit form (read-only) + badge per-warehouse di list row
- Update kategori filter di StockManagerScreen kalau perlu

**Fase 5 — Pengaturan &amp; Approval (1 hari) [AMENDED 2026-06-16]**
- Panel Costing Method
- Panel **CLIP Inference Monitor** (was AI Activity Monitor) — search/index count, latency p50/p95, cold-start hit count
- `initial_stock` approval type + WhatsApp template + handler

**Fase 6 — Testing &amp; Polish (1 hari)**
- Unit + integration tests
- Manual smoke per checklist
- Update `progress.md`

Total estimasi: **10.5-11.5 hari kerja** [AMENDED 2026-06-16] (1 sprint dengan buffer). Berdasarkan revisi:
- 8 hari (estimasi awal)
- +1.5 hari (harga modal dynamic + multi-warehouse stock display)
- +0.5 hari (rename menu + tab structure + file refactor untuk maintainability)
- +0 hari (multi-tenant Change A + B — generalisasi tanpa extra effort)
- +0 hari (Variant produk — tunda ke sprint berikut)
- **+1 hari [AMENDED 2026-06-16]: CLIP ONNX integration** — model bundling, preprocess pipeline, smoke test cold-start latency
- **+0.5 hari [AMENDED 2026-06-16]: Drag-drop zone di Cari by Foto modal**
- **−0 hari [AMENDED 2026-06-16]: Drop Generate dari Foto button** — save sedikit dev time tapi balanced oleh effort tambahan di CLIP integration
