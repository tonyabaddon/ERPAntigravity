# Service Catalog: BOM-Backed Custom Panel & Wiring Design

**Date:** 2026-07-13
**Author:** Founder (tonywei) + Claude
**Status:** Draft — awaiting founder review before implementation
**Item ID:** #2 (Custom Panel + Jasa Wiring BOM re-architecture)
**Revision:** 2 (post-advisor review 2026-07-13)

---

## Context

Garindo Jaya Panel adalah distributor listrik + panel manufacturer. Bisnis mereka mencakup:
- Wiring Panel dengan komponen (material Garindo) → panel MDB / SDP / control panel
- Wiring labor-only (customer bawa material sendiri)
- Custom panel dengan ukuran / spec bespoke

**Current state** (verified 2026-07-13 via codebase exploration + grep):
- `service_types` table (mig 20260622000004) hardcode 2 entries: `custom_panel`, `wiring_panel`
- `rakit_job_lines` (mig 20260608000008) — service line, PK `id UUID`, CHECK `service_type IN ('jasa_rakit', 'jasa_custom_panel')`, columns: `service_type`, `tracking_mode` ('detail'/'lumpsum'), `labor_cost`, `lump_sum_hpp`, `hpp_owner_override`, `hpp_final`, `estimated_price`, `final_price`
- `rakit_components` — snapshot table, columns: `rakit_line_id` (FK), `sku`, `name`, `qty`, `warehouse`, `fifo_cost_snapshot`
- `order_type_enum: KOMPONEN / CUSTOM_PANEL / RAKIT_PANEL` (mig 20260625000001)
- `chart_of_accounts` — composite UNIQUE `(tenant_id, account_code)`, PK `id UUID`
- `record_kasir_sale` (mig 20260610000001) accepts `sku=null` service lines with owner-typed HPP

**Gap**:
1. Tidak ada BOM master reusable → owner setup manual per order
2. Component stock TIDAK auto-decrement waktu deliver → stock invalid
3. HPP owner-ketik manual → margin salah, laporan tidak reliable
4. COA belum ada Pendapatan Jasa + Beban Tenaga Kerja Rakit → revenue/cost sekarang keliru masuk 4-1100 Penjualan generic
5. Tidak scalable across MSME types (hardcoded 2 service types)

**Scale target**: MVP direct value untuk Garindo hari ini, dengan arsitektur configurable + tenant-scoped supaya tenant baru (bakery, bengkel, dll) bisa join tanpa migration nyakitin.

---

## Impact Analysis

**Direct callers of `rakit_job_lines`** (grep `from.*rakit_job_lines\|rakit_job_lines` in `src/`):
- `src/lib/supabaseClient.ts` — `insertWipWithRakit()`
- `src/types.ts` — `RakitJobLine` type
- Any component reading `service_type` for display in rakit funnel UI (to be enumerated in plan phase)

**Direct callers of `rakit_components`**:
- Same file as above (rakit workflow codepath)

