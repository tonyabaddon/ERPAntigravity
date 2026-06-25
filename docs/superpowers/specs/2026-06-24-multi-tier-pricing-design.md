# Multi-Tier Pricing (Eceran + Grosir) — Design Spec

**Date:** 2026-06-24
**Author:** brainstorm session (founder + Claude)
**Status:** Approved sections 1–5, awaiting user review of full spec.

---

## 1. Goal & Context

Enable toko ber-SOP **distributor B2B campur retail** (target: toko LTC Glodok jenis Garindo Jaya Panel, penjual CCTV, komponen elektronik) untuk menjalankan dua tingkat harga — **Eceran** (walk-in) dan **Grosir** (reseller terdaftar) — dalam satu sistem, configurable per-tenant.

**Trigger:** audit configurability ERP Antigravity (2026-06-24). User memilih fokus onboarding tenant baru tipe LTC Glodok. Multi-tier pricing diidentifikasi sebagai **gap struktural paling kritis** (Tier 3 X dalam audit). Tanpa fitur ini, kasir nego ad-hoc → audit log berisik, margin tidak konsisten, reseller besar tidak punya jalur otomatis.

**Tenant target persona:** toko hybrid B2C+B2B di Glodok yang punya 50–200 SKU, customer mix walk-in dominan + 10–50 reseller terdaftar.

**Note tentang memori:** memori `feedback_phase2_defer_sop_profile.md` (defer SOP-preset picker) di-konteks-spesifik-relaxed di sini — preset profile masih defer, tapi fitur per-knob untuk onboarding tenant tipe baru kita lakukan. Memori akan di-update di akhir sesi untuk mencatat shift ini.

---

## 2. Scope

### In scope (Phase 1):
- Schema: 2-tier hardcoded (`price_eceran` + `price_grosir`) di tabel `products`
- Customer `default_pricing_tier` flag
- Tenant toggle `modul_multi_tier_price`
- Transaction snapshot column `pricing_tier_used`
- UI: Pengaturan tab, Master Produk, Master Customer, Kasir cart, Wizard Step 2
- RPC update: `record_kasir_sale`, `create_tempo_invoice`
- **Bulk CSV update grosir prices** (download template → preview → atomic apply + audit log)
- cascadeMap entry untuk modul switch (cascade hide/show UI)

### Out of scope (defer):
- Quantity-based auto-tier (≥N pcs auto-grosir)
- Customer-specific per-SKU custom pricing
- Tier 3+ (Distributor, sub-distributor)
- Bulk CSV update `price_eceran` (sensitif, butuh approval workflow)
- Excel (.xlsx) upload — CSV only
- Reporting "margin by tier" lengkap
- Scheduled/cron import
- Preset onboarding wizard (separate spec kalau dibutuhkan)
- Multi-tier untuk pembelian (PI side) — irrelevant, single price per supplier

---

## 3. Schema Changes

**Database reality check (2026-06-24):** product master table di proyek ini adalah `stocks` (PK=`sku` text), bukan `products`. `customers.id` adalah text. Transaction line items tersimpan sebagai JSONB di `kasir_transactions.items` dan `orders.items` — TIDAK ada child tables `order_items` / `kasir_transaction_items`. Spec ini disesuaikan dengan kondisi tersebut.

### 3.1 `stocks` table (product master)
```sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS price_grosir NUMERIC(14,2) NULL;

COMMENT ON COLUMN public.stocks.price_grosir IS
  'Harga jual tier grosir. NULL = fallback ke price (eceran) saat transaksi tier=grosir, dengan warning UI.';
```

**Note:** kolom `price` existing tetap = harga eceran (backward-compatible, tidak di-rename). UI label-kan sebagai "Harga Eceran" saat modul ON.

### 3.2 `customers` table
```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_pricing_tier TEXT NOT NULL DEFAULT 'eceran';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customers_default_pricing_tier_check') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_default_pricing_tier_check
      CHECK (default_pricing_tier IN ('eceran','grosir'));
  END IF;
END $$;
```

