# Fitur Diskon — Manual Per-Transaksi (Sales + Pembelian)

**Date:** 2026-06-23
**Status:** Draft (awaiting founder review)
**Scope:** Kasir + Penjualan wizard + Pembelian Tagihan PI (single-tenant Garindo)
**Estimasi:** 5-7 hari kerja
**Related:**
- `docs/superpowers/specs/2026-06-21-pengaturan-msme-configurability-design.md` (tenant_settings table extended)
- `supabase/migrations/20260607000051_kasir_discount_view.sql` (existing pengawasan view — direwrite)
- `supabase/migrations/20260715000002_chart_of_accounts_seed.sql` (akun 4-1900 Diskon Penjualan)

---

## 1. Konteks & Motivasi

ERP Garindo saat ini **tidak punya fitur diskon eksplisit**. Yang ada:
- **Kasir**: bisa override `unit_price` per-item secara langsung di cart (Path B implisit). Ke-track di view `v_pengawasan_kasir_discount_7d` sebagai `(stocks.price - kti.unit_price) * qty` — derived dari current `stocks.price` (latent bug: harga master berubah → "diskon" historis ikut bergeser).
- **Penjualan wizard**: tidak ada cara kasih diskon sama sekali.
- **Pembelian Pembayaran**: ada `pembayaran.discount_amount` (early-payment discount dari supplier). Tetap dipertahankan as-is.
- **Pembelian Tagihan PI**: tidak ada diskon di sumber (PI creation).
- **COA**: akun `4-1900 Diskon Penjualan (kontra)` sudah seeded; `5-1900 Diskon Pembelian` belum.

Founder ingin:
1. Formalkan diskon manual di Kasir + Wizard + Tagihan PI dengan input eksplisit (% atau Rp), level line dan order.
2. Configurable di Pengaturan (3 saklar on/off per modul, append ke `ModulSwitchesPanel` existing).
3. Apply ke menu impacted, dengan akuntansi auto-book ke akun kontra.
4. Path B (kasir edit harga langsung) tetap dipertahankan; backend auto-translate jadi diskon eksplisit + booking ke akun kontra.

### 1.1 Founder decisions (accepted risks)

| Decision | Konsekuensi |
|---|---|
| **Tanpa cap %, tanpa PIN gate** | Kasir/admin bebas kasih diskon berapapun. Risk revenue leak. Mitigasi: `v_pengawasan_kasir_discount_7d` retrospective monitoring. Re-evaluate setelah ~1 bulan; kalau abuse muncul, add cap + PIN sebagai Phase 2. |
| **Tanpa field alasan/reason** | Tidak ada audit "kenapa diskon dikasih". Diterima karena founder = admin = owner; konteks contextual. |
| **Tanpa COA mapping UI** | Akun kontra hardcoded (4-1900 sales, 5-1900 purchase). Founder boleh ubah via SQL kalau perlu. |
| **PDF always show diskon line (kalau > 0)** | Tidak ada toggle. Default show. |
| **JSONB shape untuk sales line discount** | `orders.items` dan `kasir_transactions.items` adalah JSONB; line discount = field di dalam JSONB tanpa CHECK/FK. Validasi RPC-level saja. Acceptable selama semua write lewat RPC. |
| **Pembayaran existing discount tidak refactor** | Sudah jalan produksi. Tetap as-is, additive dengan PI-level discount. |

---

## 2. Scope

### 2.1 In-scope

