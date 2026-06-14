# Product Module Enhancement — Multi-Photo Upload &amp; Cari by Foto (Kasir)

**Status:** Approved (brainstormed 2026-06-13/14)
**Owner:** tonywei
**Mockups:** `docs/superpowers/specs/2026-06-13-product-photo-search-mockups/index.html`
**Estimated effort:** Medium (1 sprint, ~9.5-10.5 hari dev)
**Menu rename:** "Stok" → **"Produk &amp; Stok"** (mengikuti convention MSME tools: Jurnal Mekari "Produk &amp; Layanan", Moka/Pawoon "Produk"). Label match isi (catalog + stock ops dalam satu screen).

---

## 1. Scope &amp; Goals

### Goals

1. **Form Stok lebih lengkap (Jurnal-parity)** — extend form "Tambah Barang Baru" yang sudah ada di `StockManagerScreen.tsx:683` dengan field tambahan: SKU editable (auto-suggest + override), Sub-Kategori, Satuan (UoM), multi-satuan konversi opsional, Harga Beli/Modal eksplisit, Batas Stok Min per produk, Stok Awal opsional, Merek "+ Tambah baru", Kategori &amp; Sub-Kategori "+ Buat baru".
2. **Foto Produk multi-upload** — section baru "Foto Produk" (min 1 wajib, max 5), drag-drop reorder, slot pertama otomatis = thumbnail.
3. **Deskripsi Produk** — textarea opsional + tombol `✨ Generate dari Foto` (Gemini Vision).
4. **AI indexing pipeline otomatis** — setiap foto yang di-upload → background job Gemini Flash 2.5 Vision describe → `text-embedding-004` embed → simpan di `pgvector`. Free tier Gemini.
5. **Kasir: tombol "Cari by Foto"** — di header `KasirScreen.tsx`. Modal pilih Kamera/Upload File → top 5 hasil dengan thumbnail, SKU, stok, harga, similarity %. Threshold 70%; di bawah threshold tampilkan warning + fallback search teks.
6. **Costing Method setting** — radio FIFO/Average di `PengaturanScreen`, default FIFO, berlaku toko-wide.
7. **Stok Awal approval flow** — kalau Stok Awal &gt; 0 diisi, buat `approval_request` tipe `initial_stock` ke owner (WhatsApp / app inbox), produk tetap dibuat tapi stok belum aktif sampai approve.
8. **Auto-compress foto** — client-side resize max 1024px + JPEG q=75 sebelum upload ke Supabase Storage.
9. **Monitoring AI call activity** — panel honest di `PengaturanScreen` menampilkan jumlah call Gemini hari ini (Vision + Embedding), 429 hit count, latency p50/p95. Tanpa progress bar palsu "X/1500"; disclaimer eksplisit bahwa Google tidak expose sisa kuota real-time.

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
- **Rerank step di image search** — sprint berikutnya kalau akurasi kurang.
- **Upgrade ke paid Gemini** — sistem hanya notify, tidak auto-upgrade billing (sesuai feedback `cost_upgrade_approval`).
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
- Backend Go: new `internal/gemini/embed.go` (Vision + embedding) + new Edge Function alternative
- DB: extend tabel `stocks` (kolom baru), tabel baru `stock_photo_embeddings`, `product_brands`, `product_categories`, `product_units`, extend enum `approval_request_type` dengan `initial_stock`.

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
- Helper info: *"Min 1 foto wajib — foto pertama jadi thumbnail. Drag untuk reorder. Foto akan di-index AI ~5 detik setelah simpan dan langsung bisa dipakai untuk Cari by Foto di kasir."*

#### Section "Deskripsi Produk" (opsional)
- Textarea, max 500 char (counter di kanan bawah).
- Tombol `✨ Generate dari Foto` — enabled kalau ≥ 1 foto di-upload. Click → call `POST /gemini/describe-product` (lihat 4.1) → fill textarea dengan respon (user dapat edit).

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

### 4.2. Modal: pilih sumber foto

- 2 card besar:
  - **Pakai Kamera** (emerald) — open kamera live preview (HTML5 `&lt;input type="file" accept="image/*" capture="environment"&gt;` atau MediaDevices API untuk live preview).
  - **Upload File** (biru) — file picker `accept="image/*"`.
- Tip kuning: *"Foto produk dari angle depan / label paling jelas memberi hasil paling akurat."*
- ESC / klik luar = close.

### 4.3. Pipeline pencarian (client → backend → DB)

1. User pick/snap foto → client compress (resize 1024px, JPEG q=75).
2. POST `multipart/form-data` ke backend endpoint `POST /api/products/search-by-photo`.
3. Backend Go (atau Edge Function):
   - Call Gemini Flash 2.5 Vision → describe foto → string `desc`.
   - Call `text-embedding-004` dengan `desc` → vector 768-dim.
   - Call RPC `search_products_by_embedding(query_embedding, 0.70, 5)`.
   - Log call counts ke `ai_call_log` (lihat 6.2).
