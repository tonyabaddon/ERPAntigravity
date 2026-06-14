---
name: pembelian-belanja-numpang-lewat-design
description: Phase 1 design spec — Belanja Numpang Lewat (pass-through purchase invoice) wajib link ke Sales Order, zero stock impact, Kasir expense on Lunas
metadata:
  type: project
---

# Pembelian: Belanja Numpang Lewat — Phase 1 Design Spec

**Status:** Spec • brainstormed 2026-06-14
**Surface area:** New menu "Belanja Numpang Lewat" under Pembelian; new table `purchase_invoices` + `purchase_invoice_items`; integration with existing Kasir expense + Order detail page.
**Mockup:** `tmp/pembelian-cash-invoice-mockup.html`
**Companion:** `2026-06-14-pembelian-phase2-roadmap-design.md` — Phase 2 PO refactor roadmap

## 1. Why

Saat customer minta barang yang tidak ada di stok, operator beli dari toko grosir dan langsung jual same-day ke customer. Ini "numpang lewat" — barang tidak pernah masuk ke stok. Hari ini operator tidak punya cara record transaksi ini dengan benar:

- PO flow existing (DRAFT → ORDERED → RECEIVED → PAID) menambah stok di RECEIVED — salah untuk pass-through (barang tidak masuk gudang).
- Operator workaround dengan catat Kasir expense manual, tapi kehilangan linkage ke Order customer dan visibility profit per Order.
- Margin di Laporan jadi misleading: Kasir sale pakai HPP stok lama (Rp 0 untuk SKU baru) → margin tampak 100% padahal sebenarnya cuma 30%.

Spec ini memperkenalkan entitas baru, **Belanja Numpang Lewat (BNL)** = Purchase Invoice dengan `type='PASSTHROUGH'`, yang:

- **Wajib di-link ke 1 Sales Order.** 1 Order : N BNL — barang untuk 1 customer bisa dari beberapa grosir.
- **Tidak menyentuh stok** — no `stock_lots` insert, no `stocks.stock` increment.
- **Track COGS per linked Order line** untuk profit akurat.
- **Record ke Kasir expense** saat status LUNAS — sama seperti PO PAID hari ini, untuk konsistensi cash-flow.

## 2. Phase 2 forward-compat

Phase 2 akan memperkenalkan 4-entity model (Pesanan + Tagihan + Tukar Faktur + Pembayaran) untuk stocking purchase flow. Supaya Phase 1 forward-compat:

- Table `purchase_invoices` dibuat di Phase 1 adalah fondasi. Phase 2 menambah row dengan `type='STOCK'` (= Tagihan supplier credit yang nambah stok).
- Phase 2 schema migration: `ADD COLUMN type TEXT NOT NULL DEFAULT 'PASSTHROUGH'`. Tidak ada data migration untuk row Phase 1.
- UI Phase 2 tambah menu "Tagihan" sejajar dengan "Belanja Numpang Lewat". Dua menu, satu table di backend.
- PO module existing **tidak diutak-atik** di Phase 1. Phase 2 akan migrasi PO data lama ke 4-entity model.

Detail Phase 2 di `2026-06-14-pembelian-phase2-roadmap-design.md`.

## 3. Data Model

