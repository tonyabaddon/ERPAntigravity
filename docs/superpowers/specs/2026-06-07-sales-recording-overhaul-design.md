# Sales Recording Overhaul — Design Spec

**Date:** 2026-06-07
**Sub-project:** A (Tier 1 — daily revenue & margin)
**Scope items:** 5, 6, 7, 8 (+ WhatsApp manual channel)
**Status:** Draft for user review

## Goal

Replace the modal-based Sales Recording flow (`SaleModal` in `KasirScreen`) with a dedicated full-page UX optimised for daily walk-in / Tokopedia / grosir / WhatsApp transactions. Add DP+Lunas invoice flow, standardise payment methods (Cash / Transfer / EDC with sub-type), regenerate PDF invoice with logo + bank rek + T&C, and surface per-warehouse stock during item search.

## Non-goals (out of scope here)

- Payment-proof upload (user explicitly deferred — "skip for now")
- Migrating `kasir_transactions` into the `orders` table (handled later in sub-project G — Channel Unification)
- Wiring/rakit open-invoice lock flow (sub-project B)
- Tokopedia chat sync / push stock & price (sub-project H)
- Mobile-friendly responsive audit (sub-project I)
- Data migration from legacy systems (sub-project J)

## User flow

1. Admin opens **Catat Penjualan** from sidebar → routes to `/penjualan/baru`
2. Picks channel via top pills (Walk-in / Tokopedia / Grosir / WhatsApp)
3. Channel-specific strip appears below pills when relevant (Tokped order no., WA contact info)
4. Searches item by SKU or name in left panel; sees stock-per-warehouse pills (Atas / Bawah); clicks **+ Tambah** to add to cart
5. Each cart row has a mini warehouse selector (Atas / Bawah); admin picks per item which warehouse to deduct from
6. In right panel: searches existing customer (locks form when picked) OR fills new customer (name + HP wajib, perusahaan opsional)
7. Picks payment method (Cash / Transfer / EDC); if EDC, picks sub-type (Debit / QRIS)
8. Toggles payment type (Full / DP); if DP, enters DP amount (nominal or %)
9. Optionally toggles **Biaya Ongkir** and enters amount; optionally fills **Catatan** (textarea)
10. Reviews totals (Subtotal + Ongkir − DP = Sisa; Total = Subtotal + Ongkir)
11. Clicks **Simpan & Cetak Invoice DP** or **Simpan & Cetak Invoice Lunas** (button label adapts)
12. System: persists transaction → decrements stock per warehouse → auto-prints invoice to dotmatrix printer → redirects to Kasir dashboard with success toast

For DP transactions, later: admin opens transaction detail → clicks **Tandai Lunas** → modal asks payment method for pelunasan → confirm → status updates to COMPLETED → auto-prints **Invoice Lunas** referencing the DP invoice number.

## UI design

### Page layout

- Top nav (existing app shell): breadcrumb "Dashboard › Penjualan › Baru", date pill, user pill
- Body in two columns: left ≈ 1.6fr (Items + Cart), right ≈ 1fr (Customer + Payment + Totals)
- Base body font: **14px**. Labels uppercase tracking-widest: **11px**. Headings 13-15px. No text below 11px in user-facing surfaces.

### Channel selector

Pill toggle row, mutually exclusive:

| Channel | Active style | Behaviour |
|---|---|---|
| 🏪 Walk-in | blue-50 bg, blue-700 text, blue-700 border | No extra strip |
| 🛍️ Tokopedia | amber-100 bg, amber-700 text, amber-600 border | Strip below: input "Nomor Pesanan Tokopedia" (required, free-text) |
| 🏭 Grosir | violet-100 bg, violet-700 text, violet-600 border | No extra strip in v1 (discount/term fields deferred) |
| 💬 WhatsApp (badge MANUAL) | green-100 bg, green-700 text, green-600 border | Strip below: "No WA pelanggan" + "Link chat WA" (both optional, info-only); subtitle: "Pesanan WA yang di-input manual oleh admin" |

### Left panel — Items + Cart (the prominent panel)

Distinct visual treatment so cashier can find it quickly:

- Container: 2px amber border, soft amber-to-white gradient background, drop shadow
- Header bar: amber-500 bg, white text, uppercase title "🛒 TAMBAH BARANG & KERANJANG", white pill counter showing "{N} ITEM · Rp {subtotal}"

**Search row:** large search input (12px padding, 13px font, 2px border, search icon), focus ring amber

**Search results dropdown** (when typing): each row shows:
- Item name (bold) + SKU (muted)
- Stock pills: 🔵 `Atas {n}` (blue) + 🟡 `Bawah {n}` (amber). When stock is 0, the pill turns red `Atas 0` / `Bawah 0`.
- Unit price + green **+ Tambah** button

**Cart header strip:** green-50 bg, green-700 text — "🧺 Keranjang [N item] · Rp {subtotal}"

**Cart row** (per item): grid with:
- Name + SKU/unit-price subtext
- **Per-row warehouse selector**: mini segmented control `Atas {qty} | Bawah {qty}`. Default = the warehouse with enough stock; if user changes, validates against stock. Stock 0 in one warehouse → that option is disabled (greyed out).
- Qty stepper (− input +)
- Row subtotal (navy bold)
- ✕ remove button

### Right panel — Customer + Payment

**Customer search (autocomplete)**:
- Single search input with magnifier icon
- Empty: typing triggers dropdown of matching customers (name / company / WA number; max 6 results)
- Each dropdown row: bold name, meta line "HP · Company · {N} pesanan", PILIH chip
- No match → bottom row "+ Daftar pelanggan baru '{query}'"

**Selected state**:
- Search input becomes locked (🔒 icon, readonly, value = "{name} (dipilih)", greyed bg)
- Green chip below: name (bold), 📞 HP · 🏢 Company, 🛒 N pesanan · 💰 Total Rp X, **✕ Ganti** button (resets to empty state)
- New customer block appears DIMMED (opacity 0.6, pointer-events none, hint "🔒 Nonaktif — sudah pilih pelanggan terdaftar")

**New customer block** (only editable when no selection):
- Yellow-50 dashed border, title "+ Daftar Pelanggan Baru"
- Nama lengkap (required)
- Nomor HP / WA (required) + Nama perusahaan (optional) in a 1.4fr/1fr grid
- Hint "* wajib · Nama perusahaan opsional"

On save: if `selectedCustomerId` is null and customer fields filled → auto-create new customer record via `customersService.createCustomer` (existing behaviour preserved).

**Payment method**: 3-column grid of buttons (Cash / Transfer / EDC). Active style: navy bg, white text. When EDC active, sub-pill row appears below: Debit / QRIS (one must be chosen — defaults to Debit).

**Payment type toggle**: segmented control (Full Payment / DP / Tanda Jadi). When DP active, additional row: amount input + nominal/percent selector.

**Tambahan section** — Ongkir toggle:
- Switch-style toggle (orange when on); when on, an orange input appears below

**Catatan section**:
- Sky-50 bg, sky-700 text textarea
- Heading: "📝 Catatan" + meta "opsional · tampil di invoice"
- Placeholder example: "Mis. Garansi 1 bulan. Antar ke alamat..."

**Totals block** (slate-50 bg, padding 10px 12px):
```
Subtotal barang             Rp ...
↳ Biaya ongkir              Rp ... (only if ongkir > 0; orange)
↳ DP diterima               Rp ... (only if payment_type=DP; green)
↳ Sisa pelunasan            Rp ... (only if payment_type=DP; amber bold)
─────────────────────────────────
TOTAL INVOICE               Rp ... (navy 15px bold, double-line top)
```

**Action buttons** (stacked):
- Primary: adapts to payment_type
  - DP: amber bg, "💾 Simpan & Cetak Invoice DP"
  - Full: green bg, "💾 Simpan & Cetak Invoice Lunas"
- Secondary: white ghost "Batal"
- Hint below: "🖨️ Invoice otomatis dikirim ke printer dotmatrix"

There is no "save without print" option — printing is always part of the save flow.

### Validation rules