4. Response: array `[{sku, name, category, similarity, thumbnail_url, stock, price, unit, min_stock}]` + `query_description` (string yang AI generate dari foto query, di-show ke user).
5. Frontend tampilkan modal hasil.

### 4.4. Modal hasil

- Banner atas: thumbnail foto query + `AI deskripsi: "{query_description}"` + tombol `🔄 Ganti`.
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

### 4.6. Error states

- Kamera tidak diijinkan → fallback ke File picker, toast info.
- Backend error 500 → toast *"Server AI tidak respons. Coba lagi atau cari via teks."*
- Backend 429 (Gemini rate-limited) → toast *"AI sedang sibuk. Tunggu 30 detik atau cari via teks."*
- Foto &gt; 5MB pre-compress → reject di client + toast.

---

## 5. AI Pipeline (Backend)

### 5.1. Architecture choice

- **Backend Go existing** (`backend-go/internal/gemini/`) atau **Supabase Edge Function**?
  - **Pilih: Backend Go existing**. Alasan: API key `GEMINI_API_KEY` sudah di-config di `backend-go/.env`, ada pola `gemini.NewClient` di `backend-go/main.go:201`, Document Client juga sudah ada di `backend-go/internal/gemini/document.go`. Konsisten + reuse client.

### 5.2. Indexing pipeline (saat foto upload)

Trigger: setelah `stocks` UPDATE/INSERT, frontend call `POST /api/products/index-photos` dengan `{sku, photo_paths: []}`.

Backend handler `index-product-photos`:
```
for each photo_path in body.photo_paths:
  1. Skip kalau sudah ada di stock_photo_embeddings (idempotent on retry).
  2. Download image dari Supabase Storage (signed URL atau direct via service role key).
  3. Call Gemini Flash 2.5 Vision dengan prompt:
     "Describe this electrical product photo concisely in Indonesian + English mix
      for inventory search. Include: brand, type, key specs (ampere, phase, mm²,
      color, size), and visible labels. Max 60 words. Output deskripsi saja, no preamble."
  4. Call text-embedding-004 dengan deskripsi → vector(768).
  5. Upsert ke stock_photo_embeddings (sku, photo_path, description, embedding).
  6. Log ke ai_call_log (model='flash-2.5-vision', kind='index', status).
  7. Log ke ai_call_log (model='text-embedding-004', kind='index', status).
```

**Concurrency:** sequential per request (max 5 foto = ~5 detik). Beberapa request paralel = OK.
**Retry policy:** kalau 429 → exponential backoff 2s/4s/8s, max 3 retry, lalu mark `error_at` di log.
**Throttle:** kalau ai_call_log menunjukkan &gt; 10 panggilan dalam 60 detik untuk Vision, queue extra ke background.

### 5.3. Search pipeline (saat kasir search)

Handler `search-products-by-photo`:
```
1. Validate input image (≤ 5MB, valid image/*).
2. Compress kalau perlu (server-side belt-and-suspenders).
3. Call Gemini Flash 2.5 Vision (same prompt as indexing) → query_description.
4. Call text-embedding-004 dengan query_description → vector.
5. Call RPC search_products_by_embedding via Supabase client (service role).
6. Log ke ai_call_log (2 rows: 1 vision, 1 embedding, kind='search').
7. Return JSON: { query_description, results: [...] }.
```

**Latency target:** p95 &lt; 4s total. Breakdown: Vision ~2s, Embedding ~0.3s, DB query ~0.1s, marshaling ~0.05s.

### 5.4. Prompt tuning (Gemini Vision)

```
You are an inventory matcher. Describe this electrical product photo for search.

Output a single line description in mixed Indonesian/English, including:
- Product type (MCB, Panel, Kabel, Aksesori, dll)
- Brand if visible on label (Schneider, ABB, Chint, dll)
- Key specs: ampere, phase, mm², color, size
- Distinctive visible features

Format: "[Type] [Brand] [specs] [color] [features]"
Max 60 words. No preamble, no markdown, output description only.
```

Examples expected:
- "MCB Schneider iC60H 16A 1P warna biru-putih, label ic60h, single pole, body putih"
- "Kabel NYM 3×2.5 mm² warna abu-abu, merek Supreme, ujung kuningan terlihat"

---

## 6. Pengaturan (`PengaturanScreen.tsx`)

### 6.1. Panel "Metode Costing Toko"

- Radio group: `FIFO` (default, badge Default) / `Average`.
- Description per opsi (lihat mockup).
- Warning box: *"Mengubah metode akan menghitung ulang HPP semua transaksi setelah tanggal perubahan. Laporan profit historis sebelum tanggal ini tidak berubah."*
- Tombol Simpan → update `company_settings.value` untuk key `costing_method`.
- Trigger: kalau metode berubah, panggil background job `recompute_hpp_from(timestamp)` (out of scope spec ini — flag TODO).

