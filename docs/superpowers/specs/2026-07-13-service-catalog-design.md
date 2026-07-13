# Service Catalog: BOM-Backed Custom Panel & Wiring Design

**Date:** 2026-07-13
**Author:** Founder (tonywei) + Claude
**Status:** Draft — awaiting founder review before implementation
**Item ID:** #2 (Custom Panel + Jasa Wiring BOM re-architecture)

---

## Context

Garindo Jaya Panel adalah distributor listrik + panel manufacturer. Bisnis mereka mencakup:
- Wiring Panel dengan komponen (material Garindo) → panel MDB / SDP / control panel
- Wiring labor-only (customer bawa material sendiri)
- Custom panel dengan ukuran / spec bespoke

**Current state** (verified 2026-07-13 via codebase exploration):
- `service_types` table (mig 20260622000004) hardcode 2 entries: `custom_panel`, `wiring_panel`
- `rakit_job_lines` + `rakit_components` tables (mig 20260608000008) capture service line + component tracking
- `order_type_enum: KOMPONEN / CUSTOM_PANEL / RAKIT_PANEL` (mig 20260625000001)
- `record_kasir_sale` (mig 20260610000001) accepts `sku=null` service lines with owner-typed HPP

**Gap**:
1. Tidak ada BOM master reusable → owner setup manual per order
2. Component stock TIDAK auto-decrement waktu deliver → stock invalid
3. HPP owner-ketik manual → margin salah, laporan tidak reliable
4. COA belum ada Pendapatan Jasa + Beban Tenaga Kerja Rakit → revenue/cost sekarang keliru masuk 4-1100 Penjualan generic
5. Tidak scalable across MSME types (hardcoded 2 service types)

**Scale target**: MVP direct value untuk Garindo hari ini, dengan arsitektur configurable + tenant-scoped supaya tenant baru (bakery, bengkel, dll) bisa join tanpa migration nyakitin.

---

## Design Overview

Introduce a **Service Catalog** — tenant-configurable per-tenant service master with optional BOM linkage to master stok. Sales flow attach service ke order, BOM snapshot dikunci at commit, FIFO stock decrement + HPP calculation + JE post triggered saat deliver.

### Core concepts

- **Service Catalog Entry**: master service definition per tenant (nama, kategori, labor default, BOM optional, invoice display, COA mapping).
- **BOM (Bill of Materials)**: link master service ke komponen master stok (SKU + default qty).
- **Snapshot Pattern**: waktu order commit, BOM di-freeze ke `order_service_bom_snapshot` — historical order immune ke perubahan master BOM.
- **Include Material Mode**: per-service default (Yes = paket dengan material, No = labor only). Backend column siap, FE toggle di-defer sampai tenant butuh.
- **Invoice Display**: `lump_sum` (satu baris) atau `itemized` (breakdown BOM). Per-service setting, functional di MVP.
- **One-Off / Custom Size**: pattern-nya sama dengan "empty BOM entry" — owner setup service dengan BOM kosong, admin build ad-hoc di sales flow.

### Three Garindo scenarios (validation)

1. **Wiring paket (Garindo material)**: `service_catalog` entry "Wiring Panel MDB 100A" dengan BOM lengkap. Admin pilih → auto-populate → adjust → submit.
2. **Wiring labor-only (customer material)**: `service_catalog` entry "Jasa Wiring (Labor Only)" dengan BOM kosong. Admin pilih → isi labor amount → submit. Zero stock impact.
3. **Custom ukuran bespoke**: `service_catalog` entry "Custom Panel Box (Ukuran Custom)" dengan BOM kosong. Admin pilih → build BOM ad-hoc dari master stok → submit.

Semua 3 skenario pakai flow yang sama; beda di config service catalog + BOM editor behavior per order.

---

## Data Model

### New tables