| # | Item | Estimasi (hari) |
|---|---|---|
| 1 | Migration: ALTER 4 tables (orders, kasir_transactions, purchase_invoices, purchase_invoice_items) | 0.5 |
| 2 | Migration: seed akun COA `5-1900 Diskon Pembelian` | 0.25 |
| 3 | Migration: 3 kolom toggle di `tenant_settings` | 0.25 |
| 4 | RPC patch: `record_kasir_sale` (markup validation, journaling) | 0.75 |
| 5 | RPC patch: `create_tempo_invoice` + sibling create_*_invoice | 0.75 |
| 6 | RPC patch: `record_pi` (journaling 5-1900) | 0.5 |
| 7 | Pengawasan view rewrite: sum explicit `discount_amount_rp` | 0.5 |
| 8 | Frontend shared: `<DiscountInlineInput>`, `<DiscountRow>`, `computeDiscountAmount()`, types | 0.5 |
| 9 | UI: Kasir cart + total bar + PDF | 0.75 |
| 10 | UI: Penjualan wizard Step 2/3 + PDF | 0.75 |
| 11 | UI: Pembelian Tagihan form + detail + PDF | 0.5 |
| 12 | UI: `ModulSwitchesPanel` append 3 toggle | 0.25 |
| 13 | Smoke test matrix (RPC happy/markup/over-discount; view regression) | 0.5 |
| 14 | Integration test & PDF visual check | 0.25 |
|   | **Total** | **~6.5 hari** |

### 2.2 Out-of-scope (defer)

| Item | Alasan |
|---|---|
| Promo code / voucher engine | Mini-project sendiri. Defer. |
| Per-customer-tier auto-discount (VIP/Reseller) | Butuh master customer tier baru. Defer. |
| Volume/qty-based pricing | Per-produk rule. Defer. |
| Max % cap + PIN gate | Founder pilih tanpa cap; revisit kalau abuse. |
| Reason/alasan field + preset CRUD | Founder pilih tidak perlu. |
| COA mapping UI | Hardcoded 4-1900 / 5-1900. Override via SQL. |
| PDF show/hide toggle | Always show kalau > 0. |
| Pembayaran discount refactor (existing) | Production-stable, risk regresi tinggi. Leave as-is. |
| Extract `orders.items` / `kasir_transactions.items` JSONB → tabel real | Multi-week migration. Defer ke spec terpisah. Terima asimetri sementara. |
| Diskon di Pembelian PO (purchase order) | Founder pick Tagihan saja; PO terlalu dini di funnel. |

---

## 3. Architecture Overview

Fitur diskon adalah **cross-cutting capability** — 2 representasi (line-level + order-level) di 3 modul transaksi (Kasir, Penjualan wizard, Tagihan PI), dengan 3 toggle di Pengaturan untuk hide UI per-modul. Backend RPC accept discount payload, validate, hitung effective amount, simpan, journal ke akun kontra.

Dua **entry path** konvergen ke representasi data yang sama:
- **Path A — eksplisit**: user input di field "Diskon" — toggle %/Rp.
- **Path B — implisit (Kasir + Wizard + Tagihan PI)**: user edit `Harga` (unit_price/unit_cost) per-item; backend deteksi `typed < master` dan auto-translate jadi line discount AMOUNT = `(master − typed) × qty`. UX cart tidak berubah.

**Markup** (typed > master) **ditolak** di RPC dengan error `MARKUP_NOT_ALLOWED`. Founder belum punya use-case markup; kalau muncul, tambah field eksplisit `markup_amount` di phase berikut.

### 3.1 Bidirectional UX di Cart

Setiap baris cart punya 3 input visible:

```
List Rp 100.000  (kecil, faded, di atas Harga — master price snapshot)
Harga: [Rp 80.000  ]   Diskon: [Rp 20.000 ▾ Rp/%]   Subtotal: Rp 800.000 (read-only)
```

**Sync rule**:
- Edit **Harga** → Diskon auto-update ke AMOUNT (`master − typed`). Format Diskon toggle reset ke `Rp`.
- Edit **Diskon** (apapun format) → Harga auto-update (`master − resolve(diskon)`).
- Master price disnapshot saat item ditambah ke cart (dari `stocks.price` saat itu). Tidak berubah meskipun `stocks.price` diupdate kemudian.

Diskon di **order level** punya UI input mirip di total bar (subtotal/total area), tanpa interaksi ke harga line.

---

## 4. Data Model

### 4.1 Pattern triple kolom

Untuk SETIAP tabel yang dapat diskon (level order maupun item), gunakan 3 kolom konsisten:

