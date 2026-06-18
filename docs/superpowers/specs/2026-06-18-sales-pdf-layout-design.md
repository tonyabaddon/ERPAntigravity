# Sales Funnel PDF Layout Spec

**Status:** Approved 2026-06-18 — implementation guide for Phase 1B PDF generators.

**Source:** `/tmp/fulfillment-mockup.html` Section 8 (PDF Documents).

**Scope:** 6 PDF generators — Sales Order, Invoice DP, Invoice Lunas, Invoice Pelunasan, Surat Jalan, Catatan Pembatalan. All A4 portrait, jsPDF + jspdf-autotable.

---

## Shared Conventions

All PDFs follow the same skeleton. Differences live in body title, body sections, and footer disclaimer.

### Page

- Format: A4 portrait, 595.28 × 841.89 pt
- Margins: 32 pt left/right, 28 pt top/bottom
- Body font: Helvetica (jsPDF default). Sizes — header company name 11pt, body 9.5pt, items table 9pt, footer 8pt, doc title (PESANAN PENJUALAN / INVOICE DP / etc) 14pt centered.
- Brand color: navy `#012749` for headings and dividers; green `#2d8a4e` for the grand TOTAL line; gray `#555` for muted captions; light fill `#eff4ff` for callout blocks; faint blue `#c7d7f5` border on bank rows.

### Header (every PDF)

Top band with company identity (left) + document meta (right), divided by a 2pt navy underline.

- Left, in this stacked order:
  - Logo: 60×60 pt rounded square. If `store_settings.logo_url` present → render image. Else fallback → navy filled rounded box with 2-letter initial (white, bold, centered) derived from `store_settings.name`.
  - Company name (bold, navy, 11pt)
  - Address lines (9pt)
  - "Telp/WA: " + phone (9pt)
- Right, right-aligned:
  - Document number (bold, navy, 11pt) — e.g. `SO/2026/00012`, `INV-DP/2026/00003`
  - Issue date in Bahasa Indonesia long form (9pt) — e.g. `15 Juni 2026`
  - Order ID (italic, gray, 8.5pt) — only on Invoices + Surat Jalan, prefix `Order #`

### Customer + Pengiriman block (Sales Order, all Invoices, Surat Jalan)

Two-column callout filled with `#eff4ff`, 8pt padding, 6px corner radius.

- Left "Kepada:" — bold customer name + channel · phone (mobile emoji) · address (pin emoji). Custom Panel / Rakit Panel orders show installation site if filled.
- Right "Pengiriman:" — truck emoji + delivery method (Delivery / Pickup / Lalamove) + destination summary. If pickup, show pickup window note.

### Items table

`jspdf-autotable` with theme `grid`, head fill `#012749` white text, body 9pt. Columns:

| No | Produk | Qty | Harga | Subtotal |

Right-align Qty/Harga/Subtotal. Rupiah formatted with thousand separators, no `Rp` prefix inside the table (saves width).

**Custom Panel / Rakit Panel exception:** items table shows **1 lump-sum line** in customer-facing PDFs (e.g. "Jasa Custom Panel 600×400×200" → unit total), NOT component breakdown. Internal cost breakdown stays in DB + Persetujuan Owner inbox.

### Totals block (right-aligned under table)

- Subtotal (9.5pt)
- Ongkir (9.5pt, only if `delivery_cost > 0`)
- Diskon (9.5pt, only if `discount_amount > 0`, prefix `-`)
- **TOTAL** — green `#2d8a4e`, bold, 12pt — full Rupiah format with `Rp` prefix.

### Payment instruction block (Sales Order, Invoice DP, Invoice Lunas, Invoice Pelunasan)

"Cara Pembayaran: Transfer ke salah satu rekening berikut:" header, then 1..N bank rows (from `bank_accounts.is_active=true ORDER BY display_order`). Each row in a 1px `#c7d7f5` bordered box with `#fafbff` fill, 6px padding, 4px corner radius:

`<bold>Bank Name</bold> · No. <bold>account_number</bold> · a.n. account_holder`

If no active bank rows → render `"Hubungi admin untuk info rekening."` in gray italic.

### Footer (every PDF)

Pinned to bottom of last page (jsPDF: compute Y = pageHeight - 80 pt before drawing).

- Heading "SYARAT & KETENTUAN" (navy, bold, 9pt) — replaced per PDF type, see per-doc sections.
- Bulleted T&C list (8.5pt, 1.4 line height, 18pt indent).
- Right-aligned tagline: `Dicetak otomatis · <date> <time>` (8pt, gray `#888`).

---

## Per-Document Sections

### 1. Sales Order PDF — `salesOrderPdf.ts`