### `purchase_invoices`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `pi_number` | text UNIQUE NOT NULL | Format `PI-YYYY-MM-NNN`. Auto-generate per bulan reset NNN ke 001. |
| `type` | text NOT NULL DEFAULT 'PASSTHROUGH' | `PASSTHROUGH` (Phase 1) / `STOCK` (Phase 2 reserved). |
| `supplier_id` | uuid FK → suppliers NOT NULL | Toko grosir. Bisa quick-add inline saat create. |
| `order_id` | uuid FK → orders | Sales Order tujuan. **NULL allowed di kolom level** (untuk Phase 2 STOCK), tapi diharuskan oleh CHECK constraint kalau type=PASSTHROUGH. |
| `purchase_date` | date NOT NULL DEFAULT CURRENT_DATE | Tanggal beli ke grosir. |
| `supplier_invoice_number` | text | Opsional. Nomor faktur/nota dari supplier (e.g., `INV-Eterna-0123`, `FK/2026/06/00045`). Toko grosir kadang nota tulis tangan tanpa nomor — itu sebabnya opsional. |
| `supplier_invoice_photo_url` | text | Opsional Supabase Storage URL. Foto faktur/nota asli dari supplier. Strongly recommended di UI (bukti dispute supplier kalau ada masalah). |
| `payment_method` | text NOT NULL | `CASH` / `TRANSFER` / `TEMPO`. |
| `payment_due_at` | date | Wajib kalau status=BELUM_LUNAS. Auto-fill = purchase_date + supplier.payment_term_days; editable. |
| `paid_at` | timestamptz | Set saat status → LUNAS. |
| `payment_proof_url` | text | Opsional Supabase Storage URL. Foto bukti bayar (transfer / kuitansi). Beda dari `supplier_invoice_photo_url`. |
| `subtotal` | numeric NOT NULL DEFAULT 0 | Sum dari line subtotal (qty × unit_cost). |
| `total` | numeric NOT NULL DEFAULT 0 | = subtotal di Phase 1 (no tax). Kolom terpisah supaya Phase 2 bisa add tax. |
| `status` | text NOT NULL DEFAULT 'BELUM_LUNAS' | `BELUM_LUNAS` / `LUNAS` / `TERLAMBAT` (derived). |
| `notes` | text | Opsional. |
| `created_by_user_id` | uuid FK → users | Pencatat. |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |
| `voided_at` | timestamptz | Soft-delete; set saat operator void PI lunas. |
| `voided_by_user_id` | uuid FK → users | |
| `void_reason` | text | |

**Indexes:**
- `pi_number` UNIQUE (numbering generator depends on this)
- `(supplier_id, status)` — fast filter outstanding per supplier
- `(supplier_id, supplier_invoice_number) WHERE supplier_invoice_number IS NOT NULL` — fast duplicate-detection warning
- `(order_id) WHERE order_id IS NOT NULL` — fast lookup PI per Order
- `(status, payment_due_at) WHERE status='BELUM_LUNAS'` — fast TERLAMBAT computation cron
- `(type, status, purchase_date DESC)` — fast list query

**CHECK constraints:**
- `(type != 'PASSTHROUGH' OR order_id IS NOT NULL)` — pass-through wajib link Order
- `(status != 'BELUM_LUNAS' OR payment_due_at IS NOT NULL)` — payment_due_at wajib saat belum lunas
- `(status != 'LUNAS' OR paid_at IS NOT NULL)` — paid_at wajib saat lunas
- `(voided_at IS NULL OR void_reason IS NOT NULL)` — alasan wajib saat void

**RLS:**
- SELECT: tenant member dengan `pembelian.read`
- INSERT: tenant member dengan `pembelian.create`
- UPDATE: tenant member dengan `pembelian.create` AND owner_or_creator (atau approve perm) AND `status='BELUM_LUNAS'`
- DELETE: tidak diperbolehkan; pakai soft-delete via `voided_at`

### `purchase_invoice_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `pi_id` | uuid FK → purchase_invoices ON DELETE CASCADE | |
| `sku` | varchar FK → stocks NOT NULL | SKU wajib (master). Inline create di form kalau SKU belum ada. |
| `product_name` | text NOT NULL | Snapshot nama dari stocks saat input. |
| `qty` | int NOT NULL CHECK (qty > 0) | |
| `unit_cost` | numeric NOT NULL CHECK (unit_cost >= 0) | Harga beli per unit ke grosir. |
| `sell_price` | numeric NOT NULL CHECK (sell_price >= 0) | Harga jual ke customer (snapshot dari Order line atau editable). |
| `subtotal` | numeric NOT NULL | qty × unit_cost. Stored for query speed. |
| `order_item_id` | uuid FK → order_items | Optional — link item PI ke specific Order line untuk COGS attribution presisi. NULL = match by SKU saja. |
| `created_at` | timestamptz DEFAULT now() | |