```sql
discount_type      TEXT  CHECK (discount_type IN ('PERCENT','AMOUNT')) NULL,
discount_value     NUMERIC  NULL  CHECK (discount_value IS NULL OR discount_value >= 0),
discount_amount_rp NUMERIC  NOT NULL DEFAULT 0  CHECK (discount_amount_rp >= 0)
```

Plus table-level CHECK menjaga triple konsisten:

```sql
ALTER TABLE <t> ADD CONSTRAINT <t>_discount_triple_chk
  CHECK (
    (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
    OR
    (discount_type IS NOT NULL AND discount_value IS NOT NULL AND discount_amount_rp >= 0)
  );
```

### 4.2 Tabel impacted

| Tabel | Order-level kolom | Line-level |
|---|---|---|
| `public.orders` | triple (3 kolom) | di dalam `items` JSONB |
| `public.kasir_transactions` | triple (3 kolom) | di dalam `items` JSONB |
| `public.purchase_invoices` | triple (3 kolom) | — |
| `public.purchase_invoice_items` | — | triple (3 kolom) + `master_unit_cost NUMERIC NOT NULL DEFAULT 0` |

### 4.3 JSONB shape extension (sales lines)

Untuk `orders.items[*]` dan `kasir_transactions.items[*]`:

```jsonc
{
  "sku": "KBL-001",
  "qty": 10,
  "unit_price": 100000,             // tetap = master price snapshot (NEVER typed override)
  "master_price_at_sale": 100000,   // NEW: explicit snapshot (redundant w/ unit_price for safety)
  "discount_type": "AMOUNT",        // NEW: nullable
  "discount_value": 50000,          // NEW: raw input (Rp atau %)
  "discount_amount_rp": 50000       // NEW: resolved Rupiah, always present (default 0)
}
```

**Penting**: `unit_price` di JSONB selalu = master price snapshot, BUKAN harga yang user ketik. Kalau Path B trigger (user ketik harga lebih rendah), backend translate jadi `discount_amount_rp` dan TETAP simpan `unit_price` sebagai master. Konsekuensi: konsumen JSONB lama yang hitung subtotal = `unit_price * qty` akan dapat angka pre-discount; harus eksplisit kurangi `discount_amount_rp`.

Existing rows tanpa field discount → field absent. Frontend dan view harus `COALESCE` ke 0/NULL.

**Semantik `discount_value` untuk AMOUNT** (penting, hindari ambiguitas):
- `discount_value` AMOUNT = **total Rp off the line**, bukan per-unit. Untuk qty=10 dengan AMOUNT 50000 → diskon line total Rp 50.000 (bukan Rp 500.000).
- `discount_value` PERCENT = % terhadap `unit_price × qty`. AMOUNT dan PERCENT untuk line yang sama selalu resolve ke `discount_amount_rp` identik.
- **Path B conversion rule** (Kasir/Wizard edit Harga): user ketik `typed_price` (per-unit) di kolom Harga. Backend & frontend derive:
  ```
  discount_type      = 'AMOUNT'
  per_unit_off       = master_price − typed_price       (≥ 0; else MARKUP_NOT_ALLOWED)
  discount_value     = per_unit_off × qty               (= line total)
  discount_amount_rp = discount_value
  ```
  Display di kolom Diskon = total line (Rp 200rb untuk qty=10 × Rp 20rb off), bukan per-unit. Kalau user mau per-unit thinking, lihat kolom Harga.
- **Path B reverse** (user edit Diskon): typed_price derive = `master − (discount_amount_rp / qty)`. Disclaimer ada pembulatan ketika qty > 1 dan diskon tidak habis dibagi rata.

### 4.4 Formula subtotal/total (uniform)

```
line_subtotal     = unit_price × qty − line_discount_amount_rp
order_subtotal    = SUM(line_subtotal)
order_total_sales = order_subtotal − order_discount_rp + shipping_fee
order_total_buy   = order_subtotal − order_discount_rp
```

### 4.5 Pengaturan toggles (tenant_settings)

Append 3 kolom ke `public.tenant_settings`:

```sql
ALTER TABLE public.tenant_settings ADD COLUMN
  modul_diskon_kasir       BOOLEAN NOT NULL DEFAULT TRUE,
  modul_diskon_penjualan   BOOLEAN NOT NULL DEFAULT TRUE,
  modul_diskon_tagihan     BOOLEAN NOT NULL DEFAULT TRUE;
```