- At least 1 cart item required
- Customer: either selected from list OR all required new-customer fields filled (name + HP)
- For DP: dp_amount > 0 AND dp_amount < total
- For Tokopedia channel: `tokped_order_no` is required
- For EDC payment: `payment_subtype` must be set ('debit' or 'qris')
- For each cart row: chosen warehouse must have ≥ qty stock (RPC will also re-validate)

## Data model changes

### `kasir_transactions` table

Add columns:

```sql
ALTER TYPE kasir_channel ADD VALUE 'whatsapp';

-- Replace 'qris' with 'edc' + sub-type column
ALTER TYPE kasir_payment_method RENAME VALUE 'qris' TO 'edc';  -- if enum rename not supported, use add+migrate+drop
ALTER TABLE kasir_transactions
  ADD COLUMN payment_subtype TEXT,           -- 'debit' | 'qris' | NULL
  ADD COLUMN payment_type    TEXT NOT NULL DEFAULT 'FULL',  -- 'FULL' | 'DP'
  ADD COLUMN dp_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN dp_input_type   TEXT,           -- 'AMOUNT' | 'PERCENT' | NULL
  ADD COLUMN ongkir_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN notes           TEXT,
  ADD COLUMN total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,   -- subtotal + ongkir (denormalised for query speed)
  ADD COLUMN tokped_order_no TEXT,
  ADD COLUMN wa_phone        TEXT,
  ADD COLUMN wa_chat_url     TEXT,
  ADD COLUMN status          TEXT NOT NULL DEFAULT 'PAID',  -- 'PAID' | 'AWAITING_LUNAS' | 'COMPLETED' | 'CANCELLED'
  ADD COLUMN lunas_at        TIMESTAMPTZ,
  ADD COLUMN lunas_payment_method kasir_payment_method,
  ADD COLUMN lunas_payment_subtype TEXT;
-- We use 1 row + state machine (no parent_invoice_no — DP and Lunas share the same row).

-- Status integrity checks
ALTER TABLE kasir_transactions
  ADD CONSTRAINT chk_kasir_payment_type   CHECK (payment_type IN ('FULL','DP')),
  ADD CONSTRAINT chk_kasir_status         CHECK (status IN ('PAID','AWAITING_LUNAS','COMPLETED','CANCELLED')),
  ADD CONSTRAINT chk_kasir_payment_subtype_edc CHECK (
    (payment_method <> 'edc') OR (payment_subtype IN ('debit','qris'))
  );
```

**Items JSON shape** (existing `items` column already exists as `KasirItem[]`; we add a field per row):

```ts
type KasirItem = {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  hpp_per_unit: number;
  subtotal: number;
  hpp_subtotal: number;
  warehouse: 'atas' | 'bawah';  // NEW
};
```

We store warehouse in the JSON (per row), not in a separate column, so each cart row can come from a different warehouse.

### `company_settings` table

Add column `logo_url TEXT` (nullable). Logo file uploaded via Pengaturan → Profil Toko form → Supabase Storage bucket (reuse existing `payment-proofs` bucket pattern or create new `branding` bucket — implementation plan decides).

### Invoice numbering

Existing `kasir_counters` table already handles per-channel sequences. Add 'whatsapp' channel to the counter logic. Format remains `GJP-YYMM-NNNN`.

## PDF Invoice (Dotmatrix 9.5″ × 11″)

### Paper size & print setup

- Page size in CSS: `@page { size: 9.5in 11in; margin: 0.5in 0.5in; }`
- Body font: Courier New monospace 11px for tabular data, Arial 13-16px for headers (per font-sizing rule: minimum 11px). Browser print → OS spooler → Epson dotmatrix driver.
- Single-page target for a typical 3-6 item invoice. If overflows, table continues on next form (continuous fanfold).
- Colour: B&W only. Logo image accepted as-is (will dither when printed).

### Layout (top to bottom)

1. **Header band** (border-bottom 2px solid black):
   - Left: 64×64 logo image (from `company_settings.logo_url`)
   - Right: company_name (Arial 14px bold), address, telp/WA, NPWP (optional, only if set)

2. **Title row**:
   - Left: "SALES INVOICE" (Arial 16px bold, letter-spacing 0.08em); sub-title below
     - DP: "Tanda Terima Uang Muka (DP)" (amber)
     - Lunas: "Pelunasan / Lunas" (green)
   - Right: invoice number (12px bold), date+time (WIB), channel label