**RPCs touching service lines**:
- `record_kasir_sale` (mig 20260610000001) — skips `sku=null` in FIFO walk
- Any tempo verify/deliver RPC — **name TBD in plan phase** (Explore agent didn't confirm; need explicit grep of `verify.*order`, `deliver`, `complete_order` di supabase migrations)

**Tests exercising these paths**:
- To be enumerated in plan phase Task 1 (grep `rakit.*test\|service.*test`)

**DB touchpoints**:
- `journal_entries` (via `_post_journal_entry`)
- `stock_lots` (via `deduct_stock_fifo`)
- `chart_of_accounts` (revenue + labor + persediaan + HPP accounts)
- `rakit_components` (snapshot writes)

**Verdict**: MVP touches 2 existing tables (schema extend), 2+ RPCs (extend or create), and 1 new UI tab. Estimated 5-8 call sites need review during plan phase. Plan Task 1 will enumerate exactly.

---

## Design Overview

Introduce a **Service Catalog** — tenant-configurable per-tenant service master with optional BOM linkage to master stok. Sales flow attach service ke order, BOM snapshot dikunci at commit, FIFO stock decrement + HPP calculation + JE post triggered saat deliver.

### Core concepts

- **Service Catalog Entry**: master service definition per tenant (nama, kategori, labor default, BOM optional, invoice display, COA mapping).
- **BOM (Bill of Materials)**: link master service ke komponen master stok (SKU + default qty).
- **Snapshot Pattern**: waktu order commit, BOM di-freeze ke `rakit_components` — historical order immune ke perubahan master BOM.
- **Include Material Mode**: derived from BOM presence — kalau `rakit_components` count > 0 untuk baris, include_material=true. Otherwise labor-only.
- **Invoice Display**: `lump_sum` (satu baris) atau `itemized` (breakdown BOM). Per-service catalog setting, functional di MVP.
- **One-Off / Custom Size**: pattern-nya sama dengan "empty BOM entry" — owner setup service dengan BOM kosong, admin build ad-hoc di sales flow. **No dedicated flag** — the empty-BOM catalog entry pattern subsumes it.

### Three Garindo scenarios (validation)

1. **Wiring paket (Garindo material)**: `service_catalog` entry "Wiring Panel MDB 100A" dengan BOM lengkap. Admin pilih → auto-populate → adjust → submit.
2. **Wiring labor-only (customer material)**: `service_catalog` entry "Jasa Wiring (Labor Only)" dengan BOM kosong. Admin pilih → isi labor amount → submit. Zero stock impact.
3. **Custom ukuran bespoke**: `service_catalog` entry "Custom Panel Box (Ukuran Custom)" dengan BOM kosong. Admin pilih → build BOM ad-hoc dari master stok → submit.

Semua 3 skenario pakai flow yang sama; beda di config service catalog + BOM editor behavior per order.

---

## Column Reuse Mapping (Critical)

Extension of `rakit_job_lines` **reuses existing columns** as much as possible; only add net-new columns for genuinely new concepts. Prevents column collisions.

| Concept | Reuse Existing | Add New |
|---|---|---|
| Labor cost per line | `labor_cost` (existing) | — |
| BOM tracking mode | `tracking_mode` (existing 'detail'/'lumpsum') | — |
| Service type legacy tag | `service_type` (existing enum) | — |
| Total sale price | `final_price` (existing) | — |
| Auto/manual HPP | `hpp_final`, `hpp_owner_override` (existing) | — |
| Link to catalog master | — | `service_catalog_id UUID` (nullable) |
| Per-order invoice display override | — | `invoice_display_override TEXT` (nullable) |

For `rakit_components`:
| Concept | Reuse Existing | Add New |
|---|---|---|
| Component SKU + qty | `sku`, `qty` (existing) | — |
| Warehouse | `warehouse` (existing) | — |
| FIFO cost snapshot at deliver | `fifo_cost_snapshot` (existing) | — |
| Link back to BOM master (audit) | — | `service_catalog_bom_id UUID` (nullable) |

**Semantics for new vs legacy rows**:
- **Legacy row**: `service_type IN ('jasa_rakit', 'jasa_custom_panel')`, `service_catalog_id = NULL` — pre-Item-#2 data
- **New row**: `service_type = <hint>` (default 'jasa_custom_panel' for legacy compat, can be updated by owner), `service_catalog_id = <fk>`

**CHECK constraint update**: `chk_rakit_service_type` needs relaxation (allow more values OR keep as legacy hint). Options:
- (a) Drop `chk_rakit_service_type` — accept any string. Simpler.
- (b) Keep constraint, set `service_type='jasa_custom_panel'` for all new rows (legacy compat).
- **Selected: (a)** — drop CHECK, treat `service_type` as free-text legacy hint. Simpler and forward-compat.

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
  revenue_coa_code TEXT NOT NULL,
  labor_cost_coa_code TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE (tenant_id, name),
  -- Composite FK to prevent cross-tenant COA reference
  FOREIGN KEY (tenant_id, revenue_coa_code)
    REFERENCES chart_of_accounts (tenant_id, account_code),
  FOREIGN KEY (tenant_id, labor_cost_coa_code)
    REFERENCES chart_of_accounts (tenant_id, account_code)
);
CREATE INDEX idx_service_catalog_tenant_active
  ON service_catalog (tenant_id, is_active, category);

CREATE TABLE service_catalog_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_catalog_id UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  component_sku VARCHAR(50) NOT NULL REFERENCES stocks(sku),
  default_qty NUMERIC(15,4) NOT NULL CHECK (default_qty > 0),
  notes TEXT,
  sort_order INT DEFAULT 0
);
CREATE INDEX idx_service_catalog_bom_service ON service_catalog_bom (service_catalog_id);