Saat OFF: UI input/dialog di-hide. RPC tetap accept payload diskon (backward-compat data lama tetap bisa di-edit/re-render).

---

## 5. Per-Modul UI + RPC Contract

### 5.1 Kasir (KasirScreen)

**UI**:
- `CartRows`-equivalent di kasir: tambah kolom kecil "Diskon" di kanan kolom "Harga" (input %/Rp toggle, `<DiscountInlineInput>`). Master price tampil sebagai label kecil "List Rp …" di atas Harga.
- Total bar bawah: tambah baris "Diskon Order" antara Subtotal dan Total (`<DiscountRow>`).
- Hide kalau `tenant_settings.modul_diskon_kasir = false`.
- `KasirInvoiceModal` (PDF): tambah baris "Diskon" sebelum Total. Hide kalau `discount_amount_rp = 0`.

**RPC contract** (`public.record_kasir_sale` patch):

Latest signature pasca Phase 0b dual-write (`20260723000002`) sudah 22 params, urutan: `p_date, p_channel, p_items, p_subtotal, p_payment_method, p_payment_subtype, p_payment_type, p_dp_amount, p_dp_input_type, p_ongkir_amount, p_notes, p_total_amount, p_customer_name, p_customer_phone, p_customer_company, p_delivery_address, p_marketplace_order_no, p_wa_phone, p_wa_chat_url, p_customer_id, p_cash_account_id, p_allow_negative_stock`.

Tambah 3 params diskon sebelum `p_cash_account_id`:

```sql
DROP FUNCTION public.record_kasir_sale(...);  -- Postgres treats add-param as new signature
CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date date, p_channel text, p_items jsonb, p_subtotal numeric,
  p_payment_method text, p_payment_subtype text, p_payment_type text,
  p_dp_amount numeric, p_dp_input_type text, p_ongkir_amount numeric,
  p_notes text, p_total_amount numeric, p_customer_name text,
  p_customer_phone text, p_customer_company text, p_delivery_address text,
  p_marketplace_order_no text, p_wa_phone text, p_wa_chat_url text,
  p_customer_id text,
  p_discount_type       TEXT    DEFAULT NULL,     -- NEW
  p_discount_value      NUMERIC DEFAULT NULL,     -- NEW
  p_discount_amount_rp  NUMERIC DEFAULT 0,        -- NEW
  p_cash_account_id     UUID    DEFAULT NULL,     -- existing (Phase 0b)
  p_allow_negative_stock BOOLEAN DEFAULT FALSE
) RETURNS public.kasir_transactions ...
```

Frontend caller `recordKasirSale` di `src/lib/supabaseClient.ts:1396` ikut di-update.

`p_items` JSONB sekarang expect per-line discount fields (lihat 4.3 shape).

**RPC validation**:
1. Setiap line: `master_price_at_sale >= unit_price` (effective). Markup → `RAISE EXCEPTION 'MARKUP_NOT_ALLOWED: line %', sku`.
2. Setiap line: `discount_amount_rp <= unit_price × qty`. Over → `EXCESSIVE_LINE_DISCOUNT`.
3. Order-level: `p_discount_amount_rp <= subtotal − SUM(line.discount_amount_rp)`. Over → `DISCOUNT_EXCEEDS_SUBTOTAL`.
4. Recompute server-side; tidak trust input client. Re-derive `p_subtotal` & `p_total_amount` ulang dari items + ongkir + discount.

### 5.2 Penjualan Wizard (CatatPenjualanWizard)

**UI**:
- `Step2Items.tsx` + `CartRows.tsx`: tambah kolom Diskon + Harga master label (pattern sama dengan Kasir).
- `Step3Payment.tsx`: tambah baris "Diskon Order" sebelum Total dan Ongkir.
- Hide kalau `tenant_settings.modul_diskon_penjualan = false`.
- `InvoicePreviewScreen` / `SalesInvoicePDF`: baris Diskon (hide kalau 0).