```sql
CREATE TABLE service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,                              -- owner-defined free-text
  default_labor_amount NUMERIC(15,2) DEFAULT 0,
  default_include_material BOOLEAN DEFAULT TRUE,
  invoice_display TEXT DEFAULT 'lump_sum'
    CHECK (invoice_display IN ('lump_sum', 'itemized')),
  revenue_coa_code TEXT NOT NULL,             -- FK chart_of_accounts.account_code
  labor_cost_coa_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, name)
);
CREATE INDEX idx_service_catalog_tenant_active
  ON service_catalog (tenant_id, is_active, category);

CREATE TABLE service_catalog_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  component_sku TEXT NOT NULL,                -- FK stocks.sku
  default_qty NUMERIC(15,4) NOT NULL,
  notes TEXT,
  sort_order INT DEFAULT 0
);
CREATE INDEX idx_service_catalog_bom_service ON service_catalog_bom (service_catalog_id);
```

RLS: `p_select_own`, `p_write_own` per pattern existing (tenant-scoped via `_resolve_tenant_id()`).

### Extend existing tables (backward-compat additive)

```sql
ALTER TABLE rakit_job_lines
  ADD COLUMN service_catalog_id UUID REFERENCES service_catalog(id),
  ADD COLUMN include_material BOOLEAN DEFAULT TRUE,
  ADD COLUMN labor_amount NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN invoice_display_override TEXT
    CHECK (invoice_display_override IN ('lump_sum', 'itemized')),
  ADD COLUMN is_one_off BOOLEAN DEFAULT FALSE;

ALTER TABLE rakit_components
  ADD COLUMN service_catalog_bom_id UUID REFERENCES service_catalog_bom(id),
  ADD COLUMN unit_cost_at_delivery NUMERIC(15,4);
```

Snapshot semantics:
- **Save Order**: BOM master di-copy ke `rakit_components` (existing snapshot table). `service_catalog_bom_id` di-set kalau berasal dari master (or NULL kalau admin add ad-hoc).
- **Deliver**: `unit_cost_at_delivery` di-populate dari FIFO walk. `fifo_cost_snapshot` (existing column) di-freeze.

### Extended enum

```sql
-- Reuse existing order_type_enum: KOMPONEN / CUSTOM_PANEL / RAKIT_PANEL
-- No new enum values needed. Category free-text di service_catalog jadi generic slot.
```

### COA seed (opsional install per tenant)

```sql
INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  (v_tenant, '4-1300', 'Pendapatan Jasa Wiring', 'PENDAPATAN', 'PENDAPATAN_JASA', 'CREDIT'),
  (v_tenant, '5-2110', 'Beban Tenaga Kerja Rakit', 'BEBAN', 'BEBAN_TENAGA_KERJA', 'DEBIT')
ON CONFLICT (tenant_id, account_code) DO NOTHING;
```

Fresh tenant: 2 akun baru masuk COA default. Existing tenant (Garindo): migration idempotent seed kedua akun.

---

## RPCs

### `save_service_catalog(p_data JSONB) RETURNS UUID`

CRUD service catalog entry + BOM. Idempotent via `id` in payload (NULL = create, non-NULL = update).

Payload shape:
```json
{
  "id": null,
  "name": "Wiring Panel MDB 3-fase 100A",
  "category": "Wiring",
  "default_labor_amount": 1500000,
  "default_include_material": true,
  "invoice_display": "lump_sum",
  "revenue_coa_code": "4-1300",
  "labor_cost_coa_code": "5-2110",
  "bom": [
    { "component_sku": "MCB-3P-100A-SCHNEIDER", "default_qty": 1 },
    { "component_sku": "BUSBAR-CU-100A", "default_qty": 2 },
    ...
  ]
}
```

SECURITY DEFINER, tenant-scoped via `_resolve_tenant_id()`. Transaction atomic (service + BOM di 1 transaction).

### `soft_delete_service_catalog(p_id UUID) RETURNS VOID`