- Doc number: `SO/YYYY/NNNNN` from `next_invoice_number('SO')`.
- Issued when: order moves into 2c (Admin Approve) or 3a (workshop kick-off).
- Body title: **PESANAN PENJUALAN**
- Sections: Header → Customer/Pengiriman → Items table → Totals → Payment instruction → Footer
- T&C bullets:
  - "Barang yang telah dibeli tidak dapat dikembalikan"
  - "Pembayaran dianggap sah setelah dana masuk ke rekening kami"
  - "Komplain barang rusak/kurang harap disampaikan saat barang diterima"

### 2. Invoice DP PDF — `invoiceDpPdf.ts`

- Doc number: `INV-DP/YYYY/NNNNN` from `next_invoice_number('INV-DP')`.
- Issued when: order moves into 3a (DP verified, awaiting fulfillment) for komponen, or 3c (DP verified, workshop start) for CP/RP.
- Body title: **INVOICE DP / TANDA JADI**
- Sections: Header → Customer/Pengiriman → Items table → Payment breakdown box → Payment instruction → Footer

**Payment breakdown box** (replaces simple Totals block):

```
+-----------------------------+
| Subtotal:         Rp X      |
| Ongkir:           Rp Y      |
| TOTAL:            Rp Z      |
|---                       ---|
| DP diterima:      Rp DP     |
| Sisa:             Rp Z-DP   |
+-----------------------------+
```

- Subtotal/Ongkir/TOTAL rendered as normal totals block.
- After TOTAL, draw a hairline divider, then DP (`Rp ${dp}` in green `#2d8a4e` bold 10pt) and Sisa (`Rp ${total - dp}` in amber `#b45309` bold 11pt). Right-aligned.

- T&C bullets:
  - "DP yang sudah dibayar tidak dapat dikembalikan (kecuali force majeure)"
  - "Sisa pembayaran wajib dilunasi sebelum barang dikirim/diserahkan"
  - "Estimasi pengerjaan: berlaku setelah DP dikonfirmasi"

### 3. Invoice Lunas PDF — `invoiceLunasPdf.ts`

- Doc number: `INV/YYYY/NNNNN` from `next_invoice_number('INV')`.
- Issued when: order paid in full from the start (no DP path) — Stage 3 → 4 for komponen Bayar Penuh flow.
- Body title: **INVOICE / KWITANSI**
- Sections: Header → Customer/Pengiriman → Items table → Totals → Payment status banner → Footer

**Payment status banner** (in place of payment instruction):

Green `#2d8a4e` bg 10% opacity, navy text, 8pt padding, rounded 6px:

```
✓ LUNAS — diterima <date> · via <payment_method>
```

`payment_method` from `kasir_transactions.payment_method` (e.g. "Transfer BCA", "Tunai").

- T&C bullets:
  - "Invoice ini berlaku sebagai kwitansi sah setelah pembayaran diterima"
  - "Barang yang telah dibeli tidak dapat dikembalikan"
  - "Klaim garansi mengikuti ketentuan supplier masing-masing"

### 4. Invoice Pelunasan PDF — `invoicePelunasanPdf.ts`

- Doc number: `INV-PEL/YYYY/NNNNN` from `next_invoice_number('INV-PEL')`.
- Issued when: customer paid the sisa after a DP — Stage 3 sub-stage 3d/3h → 4.
- Body title: **INVOICE PELUNASAN**
- Sections: Header → Customer/Pengiriman → Items table → Pelunasan summary box → Payment status banner → Footer

**Pelunasan summary box** (right-aligned, replaces totals + breakdown):

```
+---------------------------------------+
| TOTAL ORDER:        Rp 8.500.000      |
| DP terbayar 14 Jun: Rp 3.400.000      |
| Sisa terbayar lunas (sekarang):       |
|                     Rp 5.100.000      |
+---------------------------------------+
```

- TOTAL ORDER navy bold 10pt.
- DP terbayar muted gray 9pt (italic).
- Pelunasan amount green `#2d8a4e` bold 12pt.

**Payment status banner** same as Invoice Lunas with "✓ LUNAS — sisa diterima <date>".

- T&C bullets:
  - "Invoice ini bersifat pelunasan; sudah memperhitungkan DP sebelumnya"
  - "Surat Jalan terlampir / akan menyusul saat barang diserahkan"
  - "Klaim garansi mengikuti ketentuan supplier masing-masing"

### 5. Surat Jalan PDF — `suratJalanPdf.ts`

- Doc number: `SJ/YYYY/NNNNN` from `next_invoice_number('SJ')`.
- Issued when: order moves into 4b (Sedang Dikirim) or 4a (Pickup ready) — printed for customer signature on delivery.
- Body title: **SURAT JALAN**
- Sections: Header → Customer/Pengiriman → Items table (Qty only, no Harga/Subtotal columns) → Delivery meta → Signature block → Footer