**RPC contract**: wizard memakai 2 RPC tergantung payment path:
- **TEMPO** → `public.create_tempo_invoice(p_payload jsonb)` — payload-JSONB style (file: `20260615000011_create_tempo_invoice_rpc.sql`, latest: `20260630000003_create_tempo_invoice_allow_negative_stock.sql`).
- **DP / Lunas** → `public.record_kasir_sale(...)` — positional (sama dgn Kasir; perbedaan di `p_payment_type`). Sudah di-patch di 5.1.

Patch hanya `create_tempo_invoice` di section ini; payload extension:

```jsonc
{
  // ...existing fields
  "items": [/* dengan field discount_* per line + master_price_at_sale */],
  "discount_type": "PERCENT",
  "discount_value": 5,
  "discount_amount_rp": 60000
}
```

Validasi identik dengan Kasir RPC. Recompute server-side.

### 5.3 Pembelian Tagihan PI

**UI**:
- Tagihan form (di `src/components/pembelian/tagihan/`): tambah kolom Diskon per-item + label `master_unit_cost`.
- Total bar: baris "Diskon Tagihan" sebelum total.
- Hide kalau `tenant_settings.modul_diskon_tagihan = false`.
- Detail page + PDF (kalau ada) — tambah baris diskon.

**RPC contract** (`public.record_pi(payload jsonb)` patch):

```jsonc
{
  // ...existing
  "items": [{
    "sku": "...",
    "qty": 10,
    "unit_cost": 95000,             // = master (sebelum diskon, snapshot)
    "master_unit_cost": 95000,      // NEW snapshot (redundant w/ unit_cost untuk safety)
    "discount_type": "AMOUNT",
    "discount_value": 50000,
    "discount_amount_rp": 50000,
    "sell_price": 150000            // existing
  }],
  "discount_type": "PERCENT",
  "discount_value": 3,
  "discount_amount_rp": 30000
}
```

Validasi sama: markup blocked, over-discount blocked, server recompute.

**Pembayaran existing**: tetap. Outstanding formula:
```
pi.outstanding = pi.total − SUM(pembayaran.amount_total − pembayaran.discount_amount)
              -- pi.total sudah inkluder PI-level discount
```

### 5.4 Shared frontend (DRY)

Lokasi: `src/components/ui/discount/`:
- `<DiscountInlineInput value, type, baseAmount, onChange>` — input dengan %/Rp toggle untuk line-level.
- `<DiscountRow label, value, type, baseAmount, onChange>` — baris label+input untuk order-level di total bar.
- `computeDiscountAmount(value, type, base): number` — pure function.
- `useDiscountBinding(masterPrice)` — hook untuk bidirectional Harga ↔ Diskon sync di cart row.

Types di `src/types.ts`:
```ts
export type DiscountType = 'PERCENT' | 'AMOUNT' | null;

export interface DiscountTriple {
  discount_type: DiscountType;
  discount_value: number | null;
  discount_amount_rp: number;
}

export interface CartItemWithDiscount extends DiscountTriple {
  // existing fields preserved
  master_price_at_sale: number;
}
```

### 5.5 Pengaturan panel

Append 3 baris ke `src/components/pengaturan/ModulSwitchesPanel.tsx`:

```
Diskon di Kasir              [●○]  Aktif
Diskon di Penjualan          [●○]  Aktif
Diskon di Tagihan PI         [●○]  Aktif
```

Wired ke field baru di `tenant_settings`. Default ON. Founder bisa matikan kalau modul tidak dipakai.

---

## 6. Accounting (GL Journal)

### 6.0 Koordinasi dengan Akuntansi Phase 0b (dual-write to GL)

`record_kasir_sale` sudah mengaktifkan dual-write GL via `_post_journal_entry` (migration `20260723000002_phase0b_record_kasir_sale_dual_write.sql`). Pattern:
- Setelah insert `kasir_transactions` row, kalau `accounting_config.enable_dual_write_to_gl=true`, post `KASIR_SALE` journal entry.
- Cash account resolve dari `p_cash_account_id` → `accounting_config.default_*_account_id` → anomaly log.
- Pendapatan COA mapping dari kasir_channel via `_resolve_kasir_pendapatan_coa()`.
- Soft-fail: GL error → `gl_dual_write_anomalies` insert + `RAISE WARNING`; business row tetap RETURN.