### 6.2. Panel "Aktivitas AI Call — Hari Ini"

Tabel baru:
```sql
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model       TEXT NOT NULL,             -- 'flash-2.5-vision' | 'text-embedding-004'
  kind        TEXT NOT NULL,             -- 'index' | 'search' | 'describe'
  status      TEXT NOT NULL,             -- 'success' | 'error' | 'rate_limit'
  http_status INT,
  latency_ms  INT,
  error_msg   TEXT,
  called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_today
  ON public.ai_call_log (called_at DESC);
```

Panel UI menampilkan (data per-hari, reset 00:00 WIB):
- **Disclaimer banner**: *"Google tidak expose sisa kuota Gemini real-time. Angka di bawah hanya menghitung call yang sistem kita lakukan hari ini — bukan sisa kuota Google."*
- **2 card**: Vision call count (success/fail), Embedding call count (success/fail). Tanpa progress bar palsu.
- **3 mini stat**: Search Kasir (kind='search'), Foto Upload (kind='index'), 429 Rate-Limit hit (status='rate_limit').
- **Latency p50/p95** untuk Vision (dari `latency_ms` percentile).
- **Last Error timestamp**.
- **Note "Sinyal kapan upgrade"**: 429 berulang, latency p95 &gt; 5s konsisten. Sistem hanya notify, never auto-upgrade billing.

Query:
```sql
SELECT
  model,
  COUNT(*) FILTER (WHERE status='success') AS success,
  COUNT(*) FILTER (WHERE status='error')   AS error,
  COUNT(*) FILTER (WHERE status='rate_limit') AS rate_limit,
  PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY latency_ms) AS p50,
  PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95,
  MAX(called_at) FILTER (WHERE status='error') AS last_error_at
FROM public.ai_call_log
WHERE called_at &gt;= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta')
GROUP BY model;
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
- `ai_call_log`: insert service role; read owner/admin.

---

## 8. Error Handling &amp; Edge Cases

| Skenario | Handling |
|---|---|
| Foto &gt; 5MB pre-compress | Reject di client, toast `"File terlalu besar. Max 5MB sebelum compress."` |
| Upload Storage gagal (network) | Retry x2; kalau fail, toast `"Gagal upload foto X. Cek koneksi."` Form tidak submit. |
| AI indexing gagal saat upload | Foto tetap tersimpan; row di stocks tetap created; `stock_photo_embeddings` row absent. UI menampilkan badge `Indexing gagal — Retry`. Manual retry button. |
| Gemini 429 saat search kasir | Toast `"AI sibuk, tunggu 30 detik atau cari via teks."` Modal tetap terbuka. |
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
- Gemini 429 mock → assert toast muncul, modal tetap terbuka.

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
- **Rerank step Vision di hasil search** — sprint berikutnya kalau akurasi top-5 kurang puas.
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

**Fase 3 — AI Pipeline Backend (2 hari)**
- `backend-go/internal/gemini/embed.go`: Vision describe + Embedding wrapper
- Endpoint `POST /api/products/index-photos`
- Endpoint `POST /api/products/describe-product` (untuk tombol Generate)
- Endpoint `POST /api/products/search-by-photo`
- AI call logging ke `ai_call_log`

**Fase 4 — Kasir Cari by Foto UI + Multi-warehouse stock display (1.5 hari)**
- Tombol di KasirScreen header
- `CariByFotoModal` + `HasilCariFotoModal`
- Per-warehouse stock breakdown di card hasil (parse `warehouse_stock` JSONB dari RPC response)
- Empty state + error states
- Integration dengan add-to-cart existing
- StockManagerScreen: section "Stok per Gudang" di edit form (read-only) + badge per-warehouse di list row
- Update kategori filter di StockManagerScreen kalau perlu

**Fase 5 — Pengaturan &amp; Approval (1 hari)**
- Panel Costing Method
- Panel AI Activity Monitor
- `initial_stock` approval type + WhatsApp template + handler

**Fase 6 — Testing &amp; Polish (1 hari)**
- Unit + integration tests
- Manual smoke per checklist
- Update `progress.md`

Total estimasi: **9.5-10.5 hari kerja** (1 sprint dengan buffer). Berdasarkan beberapa revisi:
- 8 hari (estimasi awal)
- +1.5 hari (harga modal dynamic + multi-warehouse stock display)
- +0.5 hari (rename menu + tab structure + file refactor untuk maintainability)
- +0 hari (multi-tenant Change A + B — generalisasi tanpa extra effort)
- +0 hari (Variant produk — tunda ke sprint berikut)
