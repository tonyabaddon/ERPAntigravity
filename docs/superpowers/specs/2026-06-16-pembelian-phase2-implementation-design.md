---
name: pembelian-phase2-implementation-design
description: Phase 2 implementation spec — Pesanan + Tagihan + Tukar Faktur + Pembayaran (4-entity refactor of existing PO), with reconciliation panel + AP Report + WA reminder. NO approval workflow, NO SOP profile (deferred per founder).
metadata:
  type: project
---

# Pembelian Phase 2 — Implementation Design

**Status:** Spec • drafted 2026-06-16
**Branch:** `feat/pembelian-phase2` (worktree at `.claude/worktrees/pembelian-phase2`)
**Companion roadmap:** `2026-06-14-pembelian-phase2-roadmap-design.md` (conceptual; superseded by this implementation spec where they conflict)
**Phase 1 spec (live):** `2026-06-14-pembelian-belanja-numpang-lewat-design.md`
**Mockup:** `tmp/pembelian-phase2-mockup.html` (4 layar — local only)

## 1. Goal

Refactor the existing monolithic PO into a **4-entity model** that matches Jurnal/Accurate standard naming and supports B2B realities (partial delivery, consolidated payment, Tukar Faktur ritual, AP aging). Existing PO data migrated in-place; existing Belanja Numpang Lewat (Phase 1) shares `purchase_invoices` table via `type` discriminator.

**Explicit non-goals (deferred):**
- SOP Profile picker / multi-preset tenant config — single-tenant focus first (per memory `phase2-defer-sop-profile`)
- Approval workflow (admin→owner gating) — owner=admin in founder context (per memory `no-approval-workflow`)
- Permintaan + Penawaran (purchase request + quotation)
- Retur Pembelian
- Multi-currency / PPN formal
- 3-way match enforcement

## 2. Sub-phases (sequenced delivery)

| Sub-phase | Scope | Estimate |
|---|---|---|
| **2a — Foundation** | Schema: pesanan + tagihan (already exists, add type='STOCK') + pembayaran + junction. Migration: split PO data. Basic CRUD pages. Backward URL redirects. | ~1.5 sprint |
| **2b — Tukar Faktur** | tukar_faktur table + reconciliation panel + PDF tanda terima | ~1 sprint |
| **2c — AP Report** | Beranda dashboard (KPI + aging + cash flow forecast). | ~0.5 sprint |

Total: ~3 sprint = ~1.5 bulan.

## 3. Entity model

**Tukar Faktur adalah OPSIONAL** — bukan step wajib sebelum Pembayaran. Operator bisa langsung bayar Tagihan tanpa pernah lewat Tukar Faktur.

```
Pesanan ──► Tagihan ──┬──────────────────────────► Pembayaran  ← jalur langsung (paling umum)
(PO, no    (Faktur,   │                                          (toko ritel, MSME kecil,
 stock)     stok +X,  │                                           cash purchase)
            to AP)    │
                      └──► Tukar Faktur ──────────► Pembayaran  ← jalur via TF (opsional)
                           (consolidation N         (distributor B2B yang punya
                            Tagihan same-supplier)   jadwal tukar faktur formal)
```

**Operator tenant kecil/menengah:** Bayar langsung dari list Tagihan → klik "Bayar" → Pembayaran form, skip Tukar Faktur sepenuhnya. UI menu "Tukar Faktur" tetap visible (per "no SOP Profile" decision), tapi operator tidak wajib pakai.

**Operator distributor B2B:** Bundling N Tagihan ke TF saat sales supplier datang Rabu untuk tukar faktur ritual, lalu bayar TF (yang otomatis tutup semua Tagihan bundled-nya) 30 hari kemudian.