Set `is_active = false`. Historical orders yang reference tetap valid (snapshot self-contained). Cek FK di `rakit_job_lines.service_catalog_id`: kalau ada order aktif reference, warn tapi tetap soft-delete (order snapshot immune).

### `attach_service_to_order(p_order_id UUID, p_service_catalog_id UUID, p_qty NUMERIC, p_override_bom JSONB, p_override_labor NUMERIC) RETURNS UUID`

Attach service line ke existing order (kasir_transactions atau tempo order). Snapshot BOM saat call — kalau `p_override_bom` disediakan, pakai itu; kalau NULL, load default dari master `service_catalog_bom` × `p_qty`.

Idempotent atomic:
1. Validate service_catalog exists + active + tenant match
2. Insert `rakit_job_lines` dengan `service_catalog_id`
3. Insert `rakit_components` snapshot rows (dari override_bom atau default × qty)
4. Return rakit_job_line.id

### Extend `record_kasir_sale(p_service_lines JSONB DEFAULT NULL)`

Add optional param untuk kasir walk-in service line support. Backend-ready, FE UI defer (Garindo primary tempo, kasir service defer sampai bengkel/bakery tenant onboard).

### `verify_and_deliver_order(p_order_id UUID) RETURNS JSONB`

Atomic RPC waktu order status → DELIVERED:
1. For each `rakit_job_line` di order:
   - Load `rakit_components` snapshot
   - Untuk each komponen dengan sku non-null:
     - FIFO walk stock_lots → decrement × qty
     - Populate `rakit_components.unit_cost_at_delivery` = weighted FIFO cost
   - Compute total material cost = SUM(qty × unit_cost_at_delivery)
   - Compute total HPP = material cost + labor_amount
2. Post JE via `_post_journal_entry`:
   - **DEBIT** Piutang/Kas (existing) — total price
   - **CREDIT** revenue_coa_code (per service) — total price
   - **DEBIT** 5-1100 HPP Penjualan — material cost (kalau non-zero)
   - **DEBIT** labor_cost_coa_code (per service) — labor amount
   - **CREDIT** 1-1500 Persediaan — material cost
   - **CREDIT** 2-2100 Utang Gaji (or Kas kalau immediate) — labor amount
3. Update order status → DELIVERED, freeze snapshot

Returns JSONB: `{ ok, order_id, je_id, total_hpp, total_revenue }`

---

## Frontend

### Pengaturan → Layanan (new tab)

**List view:**
- Grouped by category (owner-defined)
- Card per service dengan quick actions: Edit, Nonaktif, Duplikat
- Empty state: "Belum ada layanan. Klik + Tambah Layanan untuk mulai."
- CTA: `+ Tambah Layanan Baru`

**Edit modal (reusable component):**
- Nama, kategori (free-text combobox — new atau existing category), deskripsi
- Labor default (NumberInput)
- Include material default (radio Ya/Tidak)
- Invoice display (radio Lump Sum / Itemized)
- COA mapping (2 dropdown — filtered ke akun PENDAPATAN + BEBAN)
- **BOM Editor** (reusable component):
  - Table: SKU, nama, qty default, notes, [x] hapus
  - `+ Tambah Komponen dari Master Stok` → picker modal
  - Support BOM kosong (labor-only atau custom mode)

**Reusable BOM Editor** dipakai di 2 tempat: Pengaturan (master) + Sales flow (snapshot per order).

### Sales flow — Buat Pesanan tempo

Extend existing `SalesLandingScreen` dengan tombol:
- `+ Tambah Produk Stok` (existing pattern)
- `+ Tambah Layanan` (NEW)

**+ Tambah Layanan** → modal:
1. Service picker (dropdown biasa untuk MVP — Garindo <10 services)
2. Qty
3. BOM auto-populate dari master (jika ada)
4. BOM editor: admin adjust qty / add / remove komponen (reusable component)
5. Labor amount (default dari master, editable)
6. Harga jual (default dari master atau isi manual)
7. Submit → snapshot ke `rakit_job_lines` + `rakit_components`