3. **Bill-to + meta row** (2-col grid, border-bottom dashed):
   - Left: Pelanggan (name bold, company, HP)
   - Right: Kasir/Admin name, Metode Bayar (e.g., "EDC Debit", "Transfer", "Cash")

4. **Items table**:
   - Columns: No | Deskripsi (name + SKU smaller) | Qty (+ unit) | Harga | Subtotal
   - Right-aligned numeric columns; dotted row dividers; total table width 100%

5. **Catatan block** (only if `notes` non-empty):
   - Dashed border 1px, padding 6px, label "📝 CATATAN" + content

6. **Totals block** (right-aligned, width ≈ 60%):
   - Subtotal (border-top solid)
   - Biaya Ongkir (only if > 0)
   - **TOTAL TAGIHAN** (double-line top+bottom, 13px bold)
   - For DP: "Uang Muka (DP) Diterima" + "SISA PELUNASAN" (bold)
   - For Lunas: "Sudah Dibayar" + "SISA Rp 0"

7. **Payment block** (border-top dashed):
   - Heading "REKENING PEMBAYARAN"
   - "{bank_name} · {account_number} a/n {account_name}" (from `bank_config`)
   - Sub-line: DP → "Sisa pelunasan ditransfer sebelum pengambilan/pengiriman barang."; Lunas → "Terima kasih atas pembayaran Anda."

8. **Disclaimer band** (solid 1px black border, centered, bold):
   - "⚠ BARANG YANG SUDAH DIBELI TIDAK DAPAT DIKEMBALIKAN"

9. **Stamp overlay** (CSS rotated 8°, top-right area):
   - DP: amber border + amber text "DP"
   - Lunas: green border + green text "LUNAS"

10. **Footer signatures** (2-col grid):
    - "Penerima Barang" + signature line
    - "Hormat Kami" + signature line

### Component structure

Create `src/components/penjualan/SalesInvoicePDF.tsx` (new). Replace `KasirInvoiceModal.tsx` usage from the new page. The existing `KasirInvoiceModal` can stay temporarily for backward compatibility with old transactions; mark for deprecation once all flows route through the new component.

`SalesInvoicePDF` props:
- `transaction: KasirTransaction` (with new columns)
- `variant: 'dp' | 'lunas'`
- `onClose: () => void`

Auto-print: call `window.print()` on mount, then offer a "Cetak Ulang" button for reprints. The print stylesheet uses `@media print` to hide app chrome and show only the invoice paper.

## Pengaturan page updates

Add to `PengaturanScreen.tsx`:
- **Profil Toko** section: existing fields (name, address, phone, email) + **NEW** Logo Upload widget:
  - Drag-drop or file picker (PNG / JPG, max 1 MB)
  - Preview thumbnail of current logo (if set)
  - "Hapus logo" link
  - On upload: file → Supabase Storage → `companySettingsService.update({ logo_url })`

Existing Bank Account section already covers what the PDF needs — no change required.

## Pelunasan flow (DP → Lunas)

### Visibility

DP transactions (rows where `payment_type='DP'` and `status='AWAITING_LUNAS'`) appear in:
- **Kasir dashboard / today's list** with badge "💰 Belum Lunas Rp {sisa}"
- **Order History** screen (when sub-project G unifies channels)

### Detail view + action

Clicking a DP transaction opens its existing detail panel (or new one if none). New button: **"Tandai Lunas"** (amber, prominent).

Click → opens `MarkLunasModal`:
- Read-only summary: invoice no, customer, total, DP yang sudah diterima, sisa
- Input: payment method for pelunasan (Cash / Transfer / EDC + sub-type)
- Optional: adjust ongkir (if customer paid extra delivery later)
- Action: **"Konfirmasi & Cetak Invoice Lunas"**

On confirm:
- Update row: `status='COMPLETED'`, `lunas_at=now()`, `lunas_payment_method`, `lunas_payment_subtype`
- If ongkir adjusted, update `ongkir_amount` and `total_amount` (recompute)
- Auto-print **Invoice Lunas** (variant='lunas', uses original invoice number)