**Relations:**
- 1 Pesanan : N Tagihan (partial delivery)
- 1 Tagihan : 1 Pesanan — **REQUIRED untuk type='STOCK'** (no ad-hoc Tagihan). Operator wajib buat Pesanan dulu, baru catat Tagihan saat barang datang.
- 1 Tukar Faktur : N Tagihan (same supplier only) — **opsional**
- 1 Pembayaran : N PembayaranItem (junction, points to Tagihan ATAU Tukar Faktur)
- Existing `purchase_invoices` row with `type='PASSTHROUGH'` (BNL Phase 1) → unchanged (links ke Sales Order, NOT Pesanan); new rows with `type='STOCK'` = Tagihan with mandatory pesanan_id

**Mandatory PO-first flow untuk stocking:**
```
Step 1: Buat Pesanan (PO ke supplier)        ← TRIGGER
Step 2: Barang datang                         ← real-world event
Step 3: Buat Tagihan dari Pesanan tsb         ← +stok + masuk AP
Step 4: Bayar (langsung atau via Tukar Faktur opsional)
```

Kalau operator butuh "cash pickup di pasar" yang tidak punya Pesanan formal:
- Untuk stok permanen → buat Pesanan singkat dulu (status ORDERED, ordered_at=today), lalu Tagihan
- Untuk customer tertentu pass-through → pakai Belanja Numpang Lewat (Phase 1, no Pesanan needed)

**Implikasi: form Pembayaran punya 2 mode sekaligus**

Saat operator buka Pembayaran form dan pilih supplier, `pembayaran_suggest_outstanding(supplier_id)` mengembalikan **gabungan**:
- Tagihan outstanding yang BELUM di-bundle (tukar_faktur_id IS NULL) — bisa centang individu / batch
- Tukar Faktur outstanding yang status=TERTANDA — centang TF = otomatis cover semua Tagihan di dalamnya

Operator boleh campur: 3 Tagihan loose + 1 TF dalam 1 Pembayaran. Junction table mendukung both.

## 4. Schema

### 4.1 `pesanan` (Purchase Order, refactored)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `pesanan_number` | text UNIQUE | Format `PSN-YYYY-MM-NNN` |
| `supplier_id` | uuid FK → suppliers | |
| `status` | text | `DRAFT` / `ORDERED` / `CLOSED` (when all items received or operator force-close) |
| `notes` | text | |
| `ordered_at` | timestamptz | Set on DRAFT→ORDERED |
| `closed_at` | timestamptz | Set on CLOSED |
| `tax_rate` | numeric | Default 0 |
| `tax_amount` | numeric | |
| `subtotal` | numeric | Sum item subtotals |
| `total` | numeric | subtotal + tax_amount |
| `created_by_user_id` | uuid FK → auth.users | |
| `created_at`, `updated_at`, `voided_at`, `voided_by_user_id`, `void_reason` | | |

`pesanan_items`:
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `pesanan_id` | uuid FK ON DELETE CASCADE | |
| `sku` | varchar FK → stocks | |
| `product_name` | text | Snapshot |
| `qty` | int | Ordered qty |
| `unit_cost` | numeric | Expected unit cost |
| `subtotal` | numeric | |
| `qty_received_total` | int DEFAULT 0 | Trigger-maintained sum from linked Tagihan items |

### 4.2 `purchase_invoices` (existing, extended)

Already exists from Phase 1. Phase 2 changes:
- Add column `pesanan_id` uuid NULL FK → pesanan (NULL for BNL pass-through; **REQUIRED for type='STOCK'**)
- Add column `tukar_faktur_id` uuid NULL FK → tukar_faktur (set when Tagihan bundled into TF)
- Add column `paid_amount` numeric DEFAULT 0 (sum from pembayaran_items for partial payment tracking)
- Extend `status` enum: `BELUM_LUNAS` / `DIBAYAR_SEBAGIAN` / `LUNAS` / `VOIDED` (new: DIBAYAR_SEBAGIAN)
- **CHECK constraint:** `(type = 'PASSTHROUGH' AND pesanan_id IS NULL AND order_id IS NOT NULL) OR (type = 'STOCK' AND pesanan_id IS NOT NULL AND order_id IS NULL)` — enforce mutually-exclusive linkage per type