Kalau service master BOM kosong (skenario 2 atau 3):
- BOM editor start blank
- Admin add komponen dari master stok picker
- Backend receive full BOM at commit

### Invoice PDF renderer

Extend existing PDF renderer (`src/lib/akuntansi/pdfExport.ts` or nearby) dengan branch berdasarkan `service.invoice_display`:

- **`lump_sum`**: satu baris `"<service.name> × <qty> = <total>"`
- **`itemized`**: expand BOM detail as sub-lines dengan indent

Kalau BOM kosong (labor-only): render 1 baris "Labor" saja untuk both mode.

### Reporting → Laporan Performa (extend)

New section "Layanan" dengan:
- Table top N layanan by revenue
- Column: nama, kategori, order count, total revenue, HPP total, margin %
- Grouping option: by kategori (rollup)
- Sort: revenue DESC default

Data pakai `rakit_job_lines` + `rakit_components` snapshot (bukan join ke master — historical konsisten).

---

## Reversibility Rating

| Decision | Rating | Notes |
|---|---|---|
| New tables `service_catalog` + `_bom` | Tactical | Additive, reversible drop |
| PK `(tenant_id, id)` composite di `order_service_lines` | **IRREVERSIBLE** | Partition strategy — see decision memo |
| BOM snapshot pattern (freeze at commit) | **IRREVERSIBLE** | Contract, historical data self-contained — see decision memo |
| Extend `rakit_job_lines` schema (additive) | Semi-reversible | Column add reversible, but data written depends on new columns |
| Extend `record_kasir_sale` contract (optional param) | Semi-reversible | Backward-compat, safe forward |
| New COA seed (4-1300, 5-2110) | Semi-reversible | Owner boleh remap, tapi sekali dipakai di JE historical |
| Deprecate `service_types` | Semi-reversible | Mark unused, tidak drop untuk FK integrity |
| Configurable catalog + COA per tenant | Tactical | No global config, tenant-scoped, reversible re-setup |

Irreversible items → decision memo `docs/superpowers/specs/2026-07-13-service-catalog-decision.md`.

---

## Migration Path

1. **Migration 20261115000148**: create `service_catalog` + `service_catalog_bom` tables + RLS policies + indexes
2. **Migration 20261115000149**: alter `rakit_job_lines` + `rakit_components` add new columns (additive, DEFAULT values non-breaking)
3. **Migration 20261115000150**: RPC `save_service_catalog` + `soft_delete_service_catalog` + `attach_service_to_order` + extend `verify_and_deliver_order` + extend `record_kasir_sale` param
4. **Migration 20261115000151**: COA seed baru (idempotent, ON CONFLICT DO NOTHING) untuk Garindo tenant

Existing `service_types` table: DON'T drop (rakit_job_lines historical refs). Mark unused via comment + eventual deprecation di phase future.

Existing `rakit_job_lines` records (kalau ada di Garindo): backward-compat via view alias — new sales pakai new column, old data readable via existing UI paths.

**Zero downtime**: semua migration additive + idempotent. Rollback-safe.

---

## Scope (MVP — Value Hari Ini untuk Garindo)

### ✅ IN — Build & Ship

**Backend (semua kolom siap):**
- Tables + RPCs (7 RPCs total)
- COA seed 2 akun baru
- Extend rakit_job_lines + rakit_components schemas
- Extend record_kasir_sale contract (backward-compat)
- Extend verify_and_deliver_order — atomic FIFO + JE post
- Soft delete pattern

**Frontend (Garindo-primary UI):**
- Pengaturan → Layanan CRUD dengan BOM editor
- Buat Pesanan tempo extend dengan tombol + Tambah Layanan + BOM editor sales
- Invoice PDF — branch lump_sum + itemized (**both** kerja)
- Reporting — Laporan Performa section Layanan