**Implikasi untuk fitur diskon**: line baru `4-1900 Diskon Penjualan` (debit) ditambahkan **di dalam** `_post_journal_entry` call yang sama — bukan separate journal. Soft-fail pattern dipertahankan. Periksa apakah `create_tempo_invoice` dan `record_pi` sudah dual-write (saat plan); kalau belum, journal langsung post atau menunggu Phase 0c/0d (decision saat plan).

### 6.1 Sales (Kasir + Wizard)

Contoh invoice Rp 1.140.000 dari subtotal Rp 1.200.000 dengan diskon Rp 60.000:

| Akun | Debit | Credit |
|---|---|---|
| 1-1100 Kas/Bank | 1.140.000 | |
| **4-1900 Diskon Penjualan (kontra)** | **60.000** | |
| 4-1100 Pendapatan Penjualan | | 1.200.000 |

Implementasi: di RPC `record_kasir_sale` / `create_*_invoice`, setelah journal line revenue, tambah journal line **debit** ke `4-1900` dengan nominal:
```
total_discount_rp = SUM(item.discount_amount_rp) + order.discount_amount_rp
```
Akun `4-1900` sudah seeded — tidak perlu migration baru untuk akun.

### 6.2 Pembelian (Tagihan PI)

Contoh PI Rp 970.000 dari subtotal Rp 1.000.000 dengan diskon Rp 30.000 (STOCK):

| Akun | Debit | Credit |
|---|---|---|
| 1-1300 Persediaan | 1.000.000 | |
| 2-1100 Hutang Usaha (TEMPO) atau 1-1100 Kas (CASH) | | 970.000 |
| **5-1900 Diskon Pembelian (kontra HPP)** | | **30.000** |

Untuk PASSTHROUGH (debit langsung 5-1100 HPP, bukan 1-1300):

| Akun | Debit | Credit |
|---|---|---|
| 5-1100 HPP | 1.000.000 | |
| 2-1100 / 1-1100 | | 970.000 |
| 5-1900 Diskon Pembelian | | 30.000 |

**Akun baru perlu di-seed**: `5-1900 Diskon Pembelian` (tipe KONTRA, normal kredit, kurang HPP). Migration baru.

**Review point (NOT decided sekarang)**: untuk STOCK PI, contra-HPP discount muncul di periode beda dengan HPP STOCK-nya (HPP STOCK debit nanti saat sales). Acceptable untuk MSME Garindo monthly close. Kalau jadi issue di Akuntansi phase berikut, alternatif: discount kurangi Persediaan langsung (debit Persediaan less). Diputuskan saat phase Akuntansi follow-up.

### 6.3 Pembayaran existing (early-payment discount)

Tetap journal ke `4-1900` (kalau receipt customer) atau `5-1900` (kalau pembayaran ke supplier). Pattern existing tidak diubah. Additive dengan PI-level discount: total kontra di periode = `pi_discount + pembayaran_discount`.

---

## 7. Pengawasan View Migration

Rewrite `public.v_pengawasan_kasir_discount_7d` untuk sum explicit `discount_amount_rp` dari JSONB + top-level kolom:

```sql
CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
SELECT
  kt.created_by AS cashier_user_id,
  au.name       AS cashier_name,
  (SUM(COALESCE((kti.value->>'discount_amount_rp')::numeric, 0))
   + COALESCE(SUM(DISTINCT kt.discount_amount_rp), 0)
  )::numeric AS total_discount_rp,
  SUM((kti.value->>'unit_price')::numeric * (kti.value->>'qty')::int)::numeric AS total_revenue_rp,
  CASE WHEN SUM((kti.value->>'unit_price')::numeric * (kti.value->>'qty')::int) > 0
    THEN ( SUM(COALESCE((kti.value->>'discount_amount_rp')::numeric, 0))
           + COALESCE(SUM(DISTINCT kt.discount_amount_rp), 0) )
         / SUM((kti.value->>'unit_price')::numeric * (kti.value->>'qty')::int)::numeric
    ELSE 0
  END AS discount_pct_of_revenue
FROM public.kasir_transactions kt
LEFT JOIN LATERAL jsonb_array_elements(kt.items) AS kti(value) ON TRUE
LEFT JOIN public.admin_users au ON au.id = kt.created_by
WHERE kt.type = 'income'
  AND kt.status IN ('PAID','COMPLETED')
  AND kt.created_at >= now() - INTERVAL '7 days'
GROUP BY kt.created_by, au.name;
```