**Indexes:**
- `(pi_id)` — fast load items per PI
- `(sku)` — fast lookup BNL history per SKU

### Generator: `generate_pi_number()` RPC

```sql
CREATE OR REPLACE FUNCTION generate_pi_number() RETURNS text AS $$
DECLARE
  year_month text;
  next_seq int;
BEGIN
  year_month := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM');
  SELECT COALESCE(MAX(
    CAST(split_part(pi_number, '-', 4) AS int)
  ), 0) + 1
  INTO next_seq
  FROM purchase_invoices
  WHERE pi_number LIKE 'PI-' || year_month || '-%';
  RETURN 'PI-' || year_month || '-' || LPAD(next_seq::text, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Reset sequence per bulan. Format `PI-2026-06-001`.

### Inline SKU create

Saat operator buat PI dan SKU belum ada di master, dia bisa quick-create dari form. Default values:
- `category` = `'Pass-through'`
- `stock` = `0`
- `hpp_per_unit` = `unit_cost` (harga beli yang sedang diinput)
- `selling_price` = `sell_price` (harga jual yang sedang diinput)
- `is_active` = `true`

Tidak buat `stock_lots` row (karena BNL tidak nambah stok). SKU lahir dengan stok 0, kategori "Pass-through" supaya bisa di-filter / hide dari laporan stok utama.

## 4. Lifecycle

```
                          ┌── operator save form
                          │
                          ▼
                  ┌──────────────────┐
                  │ BELUM_LUNAS      │ ← payment_due_at set
                  └──────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              │ payment_due_at         │ operator "Tandai Lunas"
              │ < today (cron daily)  │
              ▼                       ▼
       ┌──────────────┐        ┌──────────────┐
       │ TERLAMBAT    │ ────►  │ LUNAS        │
       │ (derived)    │        │ paid_at set  │
       └──────────────┘        └──────────────┘
                                       │
                                       │ operator "Void" (audit reason)
                                       ▼
                                ┌──────────────┐
                                │ VOIDED       │ ← voided_at set, soft-delete
                                │ (history)    │
                                └──────────────┘