**Config default per Garindo:**
- 4 service entries setup awal (Wiring Panel MDB 100A/200A/labor-only/custom-panel-box)
- Overhead: simple (owner adjust price manually, no separate overhead)
- Blank slate onboarding (no preset)
- Multi-warehouse component FIFO: `deduct_stock_fifo` walks whatever warehouse has stock (existing pattern reused, no explicit workshop warehouse setting introduced in MVP)
- Discount per line = existing pattern reused

### ⏸ DEFER — Backend siap, FE nyusul kalau ada demand

- Include material toggle UI per order (backend siap, Garindo default true)
- Kasir walk-in service line UI (backend siap, defer sampai bengkel/bakery)
- One-Off blank mode dedicated UI (workaround: owner setup "Custom Panel Box" entry BOM kosong)
- Search-as-you-type service picker (defer sampai catalog > 20)
- Kategori picker complex UI (backend free-text, hardcode "Wiring" di Garindo default)
- Discount per service line dedicated UI (existing discount pattern OK)
- Multi-warehouse component picking (single workshop cukup)
- Actual vs estimate variance report

### ❌ OUT — Tidak akan build

- Multi-currency
- Automatic labor payroll integration
- Multi-level BOM (sub-assembly)
- Substitution tracking with reason
- Warranty return workflow
- Progressive DP / partial delivery
- Time tracking actual jam
- Overhead rate per service
- Preset starter services per tenant type (per memory `feedback_phase2_defer_sop_profile`)
- Approval workflow material lock (per memory `feedback_no_approval_workflow`)
- Marketplace integration
- Service bundling/dependency
- Customer-specific negotiated pricing

---

## Success Criteria

1. Owner setup 4 service entries di Pengaturan → Layanan (Wiring Panel MDB 100A, MDB 200A, Labor Only, Custom Panel Box)
2. Admin quote 1 order untuk each 3 skenario Garindo:
   - Wiring Panel MDB 100A × 2 (paket, master BOM)
   - Jasa Wiring Labor Only × 1 (labor only, BOM kosong)
   - Custom Panel Box × 1 (ad-hoc BOM build)
3. Waktu deliver, FIFO decrement komponen berjalan otomatis
4. JE post dengan revenue → 4-1300 + labor cost → 5-2110 + material cost → 5-1100 + persediaan → 1-1500 (untuk skenario paket)
5. Invoice PDF lump_sum satu baris untuk all 3 test orders (Garindo default)
6. Neraca + Laba Rugi refleksikan JE benar
7. Laporan Performa → section Layanan show 3 order dengan HPP breakdown
8. Reverse order → JE reversal + stock restore + snapshot preserved

## Observability

- Log entry: `{tenant_id, user_id, feature=service_catalog, action, timestamp}` di save/attach/verify RPCs
- Log error: `{tenant_id, user_id, feature, error_code, error_message}` di RPC error branches
- Metric: `feature_usage_total{feature=service_catalog, tenant}` per RPC call

## Cost impact

- Zero paid-API call. Pure database + FE work.
- Zero cost upgrade.

## Test Plan

- **SQL smoke**: RPC test dengan fake auth via `set_config('request.jwt.claims', ...)` + `RAISE EXCEPTION` rollback (per memory `smoke_test_security_definer_rpcs`)
- **FE integration**: MCP chrome smoke Garindo tenant — setup 4 services → quote 3 orders → deliver → verify JE + PDF + reporting
- **Regression check**: existing `record_kasir_sale` (non-service items), existing `rakit_job_lines` UI flows
- **Cross-tenant isolation**: verify service_catalog RLS blocks cross-tenant access

## Rollback plan

- Semua migration idempotent (drop new tables + drop new columns reversible)
- COA seed: kalau tenant belum use akun 4-1300 / 5-2110, safe drop
- FE: revert PR
- Data: existing `rakit_job_lines` records safe (nullable new columns default OK)