### 3.3 `tenant_settings` table
```sql
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS modul_multi_tier_price BOOLEAN NOT NULL DEFAULT FALSE;
```

Default FALSE → existing tenant (Garindo) tidak terpengaruh tanpa explicit opt-in.

### 3.4 Transaction snapshot (JSONB key, bukan column)

`kasir_transactions.items` dan `orders.items` adalah JSONB array. Tier snapshot ditaruh sebagai key di tiap line object:

```jsonc
{
  "sku": "...",
  "qty": 5,
  "unit_price": 80000,
  "master_price_at_sale": 80000,
  "pricing_tier_used": "grosir"   // baru — null/absent untuk transaksi pre-feature
}
```

**Tidak ada ALTER TABLE** untuk snapshot — pure JSONB key. Validasi via CHECK pada RPC (Task 6 + 8).

### 3.5 Audit ledger (untuk CSV bulk update)

```sql
CREATE TABLE IF NOT EXISTS public.product_price_audit (
  id           BIGSERIAL PRIMARY KEY,
  sku          TEXT NOT NULL REFERENCES public.stocks(sku),
  field        TEXT NOT NULL,
  old_value    NUMERIC(14,2),
  new_value    NUMERIC(14,2),
  source       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_price_audit_field_check') THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_field_check CHECK (field IN ('price','price_grosir'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='product_price_audit_source_check') THEN
    ALTER TABLE public.product_price_audit
      ADD CONSTRAINT product_price_audit_source_check CHECK (source IN ('manual_edit','bulk_csv','rpc'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_price_audit_sku_time
  ON public.product_price_audit(sku, created_at DESC);
```

Audit FK ke `stocks(sku)` karena schema ini tidak punya `products(id)`.

---

## 4. UI Changes

### 4.1 Pengaturan → Modul & Jasa tab
**File:** `src/components/pengaturan/ModulSwitchesPanel.tsx`

Append ke `MODULS` array:
```ts
{ key: 'modul_multi_tier_price', icon: '💵',
  title: 'Modul Multi-Tier Pricing',
  description: 'Aktifkan harga grosir terpisah dari eceran. Customer dapat di-tag tier default.' },
```

### 4.2 `cascadeMap.ts`
**File:** `src/lib/pengaturan/cascadeMap.ts`

Tambah `FieldKey`:
```ts
| 'tier_pill_kasir' | 'tier_dropdown_customer'
| 'price_grosir_column' | 'csv_bulk_grosir_button'
```

`isFieldVisible` switch tambahan:
```ts
case 'tier_pill_kasir':
case 'tier_dropdown_customer':
case 'price_grosir_column':
case 'csv_bulk_grosir_button':
  return settings.modul_multi_tier_price;
```

### 4.3 Master Produk (`StockManagerScreen.tsx`)
- Kolom tabel: kalau modul ON → tampilkan **Harga Eceran** + **Harga Grosir** (2 kolom). Kalau OFF → tampilkan **Harga** saja (existing behavior).
- Edit row form: 2 input numeric saat modul ON. Validasi warn (not block) kalau `price_grosir > price_eceran`.
- Highlight badge kuning "⚠ Belum di-set" kalau `price_grosir IS NULL` saat modul ON.
- Toolbar baru: button **"Update Harga Grosir (CSV)"** (visible kalau modul ON via `isFieldVisible('csv_bulk_grosir_button')`).

### 4.4 Master Customer (`PelangganScreen.tsx`)
- Form create/edit customer: kalau modul ON → dropdown "Tier Default Harga: Eceran / Grosir" (default Eceran).
- Tabel customer: tambah kolom "Tier" (pill badge) kalau modul ON.
- Filter list: filter by tier (eceran/grosir/all).

