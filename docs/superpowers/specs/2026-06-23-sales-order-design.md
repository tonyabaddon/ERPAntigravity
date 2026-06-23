# Sales Order (Penawaran) — Design Spec

**Date:** 2026-06-23
**Status:** Draft → user review pending
**Mockup:** `docs/superpowers/mockups/2026-06-23-sales-order-design.html` (7 frames)

---

## 1. Goal & Non-goals

### Goal
Tambahkan kemampuan untuk membuat **Sales Order (Penawaran)** ke customer
— dokumen pre-commitment yang berisi daftar harga + qty per item tanpa
menyentuh stok dan tanpa payment method. Saat customer accept,
operator klik "→ Jadi Sales Invoice" → wizard dibuka pre-filled di Step 3
dengan items + customer yang sudah terisi, operator pilih payment method
dan isi ongkir + alamat, lalu Sales Invoice resmi diterbitkan.

Sebagai bonus, tambahkan kemampuan **"+ Produk Baru"** inline di Step 2
(berlaku untuk Sales Order + Sales Invoice) sehingga operator tidak harus
keluar dari wizard kalau menemukan produk yang belum terdaftar.

### Non-goals (this iteration)
- ❌ Auto-expire Sales Order (manual close only).
- ❌ Approval gating untuk SO (per memory `feedback_no_approval_workflow.md`,
  owner = admin di founder's context; single Simpan button).
- ❌ Stock reservation (soft atau hard) — SO benar-benar tidak menyentuh stok.
- ❌ Full product CRUD di wizard. Operator hanya bisa "lite create" — foto,
  specs, min stock, dll. tetap di-set via Produk & Stok screen.
- ❌ Conversion balik (SI → SO). One-way only.
- ❌ Reopen CLOSED SO. Harus bikin SO baru.

### Wording rename (locked)
- "Catat Penjualan" → **Sales Invoice** (existing wizard, mode default).
- New: **Sales Order** (penawaran, wizard mode='quote').

UI strings yang berubah (high-level scan; lengkapnya di Section 11):
- Sidebar "Penjualan" menu icon tetap, child "Catat Penjualan" entry → not changed (wizard tetap dimount via `?screen=penjualanBaru`).
- Salesland landing tombol "+ Catat Penjualan" → "+ Sales Invoice", tambah "+ Sales Order".
- Wizard header "Catat Penjualan" → "Sales Invoice" (mode=invoice) atau "Sales Order" (mode=quote).
- New sidebar item: "Penawaran" (mounts DaftarPenawaranScreen).

---

## 2. Architecture

3-layer:
- **DB**: new `sales_orders` table + new `sales_order_counters` sequence + 3 RPCs.
- **Backend RPCs**: `create_sales_order`, `mark_sales_order_converted`, `close_sales_order`.
- **UI**: 1 new screen (`DaftarPenawaranScreen`), 1 new inline form
  (`NewProductInlineForm`), extend existing wizard with `mode` prop, extend
  `SalesInvoicePDF` with `quotation` variant.

SO does NOT reuse `orders` table. Cleaner separation: SO is pre-commit,
`orders` is for TEMPO/lead-driven flows that have stock-movement & payment
semantics. Aging queries, dashboards, /piutang stay clean.

Conversion **SO → SI** is a 2-step flow:
1. User klik "→ Jadi Sales Invoice" di SO row → frontend reads SO payload
   → navigates `?screen=penjualanBaru&fromSo=<so_id>` → wizard mounts in
   `mode='invoice'`, pre-fills channel/customer/items/notes from SO.
2. Operator completes Step 3 (payment + ongkir + alamat) → save via
   existing `record_kasir_sale` / `create_tempo_invoice` / `insertWipWithRakit`
   → on success, frontend calls `mark_sales_order_converted(p_so_id, p_target_id)`
   → SO row status='CONVERTED', `converted_to_kasir_tx_id` set.

The two-step approach avoids modifying the already-consolidated
`record_kasir_sale` signature (PR #45). The mark_converted call after SI
creation has a small race window — worst case an OPEN SO references an
already-issued SI; operator can reconcile manually. Acceptable trade-off
vs adding a 22nd param to record_kasir_sale.

---

## 3. Data Model

### 3.1 Table: `sales_orders`

```sql
CREATE TABLE public.sales_orders (
  id                          text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  so_number                   text NOT NULL UNIQUE,
  date                        date NOT NULL DEFAULT CURRENT_DATE,
  channel                     text NOT NULL,
  items                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal                    numeric NOT NULL,
  customer_id                 text REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name               text NOT NULL,
  customer_phone              text,
  customer_company            text,
  notes                       text,
  status                      text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CONVERTED','CLOSED')),
  converted_to_kasir_tx_id    text REFERENCES public.kasir_transactions(id) ON DELETE SET NULL,
  converted_to_order_id       text REFERENCES public.orders(id) ON DELETE SET NULL,
  closed_reason               text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT sales_orders_converted_fk_check CHECK (
    status <> 'CONVERTED'
    OR converted_to_kasir_tx_id IS NOT NULL
    OR converted_to_order_id IS NOT NULL
  )
);

CREATE INDEX idx_sales_orders_status_date ON public.sales_orders (status, date DESC);
CREATE INDEX idx_sales_orders_customer_id ON public.sales_orders (customer_id);
CREATE INDEX idx_sales_orders_so_number   ON public.sales_orders (so_number);
```

Notes:
- `channel` validated via `validate_sales_channel(channel)` (existing function).
- `items` shape mirrors `kasir_transactions.items` exactly:
  `{sku, name, qty, unit_price, hpp_per_unit, subtotal, hpp_subtotal, warehouse_id}`.
  `sku` is nullable (jasa lump-sum line, same as SI).
- `subtotal` includes products + jasa subtotals (no ongkir; ongkir doesn't
  exist for SO).
- `customer_id` SET NULL on delete because we snapshot `customer_name`+phone
  in the row anyway (PDF stays readable).
- `converted_to_kasir_tx_id` set when SI is LUNAS/DP (target = kasir_transactions row).
- `converted_to_order_id` set when SI is TEMPO (target = orders row).
- CHECK constraint: when status='CONVERTED', exactly one of the two target
  FKs must be non-null. Both nullable in OPEN/CLOSED states.
- Both SET NULL on delete (defensive — if SI somehow gets deleted, SO can
  be re-converted manually via mark_sales_order_converted with new target).
- `closed_reason` free-text. Future: maybe enum (LOST_DEAL/STALE_PRICE/CUSTOMER_GHOST).

### 3.2 Sequence table: `sales_order_counters`

```sql
CREATE TABLE public.sales_order_counters (
  channel  text NOT NULL,
  date     date NOT NULL,
  counter  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, date)
);
```

Used by `next_sales_order_number(p_channel, p_date) RETURNS int` (clone of
existing `next_kasir_number`). Format: `SO-{prefix}-YYYYMMDD-NNN` where
prefix matches channel (WLK, GSR, TPD, WAM, etc.) — same convention as
kasir invoice numbers.

### 3.3 RLS

Same pattern as `kasir_transactions`:
- `SELECT` for authenticated users (all rows readable).
- `INSERT` via SECURITY DEFINER RPC only (no direct table inserts).
- `UPDATE` via SECURITY DEFINER RPC only (status transitions guarded).
- `DELETE` not allowed (audit trail).

---

## 4. Backend RPCs

### 4.0 Helper: `next_sales_order_number(p_channel text, p_date date) RETURNS int`

Clone of existing `next_kasir_number` pattern: atomic INSERT…ON CONFLICT
UPDATE on `sales_order_counters(channel, date)` to return the next
counter. Used internally by `create_sales_order` to reserve the SO number
before the row insert.

### 4.1 `create_sales_order(p_payload jsonb) RETURNS sales_orders`

Mirrors `record_kasir_sale` minus payment + stock movement:

Payload shape:
```json
{
  "date": "2026-06-23",
  "channel": "walkin",
  "items": [
    {"sku": "0671d9fd", "name": "MCB SchneiderA 16", "qty": 100,
     "unit_price": 45000, "hpp_per_unit": 30000, "subtotal": 4500000,
     "hpp_subtotal": 3000000, "warehouse_id": "uuid-..."},
    {"sku": null, "name": "Custom Panel ...", "qty": 1,
     "unit_price": 3500000, "hpp_per_unit": 0, "subtotal": 3500000,
     "hpp_subtotal": 0}
  ],
  "subtotal": 8000000,
  "customer_id": "cust-uuid",
  "customer_name": "PT Cipta Mandiri",
  "customer_phone": "082277665544",
  "customer_company": "PT Cipta Mandiri",
  "notes": "Garansi 1 tahun. Ongkir dihitung saat di-convert."
}
```

Logic:
1. Validate `channel` via `validate_sales_channel`.
2. Validate items array non-empty.
3. Generate SO number via `next_sales_order_number(channel, date)`.
4. **NO stock movement.** `items` is stored as-is including hpp snapshot.
5. Find-or-create customer (mirror record_kasir_sale lines 73-93 — same wa_number lookup pattern).
6. INSERT into sales_orders with status='OPEN', created_by=auth.uid().
7. Return inserted row.

### 4.2 `mark_sales_order_converted(p_so_id text, p_target_kasir_tx_id text, p_target_order_id text) RETURNS sales_orders`

Called from frontend after SI successfully saved. Exactly one of the two
target params must be non-null (function raises if both null or both set).

Logic:
1. Lock SO row (SELECT FOR UPDATE).
2. Validate status='OPEN' — raise exception if already CONVERTED/CLOSED.
3. Validate exactly one target FK is non-null.
4. Validate target row exists in respective table.
5. UPDATE status='CONVERTED' + set whichever FK was passed.
6. Return updated row.

Mapping by SI path:
- `record_kasir_sale` (LUNAS/DP) → returns kasir_transactions.id → caller invokes with `p_target_kasir_tx_id=<id>, p_target_order_id=NULL`.
- `create_tempo_invoice` (TEMPO) → returns orders.id → caller invokes with `p_target_kasir_tx_id=NULL, p_target_order_id=<id>`.
- `insertWipWithRakit` (WIP/jasa) → returns kasir_transactions.id (status=WIP) → same as LUNAS path.

### 4.3 `close_sales_order(p_so_id text, p_reason text) RETURNS sales_orders`

Logic:
1. Lock SO row.
2. Validate status='OPEN'.
3. UPDATE status='CLOSED', closed_reason=p_reason.
4. Return updated row.

---

## 5. Frontend Components

### 5.1 New files

- `src/lib/salesOrderService.ts` — wrappers:
  - `createSalesOrder(payload): Promise<DbSalesOrder>`
  - `convertSalesOrder(soId): Promise<DbSalesOrder>` (just fetch SO + flag wizard to pre-fill; actual mark happens after SI saved)
  - `markSalesOrderConverted(soId, targetId): Promise<DbSalesOrder>`
  - `closeSalesOrder(soId, reason): Promise<DbSalesOrder>`
  - `fetchSalesOrders(filter): Promise<DbSalesOrder[]>`
  - `fetchSalesOrderById(soId): Promise<DbSalesOrder | null>`
- `src/lib/products/productWrappers.ts` — `insertNewProduct(args): Promise<SupabaseStockItem>`. INSERTs into `stocks` with stock_atas=0, stock_bawah=0, status='aktif'. Returns the new SKU.
- `src/components/penjualan/DaftarPenawaranScreen.tsx` — new listing screen (mirror DaftarPesananScreen structure: summary cards + tabs + table).
- `src/components/penjualan/wizard/NewProductInlineForm.tsx` — inline form: Nama (text), Kategori (select w/ existing + free-type), Unit (select), Harga Jual (number), Harga Modal (number optional), Sub-kategori/Brand (text optional). Save → call `insertNewProduct` → auto-add to cart via callback.

### 5.2 Modified files

- `src/types.ts`:
  - `ActivePage` += `'daftarPenawaran'`.
  - `DbSalesOrder` interface.
  - `InvoiceVariant` += `'quotation'`.
- `src/lib/urlRoute.ts`: `ACTIVE_PAGES.add('daftarPenawaran')`.
- `src/App.tsx`: case `'daftarPenawaran'` mounts `DaftarPenawaranScreen`.
- `src/components/Sidebar.tsx`: add `{ id: 'daftarPenawaran', label: 'Penawaran', icon: FileText, category: 'operasional', permKey: 'kasir' }` entry.
- `src/components/penjualan/CatatPenjualanWizard.tsx`:
  - Add `mode: 'invoice' | 'quote'` prop.
  - Add `fromSalesOrderId?: string` prop (passed via URL param `?fromSo=`).
  - Header title swaps based on mode: "Sales Invoice" vs "Sales Order".
  - Pre-fill logic: if `fromSalesOrderId`, fetch SO + populate channel/customer/cart/notes on mount.
  - Save dispatch:
    - mode='quote' → call `createSalesOrder` → navigate `?screen=daftarPenawaran` + toast.
    - mode='invoice' → existing dispatch (record_kasir_sale / create_tempo_invoice / insertWipWithRakit) THEN if `fromSalesOrderId` present, `markSalesOrderConverted(fromSalesOrderId, newTxId)`.
- `src/components/penjualan/wizard/Step2Items.tsx`:
  - Add "+ Produk Baru" affordance: appears below search results when zero matches OR always as a button. Per mockup: always-visible row "Produk belum ada di daftar?" + button.
  - Expand `NewProductInlineForm` inline when clicked. On save, callback adds returned SupabaseStockItem to cart with qty=1.
  - `onAddItem` callback (to wizard orchestrator) gets the new stock item like a normal search-result add.
- `src/components/penjualan/wizard/Step3Payment.tsx`:
  - Add `mode` prop.
  - Branch render:
    - mode='invoice' (current): full payment type + method + ongkir + alamat + dark navy summary + green Simpan.
    - mode='quote' (new): info banner (mode explanation), catatan textarea, amber summary card (subtotal=total, "belum termasuk ongkir" footnote), amber Simpan button. No payment selectors, no ongkir, no alamat.
- `src/components/penjualan/SalesInvoicePDF.tsx`:
  - Add `'quotation'` to `InvoiceVariant` type.
  - When variant='quotation': render "PENAWARAN" stamp top-right, replace "INVOICE" with "SALES ORDER" in header, hide ongkir line in totals, change "TOTAL INVOICE" → "TOTAL PENAWARAN", add footnote "Belum termasuk ongkir. Final total saat Sales Invoice.", hide alamat block (or label as "Alamat saat invoice"), drop "TANGGAL JATUH TEMPO" etc. (no payment data).
- `src/components/sales/SalesLandingScreen.tsx`: add "+ Sales Order" button alongside existing "+ Catat Penjualan" (renamed "+ Sales Invoice"). Buttons navigate to `?screen=penjualanBaru` and `?screen=penjualanBaru&mode=quote` respectively.

---

## 6. Data Flow

### 6.1 Create Sales Order

```
[Sales Landing] click "+ Sales Order"
   → navigate ?screen=penjualanBaru&mode=quote
[Step 1] pick channel + customer (same UX as SI)
[Step 2] add items + jasa (same UX; "+ Produk Baru" available)
[Step 3] (quote-mode) fill catatan, see amber summary
   → click "Simpan Sales Order"
[Wizard] dispatch createSalesOrder
[Backend] insert sales_orders row (status=OPEN), no stock movement
[Wizard] toast "Sales Order SO-WLK-20260623-001 tersimpan"
   → navigate ?screen=daftarPenawaran
[Daftar Penawaran] new row visible in Open tab
```

### 6.2 Convert SO → SI

```
[Daftar Penawaran] click "→ Jadi Sales Invoice" on OPEN row
   → navigate ?screen=penjualanBaru&fromSo=<so_id>
[Wizard] mode=invoice, fetchSalesOrderById(so_id) on mount
   → pre-fill: channel, customer, items[], notes
   → green banner "Pre-filled dari SO-WLK-20260623-001"
[Step 1+2] operator can adjust items / qty if scope changed
[Step 3] full payment UI (LUNAS/DP/TEMPO + method + ongkir + alamat)
   → click "Simpan Sales Invoice"
[Wizard] dispatch record_kasir_sale or create_tempo_invoice
[Backend] SI row created (stock moves)
[Wizard] markSalesOrderConverted(so_id, new_tx_id)
[Backend] SO status=CONVERTED + FK set
[Wizard] navigate ?screen=invoicePreview (existing flow)
[Daftar Penawaran] SO row moves to Converted tab + link to SI
```

### 6.3 Close Sales Order

```
[Daftar Penawaran] click "Tutup" on OPEN row
   → modal: "Tutup Sales Order?" + textarea "Alasan"
   → confirm
[Frontend] closeSalesOrder(so_id, reason)
[Backend] status=CLOSED, closed_reason set
[Daftar Penawaran] row moves to Closed tab, "Lost: <reason>" displayed
```

### 6.4 Add New Product (in either mode)

```
[Step 2] operator types search "produk baru"
   → 0 search results
   → click "+ Produk Baru" button
[NewProductInlineForm] expands
   → fill Nama, Kategori, Unit, Harga Jual, HPP (optional)
   → click "Simpan & Tambah ke Cart"
[Frontend] insertNewProduct({name, category, unit, price, hpp})
[Backend] INSERT stocks (sku=auto-uuid, stock_atas=0, stock_bawah=0, status='aktif')
[Wizard] receives new SupabaseStockItem
   → adds to cart with qty=1 (pre-order — stock=0 everywhere)
[Step 2 cart] new row visible with PRE-ORDER badge
```

---

## 7. Wizard Mode Prop Design

`CatatPenjualanWizard` extended:

```tsx
interface CatatPenjualanWizardProps {
  // existing props...
  mode?: 'invoice' | 'quote';   // default 'invoice'
  fromSalesOrderId?: string;    // pre-fill source
}
```

URL routing:
- `?screen=penjualanBaru` → mode='invoice' (default).
- `?screen=penjualanBaru&mode=quote` → mode='quote'.
- `?screen=penjualanBaru&fromSo=<so_id>` → mode='invoice' (conversion), pre-fill.

App.tsx reads URL params + passes props. urlRoute.ts already supports
arbitrary params on top of `screen`.

Inside wizard:
- Header title: `mode === 'quote' ? 'Sales Order' : 'Sales Invoice'`.
- Header badge `QUOTE MODE` shown only when mode='quote'.
- Step 3 rendered with `<Step3Payment mode={mode} ... />`.
- Save button copy + color driven by mode.
- Save dispatch branches: createSalesOrder vs existing flows.

`fromSalesOrderId` effect (one-shot pre-fill):
```tsx
useEffect(() => {
  if (!fromSalesOrderId) return;
  let cancelled = false;
  void (async () => {
    const so = await fetchSalesOrderById(fromSalesOrderId);
    if (cancelled || !so) return;
    setChannel(so.channel);
    setCustomer(matchOrFetchCustomer(so.customer_id, so.customer_name));
    setCart(so.items.filter(i => i.sku !== null).map(toCartItem));
    setRakitLines(so.items.filter(i => i.sku === null).map(toRakitLine));
    setNotes(so.notes ?? '');
    showBanner(`Pre-filled dari ${so.so_number}`);
  })();
  return () => { cancelled = true; };
}, [fromSalesOrderId]);
```

---

## 8. Quotation PDF Variant

Extend `SalesInvoicePDF` with `variant='quotation'`:

Visual differences vs `lunas`/`dp`:
- Title bar: "SALES ORDER" instead of "INVOICE".
- Rotated stamp top-right: `PENAWARAN` (3px amber border, amber text,
  -12deg rotation, 18px tracking, semi-transparent white bg).
- Customer block: omit alamat pengiriman row; add italic note "Alamat
  pengiriman ditentukan saat Sales Invoice diterbitkan."
- Items table: identical structure.
- Totals: hide "Ongkir" line. "TOTAL PENAWARAN" instead of "TOTAL INVOICE".
  Footnote: "* Belum termasuk ongkir. Final total saat Sales Invoice."
- Hide payment section (TANGGAL JATUH TEMPO, payment method, dll.).
- Footer disclaimer: "Dokumen ini bukan invoice resmi. Untuk pemesanan,
  konfirmasi ke admin untuk diteruskan menjadi Sales Invoice."

Reuse existing letterhead + bank info components.

Print modes (`normal` vs `dot_matrix`) both supported, same as invoice.

---

## 9. Error Handling

| Scenario | Behavior |
|---|---|
| `createSalesOrder` validation fails (empty items, invalid channel) | RPC raises EXCEPTION; wizard surfaces toast with error message |
| `convertSalesOrder` called on already-CONVERTED SO | Frontend pre-check + RPC double-check; UI shows "Sudah dikonversi ke SI-XXX, buka SI?" with link |
| `convertSalesOrder` called on CLOSED SO | UI shows "SO sudah ditutup. Buat SO baru." Button disabled. |
| Race: 2 admins convert same SO simultaneously | First markSalesOrderConverted succeeds; second gets RPC exception "Sales order status sudah CONVERTED". Second admin's SI tetap exist (no rollback) — show toast "SI tersimpan tapi SO sudah dikonversi oleh user lain. Cek Daftar Penawaran." |
| `markSalesOrderConverted` fails after SI created (network drop, etc.) | SI exists, SO stays OPEN. Wizard shows persistent banner on InvoicePreviewScreen: "⚠️ SO asal SO-XXX belum di-mark CONVERTED. [Coba lagi]". Operator can retry. Manual cleanup: from Daftar Penawaran, click "Tutup" with reason "Sudah jadi SI-YYY". |
| Customer deleted while SO is OPEN | SO.customer_id SET NULL by FK; SO.customer_name snapshot tetap readable. Convert flow shows warning "Customer asli sudah dihapus — sale ini akan tercatat tanpa link customer." |
| `insertNewProduct` fails (duplicate name? RLS?) | Toast "Gagal simpan produk: <message>". Form stays open, operator can retry / cancel. |
| New product with HPP=0 | Allowed (per memory pre-order pattern). Warning text in form: "HPP belum diisi — invoice akan punya HPP=0. Recommend isi sebelum simpan." |
| Stocks search query while typing exact SKU that exists | Normal search match, no "+ Produk Baru" CTA needed. Form opens via explicit button click. |

---

## 10. Testing

### 10.1 Vitest (pure / wrapper layer)

- `salesOrderService` wrappers — happy path + error path (mock supabase client).
- `productWrappers.insertNewProduct` — required field validation client-side; mock supabase response.
- `Step3Payment` mode=quote — renders catatan + summary, hides payment/ongkir/alamat. Vitest snapshot + assertion on absence of payment-method buttons.
- `Step3Payment` mode=invoice — unchanged, regression test.
- Wizard `dispatchSave` — branch on mode (quote → createSalesOrder; invoice + fromSo → record_kasir_sale + markSalesOrderConverted).

### 10.2 SQL smoke (via Supabase MCP, RAISE EXCEPTION rollback pattern)

- `create_sales_order` inserts row, returns row with status=OPEN.
- `create_sales_order` raises on invalid channel.
- `next_sales_order_number` increments per (channel, date).
- `mark_sales_order_converted` flips status to CONVERTED + sets FK.
- `mark_sales_order_converted` raises on already-CONVERTED row.
- `close_sales_order` flips status to CLOSED + sets reason.
- `close_sales_order` raises on already-CONVERTED row.
- Verify NO stock_movements rows created by create_sales_order.

### 10.3 Browser smoke (post-deploy)

- Create SO walkin → daftarPenawaran shows new row.
- Convert SO → wizard opens pre-filled → save LUNAS → invoicePreview shows new SI + Daftar Penawaran moves SO to Converted tab.
- Close SO → status=Closed, reason saved.
- Add new product mid-wizard (Step 2) → auto-add to cart → save SO → row visible. Check Produk & Stok screen confirms new SKU with 0 stock.
- Try to convert already-CONVERTED SO → blocked + correct error message.
- TEMPO SO conversion → routes to /piutang per existing flow.

---

## 11. Wording / Copy Audit

Strings yang perlu di-update:

| Location | Current | New |
|---|---|---|
| SalesLandingScreen primary button | "+ Catat Penjualan" | "+ Sales Invoice" (kept icon) |
| SalesLandingScreen | (none) | "+ Sales Order" (new amber button) |
| `SalesTabStrip.tsx` tab label | "📝 Catat Penjualan" | "📝 Sales Invoice" |
| Wizard header (mode=invoice) | "Catat Penjualan" | "Sales Invoice" |
| Wizard header (mode=quote) | (n/a) | "Sales Order" + `QUOTE MODE` badge |
| Wizard subtitle slug Step 3 | "Pembayaran & finalisasi" | (invoice: keep) / (quote: "Finalisasi penawaran") |
| Save button Step 3 (mode=quote) | (n/a) | "✓ Simpan Sales Order" (amber bg) |
| Toast after quote save | (n/a) | "Sales Order SO-XXX tersimpan" |
| Sidebar menu (new) | (n/a) | "Penawaran" entry |
| Daftar Penawaran title | (n/a) | "Daftar Penawaran" |
| Convert button label | (n/a) | "→ Jadi Sales Invoice" |
| Close button label | (n/a) | "Tutup" |
| Pre-fill banner | (n/a) | "Pre-filled dari SO-XXX · channel/customer/items/notes sudah diisi" |

NOTE: existing internal route `?screen=penjualanBaru` and existing
component name `CatatPenjualanWizard.tsx` are NOT renamed (avoid file
rename churn). Only USER-FACING strings change.

---

## 12. Permissions

Per memory `feedback_no_approval_workflow.md`: no new permission key. Reuse:

- **Create SO / Convert / Close** — require `permissions.kasir`. Same as Sales Invoice (single operator persona).
- **Insert new product** — require `permissions.kasir` (lite-create is part of wizard surface). Full product CRUD remains gated by `permissions.aiStock` in Produk & Stok screen.
- **View Daftar Penawaran** — require `permissions.kasir`.

Sidebar item visibility follows the same `kasir` perm flag.

---

## 13. Cross-cutting Impact

| Area | Impact |
|---|---|
| Sidebar navigation | +1 menu item in "Operasional" category between Penjualan and Kasir |
| URL routing | `ACTIVE_PAGES` += `'daftarPenawaran'`. Sub-page won't be evicted thanks to PR #44 sidebar fix. |
| Wizard component | +1 prop (`mode`), +1 prop (`fromSalesOrderId`), +1 effect (pre-fill), branched save dispatch. Test coverage for mode=invoice must stay green. |
| PDF | New variant in shared SalesInvoicePDF component. @page rules unchanged. |
| Dashboard / Laporan | NO changes. SO doesn't flow into revenue charts, aging, etc. (intentional — SO is pre-commit). Future: add "SO conversion rate" widget to dashboard. |
| /piutang aging | NO change. SO doesn't touch orders/piutang. |
| Stock movements | NO change. SO doesn't create stock_movements. |
| Recent activity / audit log | New audit events: `sales_order_created`, `sales_order_converted`, `sales_order_closed`. Future scope — not blocker for this iteration. |
| Migrations slot range | Claim `20260701000001-005` (5 slots: table, sequence table, 3 RPCs) — distant from existing in-flight parallel work. |

---

## 14. Out-of-scope / Deferred

- Auto-expire SO after N days.
- SO Approval workflow (Owner sign-off).
- SO → DP conversion path (SO accepted but partial bayar dulu).
- SO templates (re-use last SO for same customer).
- SO numbering reset per year/month.
- Bulk close (close multiple SO at once).
- SO email automation.
- SO sharing via public URL.
- Conversion reverse (SI → SO).

---

## 15. Implementation Effort Estimate

| Item | Days |
|---|---|
| Backend (table + sequence + 3 RPCs + RLS) | 0.5 |
| salesOrderService + productWrappers | 0.5 |
| DaftarPenawaranScreen (listing + tabs + filters) | 1.0 |
| Wizard mode prop + Step 3 branch + pre-fill effect | 1.0 |
| NewProductInlineForm + Step2Items wire-up | 0.5 |
| SalesInvoicePDF quotation variant | 0.5 |
| Sidebar entry + URL routing + App.tsx mount | 0.25 |
| SalesLandingScreen entry buttons + wording | 0.25 |
| Vitest coverage + SQL smoke + browser smoke | 1.0 |
| **Total** | **~5.5 days** |

Slot range claim: migrations `20260701000001-005`.

---

## 16. Risks

- **Wizard component growth**: CatatPenjualanWizard sudah 600+ LOC. Adding mode prop + fromSo effect = +50-100 LOC. If it gets unwieldy, consider extracting a `useWizardSavedispatch` hook. Not blocker now.
- **Race in mark_converted after SI created**: documented above. Worst case manual reconciliation. Could be hardened in v2 with idempotency tokens.
- **Snapshot drift**: items[] in SO includes hpp + unit_price snapshot at SO time. If product price changes before convert, SI pre-fill uses SO's snapshot (operator can adjust). Trade-off: operator may inadvertently quote stale price. Mitigation: pre-fill banner notes "Items dari SO — cek harga sebelum simpan SI."
- **Insert new product permission scope creep**: operators dengan `kasir` flag tapi bukan `aiStock` admin sekarang bisa bikin SKU. Trade-off vs DX (must leave wizard). Acceptable for MVP; revisit if abuse pattern surfaces.

---

**End of spec.** Mockup di `docs/superpowers/mockups/2026-06-23-sales-order-design.html`.