```

- **BELUM_LUNAS**: status default saat create. Operator masih bisa edit semua field.
- **LUNAS**: terjadi saat operator klik "Tandai Lunas" (modal upload bukti opsional). Setelah ini, edit tidak diperbolehkan. Trigger: insert Kasir expense entry.
- **TERLAMBAT**: derived — tidak disimpan sebagai status field. Computed di query: `status='BELUM_LUNAS' AND payment_due_at < CURRENT_DATE`. UI tampilkan sebagai badge merah.
- **VOIDED**: hanya bisa dari LUNAS, dengan alasan wajib. Trigger: reverse Kasir expense entry. PI tetap visible di history dengan flag "VOID".

**Edit rule:** PI di status BELUM_LUNAS boleh di-edit. PI di LUNAS hanya bisa Void & re-create (karena Kasir expense sudah tercatat — edit langsung akan inkonsisten).

## 5. Business Rules

### BR1 — Wajib link ke Order
`order_id` NOT NULL untuk type='PASSTHROUGH'. Validation di RPC + frontend.

### BR2 — Zero stock impact
`record_pi` RPC tidak memanggil `stock_lots` insert, tidak update `stocks.stock`. Berbeda dengan PO RECEIVED yang nambah stok.

### BR3 — COGS attribution
Untuk profit calculation per Order:
- Setiap PI item bawa `unit_cost` (harga beli) dan `sell_price` (harga jual).
- Saat Order ditandai lunas, COGS untuk item yang punya matching PI item = PI.unit_cost. Item yang tidak match PI = FIFO `stock_lots` (current behavior).
- Matching strategy: `order_item_id` FK kalau ada; kalau tidak, match by `sku` di Order line dengan qty cap (Order qty ≤ sum of PI qty for SKU).

### BR4 — Kasir expense pada LUNAS
Saat status → LUNAS:
- Insert `kasir_expenses`:
  - `date` = `paid_at` (WIB)
  - `expense_category` = `'Pembelian Pass-Through'`
  - `description` = `'BNL <pi_number> — <supplier name> — utk Order <order_number>'`
  - `subtotal` = `pi.total`

Berbeda category dari PO PAID ("Pembelian Stok") supaya laporan bisa pisahkan stocking vs pass-through.

### BR5 — Void reverse
Saat operator void PI lunas:
- Soft-set `voided_at` + `void_reason` + `voided_by_user_id`
- Insert reversal Kasir expense entry (negative amount) dengan reference ke original
- Order's profit calculation re-runs (kalau Order belum closed)

### BR6 — Duplicate supplier invoice number warning (soft)

Saat operator input `supplier_invoice_number`, RPC `record_pi` (sebelum INSERT) cek:

```sql
SELECT pi_number FROM purchase_invoices
WHERE supplier_id = $1
  AND supplier_invoice_number = $2
  AND voided_at IS NULL
  AND id != COALESCE($3, '00000000-0000-0000-0000-000000000000'::uuid)
LIMIT 1;
```

Kalau ada hasil:
- RPC return success dengan payload tambahan `{ warning: 'duplicate_supplier_invoice', existing_pi: <pi_number> }`
- Frontend display warning modal: "Faktur INV-0123 dari supplier ini sudah pernah dicatat di PI-2026-06-005. Lanjut?"
- Operator klik "Lanjut" → ulang call RPC dengan param `ignore_duplicate_warning=true` → skip check, INSERT.

Soft warning, bukan hard block — operator boleh override (kadang supplier kasih nomor sama karena typo).

### BR7 — Payment due reminder
Cron daily (Jakarta midnight):
- Untuk semua PI status=BELUM_LUNAS dengan `payment_due_at - CURRENT_DATE = 3`:
  - Insert reminder ke dashboard widget (visible saat user login)
- Untuk semua PI status=BELUM_LUNAS dengan `payment_due_at < CURRENT_DATE`:
  - Tidak ada DB status change (TERLAMBAT derived); cron cuma utk push notif

WA reminder ke supplier ditunda ke Phase 2 (whatsmeow integration).

## 6. RPC Functions

### `record_pi(payload jsonb) returns text` (pi_number)

```typescript
type RecordPiPayload = {
  supplier_id: string;
  order_id: string;
  purchase_date: string;       // YYYY-MM-DD
  supplier_invoice_number?: string;  // opsional, nomor faktur dari supplier
  supplier_invoice_photo_url?: string; // opsional, foto faktur supplier
  payment_method: 'CASH' | 'TRANSFER' | 'TEMPO';
  payment_due_at?: string;     // wajib kalau status=BELUM_LUNAS
  initial_status: 'BELUM_LUNAS' | 'LUNAS';  // operator boleh langsung lunas
  payment_proof_url?: string;
  notes?: string;
  items: Array<{
    sku: string;
    product_name: string;      // snapshot
    qty: number;
    unit_cost: number;
    sell_price: number;
    order_item_id?: string;
  }>;
  ignore_duplicate_warning?: boolean; // untuk konfirmasi setelah BR6 warning
};
```

Atomic:
1. Validate: supplier exists, order exists, items.length > 0, all SKUs valid.
2. Generate pi_number via `generate_pi_number()`.
3. Insert `purchase_invoices` row.
4. Insert `purchase_invoice_items` rows.
5. If initial_status=LUNAS: insert Kasir expense entry, set paid_at.
6. Return pi_number.

### `mark_pi_paid(pi_id uuid, proof_url text default null) returns void`

1. Lock PI row (FOR UPDATE).
2. Validate status=BELUM_LUNAS.
3. Update: status=LUNAS, paid_at=now(), payment_proof_url=COALESCE(proof_url, existing).
4. Insert Kasir expense entry.

### `void_pi(pi_id uuid, reason text) returns void`

1. Lock PI row.
2. Validate status=LUNAS AND voided_at IS NULL.
3. Validate reason length ≥ 10 chars.
4. Update: voided_at=now(), voided_by_user_id=auth.uid(), void_reason=reason.
5. Insert reversal Kasir expense entry (negative subtotal).

### `update_pi(pi_id uuid, payload jsonb) returns void`

1. Lock PI row.
2. Validate status=BELUM_LUNAS AND voided_at IS NULL.
3. Validate same as record_pi.
4. UPSERT items (delete missing, update existing, insert new).
5. Update header.

## 7. Frontend Architecture

### Sidebar

Existing "Pembelian" menu tetap. Sub-tabs di `PembelianScreen.tsx`:

- `Purchase Order` (existing, tidak berubah Phase 1)
- **`Belanja Numpang Lewat`** (NEW) ← Phase 1 ini
- `Supplier` (existing)

### Pages baru

```
src/components/pembelian/bnl/
  ├── BelanjaNumpangLewatList.tsx        — list + KPI + filter
  ├── BelanjaNumpangLewatFormPage.tsx    — create / edit form
  ├── BelanjaNumpangLewatDetailPage.tsx  — read-only detail with actions
  ├── PiNumberBadge.tsx                  — shared PI badge
  ├── PaymentMethodPicker.tsx            — Cash/Transfer/Tempo (reusable Phase 2)
  ├── OrderPicker.tsx                    — search + pick Sales Order
  ├── SkuPickerWithInlineCreate.tsx      — SKU autocomplete + "+ Buat SKU baru cepat"
  ├── MarkPaidModal.tsx
  └── VoidConfirmModal.tsx