-- RLS: p_select_own + p_write_own tenant-scoped via _resolve_tenant_id()
-- Per memory secdef_returning_gap: t_select_own MUST include vosi_rpc_owner
--   because save_service_catalog uses INSERT ... RETURNING
```

### Extend existing tables

```sql
-- rakit_job_lines: additive only. No PK change (see decision memo).
ALTER TABLE rakit_job_lines
  ADD COLUMN service_catalog_id UUID REFERENCES service_catalog(id),
  ADD COLUMN invoice_display_override TEXT
    CHECK (invoice_display_override IS NULL OR
           invoice_display_override IN ('lump_sum', 'itemized'));

-- Relax existing CHECK to allow legacy + new values
ALTER TABLE rakit_job_lines DROP CONSTRAINT chk_rakit_service_type;
-- (service_type stays NOT NULL; new rows default 'jasa_custom_panel' as legacy hint)

CREATE INDEX idx_rakit_job_lines_catalog ON rakit_job_lines (service_catalog_id)
  WHERE service_catalog_id IS NOT NULL;

-- rakit_components: additive only
ALTER TABLE rakit_components
  ADD COLUMN service_catalog_bom_id UUID REFERENCES service_catalog_bom(id);
```

Snapshot semantics:
- **`attach_service_to_order` (save order)**: BOM master di-copy ke `rakit_components`. `service_catalog_bom_id` di-set kalau berasal dari master (or NULL kalau admin add ad-hoc).
- **`verify_and_deliver_order` (deliver)**: `fifo_cost_snapshot` (existing column) di-populate dari FIFO walk. Semantic: snapshot_frozen_at = order_commit; unit_cost_frozen_at = deliver_commit.

### Historical `rakit_job_lines` records policy

Existing Garindo rakit_job_lines rows (kalau ada, pre-Item-#2):
- `service_type IN ('jasa_rakit', 'jasa_custom_panel')`, `service_catalog_id = NULL`
- **Policy**: leave orphaned (`service_catalog_id = NULL`) — new Layanan reporting section only shows orders WITH catalog linkage (`WHERE service_catalog_id IS NOT NULL`). Historical data still accessible via existing rakit funnel UI.
- **No backfill script for MVP** — historical rakit data was hack-tier anyway (no BOM, HPP owner-typed); accurate re-categorization impossible without owner input per order.
- Owner may optionally edit historical orders to backfill catalog reference; not required for MVP correctness.

### COA seed (idempotent install)

Prerequisite: verify existing `account_subtype` enum has `PENDAPATAN_JASA` and `BEBAN_TENAGA_KERJA` values. If missing, add via `ALTER TYPE account_subtype ADD VALUE IF NOT EXISTS 'PENDAPATAN_JASA'` before the seed insert.

```sql
-- Enum extension (idempotent per Postgres 14+)
ALTER TYPE account_subtype ADD VALUE IF NOT EXISTS 'PENDAPATAN_JASA';
ALTER TYPE account_subtype ADD VALUE IF NOT EXISTS 'BEBAN_TENAGA_KERJA';

-- Seed for Garindo tenant (idempotent)
INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, account_subtype, normal_balance)
SELECT t.id, '4-1300', 'Pendapatan Jasa Wiring', 'PENDAPATAN', 'PENDAPATAN_JASA', 'CREDIT'
FROM tenants t WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;

INSERT INTO chart_of_accounts (tenant_id, account_code, account_name, account_type, account_subtype, normal_balance)
SELECT t.id, '5-2110', 'Beban Tenaga Kerja Rakit', 'BEBAN', 'BEBAN_TENAGA_KERJA', 'DEBIT'
FROM tenants t WHERE t.slug = 'garindo'
ON CONFLICT (tenant_id, account_code) DO NOTHING;
```

Fresh future tenants: bootstrap COA setup (existing pattern) should also include these accounts by default — to be added in `bootstrap_tenant_context` follow-up.

---

## RPCs

All new RPCs are `SECURITY DEFINER owned by vosi_rpc_owner`, `SET search_path TO 'public'`, tenant-scoped via `_resolve_tenant_id()`. All new RPCs get:

```sql
REVOKE ALL ON FUNCTION public.<name>(...) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<name>(...) TO authenticated;
```

Per memory `secdef_returning_gap`: RLS policy `t_select_own` on new tables MUST include `vosi_rpc_owner` role because save RPCs use INSERT ... RETURNING.

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
    { "component_sku": "BUSBAR-CU-100A", "default_qty": 2 }
  ]
}
```

Transaction atomic (service + BOM di 1 transaction).