### 4.5 Kasir cart (`KasirScreen.tsx`)
- Header cart: pill toggle `[Eceran | Grosir]` kalau modul ON.
- Initial state: dari `customer.default_pricing_tier` saat customer dipilih; walk-in default eceran.
- Switch toggle → semua line re-compute harga ke tier baru + record `pricing_tier_used` per line.
- Snapshot logic: `master_price_at_sale = (tier === 'grosir' ? COALESCE(price_grosir, price) : price)`.

### 4.6 Wizard Catat Penjualan Step 2 (`Step2Items.tsx`)
- Sama dengan kasir: pill toggle `[Eceran | Grosir]` di atas line items.
- Auto-apply tier saat customer dipilih di Step 1.
- Switch toggle = re-compute semua line.

### 4.7 Invoice / Struk PDF
- Tidak ada label "Eceran/Grosir" di customer-facing print (privacy). Tier dicatat di metadata invoice + system reporting saja.

---

## 5. RPC Changes

### 5.1 `record_kasir_sale`
**File:** `supabase/migrations/20260901000004_record_kasir_sale_tier.sql`

Tambah ke payload per-line item:
```jsonc
{
  "sku": "...",
  "qty": ...,
  "unit_price": ...,
  "master_price_at_sale": ...,
  "pricing_tier_used": "eceran" | "grosir" | null  // baru
}
```

Server logic:
- Kalau `modul_multi_tier_price = FALSE` di tenant_settings → field diabaikan (tetap dipersist sebagai NULL).
- Kalau ON:
  - Validate: `pricing_tier_used IN ('eceran','grosir')` per item.
  - Validate: `master_price_at_sale` matches `products.price` (eceran) atau `COALESCE(products.price_grosir, products.price)` (grosir). Tolerance: ±0 (strict; markup tetap dilarang).
  - INSERT `kasir_transaction_items.pricing_tier_used`.

### 5.2 `create_tempo_invoice`
Sama dengan 5.1, target tabel `order_items`.

### 5.3 RPC baru: `bulk_update_grosir_price(p_rows JSONB)`
**File:** `supabase/migrations/20260901000006_bulk_update_grosir_price.sql`

Payload:
```jsonc
{
  "rows": [
    {"sku": "GAR-001", "price_grosir": 1200000},
    {"sku": "GAR-002", "price_grosir": 850000}
  ]
}
```

Logic (SECURITY DEFINER):
1. Validate auth: caller role = 'Owner' OR 'Admin Stok' (via `auth.uid()` → admin_users lookup).
2. Loop rows:
   - Validate SKU exists (skip + log if not).
   - Validate `price_grosir` numeric, > 0.
   - UPDATE `products.price_grosir`.
   - INSERT `product_price_audit` (source='bulk_csv', actor, old, new).
3. ATOMIC: wrap dalam BEGIN…COMMIT; rollback all kalau ada exception non-skip (e.g., DB error). Skipped rows (SKU not found, invalid format) tidak rollback — di-return sebagai array.
4. Return:
```jsonc
{
  "applied": 24,
  "skipped": [
    {"sku":"X-999","reason":"sku_not_found"},
    {"sku":"GAR-005","reason":"price_not_numeric"}
  ]
}
```

---

## 6. Bulk CSV Upload — UI & Flow

### 6.1 File: `src/components/produk/BulkUpdateGrosirSection.tsx` (NEW)

Sibling dari `BulkUploadSection.tsx`. Reuse pattern download-template + upload tetapi flow-nya UPDATE, bukan CREATE.

### 6.2 Template generator
Button "Download Template Harga Grosir" → generate CSV dari current stockList:
```csv
sku,nama,price_eceran,price_grosir_lama,price_grosir_baru
GAR-001,Panel Box 60x40,850000,720000,
GAR-002,MCB Schneider 16A,45000,,
GAR-003,Kabel NYM 2.5,380000,310000,
```

Kolom:
- `sku` (read-only ref)
- `nama` (read-only ref — bantu admin verify)
- `price_eceran` (read-only ref)
- `price_grosir_lama` (read-only ref; kosong kalau belum di-set)
- `price_grosir_baru` (admin isi; kosong/blank = skip row)