```

### List page

KPI strip (4 card):
- Total PI bulan ini
- Total Belanja (subtotal sum)
- Belum Lunas (count + total)
- Terlambat (count + total)

Filter bar: preset chips (Bulan Ini / 30 Hari / 90 Hari / Custom).

Search: PI number, supplier, order number.

Status filter: All / Belum Lunas / Lunas / Terlambat.

Table columns: PI Number + Tanggal, Supplier (Grosir), Order Terkait, Total Beli, Pembayaran (badge cash/tempo + jatuh tempo), Status badge, Aksi (Tandai Lunas / Detail).

Tab-sync after detail-tab actions: refresh on `visibilitychange`.

### Form page

Header section (2 col grid):
- Order tujuan (search + pick; pill style menonjol; wajib)
- Supplier toko grosir (search + quick-add)
- Tanggal beli (date picker, default today)
- **Nomor faktur supplier** (text input, opsional, dengan placeholder "INV-0123 / nota tulis tangan")
- **Foto faktur supplier** (upload zone, opsional, accept JPG/PNG/PDF, max 5MB) — UI nudge: "Recommended — bukti kalau ada dispute supplier"
- Catatan (textarea)

Items section:
- Table: SKU/Nama (badge SKU + search picker dengan inline "+ Buat SKU baru cepat"), Qty, Harga Beli, Harga Jual (auto-fill from SKU master kalau ada, editable), Subtotal Beli, [✕]
- "+ Tambah item" row dengan inline search/create

Payment section (2 col):
- Metode (3-tile picker: Cash / Transfer / Tempo)
- Jatuh tempo (auto-fill dari supplier term, editable; tampil saat method=Tempo atau status=Belum Lunas)
- Status (radio: Sudah Lunas / Belum Lunas)
- Bukti bayar (upload, opsional)
- Reminder note: "Reminder otomatis 3 hari sebelum jatuh tempo. Lewat tanggal → status Terlambat."

Summary section (3 card):
- Total Beli (subtotal sum)
- Estimasi Jual (dari Order's matching items × sell_price)
- Estimasi Profit (% margin)

Action: Batal / Simpan Draft / Simpan & Tandai Lunas (kalau user punya `pembelian.create` AND mode=create AND status=LUNAS).

### Detail page

Header:
- PI Number + Status badge + Payment badge + "⚡ Pass-through" badge
- Aksi tergantung status: Tandai Lunas / Print / PDF / Void (kalau Lunas)

3 info card:
- Order Terkait (clickable ke Order detail)
- Supplier (+ nomor faktur supplier kalau ada)
- Jatuh Tempo (warna merah kalau Terlambat)

Lampiran section (2 thumbnail kalau ada):
- Foto faktur supplier (klik → fullscreen viewer)
- Foto bukti bayar (klik → fullscreen viewer)
- Tombol download / re-upload untuk owner

Items table (read-only): SKU, qty, unit cost, sell price, profit/unit, subtotal beli.

Profit summary 3 card: Total Beli, Pendapatan dari Order, Profit (% margin).

History panel (kalau ada): create/edit/lunas/void timestamps + user.

### Permission gating

- `pembelian.create` required untuk akses menu BNL
- `pembelian.read` required untuk lihat list/detail
- Owner role (semua perm) bisa create + langsung tandai lunas di 1 step
- Admin biasa (cuma `create`): tombol "Simpan & Tandai Lunas" hide; cuma "Simpan Draft"

## 8. Integration dengan modul existing

### 8.1 Order detail page

Tambah section "Purchase Invoice Terkait (Pass-Through)" di `OrderDetailPage`:

- List semua PI yang link ke Order ini
- Per PI row: PI Number + status + payment badge + supplier + total + tombol "Detail PI →"
- Tombol di header Order: "+ Buat PI untuk Order ini" → membuka BNL form pre-filled:
  - `order_id` set
  - Items pre-filled dari Order items yang belum punya source PI (semua qty)
  - Operator tinggal pilih supplier + harga beli

Item table di Order detail tambah kolom "Sumber Pengadaan":
- "📦 Dari Stok" (FIFO) untuk item yang dari stok existing
- "⚡ PI-2026-06-008" (badge link) untuk item yang dari PI

### 8.2 Kasir expense

Pakai existing `kasirService.insertExpense()` saat PI → LUNAS. Category `'Pembelian Pass-Through'` (baru, beda dari `'Pembelian Stok'` PO).

### 8.3 Laporan

Existing `LaporanScreen` perlu tambah:
- Filter expense by category: `Pembelian Pass-Through` vs `Pembelian Stok`
- Pembelian per Produk: include BNL transaksi dengan badge type
- Profit per Order: cross-reference PI dengan Order items untuk COGS akurat

Detail Laporan update di-spec terpisah (out of scope Phase 1 minimal).

### 8.4 Order's profit calculation

Existing Order's revenue−COGS calc:
- Untuk item yang tidak ada di PI: COGS = FIFO `stock_lots` (current behavior)
- Untuk item yang ada di PI (matched by sku + qty): COGS = PI.unit_cost

**Implementation:** SQL view `order_cogs_breakdown` yang join `order_items` ↔ `purchase_invoice_items` by `order_id` (header) + `sku` + qty cap. Logic:

1. Untuk tiap `order_items` row, cari `purchase_invoice_items` WHERE `pi.order_id = order.id AND item.sku = order_item.sku AND pi.voided_at IS NULL`
2. Allocate qty FIFO by `pi.created_at` ASC sampai habis order qty
3. COGS = SUM(allocated_qty × pi_item.unit_cost) + sisa qty × FIFO `stock_lots.unit_cost`
4. View materialized atau plain — keputusan saat implementasi berdasarkan query volume

Edge case: kalau total PI qty < order qty (under-coverage), sisa pakai FIFO stok. Kalau PI qty > order qty (over-coverage), warning di UI tapi tidak block — operator boleh beli buffer.

## 9. PDF Tanda Terima BNL

PDF generator di `src/lib/pdf/belanjaNumpangLewatPdf.ts`. Layout:

```
─────────────────────────────────────────────
Belanja Numpang Lewat — PI-2026-06-008
Tanggal: 13 Jun 2026          Status: ✓ LUNAS
─────────────────────────────────────────────
Supplier (Grosir): Toko Grosir Sumber Jaya
Cash & Carry
Faktur Supplier: INV-Eterna-0123  (kalau ada)
Untuk Order:     ORD-2026-1184 — Pak Heri (Walk-in)
─────────────────────────────────────────────
Item                Qty   Beli      Subtotal
Kabel NYM 3×2.5     30   12,000     360,000
Dus Inbow PVC        4   15,000      60,000
─────────────────────────────────────────────
                          TOTAL    420,000