### `soft_delete_service_catalog(p_id UUID) RETURNS VOID`

Set `is_active = false`. Historical orders yang reference tetap valid (snapshot self-contained).

### `attach_service_to_order(p_order_id UUID, p_service_catalog_id UUID, p_qty NUMERIC, p_override_bom JSONB, p_override_labor NUMERIC) RETURNS UUID`

Attach service line ke existing order (tempo order primary; kasir extension deferred). Snapshot BOM saat call.

Idempotent atomic:
1. Validate service_catalog exists + active + tenant match
2. Insert `rakit_job_lines` dengan `service_catalog_id`, `labor_cost` (from override or catalog default), `service_type='jasa_custom_panel'` (legacy hint), `tracking_mode='detail'` (BOM present) or `'lumpsum'` (empty BOM)
3. Insert `rakit_components` snapshot rows (dari override_bom atau default × qty)
4. Return `rakit_job_lines.id`

### `verify_and_deliver_order(p_order_id UUID) RETURNS JSONB`

**Verify RPC name TBD in plan phase.** Grep target: `verify.*order`, `deliver`, `complete_order`, `mark_order_delivered` in existing migrations. If exists, extend; if not, create.

Atomic RPC waktu order status → DELIVERED:
1. For each `rakit_job_lines` di order:
   - Load `rakit_components` snapshot
   - Untuk each komponen dengan sku non-null:
     - FIFO walk stock_lots → decrement × qty (per memory `feedback_allow_negative_stock_preorder`: relax stock check, warn UI but don't block)
     - Populate `rakit_components.fifo_cost_snapshot` = weighted FIFO cost
   - Compute total material cost = SUM(qty × fifo_cost_snapshot)
   - Compute total HPP = material cost + labor_cost
2. Post JE via `_post_journal_entry`:
   - **DEBIT** Piutang/Kas (existing) — total price
   - **CREDIT** `revenue_coa_code` (per service) — total price
   - **DEBIT** 5-1100 HPP Penjualan — material cost (kalau non-zero)
   - **DEBIT** `labor_cost_coa_code` (per service) — labor amount
   - **CREDIT** 1-1500 Persediaan — material cost
   - **CREDIT** 2-2100 Utang Gaji (or Kas kalau immediate) — labor amount
3. Update order status → DELIVERED

Returns JSONB: `{ ok, order_id, je_id, total_hpp, total_revenue }`

### `record_kasir_sale` — **NOT extended in MVP**

Deferred entirely (Garindo primary tempo). Kasir walk-in service line UI + backend support = phase 2 when bengkel/bakery tenant onboard.

---

## Frontend

### Pengaturan → Layanan (new tab)

**Tab position**: after Approval tab, before Promo Produk tab (di Pengaturan navigation).

**List view:**
- Grouped by category (owner-defined)
- Card per service dengan quick actions: Edit, Nonaktif, Duplikat
- Empty state: "Belum ada layanan. Klik + Tambah Layanan untuk mulai."
- CTA: `+ Tambah Layanan Baru`

**Edit modal:**
- Nama, kategori (free-text combobox — new atau existing category), deskripsi
- Labor default (NumberInput)
- Include material default (radio Ya/Tidak) — UI hint only; backend derives from BOM presence
- Invoice display (radio Lump Sum / Itemized)
- COA mapping (2 dropdown — filtered ke akun PENDAPATAN + BEBAN per tenant)
- **BOM Editor** (reusable component):
  - Table: SKU, nama, qty default, notes, [x] hapus
  - `+ Tambah Komponen dari Master Stok` → picker modal
  - Support BOM kosong (labor-only atau custom mode)

**Reusable BOM Editor** dipakai di 2 tempat: Pengaturan (master) + Sales flow (snapshot per order).

**UI/UX defaults:**
- Bahasa Indonesia + MSME tone
- Font sizing per memory `feedback_font_sizing`: base 13-14px UI
- Empty/loading/error states all covered
- Mobile responsive (Pengaturan tablet-friendly)

### Sales flow — Buat Pesanan tempo

Extend existing tempo B2B Buat Pesanan screen dengan tombol:
- `+ Tambah Produk Stok` (existing pattern)
- `+ Tambah Layanan` (NEW)

**+ Tambah Layanan** → modal:
1. Service picker (dropdown biasa untuk MVP — Garindo <10 services)
2. Qty
3. BOM auto-populate dari master (jika ada)
4. BOM editor: admin adjust qty / add / remove komponen (reusable component)
5. Labor amount (default dari master, editable)
6. Harga jual (default dari master atau isi manual)
7. Submit → snapshot ke `rakit_job_lines` + `rakit_components` via `attach_service_to_order`

Kalau service master BOM kosong (skenario 2 atau 3):
- BOM editor start blank
- Admin add komponen dari master stok picker
- Backend receive full BOM at commit

### Invoice PDF renderer

Extend existing tempo invoice PDF renderer dengan branch berdasarkan effective `invoice_display` (per service, dengan `invoice_display_override` per-order fallback opsional):

- **`lump_sum`**: satu baris `"<service.name> × <qty> = <total>"`
- **`itemized`**: expand BOM detail as sub-lines dengan indent

Kalau BOM kosong (labor-only): render 1 baris "Labor" saja untuk both mode.

### Reporting → Laporan Performa (extend)

New section "Layanan" dengan:
- Filter: `WHERE service_catalog_id IS NOT NULL` (historical hack-tier data excluded)
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
| Composite FK `(tenant_id, account_code)` for COA references | Tactical | Additive constraint |
| BOM snapshot pattern (freeze at commit) | **IRREVERSIBLE** | Contract — see decision memo |
| Extend `rakit_job_lines` schema (additive) | Semi-reversible | Column add reversible |
| Drop `chk_rakit_service_type` CHECK | Semi-reversible | Loosening — can re-tighten later with data cleanup |
| New COA seed (4-1300, 5-2110) + subtype enum values | Semi-reversible | Enum ADD VALUE non-revert; account row drop safe pre-use |
| Deprecate `service_types` | Tactical | Mark unused, no drop |
| Configurable catalog + COA per tenant | Tactical | No global config, tenant-scoped, reversible re-setup |
| `rakit_job_lines` composite PK migration | **DEFERRED** | Not shipped; see decision memo |

Irreversible items → decision memo `docs/superpowers/specs/2026-07-13-service-catalog-decision.md`.

---

## Migration Path

Migration slots claimed (block 100+, session 3): **148, 149, 150, 151**. Update memory `project_migration_slot_allocation` post-plan.

1. **Migration 20261115000148**: create `service_catalog` + `service_catalog_bom` tables + RLS policies (including `vosi_rpc_owner` in t_select_own) + indexes + composite FK to COA
2. **Migration 20261115000149**: alter `rakit_job_lines` + `rakit_components` add new columns; drop `chk_rakit_service_type` CHECK
3. **Migration 20261115000150**: enum ADD VALUE for `account_subtype` (idempotent) + COA seed for Garindo tenant (idempotent, ON CONFLICT DO NOTHING)
4. **Migration 20261115000151**: RPCs — `save_service_catalog`, `soft_delete_service_catalog`, `attach_service_to_order`. All REVOKE from anon + GRANT to authenticated. All SECDEF owned by `vosi_rpc_owner`.
5. **Migration 20261115000152** (extra slot if needed): tempo verify/deliver RPC extension — name confirmed at plan Task 1.

Existing `service_types` table: DON'T drop (existing rakit_job_lines historical refs). Mark deprecated in comment.

**Zero downtime**: semua migration additive + idempotent + drop-safe on rollback. Per memory `smoke_test_security_definer_rpcs`: smoke test each new RPC with fake `auth.uid` + `RAISE EXCEPTION` rollback before shipping.

**Post-migration DB advisor scan**: run `mcp__plugin_supabase_supabase__get_advisors` after each migration per CLAUDE.md Infrastructure lens.

---

## Scope (MVP — Value Hari Ini untuk Garindo)

### ✅ IN — Build & Ship

**Backend:**
- 2 new tables + RLS + composite FK to COA
- `rakit_job_lines` + `rakit_components` additive extends
- COA seed + subtype enum values
- 3 new RPCs (`save_service_catalog`, `soft_delete_service_catalog`, `attach_service_to_order`)
- Extend or create tempo verify/deliver RPC — atomic FIFO + JE post with revenue/labor split
- All RPCs: SECDEF, REVOKE anon, GRANT authenticated, tenant-scoped, vosi_rpc_owner in t_select_own

**Frontend:**
- Pengaturan → Layanan CRUD dengan BOM editor
- Buat Pesanan tempo extend dengan tombol + Tambah Layanan + BOM editor sales
- Invoice PDF — branch lump_sum + itemized (**both** functional)
- Reporting — Laporan Performa section Layanan (filter `service_catalog_id IS NOT NULL`)

**Config default per Garindo:**
- 4 service entries setup awal (Wiring Panel MDB 100A/200A/labor-only/custom-panel-box)
- Overhead: simple (owner adjust price manually)
- Blank slate onboarding
- Multi-warehouse component FIFO: existing `deduct_stock_fifo` walks whatever warehouse has stock
- Discount per line = existing pattern reused (existing per-line `discount_amount` pattern in orders)

### ⏸ DEFER — Nyusul kalau ada demand

- Include material toggle UI per order (backend derived from BOM presence)
- Kasir walk-in service line (backend + FE both defer; not simple to keep-only-schema-siap without touching `record_kasir_sale`)
- One-Off blank mode dedicated UI (workaround: owner setup "Custom Panel Box" entry BOM kosong)
- Search-as-you-type service picker (defer sampai catalog > 20)
- Kategori picker complex UI (backend free-text, Garindo hardcode "Wiring")
- Discount per service line dedicated UI (existing discount pattern reused)
- Multi-warehouse component picking per line (existing FIFO pattern sufficient)
- Actual vs estimate variance report
- Historical rakit_job_lines backfill script
- `rakit_job_lines` composite PK migration (see decision memo)

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
3. Waktu deliver, FIFO decrement komponen berjalan otomatis (relaxed stock check per memory)
4. JE post dengan revenue → 4-1300 + labor cost → 5-2110 + material cost → 5-1100 + persediaan → 1-1500 (untuk skenario paket)
5. Invoice PDF lump_sum satu baris untuk all 3 test orders (Garindo default). Verify itemized rendering via one test-only itemized service catalog entry.
6. Neraca + Laba Rugi refleksikan JE benar
7. Laporan Performa → section Layanan show 3 order dengan HPP breakdown
8. Reverse order → JE reversal + stock restore + snapshot preserved
9. Cross-tenant isolation: SQL smoke verify tenant A tidak bisa read service_catalog tenant B (RLS)
10. Zero regression: existing rakit funnel UI + record_kasir_sale (non-service items) still work

## Observability

Per CLAUDE.md observability requirement for net-new user-facing feature:
- Log entry: `{tenant_id, user_id, feature=service_catalog, action, timestamp}` di save/attach/verify RPCs
- Log error: `{tenant_id, user_id, feature, error_code, error_message}` di RPC error branches
- Metric: `feature_usage_total{feature=service_catalog, tenant}` per RPC call

## Cost impact

- Zero paid-API call. Pure database + FE work.
- Zero cost upgrade.
- Per CLAUDE.md cost discipline: no explicit founder approval needed.

## Test Plan

- **SQL smoke** (Stage 1): each new RPC with fake `auth.uid` via `set_config('request.jwt.claims', ...)` + `RAISE EXCEPTION` rollback (per memory `smoke_test_security_definer_rpcs`)
- **Check constraint audit** (per memory `check_constraints_before_rpc_rewrite`): enumerate ALL CHECK + partial index on `rakit_job_lines` + `rakit_components` at plan Task 1 before writing extension migration
- **FE integration** (Stage 3): MCP chrome smoke Garindo tenant — setup 4 services → quote 3 orders → deliver → verify JE + PDF + reporting
- **Regression check**: existing `record_kasir_sale` (non-service items), existing rakit funnel UI (rakit_job_lines display)
- **Cross-tenant isolation test**: 2-tenant SQL smoke — verify RLS blocks cross-tenant service_catalog read

## Rollback plan

- Semua migration idempotent (drop new tables + drop new columns reversible; enum ADD VALUE non-revertible but harmless if unused)
- COA seed: kalau tenant belum use akun 4-1300 / 5-2110 in JE historical, safe drop
- FE: revert PR
- Data: existing `rakit_job_lines` records safe (nullable new columns default OK)
- Existing `chk_rakit_service_type` CHECK: if we ever want to re-add, need to first cleanup any non-conforming service_type values

## Follow-up work (post-MVP tracker)

- Bootstrap tenant COA include 4-1300 + 5-2110 by default
- FE toggle for Include Material per order (kalau tenant butuh)
- Kasir walk-in service line (bengkel/bakery onboard)
- Backfill script for historical hack-tier rakit rows (owner-driven, optional)
- `rakit_job_lines` composite PK migration when row count > 5M
- Actual-vs-estimate labor variance report (kalau owner butuh)