### Cancellation

A separate "Batalkan Pesanan" action (red, with confirmation) sets `status='CANCELLED'`. Stock decrements are NOT auto-reversed in v1 — admin manually corrects via Stock Manager if needed (consistent with current kasir behaviour).

## Routing

New route in App.tsx router (or wherever screens are switched):
- `/penjualan/baru` → `PenjualanBaruScreen` (new file `src/components/PenjualanBaruScreen.tsx`)
- Entry points: Sidebar link "📋 Catat Penjualan", Kasir dashboard quick action button, and channel-specific buttons on Kasir dashboard (Walk-in / Tokped / Grosir / WhatsApp) all link to the same route with a default channel query param.

The existing `KasirScreen` retains the daily summary + transactions list view; only the modal-based create flow is replaced.

## Migration & rollout

1. Database migration: add columns, enum values, constraints (forward-compat — existing rows get defaults).
2. Backfill: existing rows get `payment_type='FULL'`, `status='PAID'`, `total_amount = subtotal`, items get `warehouse='atas'` (the current default).
3. Update `kasirService.insertSaleTransaction`, `nextInvoiceNumber`, and other service methods to accept new fields.
4. Build new `PenjualanBaruScreen` + `SalesInvoicePDF` components.
5. Wire route; add nav entry.
6. QA on staging with at least one transaction per channel (walk-in, tokped, grosir, WA) and per payment-type (Full + DP), plus pelunasan flow.
7. Deprecate `SaleModal` and `KasirInvoiceModal` after one stable week (separate cleanup PR).

## Acceptance criteria

A pass means all of the following work end-to-end:

- [ ] Catat Penjualan page loads at `/penjualan/baru`, defaults to Walk-in channel
- [ ] Switching channel toggles correct strip (Tokped no., WA contact); fields persist when switching back
- [ ] Item search shows per-warehouse stock pills; clicking + Tambah pre-selects warehouse with adequate stock
- [ ] Cart row warehouse selector flips per row; 0-stock option is disabled
- [ ] Customer search dropdown lists matches; selecting one locks form + disables new-customer block
- [ ] ✕ Ganti returns to empty state with editable new-customer block
- [ ] Cash / Transfer / EDC payment selectable; EDC reveals Debit/QRIS sub-pill (required)
- [ ] Full Payment vs DP toggle; DP nominal & percent both compute correctly; sisa = total − DP
- [ ] Ongkir toggle adds row to totals and to grand total
- [ ] Notes textarea content reaches PDF invoice when non-empty
- [ ] Save creates kasir_transactions row with all new fields; stock decrements per chosen warehouse per row
- [ ] Invoice auto-prints to dotmatrix; variant DP shows stamp + "Sisa Pelunasan"; variant Lunas shows stamp + "Sudah Dibayar"
- [ ] PDF header reads logo + name + address + phone from company_settings; payment block reads bank_config
- [ ] T&C "BARANG YANG SUDAH DIBELI TIDAK DAPAT DIKEMBALIKAN" always appears
- [ ] DP transaction surfaces in Kasir with "Belum Lunas" badge; "Tandai Lunas" action completes the flow and prints Invoice Lunas
- [ ] WhatsApp channel records `wa_phone` and `wa_chat_url` when provided
- [ ] Tokopedia channel rejects save if `tokped_order_no` empty
- [ ] No UI text smaller than 11px; body text 13-14px

## Open questions for plan stage

These are deliberately deferred to the implementation plan (writing-plans skill will resolve):

- Whether to introduce a new Supabase Storage bucket `branding` for the logo, or piggy-back on existing `payment-proofs` bucket
- Whether to refactor `KasirInvoiceModal` in-place vs build greenfield `SalesInvoicePDF` (recommendation: greenfield to avoid breaking existing transactions)
- Exact enum migration path for `kasir_payment_method` (Postgres `ALTER TYPE ... RENAME VALUE` syntax varies by version; may need add-new + data migration + drop-old in two migrations)

---

**End of spec. Awaiting user review before transitioning to writing-plans skill.**