─────────────────────────────────────────────
Pembayaran: Cash — Lunas 13 Jun 2026
[barcode atau QR code link ke detail]

Dibuat oleh: <user nama>
```

Single A6/half-A4 untuk hemat kertas. Bisa juga digital share (WA / email PDF link).

## 10. Permissions

Tambah ke `PermissionSet`:
- `pembelian` (existing) → masih cover keseluruhan
- Tidak ada permission baru di Phase 1; semua flow pakai existing `pembelian` permission

(Phase 2 akan split jadi `pembelian.create`, `pembelian.approve_pesanan`, `pembelian.approve_pembayaran`.)

## 11. Migration

### Schema migrations (Phase 1)

1. `20260614000001_pi_schema.sql`:
   - Create `purchase_invoices` table
   - Create `purchase_invoice_items` table
   - Create indexes
   - Setup RLS policies

2. `20260614000002_pi_rpcs.sql`:
   - `generate_pi_number()`
   - `record_pi(payload jsonb)`
   - `mark_pi_paid(pi_id uuid, proof_url text)`
   - `void_pi(pi_id uuid, reason text)`
   - `update_pi(pi_id uuid, payload jsonb)`

3. `20260614000003_pi_kasir_category.sql`:
   - Insert `'Pembelian Pass-Through'` ke kasir expense categories master (kalau ada)

### Backfill — tidak ada

Tidak ada data existing untuk dimigrate. Tabel baru, fitur baru.

## 12. Out of scope (Phase 1)

- **PO module refactor.** Existing PO flow tetap utuh. Phase 2 yang akan refactor.
- **Tagihan / Pesanan / Tukar Faktur / Pembayaran entities.** Phase 2.
- **SOP Profile per tenant.** Phase 2.
- **Approval workflow.** Phase 2.
- **AP Report (utang aging).** Phase 2.
- **Reconciliation panel (Tukar Faktur Day).** Phase 2.
- **WA reminder via whatsmeow.** Phase 2.
- **Multi-tenant naming customization (`Pengaturan → Belanja`).** Phase 2.
- **Penawaran (Quote) & Permintaan (PR).** Phase 3 if demand.
- **Retur Pembelian (return to supplier).** Phase 3.

## 13. Rollout plan

1. Deploy schema migrations 1, 2, 3.
2. Deploy frontend changes (PembelianScreen sub-tab + BNL pages + Order detail integration).
3. Smoke test:
   - Create BNL → status BELUM_LUNAS → verify Kasir expense NOT created
   - Mark as Paid → status LUNAS → verify Kasir expense created
   - Void Lunas BNL → verify reversal Kasir expense
   - Verify zero stock impact (stocks.stock tidak berubah)
   - Verify Order detail shows linked BNL
4. Update `progress.md`.