(Implementer note: `SUM(DISTINCT kt.discount_amount_rp)` adalah hack untuk hindari double-count top-level di lateral join — saat plan, lebih bersih CTE: aggregate line dulu, lalu join ke top-level dengan satu row per kt. Bersihkan saat write migration.)

**Order-level attribution decision**: order-level discount **TIDAK** di-prorate ke per-line; dijumlah utuh ke total cashier. Sederhana dan defensible. Kalau founder mau granular per-line attribution nanti, tambah view varian.

**Latent bug fix**: view lama derive dari `s.price - kti.unit_price` (current `stocks.price`); view baru baca explicit snapshot. Harga master berubah tidak lagi geser angka historis.

**Backward-compat**: existing kasir_transactions tanpa field `discount_amount_rp` → COALESCE ke 0; sales lama "stealth discount" (Path B pre-migration) **tidak ter-counted** di view baru. Acceptable: window 7 hari, dalam 1 minggu data lama akan habis.

---

## 8. Testing

### 8.1 Unit (Vitest)

- `computeDiscountAmount(value, type, base)` — happy + edge (0%, 100%, > base, NaN guard).
- `<DiscountInlineInput>` render & state transition (toggle %/Rp preserves equivalence).
- `useDiscountBinding` hook — bidirectional sync sequences (Harga edit → Diskon update; Diskon edit → Harga update; toggle format preserve nilai).
- `<DiscountRow>` render.

### 8.2 SQL/RPC smoke (pakai pattern `reference_smoke_test_security_definer_rpcs.md`)

Pakai `set_config('request.jwt.claim.sub', <admin_id>)` + `RAISE EXCEPTION` di akhir untuk rollback. MCP `execute_sql`:

- **`record_kasir_sale`** matrix:
  - Happy: line discount %, line discount Rp, order discount %, order discount Rp, combined. Verify `total_amount`, JSONB shape, journal lines (4-1100 credit, 1-1100 debit, 4-1900 debit).
  - Markup: typed > master → expect `MARKUP_NOT_ALLOWED`.
  - Over-discount: order discount > subtotal-after-line → expect `DISCOUNT_EXCEEDS_SUBTOTAL`.
  - Excessive line: line discount > unit_price × qty → expect `EXCESSIVE_LINE_DISCOUNT`.
  - Toggle OFF di settings: RPC tetap accept (backward-compat).
- **`create_tempo_invoice`** (+ siblings): same matrix.
- **`record_pi`**: same matrix, plus PASSTHROUGH vs STOCK journal correctness, plus interaksi dengan Pembayaran existing discount (additive).

### 8.3 View regression

- Seed 3 kasir_transactions pre-migration shape (no discount fields) + 3 post-migration (with line + order discount) → query view → verify sum benar untuk dua jenis row.
- Verify `stocks.price` update tidak menggeser angka historical (latent bug regression).

### 8.4 Integration / E2E

- Wizard end-to-end: tambah item, input line discount 10%, input order discount Rp 50k, save TEMPO → buka invoice PDF, verify baris Diskon muncul, Total benar.
- Kasir Path B: input qty 5, edit Harga dari 100k → 80k, verify Diskon field update ke "Rp 100.000" (100k × … wait, master − typed = 20k per unit, total line discount = 20k × 5 = 100k). Save, verify backend store `unit_price=100k` (master), `discount_amount_rp=100k`, dan journal 4-1900 = 100k.
- Tagihan PI: input order discount %, save, verify total benar dan journal 5-1900 = expected.