### 6.3 Upload + Preview dialog
1. Admin pilih file `.csv` → parse client-side (existing Papa pattern atau manual).
2. Tampilkan modal preview:
   - Tabel diff (sticky header, max 500 rows visible + paginate):
     | SKU | Nama | Eceran | Grosir Lama | Grosir Baru | Status |
   - Status badge per row:
     - 🟢 `OK` — numeric valid, ≤ eceran
     - 🟡 `WARNING_ABOVE_ECERAN` — grosir > eceran (allowed, butuh confirm checkbox di footer)
     - 🟡 `SKIP_SKU_NOT_FOUND` — SKU bukan di master
     - 🟡 `SKIP_INVALID_FORMAT` — bukan numeric / negatif
     - 🔵 `NO_CHANGE` — grosir_baru = grosir_lama (atau blank)
   - Summary panel: "X akan diupdate, Y skipped, Z warning"
3. Footer dialog:
   - Checkbox "Saya konfirmasi update harga grosir di atas eceran" (enabled kalau ada WARNING_ABOVE_ECERAN; disable Apply button kalau unchecked).
   - Button "Apply" (primary) + "Batal" (secondary).
4. Apply:
   - Call RPC `bulk_update_grosir_price` dengan rows valid only (status OK + WARNING_ABOVE_ECERAN).
   - Spinner di button.
   - Result toast: "✅ 24 produk berhasil diupdate; 3 skipped" + opsi "Lihat log" → navigate ke audit log filter.
5. Refresh stockList parent.

### 6.4 Audit log surfacing
- Akses log: Persetujuan / Audit screen → tab baru "Harga Audit" (kalau modul ON) dengan filter SKU + date range.
- (Phase 1: minimal viewer; advanced filter Phase 2.)

---

## 7. Migration & Rollout

### 7.1 Migration order (idempotent, slot 20260901xxx — distant dari ongoing work):
1. `20260901000001_multi_tier_columns.sql` — schema 3.1, 3.2, 3.4
2. `20260901000002_tenant_settings_multi_tier_toggle.sql` — schema 3.3
3. `20260901000003_product_price_audit_table.sql` — schema 3.5
4. `20260901000004_record_kasir_sale_tier.sql` — RPC 5.1
5. `20260901000005_create_tempo_invoice_tier.sql` — RPC 5.2
6. `20260901000006_bulk_update_grosir_price.sql` — RPC 5.3

### 7.2 Tenant Garindo (existing)
- Migration apply; modul tetap OFF default → no behavior change.
- Founder bisa nyalakan kalau mau dual-price.

### 7.3 Tenant baru (LTC Glodok onboarding)
- Saat onboarding (manual via Pengaturan): nyalakan `modul_multi_tier_price`.
- Admin masuk ke Master Produk → toolbar "Update Harga Grosir (CSV)" → download template → isi → upload.
- Customer reseller existing: bulk-set `default_pricing_tier = 'grosir'` via Master Customer (Phase 1: edit satu per satu; CSV bulk untuk customer = defer Phase 2).

### 7.4 Rollback
- Modul switch OFF → UI semua hide; data `price_grosir` + `default_pricing_tier` + `pricing_tier_used` tetap tersimpan (soft-hide pattern).
- Re-enable: data kembali muncul.

---

## 8. Configurability (cascadeMap impact)

```ts
// cascadeImpactSummary tambahan:
case 'modul_multi_tier_price':
  if ((stats.tierEnabledCustomerCount ?? 0) > 0)
    return { level: 'warn',
      message: `${stats.tierEnabledCustomerCount} customer ter-tag grosir akan kembali jadi harga eceran; CSV log tetap tersimpan` };
  return { level: 'info', message: 'Belum ada customer grosir — aman dimatikan' };
```

---

## 9. Reporting

Phase 1 minimal:
- Laporan Penjualan existing → tambah optional filter "Tier" (Eceran/Grosir/All) kalau modul ON.
- Drill-down sales-by-tier breakdown — defer Phase 2.