`purchase_invoice_items` — already has `sku, qty, unit_cost, subtotal`. Add:
- `pesanan_item_id` uuid NULL FK → pesanan_items (optional link to specific Pesanan line)

### 4.3 `tukar_faktur` (NEW)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tf_number` | text UNIQUE | Format `TF-YYYY-MM-NNN` |
| `supplier_id` | uuid FK → suppliers NOT NULL | Same-supplier constraint enforced at app layer |
| `status` | text | `DRAFT` / `TERTANDA` / `PAID` |
| `tukar_date` | date NOT NULL | When the ritual happened |
| `payment_due_at` | date NOT NULL | When buyer commits to pay |
| `total_amount` | numeric | Sum of bundled Tagihan totals |
| `tanda_terima_pdf_url` | text | Auto-generated when status → TERTANDA |
| `photo_urls` | text[] | Bulk upload Faktur asli — array of Storage URLs, no per-Tagihan attribution (operator labels by hand if needed) |
| `notes` | text | Free-text — includes any discrepancy notes operator wants to record |
| `created_by_user_id` | uuid FK → auth.users | |
| `created_at`, `updated_at`, `voided_at`, `voided_by_user_id`, `void_reason` | | |

**Note:** no separate `tukar_faktur_items` table — the relation Tagihan → TukarFaktur is via `purchase_invoices.tukar_faktur_id` (1:N).

### 4.4 `pembayaran` (NEW)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `pembayaran_number` | text UNIQUE | Format `PMB-YYYY-MM-NNN` |
| `supplier_id` | uuid FK → suppliers | |
| `paid_at` | timestamptz NOT NULL | |
| `payment_method` | text | `CASH` / `TRANSFER` / `CHEQUE` / `EDC` |
| `account_id` | uuid NULL | Future: link to bank account master (Phase 3) |
| `account_label` | text | Free-text for now (e.g., "BCA 1234") |
| `amount_total` | numeric | sum of items.amount |
| `discount_amount` | numeric DEFAULT 0 | Cash discount applied at payment time |
| `proof_url` | text | Bukti transfer / kuitansi |
| `status` | text | `LUNAS` / `VOIDED` |
| `notes` | text | |
| `created_by_user_id`, `created_at`, `updated_at`, `voided_at`, `voided_by_user_id`, `void_reason` | | |

`pembayaran_items` (junction):
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `pembayaran_id` | uuid FK ON DELETE CASCADE | |
| `tagihan_id` | uuid NULL FK → purchase_invoices | XOR with tukar_faktur_id |
| `tukar_faktur_id` | uuid NULL FK → tukar_faktur | XOR with tagihan_id |
| `amount` | numeric NOT NULL | Allows partial payment |

**Constraint:** `CHECK ((tagihan_id IS NOT NULL) <> (tukar_faktur_id IS NOT NULL))` — exactly one set.

### 4.5 Indexes & RLS

- `pesanan(supplier_id, status)` for filter
- `pesanan(status, ordered_at DESC)` for list view
- `tukar_faktur(supplier_id, status)`
- `tukar_faktur(status, payment_due_at)` WHERE status='TERTANDA' for cash flow forecast
- `pembayaran(supplier_id, paid_at DESC)`
- `pembayaran_items(tagihan_id)` for paid_amount sum
- `pembayaran_items(tukar_faktur_id)` for TF payment tracking
- All tables: RLS deny-by-default, SELECT for authenticated, writes through SECURITY DEFINER RPCs

## 5. RPCs (atomic)

### 5.1 Pesanan
- `generate_pesanan_number() returns text`
- `record_pesanan(payload jsonb) returns text` — creates Pesanan as DRAFT or ORDERED based on payload
- `mark_pesanan_ordered(p_pesanan_id uuid) returns void` — DRAFT → ORDERED, sets ordered_at
- `update_pesanan(p_pesanan_id uuid, payload jsonb) returns void` — edit only DRAFT
- `void_pesanan(p_pesanan_id uuid, reason text) returns void` — also used for force-close (no separate close RPC)