### 8.5 Visual / PDF

- Generate sample PDF (Kasir invoice + Sales invoice + PI doc kalau ada) untuk transaksi dengan diskon — verify baris Diskon render benar, layout tidak rusak.

---

## 9. Migration & Rollout

### 9.1 Slot

`20260801xxxxxx` series (jaga jarak dari Akuntansi Phase 0b in-flight per `project_phase3_warehouse_cutover_pending.md`).

### 9.2 Order

| File | Isi |
|---|---|
| `20260801000001_diskon_schema.sql` | ALTER 4 tables (orders, kasir_transactions, purchase_invoices, purchase_invoice_items) + triple-check constraints |
| `20260801000002_diskon_pembelian_coa_seed.sql` | INSERT 5-1900 Diskon Pembelian ke `chart_of_accounts` |
| `20260801000003_tenant_settings_diskon_toggles.sql` | 3 kolom toggle + default TRUE + backfill kalau ada row Garindo |
| `20260801000004_record_kasir_sale_with_discount.sql` | RPC patch + validation |
| `20260801000005_create_tempo_invoice_with_discount.sql` | RPC patch (+ siblings di file sama) |
| `20260801000006_record_pi_with_discount.sql` | RPC patch |
| `20260801000007_pengawasan_kasir_discount_view_v2.sql` | View rewrite |
| (frontend deploy) | shared components + Kasir/Wizard/Tagihan/Pengaturan UI |

### 9.3 Backward-compat

- Existing rows: `discount_amount_rp = 0`, `discount_type/value = NULL`. Triple-check passes.
- Existing JSONB `items` tanpa discount fields: frontend & view COALESCE to 0/null. Tidak ada backfill.
- Existing PDF render tidak berubah untuk data lama (baris Diskon hidden saat 0).
- Existing RPC callers di frontend bertahap di-update; RPC signature backward-compat via default values pada parameter baru.

### 9.4 Rollback

Setiap migration punya pasangan DOWN file (`*_rollback.sql`) — drop kolom, restore view, restore RPC body (snapshot saved sebelum patch). Lokasi: `supabase/migrations/rollback/`.

---

## 10. Open Questions / Review Points

1. ~~Sales sibling RPC enumeration~~ — **resolved**: hanya 2 RPC sales (`record_kasir_sale` untuk Kasir + Wizard DP/Lunas; `create_tempo_invoice` untuk Wizard TEMPO). Tidak ada sibling create_dp/create_lunas.
2. **Order-level discount attribution di view**: dijumlah utuh ke cashier total (decision); kalau founder nanti mau per-line prorated, tambah view varian.
3. **PASSTHROUGH STOCK accounting timing**: contra-HPP discount muncul beda periode dengan HPP STOCK debit-nya. Acceptable untuk Garindo; revisit di akuntansi phase berikut.
4. **Markup support**: blocked saat ini. Kalau founder punya use-case ("naikin harga di lapangan untuk customer khusus"), tambah field eksplisit `markup_amount` di phase berikut.
5. **Pembelian PO discount**: skip sekarang (PI saja). Kalau ternyata negotiation lebih sering di PO, pindah ke PO + propagate ke PI saat receive.

---

## 11. Founder memory yang harus dipertahankan

- `feedback_no_approval_workflow.md` — diskon tanpa PIN gate sesuai pattern; no approval workflow.
- `feedback_allow_negative_stock_preorder.md` — stock check tetap relax di kasir RPC (tidak diubah spec ini).
- `feedback_no_adhoc_customers.md` — diskon tidak mengubah customer flow.
- `feedback_check_constraints_before_rpc_rewrite.md` — saat patch RPC, enumerate semua CHECK di tabel target (subtotal >= 0, total >= 0, dll); pastikan recompute server-side tidak melanggar di state intermediate.
- `feedback_font_sizing.md` — baris Diskon di PDF ikuti pattern 11-12px PDF data.
- `reference_smoke_test_security_definer_rpcs.md` — smoke test pakai pattern fake auth.uid + RAISE EXCEPTION rollback.