---

## 10. Open Questions / Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Customer pindah tier (eceran→grosir) — historical invoice harus tetap pakai tier lama | `pricing_tier_used` snapshot per line + `master_price_at_sale` snapshot. Tidak rewrite historical. |
| 2 | Admin upload CSV salah → harga grosir kacau | (a) preview dialog wajib confirm; (b) audit ledger ada old_value untuk manual rollback; (c) Phase 2: dry-run mode tanpa apply. |
| 3 | Markup violation: kasir input harga > grosir tier | RPC `record_kasir_sale` tetap reject MARKUP_NOT_ALLOWED (cek vs `master_price_at_sale`). |
| 4 | `price_grosir IS NULL` saat tier=grosir di kasir | Fallback ke `price` (eceran) + UI banner kuning "Harga grosir belum di-set; pakai eceran". |
| 5 | Customer ter-tag grosir tapi nyatanya beli 1 pcs untuk konsumsi pribadi | Kasir bebas switch tier ke eceran (decision section 3 sebelumnya). Audit log tercatat. |
| 6 | Effort multi-tier menyita waktu Garindo development | Modul default OFF; Garindo tidak ke-touch. |

---

## 11. Effort Estimate

| Item | Effort |
|---|---|
| Schema migrations (6 file) | 0.5 hari |
| RPC `record_kasir_sale` + `create_tempo_invoice` tier param | 1 hari |
| RPC `bulk_update_grosir_price` + audit ledger | 1 hari |
| Pengaturan ModulSwitchesPanel + cascadeMap | 0.5 hari |
| Master Produk UI (kolom + edit form + warning) | 1 hari |
| Master Customer UI (dropdown + filter) | 0.5 hari |
| Kasir cart + Wizard Step 2 pill toggle + re-compute | 1.5 hari |
| BulkUpdateGrosirSection (template + preview + apply) | 2 hari |
| Audit log viewer (minimal) | 0.5 hari |
| RTL unit tests + RPC smoke tests | 1.5 hari |
| Integration test (kasir tier switch, CSV upload, modul toggle) | 1 hari |
| **TOTAL** | **~11 hari (2-2.5 minggu) — single developer** |

---

## 12. Acceptance Criteria

- [ ] Migration apply clean (idempotent rerun OK).
- [ ] Tenant Garindo: modul OFF → tidak ada perubahan visible di UI; semua test existing PASS.
- [ ] Tenant baru: nyalakan modul → Master Produk muncul kolom Grosir; download CSV template; upload + preview + apply; harga ter-update di DB; audit log tercatat.
- [ ] Customer ter-tag grosir → di kasir auto-pakai harga grosir.
- [ ] Walk-in (no customer) → auto-pakai eceran.
- [ ] Switch tier di kasir → re-compute semua line + log per-line.
- [ ] Invoice/Struk PDF tidak expose tier (privacy).
- [ ] Modul OFF kembali → UI hide; data tersimpan; re-enable → muncul lagi.
- [ ] CSV upload: SKU not-found → skip + report; grosir > eceran → warning + checkbox confirm.
- [ ] `npm run lint` + `npm test` PASS.
- [ ] Founder smoke test manual: jalan dev server, end-to-end kasir + CSV scenario.

---

## 13. Decisions Locked (from brainstorming 2026-06-24)

1. Fixed 2 tier hardcoded (Eceran + Grosir), bukan configurable count.
2. Auto-apply tier berdasarkan `customer.default_pricing_tier`. Walk-in → eceran.
3. Kasir/admin boleh switch tier bebas, no approval, audit-logged.
4. Modul toggle default OFF; tenant baru opt-in saat onboarding.
5. CSV bulk update grosir prices = Phase 1 (NOT defer).
6. CSV update eceran = defer Phase 2 (sensitif).
7. Soft-hide on modul OFF; data tersimpan.
8. Pajak/PPN per-tier = TIDAK ada interaksi; pajak_mode tenant tetap global (separate concern).
