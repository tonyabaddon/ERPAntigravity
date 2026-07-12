# Promo Produk (Item #4b) — Design Spec

**Status:** Draft
**Author:** Claude (with founder review)
**Date:** 2026-07-13
**Related:** [Item #4 discount approval spec](./2026-07-12-discount-approval-config-design.md) — LIVE 100% traffic sejak 2026-07-12
**Feature model:** B — auto-applied per-SKU promo (bukan cap ceiling)

---

## 1. Ringkasan

Owner set diskon promo per SKU **in advance** (% atau Rp per unit) dengan expiration opsional. Kasir wizard auto-apply promo ke line item ketika SKU dimasukkan cart — kasir tidak perlu input diskon manual untuk promo tersebut. Kasir tetap bisa tambah **Diskon Nota** (invoice-level) yang gated oleh Item #4 threshold.

Total sistem punya 2 layer diskon yang jelas terpisah:

| Layer | Nama user-facing | Setter | Waktu apply | Approval | Backend |
|-------|------------------|--------|-------------|----------|---------|
| **1** | **Promo Produk** | Owner (in advance) | Auto saat SKU masuk cart | Owner pre-approved | Item #4b (this spec) |
| **2** | **Diskon Nota** | Kasir (per transaksi) | Manual input | Item #4 flow (kalau > threshold) | Item #4 (LIVE) |

Feature ini adalah **layer optimization** di atas Item #4. Item #4 tetap safety net untuk exception (VIP customer, competitor match, negotiated deal).

---

## 2. Tujuan + non-goals

### 2.1 In scope MVP

- Schema kolom promo di `stocks` table (per-SKU, per-tenant via existing tenant_id)
- 5 backend RPCs: `upsert_stock_promo`, `bulk_upsert_stock_promo`, `list_active_promos`, `get_promo_summary`, dan behavior extension di `record_kasir_sale` (no signature change)
- Halaman baru `Pengaturan → Diskon → Promo Produk` dengan list + tambah + edit + bulk apply + delete + filter status/kategori
- `Produk & Stok` — tambah 2 kolom "Promo" + "Berlaku hingga" dengan inline edit (quick fix)
- Kasir wizard — auto-tampil promo per line + auto-hitung line net
- Dashboard maintenance card — 3 metric summary + shortcut ke halaman promo
- Restructure Pengaturan menu — buat parent "Diskon" yang tampung `Aturan Diskon Nota` (Item #4) + `Promo Produk` (Item #4b)
- Multi-tenant aman: idempotent migrations, no per-tenant seed, backward-compatible

### 2.2 Out of scope (deferred)

- **Category-level default cap** — data model `product_categories` sudah exist, tapi user pilih skip; add kalau owner minta
- **Per-line manual discount input di kasir** — kasir tetap punya invoice-level Diskon Nota; auto-promo per line
- **CSV bulk import** — MVP pakai bulk-select toolbar di UI, CSV nunggu owner complain
- **Auto-apply di modul Penjualan / Faktur** — SO biasanya B2B negosiasi khusus, skip
- **Realtime propagation ke kasir wizard** ketika owner ubah promo mid-transaction — kasir load cache saat mount, refresh manual kalau perlu
- **Customer-tier promo** (VIP dapat promo berbeda) — needs customer segmentation
- **Time-of-day promo** (happy hour dsb) — YAGNI
- **PDF invoice / receipt template update** untuk tampilkan "Promo Produk: -Rp X" line breakdown — data ada di DB, template update di iteration selanjutnya

### 2.3 Bahasa + design system

- Bahasa Indonesia MSME tone
- Font: 13-14px UI (per feedback `font_sizing`)
- Reuse pattern dari Item #4 (`ApprovalRulesPanel`, `ApprovalGateEditor`, modal shell)
- Rupiah format via existing `formatIDR` helper
- Badge palette existing: emerald (aktif) / amber (⚠ expiring) / slate (kadaluwarsa)

---

## 3. Terminology (biar tidak bingung 2 layer diskon)

### Promo Produk (Layer 1 — Item #4b)

- **Siapa set**: owner via `Pengaturan → Diskon → Promo Produk` atau inline edit di `Produk & Stok`
- **Kapan berlaku**: **otomatis** nempel ke SKU saat kasir add ke cart
- **Approval**: tidak perlu (owner sudah set in advance)
- **Kasir bisa ubah?**: TIDAK. Kasir tidak bisa reduce/hapus promo per line
- **Berlaku**: sesuai `promo_expires_at` (NULL = permanen)
- **Data storage**: kolom `stocks.promo_*`
- **Audit**: `kasir_transaction_items.promo_snapshot` JSONB per line

### Diskon Nota (Layer 2 — Item #4, LIVE)

- **Siapa set**: kasir manual saat transaksi
- **Kapan berlaku**: kasir input di field "Diskon Nota" di wizard
- **Approval**: Item #4 gate — kalau `discount > threshold` → owner approve via APP_INBOX/PIN
- **Kasir bisa ubah?**: YA (dengan approval kalau > threshold)
- **Berlaku**: per transaksi
- **Data storage**: existing `kasir_transactions.discount_amount` + `discount_approval_request_id`

### Contoh gabungan

```
Cart:
  MCB Schneider 32A   5 × Rp 85.000  = Rp 425.000
    🏷 Promo Produk: 15% = -Rp 63.750
    Net: Rp 361.250

  Kabel NYA 2.5      10 × Rp 12.000  = Rp 120.000
    🏷 Promo Produk: Rp 3.000/unit = -Rp 30.000
    Net: Rp 90.000

  Panel Kosong        1 × Rp 200.000 = Rp 200.000
    (tidak ada promo)
    Net: Rp 200.000

Subtotal (setelah Promo Produk): Rp 651.250

Diskon Nota:  [ Rp 0                ]
Total bayar:  Rp 651.250
```

Kalau kasir input `Diskon Nota = Rp 150.000` dan threshold tenant Rp 100.000 → Item #4 gate trigger → owner approval dulu.

---

## 4. Data model

### 4.1 Kolom baru di `stocks`

```sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS promo_discount_type   TEXT
    CHECK (promo_discount_type IN ('PERCENT','AMOUNT')),
  ADD COLUMN IF NOT EXISTS promo_discount_value  NUMERIC(15,2)
    CHECK (promo_discount_value > 0),
  ADD COLUMN IF NOT EXISTS promo_expires_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS promo_updated_by      UUID NULL;

-- CHECK constraints via DO block untuk safe re-run
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='promo_type_value_consistency') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT promo_type_value_consistency CHECK (
        (promo_discount_type IS NULL AND promo_discount_value IS NULL)
        OR (promo_discount_type IS NOT NULL AND promo_discount_value IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='promo_percent_range') THEN
    ALTER TABLE public.stocks
      ADD CONSTRAINT promo_percent_range CHECK (
        promo_discount_type <> 'PERCENT'
        OR (promo_discount_value >= 0.01 AND promo_discount_value <= 100)
      );
  END IF;
END $$;
```

**Rasional per kolom:**
- `promo_discount_type` — `'PERCENT'` atau `'AMOUNT'` (Rp per unit)
- `promo_discount_value` — kalau PERCENT: 15 = 15%; kalau AMOUNT: 3000 = Rp 3.000/unit
- `promo_expires_at` — NULL = permanen; non-NULL cut-off (setelah `now() > expires_at`, promo di-treat inactive)
- `promo_updated_at` + `promo_updated_by` — audit siapa/kapan set/ubah

**Yang TIDAK di-enforce di DB:**
- `promo_discount_value ≤ stocks.price` untuk AMOUNT — validasi di RPC layer (unit price mutable, DB CHECK tidak boleh cross-column dependent)

### 4.2 Index

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stocks_active_promo
  ON public.stocks (tenant_id, promo_expires_at)
  WHERE promo_discount_type IS NOT NULL;
```

Partial: hanya index SKU yang punya promo. Query `list_active_promos` filter `expires_at IS NULL OR expires_at > now()` di WHERE clause — index bantu tenant_id scoping + range scan. Tidak pakai `WHERE ... > now()` di index expression (Postgres immutable requirement).

### 4.3 Audit snapshot di `kasir_transaction_items`

```sql
ALTER TABLE public.kasir_transaction_items
  ADD COLUMN IF NOT EXISTS promo_snapshot JSONB NULL;
```

**Contoh isi:**
```json
{
  "type": "PERCENT",
  "value": 15,
  "expires_at": "2026-12-31T00:00:00Z",
  "applied_at": "2026-07-13T10:30:00Z"
}
```

NULL = tidak ada auto-promo saat sale. JSONB immutable snapshot supaya perubahan config di masa depan tidak rewrite history.

### 4.4 RLS

- `stocks` sudah punya RLS `p_select_own` (existing) — reader tidak berubah
- Write kolom promo via SECDEF RPC `upsert_stock_promo` owned by `vosi_rpc_owner` (pattern Item #4 + guard `_guard_expiry_write` predicate broken per memory `guard_expiry_write_broken_predicate`)
- `kasir_transaction_items.promo_snapshot` di-populate oleh `record_kasir_sale` (SECDEF, existing)

### 4.5 Migration slot allocation

| Slot | File | Isi |
|------|------|-----|
| **20261115000120** | `20261115000120_stocks_promo_schema.sql` | ADD COLUMN + CHECK + partial index |
| **20261115000121** | `20261115000121_stocks_promo_kasir_items_snapshot.sql` | ADD COLUMN `promo_snapshot` |
| **20261115000122** | `20261115000122_upsert_stock_promo_rpc.sql` | `upsert_stock_promo` |
| **20261115000123** | `20261115000123_bulk_upsert_stock_promo_rpc.sql` | `bulk_upsert_stock_promo` |
| **20261115000124** | `20261115000124_list_active_promos_rpc.sql` | `list_active_promos` + `get_promo_summary` |
| **20261115000125** | `20261115000125_record_kasir_sale_promo_enrich.sql` | `record_kasir_sale` behavior update |

Slot 120-125 masih di block 100+ free per memory `migration_slot_allocation` (QA-sweep 054-079, Session 2 080-099, block 100+ free untuk fresh sessions).

---

## 5. Backend RPCs

### 5.1 `upsert_stock_promo` — set/edit/hapus promo per SKU

**Signature:**
```
upsert_stock_promo(
  p_sku                  TEXT,
  p_promo_discount_type  TEXT NULL,      -- NULL keduanya = hapus promo
  p_promo_discount_value NUMERIC NULL,
  p_promo_expires_at     TIMESTAMPTZ NULL
) RETURNS VOID
```

**Validasi:**
- SKU exist di `stocks` tenant scope — tolak kalau tidak
- Kalau `p_promo_discount_type IS NULL AND p_promo_discount_value IS NULL` → hapus promo (set kolom NULL)
- Kalau salah satu non-NULL, yang lain juga harus non-NULL → tolak inconsistency
- Type ∈ {PERCENT, AMOUNT}
- PERCENT: `0.01 ≤ value ≤ 100`
- AMOUNT: `value > 0 AND value ≤ stocks.price` (fetch current unit price)
- `p_promo_expires_at`: NULL boleh; non-NULL harus `> now()`

**Behavior:**
- Update kolom + `promo_updated_at = now()` + `promo_updated_by = auth.uid()`
- Idempotent (repeat call sama args = no-op)
- SECDEF, owned by `vosi_rpc_owner`, GRANT EXECUTE ke `authenticated`

### 5.2 `bulk_upsert_stock_promo` — bulk apply promo ke N SKU

**Signature:**
```
bulk_upsert_stock_promo(
  p_skus                 TEXT[],
  p_promo_discount_type  TEXT NULL,
  p_promo_discount_value NUMERIC NULL,
  p_promo_expires_at     TIMESTAMPTZ NULL
) RETURNS TABLE(sku TEXT, ok BOOLEAN, error_message TEXT)
```

**Behavior:**
- Deduplicate `p_skus` first
- Cap `array_length ≤ 500`
- Iterate per-SKU, catch exception per iteration → append ke result row (tolerant mode)
- SECDEF, owned by `vosi_rpc_owner`

### 5.3 `list_active_promos` — list untuk kasir wizard + Promo Produk page

**Signature:**
```
list_active_promos(
  p_filter TEXT DEFAULT 'active'   -- 'active' | 'expiring_7d' | 'expired' | 'all'
) RETURNS TABLE(
  sku                    TEXT,
  name                   TEXT,
  category               TEXT,
  price                  NUMERIC,
  promo_discount_type    TEXT,
  promo_discount_value   NUMERIC,
  promo_expires_at       TIMESTAMPTZ,
  status                 TEXT       -- 'active' | 'expiring_7d' | 'expired'
)
```

**Filter logic:**
- `active`: `promo_discount_type IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`
- `expiring_7d`: aktif AND `expires_at BETWEEN now() AND now() + INTERVAL '7 days'`
- `expired`: `expires_at IS NOT NULL AND expires_at <= now()`
- `all`: semua yang ada `promo_discount_type IS NOT NULL`
- Filter invalid → fallback ke `'active'`

**Hard cap:** `LIMIT 5000` (guard tenant dengan jumlah promo besar).

**Consumers:**
- Kasir wizard mount → filter `active` → cache
- Promo Produk page → filter user choice
- Dashboard card summary → filter `active` + `expiring_7d`

### 5.4 `get_promo_summary` — dashboard card metrics

**Signature:**
```
get_promo_summary() RETURNS TABLE(
  total_active     INT,
  expiring_7d      INT,
  expired_30d      INT     -- expired dalam 30 hari terakhir
)
```

**Query:** single aggregate against `stocks` tenant scope + partial index. Cheap even di tenant besar.

### 5.5 `record_kasir_sale` — behavior extension

**Signature:** **TIDAK berubah.** Frontend `CatatPenjualanWizard.tsx` tetap panggil dengan payload existing.

**Behavior additive:**
- Setelah insert row ke `kasir_transaction_items`, backend read current promo dari `stocks` untuk SKU tersebut
- Kalau `promo_discount_type IS NOT NULL AND (expires_at IS NULL OR expires_at > now())`:
  - Update row yang baru dengan `promo_snapshot = jsonb_build_object('type', ..., 'value', ..., 'expires_at', ..., 'applied_at', now())`
- Kalau tidak ada promo aktif → `promo_snapshot = NULL`

**Kenapa backend-derived (bukan frontend-supplied):**
- Kasir tidak bisa "fake" promo — snapshot selalu match kondisi DB saat write
- Signature `record_kasir_sale` tetap → tidak break existing call sites
- Trade-off jujur: kalau owner ubah promo persis di detik kasir submit (rare race), `discount_amount` yang customer bayar dihitung dari frontend cache (stale), tapi `promo_snapshot` catat kondisi DB saat submit. Mismatch minor, audit-visible.

### 5.6 Impact analysis

**Direct importers `record_kasir_sale`:**
- `src/components/penjualan/CatatPenjualanWizard.tsx`

**Indirect callers:** none

**Tests:** tidak ada existing test file untuk RPC ini. Smoke test manual + MCP chrome smoke di prod-testing tenant.

**DB touchpoints:**
- `stocks` (read + write kolom promo baru)
- `kasir_transaction_items` (write `promo_snapshot`)
- `product_categories` (read only, untuk filter Promo Produk page)

**Verdict:** 1 direct call site (wizard), 0 tests, 3 DB touchpoints. Plan cover semua. Signature tidak berubah = 0 breaking change.

---

## 6. Frontend UI

### 6.1 Restructure Pengaturan menu — parent "Diskon"

**Sidebar structure (setelah restructure):**

```
Pengaturan
  ├─ Diskon                          ← NEW parent group
  │    ├─ Aturan Diskon Nota         ← pindah dari Aturan Persetujuan
  │    └─ Promo Produk               ← baru (Item #4b)
  │
  ├─ Aturan Persetujuan              ← tetap, untuk approval type lain
  │
  ├─ Katalog                         ← tetap, tanpa Promo Produk
  │    └─ Produk & Stok
  │
  └─ ...
```

**Halaman landing `/pengaturan/diskon`:**

```
Pengaturan / Diskon

┌────────────────────────────────────────────────────────────────────┐
│  Ada 2 jenis diskon di sistem ini:                                 │
│  1. Promo Produk = auto-apply saat kasir jual (owner set)          │
│  2. Diskon Nota  = manual kasir input di nota, subject approval    │
└────────────────────────────────────────────────────────────────────┘

┌─ 🏷 Promo Produk ──────────────────┐  ┌─ 🎫 Aturan Diskon Nota ──────┐
│  Diskon per SKU otomatis nempel    │  │  Batas diskon nota manual    │
│  saat kasir jual produk.           │  │  kasir. Kalau lewat batas    │
│                                    │  │  → butuh persetujuan owner.  │
│  42 SKU sedang promo               │  │                              │
│  8 kadaluwarsa 7 hari              │  │  Approval: APP_INBOX          │
│                                    │  │  Batas: Rp 100.000 / 10%     │
│  [Kelola promo →]                  │  │  [Ubah aturan →]             │
└────────────────────────────────────┘  └──────────────────────────────┘
```

**Effect ke Item #4 (LIVE):**
- **Buat `AturanDiskonNotaPage.tsx`** — render **hanya row `kasir_discount`** dari `approval_settings`. Reuse `ApprovalGateEditor` component
- **`ApprovalRulesPanel`** — filter out `kasir_discount` (jangan render di Aturan Persetujuan lagi)
- **Backend zero change** — `approval_settings.request_type='kasir_discount'` tetap sama, RPCs unchanged
- **Redirect deprecated URL** — bookmark `/pengaturan/aturan-persetujuan` tetap kerja tapi row kasir_discount tidak muncul di situ

### 6.2 Halaman baru `/pengaturan/diskon/promo-produk`

**File:** `src/pages/pengaturan/PromoProdukPage.tsx`

**Komponen anak** (di `src/components/promo/`):
- `PromoDiskonTable.tsx`
- `PromoDiskonFilters.tsx`
- `PromoDiskonBulkToolbar.tsx`
- `PromoDiskonFormModal.tsx`
- `PromoDiskonRowActions.tsx`

**Layout:**

```
Pengaturan / Diskon / Promo Produk

┌ Promo Produk ───────────────────────────────────────────────────────────┐
│                                                                         │
│  [+ Tambah Promo]      🔍 [Cari SKU atau nama produk...        ]       │
│                                                                         │
│  Status: [Aktif ▾]   Kategori: [Semua ▾]                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ ☐ │ SKU       │ Nama              │ Promo         │ Berlaku       ⋯│ │
│  │───┼───────────┼───────────────────┼───────────────┼───────────────┤ │
│  │ ☐ │ MCB-32A   │ MCB Schneider 32A │ 15%           │ 2026-12-31   ⋯│ │
│  │ ☐ │ KBL-2.5   │ Kabel NYA 2.5     │ Rp 3.000/unit │ ∞ permanen   ⋯│ │
│  │ ☐ │ PNL-500   │ Panel 500×500     │ 10%           │ 2026-07-15 ⚠ ⋯│ │
│  │ ☐ │ MCB-16A   │ MCB 16A           │ 8%            │ Kadaluwarsa   ⋯│ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  Menampilkan 42 dari 42 SKU                                             │
└─────────────────────────────────────────────────────────────────────────┘

Ketika ada checkbox tercentang, floating bulk toolbar di bawah:

┌─ 3 dipilih ─────────────────────────────────────────────────────────────┐
│  [⏸ Nonaktifkan]  [🗑 Hapus]  [📅 Ubah tanggal berakhir]  [❌ Batal]    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Badge status:**
- **Aktif** — badge hijau (`bg-emerald-50 text-emerald-700 border-emerald-200`)
- **Kadaluwarsa <7 hari (⚠)** — badge amber (`bg-amber-50 text-amber-700 border-amber-200`) + tooltip "Berakhir dalam 3 hari"
- **Kadaluwarsa** — badge slate (`bg-slate-100 text-slate-500 border-slate-200`)

**Row action (⋯) menu:**
- Edit promo → open `PromoDiskonFormModal` prefill
- Duplicate ke SKU lain → open modal dengan SKU picker kosong, value prefill
- Hapus promo → confirmation modal

**Filter status dropdown:**
```
[Aktif ▾]
 - Aktif (42 SKU)
 - Akan kadaluwarsa 7 hari (8 SKU)
 - Sudah kadaluwarsa (15 SKU)
 - Semua yang punya promo (65 SKU)
```

**Deep link support:** `?filter=expiring_7d` (dari dashboard card).

### 6.3 Modal Tambah/Edit Promo

**File:** `src/components/promo/PromoDiskonFormModal.tsx`

```
┌── Tambah Promo Diskon ──────────────────────────────────────────┐
│                                                                 │
│  Produk *                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 🔍 Ketik SKU atau nama produk...                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│    Terpilih:                                                    │
│    [ MCB-32A · MCB Schneider 32A · Rp 85.000  ×]               │
│    [ KBL-2.5 · Kabel NYA 2.5 · Rp 12.000       ×]               │
│    + tambah produk lain                                         │
│                                                                 │
│  Jenis promo *                                                  │
│    ( ● ) Persentase (%)     ( ○ ) Rp per unit                  │
│                                                                 │
│  Nilai promo *                                                  │
│  ┌──────────┐                                                   │
│  │  15      │ %      ← unit auto-tampil sesuai jenis          │
│  └──────────┘                                                   │
│                                                                 │
│  Berlaku hingga                                                 │
│    ( ○ ) Selamanya    ( ● ) Sampai tanggal                     │
│  ┌────────────────┐                                             │
│  │ 📅 2026-12-31  │                                             │
│  └────────────────┘                                             │
│                                                                 │
│  Preview:                                                       │
│  • MCB-32A (Rp 85.000)  → hemat 15% = Rp 12.750/unit            │
│  • KBL-2.5 (Rp 12.000)  → hemat 15% = Rp 1.800/unit             │
│                                                                 │
│  [Batal]                                    [Simpan Promo]      │
└─────────────────────────────────────────────────────────────────┘
```

**Fitur:**
- Multi-SKU picker via autocomplete + chip display
- Type toggle PERCENT/AMOUNT — nilai unit auto-swap (% vs "Rp per unit")
- Preview list membantu owner spot mistake (misal set Rp 100.000 di produk yang harganya Rp 50.000)
- **Client-side validasi:**
  - PERCENT: 0.01 ≤ value ≤ 100
  - AMOUNT: value > 0 AND value ≤ harga produk terkecil dari yang dipilih
  - Inline error kalau 1 SKU tidak valid, disable submit
- **On submit:** panggil `bulk_upsert_stock_promo` (tolerant mode) → toast "X berhasil, Y gagal" + tetap di modal kalau ada gagal, close kalau semua sukses

### 6.4 `Produk & Stok` — tambah 2 kolom

**File:** `src/components/produk/ProdukStokTable.tsx` (existing, modify)

Tambah kolom setelah kolom "Kategori":

```
SKU       Nama              Harga    Stok  Kategori  Promo             Berlaku hingga
MCB-32A   MCB Schneider 32A 85.000   50    MCB       15% ✏             2026-12-31 ✏
KBL-2.5   Kabel NYA 2.5     12.000   200   Kabel     Rp 3.000/unit ✏   ∞ permanen ✏
MCB-16A   MCB 16A           45.000   80    MCB       — [+ Set promo]    —
```

**Inline edit behavior:**
- Klik nilai promo / berlaku → popover mini-form (type toggle + value input + date picker) → save langsung via `upsert_stock_promo`
- Kolom "Promo" tampilkan value + unit, atau em-dash + "+ Set promo" button kalau NULL
- Kolom "Berlaku hingga" tampilkan tanggal atau "∞ permanen" atau em-dash

**Extract:** kalau `ProdukStokTable` sudah punya pattern popover edit column, reuse. Kalau belum, extract mini-form ke `src/components/promo/PromoInlineEdit.tsx`.

### 6.5 Kasir wizard auto-apply

**File:** `src/components/penjualan/CatatPenjualanWizard.tsx` (existing, modify)

**Existing behavior:** kasir add SKU ke cart, line tampil `qty × unit_price = subtotal_line`. Field `Diskon` di invoice level.

**New behavior:** line item tampilkan promo aktif kalau ada:

```
Cart:
┌───────────────────────────────────────────────────────────────────────┐
│  MCB Schneider 32A                       5 × Rp 85.000 = Rp 425.000  │
│   🏷 Promo Produk: 15% = -Rp 63.750                                  │
│   Net: Rp 361.250                                                     │
│                                                                       │
│  Kabel NYA 2.5                          10 × Rp 12.000 = Rp 120.000  │
│   🏷 Promo Produk: Rp 3.000/unit = -Rp 30.000                         │
│   Net: Rp 90.000                                                      │
│                                                                       │
│  Panel Kosong 300×300                   1 × Rp 200.000 = Rp 200.000  │
│   Net: Rp 200.000                                                     │
└───────────────────────────────────────────────────────────────────────┘

Subtotal (setelah Promo Produk): Rp 651.250

Diskon Nota:  [ Rp 0                    ]  Alasan: [           ]
Total bayar:  Rp 651.250
```

**Implementation:**
- On wizard mount → panggil `list_active_promos('active')` → simpan di state hook (`useActivePromos` di `src/hooks/useActivePromos.ts`)
- When SKU added to cart → look up di cache, kalau ada promo aktif → compute + display
- Line net kalkulasi client-side:
  - PERCENT: `qty × unit_price × (1 − value/100)`
  - AMOUNT: `qty × (unit_price − value)` (guard: kalau `value > unit_price`, skip promo + toast warning)
- Subtotal invoice = sum of line nets
- Field "Diskon Nota" existing (Item #4 gate) tetap ada; gate cek pakai subtotal post-promo
- Kasir **TIDAK bisa reduce/hapus promo per line** (baseline read-only)
- Kasir isi "Diskon Nota" → Item #4 flow existing trigger kalau > threshold

**Persistence:** kasir wizard tetap panggil `record_kasir_sale` dengan payload existing. Backend enrich `promo_snapshot` per line (§5.5). No payload change.

### 6.6 Dashboard maintenance card

**File:** `src/components/dashboard/PromoProdukCard.tsx` (baru)

```
┌─ 🏷 Promo Produk ────────────────────────────────┐
│                                                   │
│  42 SKU sedang promo                              │
│                                                   │
│  ⏰ 8 SKU akan kadaluwarsa dalam 7 hari           │
│  📉 15 SKU sudah kadaluwarsa (30 hari terakhir)   │
│                                                   │
│  [Kelola promo →]                                 │
└───────────────────────────────────────────────────┘
```

**Behavior:**
- On mount → call `get_promo_summary()` → render 3 metric
- CTA button → navigate ke `/pengaturan/diskon/promo-produk?filter=expiring_7d` (default filter jadi expiring kalau ada; else `?filter=active`)
- **Hide card entirely kalau semua 3 metric = 0** (jangan clutter dashboard tenant yang belum pakai fitur)

### 6.7 Design system alignment

- Font 13-14px UI body (per feedback `font_sizing`)
- Colors: badge palette emerald/amber/slate, primary button reuse tenant primary
- Table: reuse pattern `ApprovalRulesPanel` (Item #4) atau Produk & Stok existing
- Modal: reuse existing modal shell
- Icon: emoji inline (🏷 ⏰ 📉) match dashboard existing cards; swap ke Lucide/Heroicons kalau ada library
- Rupiah formatting via existing `formatIDR()`

### 6.8 Empty / loading / error states

- **Promo Produk page, no promos:** "Belum ada SKU dengan promo. Klik + Tambah Promo untuk mulai."
- **Promo Produk page, filter no results:** "Tidak ada promo yang cocok dengan filter." + [Reset filter]
- **Kasir wizard no active promos:** normal — cart line tampil tanpa 🏷 badge
- **Dashboard card no promos:** hide card entirely
- **List loading:** skeleton row (5 baris)
- **Modal submit:** button "Menyimpan..." + disable
- **Bulk apply:** progress toast "Menyimpan 5 produk..." → hasil toast "4 berhasil, 1 gagal (klik untuk detail)"
- **Error 42501 / RLS:** toast "Tidak punya akses. Hubungi owner."
- **Network error:** toast "Gagal menyimpan. Coba lagi." + retry button

---

## 7. Interaksi dengan Item #4 + modul lain

### 7.1 Item #4 (Diskon Nota) — unchanged

**Aliran end-to-end:**

```
1. Kasir add SKU ke cart
   ↓
2. Wizard cek cache list_active_promos → auto-apply Promo Produk per line
   ↓
3. Line net = qty × unit_price × (1 − promo%) atau qty × (unit_price − promo_rp)
   ↓
4. Subtotal invoice = Σ line net (SUDAH termasuk potongan Promo Produk)
   ↓
5. Kasir bisa isi "Diskon Nota" [Rp X]
   ↓
6. Kalau X > 0 → check_kasir_discount_gate(X, subtotal_invoice_post_promo)
       ├─ approval_required=false OR X ≤ threshold → tidak trigger
       └─ X > threshold → Item #4 flow (reason modal → approval request → waiting banner)
   ↓
7. Submit → record_kasir_sale (existing signature) → backend enrich promo_snapshot per line
```

**Key:**
- Item #4 gate cek pakai **HANYA "Diskon Nota"** amount (not sum of promo + diskon nota)
- Subtotal yang dicek = **post-Promo Produk subtotal**
- Rasional: Promo Produk sudah pre-approved by owner (setting in advance), tidak masuk hitungan gate
- Item #4 threshold config, RPC signature, dan flow **TIDAK berubah**

### 7.2 Modul Penjualan (Sales Order) non-kasir

**MVP:** auto-promo TIDAK di-apply di SO.

**Rasional:** SO biasanya B2B negosiasi khusus per customer, auto-apply consumer-retail promo bisa konflik. YAGNI.

**Defer alternative:** tambah toggle di Pengaturan → "Terapkan Promo Produk di Penjualan (SO)?" default OFF.

### 7.3 Modul Faktur / Invoice

**MVP:** karena SO tidak pakai auto-promo, Faktur juga tidak.

**Kasir receipt:** `promo_snapshot` bisa di-tampilkan sebagai line "Promo Produk" di receipt printer — **DEFER MVP** (data ada, template update di iteration selanjutnya).

### 7.4 Laporan Penjualan

- Revenue per-SKU tetap = `qty × unit_price - line_discount_amount` (line_discount_amount include auto-promo)
- Aggregate angka tetap benar tanpa perubahan report code
- **Defer:** panel breakdown "diskon dari Promo Produk vs Diskon Nota"

### 7.5 COGS / harga modal

**Effect:** TIDAK ADA. Promo hanya potong revenue. Gross margin per line = `line_net - qty × harga_modal`.

### 7.6 Realtime kasir wizard vs owner edit

**Skenario race:** kasir buka wizard jam 10:00, cache promo termasuk MCB-32A = 15%. Jam 10:05 owner ganti jadi 20%. Jam 10:07 kasir submit.

**Behavior:** kasir display + charge 15% (cache stale). Backend snapshot 20% (kondisi DB terbaru). Mismatch minor, audit-visible.

**Frequency:** rare. **MVP:** tolerate, dokumentasi.

**Defer:** wizard subscribe realtime `stocks` UPDATE untuk SKU di cart → refresh cache.

### 7.7 Multi-tenant + platform_admin

- Owner tenant X tidak bisa lihat promo tenant Y (RLS `p_select_own` enforce)
- Platform admin via `p_platform_admin_readall` bisa read cross-tenant (no write)
- New tenant onboarding: tidak butuh seed (kolom promo NULL default). Fitur langsung available begitu owner buka Pengaturan → Diskon → Promo Produk

### 7.8 Data preservation

- SKU dihapus → kolom promo hilang ikut baris. `kasir_transaction_items.promo_snapshot` untuk sale historis tetap ada (immutable)
- Owner hapus promo (`upsert_stock_promo` dengan NULL) → kolom reset NULL. Sale historis dengan `promo_snapshot != NULL` tetap ada
- Tenant di-suspend/archived → stocks + promo tidak diubah

### 7.9 Impact analysis

**Direct importers:**
- `CatatPenjualanWizard.tsx` — panggil `list_active_promos` on mount, apply per line (1 file, additive)
- `ProdukStokTable.tsx` — tambah 2 kolom + inline edit (existing file modify)
- Dashboard main page — tambah `PromoProdukCard` (additive)
- Sidebar/routing config — tambah entries (additive)
- `ApprovalRulesPanel.tsx` — filter out `kasir_discount` row (existing modify)

**Indirect callers:**
- `record_kasir_sale` — 1 call site (`CatatPenjualanWizard`), signature unchanged
- `check_kasir_discount_gate` — 1 call site (`CatatPenjualanWizard`), signature unchanged

**Tests:** no existing test file. Manual smoke via MCP chrome di prod-testing tenant + rollback-marker SQL smoke.

**DB touchpoints:**
- `stocks` (read + write kolom promo baru)
- `kasir_transaction_items` (write `promo_snapshot`)
- `product_categories` (read only)

**Verdict:** 5 call sites modify (semua additive), 0 signature breaking, 3 DB touchpoints, 0 existing test. Plan cover semua.

---

## 8. Multi-tenant scalability

### 8.1 Existing tenants

1. **Migration `stocks` ADD COLUMN default NULL** — Postgres 12+ handle instant (metadata-only, no rewrite). Aman di semua tenant tanpa lock
2. **CHECK constraints via `DO $$ IF NOT EXISTS $$` guard** — safe re-run; untuk table besar (10M+ rows), pakai `NOT VALID` + `VALIDATE CONSTRAINT` di transaction terpisah (Garindo 494 SKU trivial, tapi tenant besar nanti aman)
3. **Backfill: TIDAK ADA.** Existing rows tetap NULL = no promo. Semantic aman
4. **Tidak butuh per-tenant seed row.** Beda dari Item #4 (`approval_settings` seed) — di sini kolom nullable, opt-in per SKU

### 8.2 New tenants (self-service onboarding)

- Tidak butuh trigger/hook di onboarding flow — tenant baru punya kolom promo kosong via `INSERT INTO stocks`
- Owner tenant baru buka Pengaturan → Diskon → Promo Produk langsung available, no setup

### 8.3 Query scalability

- **Index `idx_stocks_active_promo (tenant_id, promo_expires_at) WHERE promo_discount_type IS NOT NULL`** — partial; tenant 100K SKU, 500 promo aktif → index only 500 rows
- **RLS predicate hits index** — semua query filter `tenant_id` first, index leading column match
- **`list_active_promos` cap `LIMIT 5000`** — guard tenant besar. Payload ~500KB acceptable
- **`get_promo_summary` aggregate** — indexed count, cheap

### 8.4 RPC concurrency

- `upsert_stock_promo` update 1 row `stocks` — row-level lock only, no contention
- `bulk_upsert_stock_promo` — iterasi per-SKU, cap 500 = max 500 row-level locks singkat, no deadlock
- `record_kasir_sale` behavior change (read stocks untuk snapshot) — no `FOR SHARE` lock; kalau owner ubah promo persis saat kasir submit, snapshot pakai kondisi setelah update — still valid

### 8.5 Storage curve

- `stocks` +5 kolom: ~40 bytes/row extra (jsonb-free, nullable). Tenant 10K SKU = +400KB. Trivial
- `kasir_transaction_items.promo_snapshot` JSONB NULL untuk sale tanpa promo. Sale dengan promo ~100 bytes. Tenant 1M transactions/tahun × 30% promo = ~30MB/tahun. Absorbed

### 8.6 Partition-ready

- `stocks` bukan hot table — TIDAK butuh partition. PK shape existing `(tenant_id, sku)` sudah partition-ready
- `kasir_transaction_items` hot table. Kalau nanti partition by `(tenant_id, transaction_date)`, kolom `promo_snapshot JSONB` NULL kompatibel (no PK shape change)

### 8.7 Cost curve

- No new paid API. No new service upgrade
- Per-tenant $/bulan flat. Superlinear risk: none
- **$/tenant/month impact: ~$0**, absorbed existing Supabase + Cloud Run

### 8.8 Idempotency

- `ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
- CHECK constraint pakai `DO $$ IF NOT EXISTS $$` guard
- RPCs pakai `CREATE OR REPLACE FUNCTION`
- Re-run safe

### 8.9 Reversibility rating

- **Semi-reversible** — kolom bisa di-drop, RPC bisa di-drop. Data audit `promo_snapshot` di transactions historis tetap ada (metadata, non-destructive)
- Ceiling 10× scale (~10K tenants, ~100M rows): OK — index dan queries linear per tenant
- Hot path indexed: ya (partial index)
- Partition-ready: ya (existing PK shape)
- Idempotent write: ya
- Long ops: none (semua synchronous < 1s)

---

## 9. Edge cases + validasi

### 9.1 Validasi RPC-layer summary

| RPC | Validasi |
|-----|----------|
| `upsert_stock_promo` | SKU exist di tenant · type ∈ {PERCENT,AMOUNT} · PERCENT 0.01–100 · AMOUNT > 0 AND ≤ stocks.price · expires_at NULL atau > now() |
| `bulk_upsert_stock_promo` | array length ≤ 500 · deduplicate · per-SKU tolerant · return status per row |
| `list_active_promos` | filter invalid → fallback 'active' · LIMIT 5000 |
| `get_promo_summary` | tenant scope via `_resolve_tenant_id` |
| `record_kasir_sale` | no signature change; behavior enrich only |

### 9.2 Edge cases user-facing

| # | Skenario | Handling |
|---|----------|----------|
| **1** | Promo AMOUNT Rp 5.000/unit, owner turunkan harga jadi Rp 3.000 | Kasir wizard skip promo di line itu + toast warning "Promo Rp 5.000/unit tidak nempel di [SKU] karena harga sekarang Rp 3.000. Owner perlu update promo." Backend snapshot tetap catat config, `line_discount = 0` (fail-safe) |
| **2** | Customer beli 2× SKU sama di 2 baris cart terpisah | Line independen, promo apply per line, sum di subtotal normal |
| **3** | Kasir cache stale (owner ubah promo saat kasir buka wizard) | Kasir display + charge pakai cache lama; backend snapshot pakai kondisi DB saat submit (mismatch minor, audit-visible) |
| **4** | Owner set expiry di masa lalu | RPC reject "Tanggal berakhir harus di masa depan" |
| **5** | Bulk apply, 1 dari 500 SKU gagal | Modal → toast "499 berhasil, 1 gagal" + expandable detail |
| **6** | Owner hapus produk yang punya promo aktif | Row DELETE → kolom promo ikut hilang. Sale historis tetap (`promo_snapshot` immutable) |
| **7** | Kasir input Diskon Nota + Promo Produk bareng | Item #4 gate cek pakai `discount = diskon_nota`, `subtotal = post-promo subtotal`. 2 layer terlacak di sale record |
| **8** | Scan barcode berkali-kali (5× sama SKU) | Reuse existing wizard behavior (kalau merge ke qty=5 atau split 5 lines) |
| **9** | Tenant baru, belum ada SKU | Promo Produk page empty state, Dashboard card hidden |
| **10** | Expiry di masa depan jauh (2030-12-31) | Accepted; filter "expiring_7d" skip, filter "aktif" include |
| **11** | Print receipt / PDF invoice | **DEFER MVP** — sale record punya data, PDF template update di iteration selanjutnya |

---

## 10. Smoke tests + rollback

### 10.1 Stage 1 — Local verification

1. `npm run lint` clean
2. `npm run audit:numinput` + `npm run audit:secdef-null-tenant` clean (untuk 5 RPC baru)
3. `npx vitest run --changed` — no existing test file
4. UI check via `npm run dev`:
   - `/pengaturan/diskon` landing 2 card
   - `/pengaturan/diskon/promo-produk` — list, tambah, edit, bulk, delete
   - `/pengaturan/diskon/aturan-nota` — Item #4 config post-restructure masih kerja
   - `/produk-stok` — kolom baru + inline edit promo
   - `/kasir` — CatatPenjualan wizard cart line auto-apply
   - Dashboard — card baru tampil kalau ada promo, hidden kalau tidak
5. Console clean, network 200

### 10.2 SQL smoke — rollback-marker pattern

Per memory `smoke_test_security_definer_rpcs`:

```sql
DO $$
DECLARE
  v_tenant UUID := (SELECT id FROM tenants WHERE slug='garindo-jaya-panel');
  v_user   UUID := (SELECT id FROM auth.users LIMIT 1);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  -- test upsert
  PERFORM upsert_stock_promo('MCB-32A', 'PERCENT', 15, '2026-12-31'::timestamptz);
  ASSERT (SELECT promo_discount_type FROM stocks
          WHERE sku='MCB-32A' AND tenant_id=v_tenant) = 'PERCENT';

  -- test AMOUNT validation reject
  BEGIN
    PERFORM upsert_stock_promo('KBL-2.5', 'AMOUNT', 999999, NULL);
    RAISE EXCEPTION 'expected failure';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- test bulk tolerant
  PERFORM * FROM bulk_upsert_stock_promo(
    ARRAY['MCB-32A','MCB-16A','NONEXISTENT-SKU'],
    'PERCENT', 10, NULL);

  -- test list + summary
  ASSERT (SELECT COUNT(*) FROM list_active_promos('active')) >= 2;
  ASSERT (SELECT total_active FROM get_promo_summary()) >= 2;

  RAISE EXCEPTION 'rollback-marker: smoke test complete';
END $$;
```

### 10.3 Stage 2 — Deploy prod

- `git push main` → cloudbuild.frontend.yaml → Cloud Run --no-traffic → tag URL smoke → 100% traffic

### 10.4 Stage 3 — Prod smoke di prod-testing tenant

Per memory `production-testing-tenant` (Toko Jaya Makmur):

1. Login sebagai owner Toko Jaya Makmur
2. Setup 3 SKU: 1 PERCENT, 1 AMOUNT, 1 dengan expiry 7 hari
3. Buka kasir wizard → cart 3 SKU → verify promo nempel per line
4. Add Diskon Nota > threshold → verify Item #4 flow trigger (waiting banner + inbox)
5. Owner approve dari inbox → kasir submit → verify sale record + `promo_snapshot` di kasir_transaction_items
6. Bulk apply promo ke 5 SKU → verify list refresh
7. Dashboard card render 3 metric benar
8. Restructure Pengaturan menu — verify `Aturan Diskon Nota` di grouping baru masih save + read config

### 10.5 Post-migration advisor check

Per CLAUDE.md:
- `mcp__plugin_supabase_supabase__get_advisors` setelah slot 120-125 apply
- Flag missing index / RLS / SECDEF gap sebelum promote 100% traffic

### 10.6 Rollback plan

- **Frontend bug pasca-deploy**: revert Cloud Run revision ke previous tag → traffic 100% previous. DB kolom tetap ada (nullable, harmless)
- **Data corruption critical**: `ALTER TABLE stocks DROP COLUMN promo_*` — cadangan, tidak recommended kecuali disaster

---

## 11. Observability

Per CLAUDE.md observability requirement untuk new user-facing feature.

### 11.1 Entry logs

- `upsert_stock_promo` → `{tenant_id, user_id, feature: 'promo_produk', action: 'upsert', sku, type, value, has_expiry}`
- `bulk_upsert_stock_promo` → `{..., action: 'bulk_upsert', n_skus, n_success, n_failed}`
- `list_active_promos` → `{..., action: 'list', filter}`
- `record_kasir_sale` line dengan promo → structured audit log existing pattern extension

### 11.2 Error path logs

- Validation reject → `{feature: 'promo_produk', error_code: 'INVALID_INPUT', reason}`
- Bulk partial fail → per-SKU error logged

### 11.3 Usage counter (query-based)

- SKU adoption per tenant: `SELECT COUNT(*) FROM stocks WHERE promo_discount_type IS NOT NULL GROUP BY tenant_id`
- Promo effectiveness: `SELECT COUNT(*) FROM kasir_transaction_items WHERE promo_snapshot IS NOT NULL` per periode
- No new metric infra needed

---

## 12. Open items / deferred

Setelah Item #4b MVP ship:

1. **Category-level default cap** — data model `product_categories` sudah exist; add kalau owner minta setup fewer clicks
2. **CSV bulk import** — MVP pakai bulk-select toolbar; CSV nunggu owner complain
3. **Auto-apply Promo Produk di SO / Faktur** — kalau tenant B2C juga pakai SO module
4. **Realtime cache refresh kasir wizard** — subscribe `stocks` UPDATE untuk SKU di cart
5. **PDF receipt / invoice template update** untuk breakdown "Promo Produk: -Rp X" line
6. **Customer-tier promo** (VIP dapat promo berbeda) — needs customer segmentation
7. **Time-of-day / weekend promo** — schedule-based auto-apply
8. **Volume-based tier** (buy 100+ get 20%) — auto-apply berdasarkan qty
9. **Laporan breakdown** "Diskon dari Promo Produk vs Diskon Nota" per periode
10. **Historical migration** dari sale record lama (pra Item #4b) — tidak perlu, snapshot forward-only

---

## 13. Reversibility rating

| Rating | Ini feature | Rasional |
|--------|-------------|----------|
| **Reversible / tactical** | ✓ untuk ADD COLUMN + RPC | Kolom nullable, RPC drop-able tanpa data loss (kecuali promo_snapshot audit trail) |
| **Semi-reversible** | ✓ untuk `record_kasir_sale` behavior change | Behavior change additive; kalau revert, snapshot di-populate NULL, sale flow unchanged |
| **Irreversible** | ✗ | Tidak ada decision arsitektural yang irreversible; PK shape existing tenant-scoped, tidak butuh advisor memo |

Per CLAUDE.md scale-forward architecture: reversibility = tactical / semi. Tidak butuh design memo terpisah (`docs/superpowers/specs/YYYY-MM-DD-<slug>-decision.md`). Advisor call sebelum commit tetap dijalankan per CLAUDE.md diff-size trigger (diff akan >100 lines, ~10 files).

---

## 14. Success criteria

Feature dikatakan berhasil kalau:

1. Owner Garindo bisa setup ≥5 promo aktif via Promo Produk page
2. Kasir wizard tampil "🏷 Promo Produk: X% = -Rp Y" per line SKU yang punya promo
3. `promo_snapshot` di-populate benar di `kasir_transaction_items` setelah sale
4. Item #4 gate masih trigger untuk Diskon Nota > threshold (post-promo subtotal)
5. Dashboard card render 3 metric correct
6. Restructure Pengaturan menu → `Aturan Diskon Nota` (dari Item #4) tetap kerja normal
7. Multi-tenant: bikin tenant test baru, verify fitur langsung available tanpa seed
8. Advisor check post-migration: no critical finding

---

**End of spec.**