### 5.2 Tagihan (extends existing `record_pi`)
- `record_tagihan(payload jsonb) returns jsonb` — payload requires `pesanan_id` when type='STOCK'; rejects with error if missing. Auto-increments stocks + creates stock_lots (for type='STOCK'). BNL-style payload (type='PASSTHROUGH') validates `order_id` (Sales Order) instead.
- Extend existing `mark_pi_paid` → also handle DIBAYAR_SEBAGIAN status when partial
- `void_pi` extended to reverse stock_lots for type='STOCK'

Trigger: after Tagihan insert/update with `pesanan_item_id`, update `pesanan_items.qty_received_total`. When all items fulfilled, auto-close Pesanan.

**Validation rule:** `record_tagihan` with `type='STOCK'` rejects payload where `pesanan_id IS NULL` with explicit error message: "Tagihan stocking wajib dari Pesanan. Buat Pesanan dulu, atau pakai Belanja Numpang Lewat untuk pass-through customer." (Operator's UX: form Buat Tagihan tidak punya jalur ad-hoc; Pesanan picker required.)

### 5.3 Tukar Faktur
- `generate_tf_number() returns text`
- `record_tukar_faktur(payload jsonb) returns jsonb` — bundles Tagihan IDs, sets tukar_faktur_id on each. Validates same-supplier.
- `sign_tukar_faktur(p_tf_id uuid, photos jsonb) returns text (pdf_url)` — DRAFT → TERTANDA, stores photos, generates PDF
- `void_tf(p_tf_id uuid, reason text) returns void` — also used to unbundle (void + recreate if operator needs different Tagihan composition)

**Foreign-faktur handling:** if supplier brings a Faktur not yet in the system during TF ritual, operator skips it from current TF, creates Tagihan via normal Tagihan flow afterward, and creates the next TF including the missed faktur. Phase 2 doesn't auto-quick-create from within TF panel (defer to Phase 3 if demand surfaces).

### 5.4 Pembayaran
- `generate_pembayaran_number() returns text`
- `record_pembayaran(payload jsonb) returns jsonb` — atomic: insert pembayaran + items, recompute Tagihan.paid_amount + status, insert Kasir expense entry (sum), validate amounts don't exceed Tagihan total minus prior payments
- `void_pembayaran(p_pmb_id uuid, reason text) returns void` — reverse Tagihan.paid_amount, reverse Kasir expense

### 5.5 Smart suggestions (RPC for AP dashboard)
- `pembayaran_suggest_outstanding(p_supplier_id uuid) returns jsonb` — returns `{tagihan: [...], tukar_faktur: [...]}` for pre-filling Pembayaran form
- `ap_dashboard() returns jsonb` — returns KPI + per-supplier + aging buckets + 7-day cash flow forecast in single round-trip

## 6. Migration (existing PO → Pesanan + Tagihan + Pembayaran)

Strategy: **big-bang split during maintenance window**.

### 6.1 Migration script outline (`20260620000010_pembelian_phase2_migrate_po.sql`)

**Note:** no `purchase_orders_archive` table is created. Postgres point-in-time recovery + git history of migration scripts provides sufficient rollback path. No `legacy_po_number` column on Pesanan (URL backward compat dropped — small audience of 2-3 admin staff can re-bookmark).

```sql
BEGIN;

-- Step 1: Create new tables (pesanan, pesanan_items, tukar_faktur, pembayaran, pembayaran_items)
-- ... [DDL] ...

-- Step 2: For each PO row, derive Pesanan + Tagihan + Pembayaran:
INSERT INTO pesanan (id, pesanan_number, supplier_id, status, ordered_at, closed_at, tax_rate, tax_amount, subtotal, total, notes, created_by_user_id, created_at)
SELECT
  gen_random_uuid(),
  'PSN-' || to_char(created_at, 'YYYY-MM') || '-' || lpad(row_number() over (partition by to_char(created_at, 'YYYY-MM') order by created_at)::text, 3, '0'),
  supplier_id,
  CASE status
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'ORDERED' THEN 'ORDERED'
    WHEN 'RECEIVED' THEN 'CLOSED'  -- received = all items in
    WHEN 'PAID' THEN 'CLOSED'
  END,
  ordered_at,
  CASE WHEN status IN ('RECEIVED','PAID') THEN received_at ELSE NULL END,
  tax_rate, tax_amount, subtotal, total, notes, created_by_user_id, created_at
FROM purchase_orders;

-- pesanan_items derived from purchase_order_items
INSERT INTO pesanan_items (...) SELECT ... FROM purchase_order_items;

-- For PO at RECEIVED/PAID: create Tagihan
INSERT INTO purchase_invoices (id, pi_number, type, supplier_id, pesanan_id, purchase_date, payment_method, payment_due_at, paid_at, payment_proof_url, subtotal, total, status, ...)
SELECT
  gen_random_uuid(),
  'TGH-' || to_char(received_at, 'YYYY-MM') || '-' || ...,
  'STOCK',
  po.supplier_id,
  pesanan_lookup.new_id,
  po.received_at::date,
  'TRANSFER',  -- assumed
  po.payment_due_at,
  po.paid_at,
  po.payment_proof_url,
  po.subtotal, po.total,
  CASE po.status WHEN 'RECEIVED' THEN 'BELUM_LUNAS' WHEN 'PAID' THEN 'LUNAS' END,
  ...
FROM purchase_orders po
JOIN pesanan_lookup ON pesanan_lookup.legacy_po_number = po.po_number
WHERE po.status IN ('RECEIVED', 'PAID');

-- For PO at PAID: create Pembayaran + junction row
INSERT INTO pembayaran (...) SELECT ... FROM purchase_orders WHERE status = 'PAID';
INSERT INTO pembayaran_items (pembayaran_id, tagihan_id, amount) SELECT ...;

-- Step 3: Rewire stock_lots
ALTER TABLE stock_lots ADD COLUMN source_id uuid;
ALTER TABLE stock_lots ADD COLUMN source_type text;
UPDATE stock_lots SET source_id = tagihan_lookup.new_tagihan_id, source_type = 'TAGIHAN' FROM tagihan_lookup WHERE stock_lots.po_id = tagihan_lookup.legacy_po_id;
-- After verify: ALTER TABLE stock_lots DROP COLUMN po_id; (in subsequent migration)

-- Step 4: Cross-reference Kasir expense entries
ALTER TABLE kasir_transactions ADD COLUMN pembayaran_id uuid REFERENCES pembayaran(id);
UPDATE kasir_transactions SET pembayaran_id = pembayaran_lookup.id FROM pembayaran_lookup WHERE kasir_transactions.po_id = pembayaran_lookup.legacy_po_id;

-- Step 5: After verification (1 week post-cutover), drop old purchase_orders + items.
-- Don't drop in this migration — that's a separate phase 2-cleanup migration.
-- Recovery path: Postgres PITR + git history of this migration script.

COMMIT;
```

### 6.2 Risk mitigation
- **Dry-run** on staging Supabase snapshot first
- **Checksum verification** pre/post:
  - Total stock per SKU sum unchanged
  - Total AP outstanding (BELUM_LUNAS) unchanged
  - Total Kasir expense (Pembelian Stok category) unchanged
  - Stock_lots count unchanged
- **Rollback plan:** Postgres point-in-time recovery (PITR) to pre-migration timestamp + re-deploy old frontend
- **Maintenance window:** Sunday 02:00 WIB (low traffic)
- **Frontend deploy:** after migration verified, deploy new frontend that reads from new tables

## 7. Frontend file structure

```
src/components/pembelian/
  beranda/
    BerandaPembelian.tsx         — AP dashboard (KPI + per-supplier + aging + cash flow)
    APAgingChart.tsx             — horizontal bar chart 5 buckets
    CashFlowForecast.tsx         — 7-day bar chart
    SupplierOutstandingCard.tsx  — per-supplier row component
  pesanan/
    PesananList.tsx              — replaces existing PembelianScreen orders tab
    PesananFormPage.tsx          — create/edit Pesanan (replaces PurchaseOrderFormPage)
    PesananDetailPage.tsx        — replaces PembelianDetailPage
    ReceiveTagihanModal.tsx      — quick-create Tagihan from Pesanan (replaces ReceiveGoodsModal)
  tagihan/
    TagihanList.tsx              — both STOCK + PASSTHROUGH filterable
    TagihanFormPage.tsx          — create/edit (ad-hoc OR from Pesanan)
    TagihanDetailPage.tsx        — same shape as BNL detail
  tukar_faktur/
    TukarFakturList.tsx
    TukarFakturReconciliationPage.tsx   — ⭐ killer flow (auto-suggest + photo + reconcile)
    TukarFakturDetailPage.tsx
  pembayaran/
    PembayaranList.tsx
    PembayaranFormPage.tsx       — consolidated + partial support
    PembayaranDetailPage.tsx
  bnl/                            — Phase 1 (unchanged)
  shared/
    SupplierPicker.tsx           — already exists
    PaymentMethodPicker.tsx      — already exists from BNL Phase 1
    SkuPickerWithInlineCreate.tsx — already exists from BNL Phase 1 (reused for Pesanan + Tagihan)
src/lib/
  pembelianService.ts            — extend with pesananService + pembayaranService + tukarFakturService (or split)
  pdf/
    tukarFakturTandaTerima.ts    — A4 PDF generator
    purchaseOrderPdf.ts          — existing, kept as-is (rename deferred to avoid touching unrelated code)
```

### 7.1 Sidebar / menu structure

```
Pembelian (top-level)
  ├─ Beranda                      ← default landing
  ├─ Pesanan
  ├─ Tagihan
  ├─ Belanja Numpang Lewat        ← Phase 1, unchanged
  ├─ Tukar Faktur
  ├─ Pembayaran
  └─ Supplier
```

No SOP-based hiding. All menus visible to any user with `pembelian` permission.

### 7.2 Status badges (consistent across entities)

| Entity | Status | Color |
|---|---|---|
| Pesanan | DRAFT | gray |
| Pesanan | ORDERED | blue |
| Pesanan | CLOSED | green |
| Tagihan | BELUM_LUNAS | amber |
| Tagihan | DIBAYAR_SEBAGIAN | sky |
| Tagihan | LUNAS | green |
| Tagihan | TERLAMBAT (derived) | red |
| Tukar Faktur | DRAFT | gray |
| Tukar Faktur | TERTANDA | violet |
| Tukar Faktur | PAID | green |
| Pembayaran | LUNAS | green |
| Pembayaran | VOIDED | gray strikethrough |

## 8. AP Report dashboard (Beranda)

See mockup Layar 1.

**Single RPC `ap_dashboard()` returns:**
```typescript
{
  kpi: {
    total_outstanding: number,
    due_this_month: number,
    next_7_days: number,
    overdue: { amount: number, count: number, max_overdue_days: number },
  },
  per_supplier: Array<{
    supplier_id, supplier_name, schedule_label, // e.g., "Rabu"
    outstanding, tagihan_count, tf_count,
    due_soonest_date, due_soonest_label,        // "16 Jun" (formatted in WIB)
  }>,
  aging_buckets: {
    not_due: number, d1_30: number, d31_60: number, d61_90: number, d90_plus: number,
  },
  cash_flow_7d: Array<{
    date: string, // ISO
    total_due: number,
    tagihan_ids: string[], tukar_faktur_ids: string[],
  }>,
}
```

Frontend: fetch once on mount, render 4 panels. Refetch on tab refocus.

## 9. Tukar Faktur reconciliation panel

See mockup Layar 3. Implementation flow:

1. Operator → `Pembelian → Tukar Faktur → + Buat Baru`
2. Pick supplier → frontend calls `pembayaran_suggest_outstanding(supplier_id)` → render outstanding Tagihan list with checkboxes (all pre-checked)
3. Operator unchecks Tagihan that supplier didn't bring → moves to "tidak di-bundle" sub-section
4. Foreign faktur input (optional): operator adds supplier-brought Faktur not in system → `quick_create_tagihan_for_tf` RPC creates ad-hoc Tagihan + auto-includes in current TF
5. Photo upload: bulk multi-file `<input type=file multiple>` → upload to Storage → array of `{tagihan_id, photo_url}` stored in `tagihan_photos` JSONB
6. Set payment_due_at (auto-fill from supplier term)
7. Click "Tanda Tangan & Selesai" → `sign_tukar_faktur` RPC: 
   - status → TERTANDA
   - Set `purchase_invoices.tukar_faktur_id` on each bundled row
   - Generate PDF tanda terima (server-side via Edge Function OR client-side jspdf then upload)
   - Schedule calendar reminder via existing notification config

PDF tanda terima layout: A4 with supplier letterhead, list of Tagihan, total, payment due date, signature line. Auto-archived to Storage.

## 10. WA reminder to suppliers — REMOVED from Phase 2

Originally proposed 3 trigger points (payment reminder / payment confirmation / TF tanda terima). All three taken out after critique:

1. **Payment reminder to supplier is backwards.** Buyer reminding supplier about money owed — suppliers remind buyers, not vice versa. Use case doesn't exist in real ops.
2. **Internal reminder is already covered by AP Dashboard** (Beranda Pembelian KPI + cash flow forecast 7-day). Owner sees what to pay each morning; no need for WA push.
3. **Manual operator WA forward is more polite + contextual** than auto-template (relationship-driven supplier comms).
4. **whatsmeow integration already loaded with Calista (customer chat).** Adding supplier WA = identity mismatch, separate phone matrix, opt-in templates editor — scope creep not proportionate to value.
5. **Not requested by current operator.** Sinar Elektrik / Garindo Jaya runs without WA reminder today, zero complaint.

If demand surfaces post-launch (specific tenant asks), re-evaluate in Phase 3.

## 11. Business rules

### BR1 — Partial delivery (Pesanan REQUIRED)
1 Pesanan : N Tagihan. **Tagihan type='STOCK' wajib dari Pesanan** — no ad-hoc Tagihan. `pesanan_items.qty_received_total` updated by trigger from Tagihan items. Pesanan auto-CLOSED when all items.qty_received_total ≥ items.qty. Manual force-close via `void_pesanan(reason)` (supplier cancels sisa, etc.). Tagihan type='PASSTHROUGH' (BNL) tetap link ke Sales Order (order_id), bukan Pesanan.

### BR2 — Partial + consolidated payment
1 Pembayaran : N Tagihan via junction. Per-item amount editable. Tagihan.paid_amount = SUM of pembayaran_items.amount WHERE tagihan_id=this AND pembayaran NOT voided. Status: BELUM_LUNAS (0) → DIBAYAR_SEBAGIAN (0 < paid < total) → LUNAS (paid ≥ total).

### BR3 — Tukar Faktur same-supplier
All Tagihan bundled into a TF must share `supplier_id` with the TF. Enforce in `record_tukar_faktur` RPC.

### BR3a — Tukar Faktur is OPTIONAL
Tagihan can transition directly to Pembayaran WITHOUT being bundled into Tukar Faktur first. The TF entity exists for distributor B2B tenants that follow formal tukar-faktur ritual; tenants without that workflow simply pay Tagihan directly. No constraint requires `tukar_faktur_id` to be set before Pembayaran can reference a Tagihan.

UI affordance: Tagihan list shows "Bayar" button inline for any BELUM_LUNAS row regardless of whether it's bundled. Pembayaran form's outstanding picker shows BOTH unbundled Tagihan AND bundled Tukar Faktur as selectable rows.

### BR4 — Stock impact only on STOCK Tagihan
Phase 1 BR2 (PASSTHROUGH = zero stock) preserved. New STOCK Tagihan creates stock_lots + increments stocks.stock — same as existing PO RECEIVED behavior.

### BR5 — Kasir expense category
- PASSTHROUGH Tagihan (BNL) → "Pembelian Pass-Through" (Phase 1, already shipped)
- STOCK Tagihan → existing "Pembelian Stok" category (unchanged)
- Pembayaran inserts Kasir expense with sum total

### BR6 — Soft duplicate warning (extends Phase 1 BR6)
Same warning logic for Tagihan (type=STOCK) `supplier_invoice_number`. Operator override flag preserved.

### BR7 — Void cascades
- Void Pembayaran → reverse Tagihan.paid_amount + reverse Kasir expense
- Void Tagihan (LUNAS only) → reverse stock_lots + reverse Kasir expense + unlink from TF
- Void Tukar Faktur → unlink all Tagihan back to outstanding state

## 12. Phase 2a Migration list (foundation)

```
supabase/migrations/
  20260620000001_phase2_pesanan_schema.sql
  20260620000002_phase2_pembayaran_schema.sql
  20260620000003_phase2_pi_extend.sql              -- add pesanan_id, tukar_faktur_id, paid_amount cols on existing purchase_invoices
  20260620000004_phase2_rpcs_pesanan.sql
  20260620000005_phase2_rpcs_tagihan_extend.sql
  20260620000006_phase2_rpcs_pembayaran.sql
  20260620000010_phase2_migrate_po_data.sql        -- big-bang split
```

## 13. Phase 2b additions (Tukar Faktur)

```
  20260622000001_phase2_tukar_faktur_schema.sql
  20260622000002_phase2_rpcs_tukar_faktur.sql
```

## 14. Phase 2c additions (AP Report only)

```
  20260625000001_phase2_ap_dashboard_rpc.sql
```

No backend-go changes. Frontend reads RPC result, renders Beranda Pembelian (4 panels).

## 15. Out of scope (Phase 3 / future)

- SOP Profile picker (multi-preset tenant config)
- Approval workflow (admin→owner gating)
- Permintaan Pembelian + Penawaran Pembelian
- Retur Pembelian (return to supplier)
- Multi-currency
- PPN / Faktur Pajak formal compliance
- 3-way match enforcement
- **WA reminder to suppliers (any direction)** — internal AP dashboard covers reminder need
- Bank account master + reconciliation

## 16. Rollout checklist

1. Apply Phase 2a migrations to staging Supabase → verify checksums match production snapshot
2. Build frontend for Phase 2a → deploy preview → smoke test
3. Schedule maintenance window → apply migrations to production → deploy frontend
4. Verify URL redirects work (`?po=PO-2026-XXXX` → Pesanan detail)
5. Verify existing reports still work (Laporan, Rekonsiliasi)
6. Phase 2b: ship Tukar Faktur after 1 week of Phase 2a stability
7. Phase 2c: ship AP Report after Phase 2b validated by founder

## 17. Backward compatibility checklist

- ✅ Phase 1 BNL unchanged (`purchase_invoices type='PASSTHROUGH'` preserved)
- ⚠️ Existing PO URLs (`?po=PO-2026-XXXX`) will 404 — admin staff (2-3 people) re-bookmark to new Pesanan URL. Internal announcement banner first week.
- ✅ Existing Kasir expense entries cross-referenced to new Pembayaran
- ✅ Existing stock_lots re-attributed to Tagihan via `source_id`/`source_type`
- ✅ Existing reports (Laporan, Rekonsiliasi) — UPDATE QUERIES needed to read from Pesanan+Tagihan instead of purchase_orders
- ⚠️ User training: PO → Pesanan + Tagihan + Pembayaran terms. PDF in-app help banner first 30 days post-launch.