**Items table for Surat Jalan:** columns `No | Produk | Qty` only. No prices.

**Delivery meta block** (above signature):

```
Nomor Resi / Tracking:  <resi_number or "-">
Kurir:                  <delivery_method>
Catatan:                <delivery_notes or "-">
```

**Signature block** (2-column at bottom, before T&C):

```
+-----------------------+-----------------------+
| Diserahkan oleh,      | Diterima oleh,        |
|                       |                       |
|                       |                       |
| _________________     | _________________     |
| Sinar Elektrik        | (nama jelas + TTD)    |
+-----------------------+-----------------------+
```

Two boxes 220×80 pt each with hairline borders. Signature lines drawn at 50% box height.

- T&C bullets:
  - "Mohon periksa barang sebelum tanda tangan"
  - "Komplain barang rusak/kurang setelah tanda tangan tidak dilayani"
  - "Surat Jalan ini bukti sah penyerahan barang"

### 6. Catatan Pembatalan PDF — `catatanPembatalanPdf.ts`

- Doc number: `CAN/YYYY/NNNNN` from `next_invoice_number('CAN')`.
- Issued when: order moves into Stage 6 (Batal/Refund) — archive document for audit.
- Body title: **CATATAN PEMBATALAN**
- Sections: Header → Customer block (no Pengiriman) → Original items table → Pembatalan summary → Refund block (if any) → Footer

**Pembatalan summary box** (replaces totals):

```
Tanggal Pembatalan:    <cancel_date>
Diminta oleh:          <cancelled_by_actor> (Owner/Admin)
Alasan:                <cancel_reason>
```

Light red bg `#fef2f2`, border `#fca5a5`, 8pt padding, 6px rounded. `cancel_reason` rendered as full paragraph (autoTable single-row wrap if long).

**Refund block** (only if `refund_amount > 0`):

```
Refund Diberikan:      Rp <refund_amount>
Metode Refund:         <refund_method>
Bukti Refund:          (terlampir di sistem)
```

- T&C bullets:
  - "Catatan ini sebagai bukti audit pembatalan order"
  - "Sengketa pembatalan harap diselesaikan secara baik-baik"
  - "Refund (jika ada) sudah ditransfer per metode di atas"

---

## Implementation Notes

- **Number generation:** All doc numbers go through `next_invoice_number(p_type)` RPC. Function increments `invoice_counters.last_number` per (type, year) and returns formatted string `<TYPE>/<YYYY>/<NNNNN>` (5-digit pad). NEVER generate numbers client-side.
- **Idempotent regenerate:** If a PDF is regenerated for the same order+type, the existing doc number should be reused (read from `kasir_transactions.so_number`, `.invoice_dp_number`, etc.). Only mint a new number if none exists. This means migration 011 must add nullable columns `so_number TEXT`, `invoice_number TEXT`, `invoice_dp_number TEXT`, `invoice_pelunasan_number TEXT`, `surat_jalan_number TEXT`, `cancel_number TEXT` to `kasir_transactions`.
- **Logo storage:** `store_settings.logo_url` points at Supabase Storage `store-assets/logo.<ext>`. Client fetches as data URL before calling jsPDF `addImage()`. If fetch fails → render fallback initial box.
- **Date format:** `Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })`.
- **Rupiah format:** `Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 })` — but strip the "Rp" prefix manually when inside the items table.
- **Filename convention:** `<DOC_TYPE>_<DOC_NUMBER_SAFE>_<CUSTOMER_INITIAL>.pdf` (e.g. `Sales_Order_SO-2026-00012_JS.pdf`). `DOC_NUMBER_SAFE` = doc number with `/` → `-`.
- **Preview vs download:** `PdfPreviewModal` renders in iframe via `blob:` URL; download button calls `pdf.save(filename)`.
- **Test surface:** Each generator has a smoke test that calls it with a synthetic order + fixed settings, asserts the returned `Blob` is non-empty (`size > 5000`) and MIME is `application/pdf`. Visual correctness verified via manual review at PR time, not automated.

---

## Out of Scope (for Phase 1B)

- Multi-page splitting for orders with >20 items (single-page assumption holds for our average MSME order).
- Localized templates beyond Bahasa Indonesia.
- Watermarks (DRAFT / VOID) — handled in Phase 1C if needed.
- Email/WA attachment delivery — manual download for now (Phase 1C wires Calista delivery).
- Audit trail of every PDF generation in `audit_log` — generator only mints the number; the calling code logs.
