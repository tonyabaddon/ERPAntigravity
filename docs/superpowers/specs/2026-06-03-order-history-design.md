# F1 — Order History Screen Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Overview

Build a dedicated **Riwayat Pesanan** screen that gives the admin a single place to view all orders, approve new orders, verify payment proofs, and download invoices. This screen consolidates two workflows currently split across DashboardScreen: order approval and payment verification.

**Tech Stack:** React + TypeScript, Tailwind CSS, Supabase JS client, Lucide React icons  
**Build check:** `npm run build` must pass with zero TypeScript errors after each task.  
**Do NOT touch:** `backend-go/`, any `.sql` migration files.

---

## Architecture

### New files
- `src/components/OrderHistoryScreen.tsx` — main screen component
- `src/components/InvoiceModal.tsx` — PDF invoice modal
- `src/lib/companySettingsService.ts` — fetch/save company settings from Supabase

### Modified files
- `src/lib/supabaseClient.ts` — add `ordersService` (fetch all orders, approve, reject, verify payment, reject payment)
- `src/types.ts` — add `DbCompanySettings` interface
- `src/components/DashboardScreen.tsx` — remove `PaymentVerificationCard` panel and order approval panel; replace with alert badge counts linking to Order History
- `src/App.tsx` — add `order-history` route
- `src/components/Sidebar.tsx` — add "Riwayat Pesanan" nav item
- `src/components/SettingsScreen.tsx` (or equivalent) — add Company Settings section

### New Supabase table
`company_settings` — stores configurable invoice fields (one row, upserted on save).

---

## Screen: Riwayat Pesanan

### Page header
- Title "Riwayat Pesanan" with document icon
- Right side: two alert badges, shown only when count > 0
  - `🔔 N pesanan perlu konfirmasi` — purple (`bg-purple-100 text-purple-800 border-purple-200`)
  - `📎 N bukti bayar menunggu verifikasi` — blue (`bg-blue-100 text-blue-800 border-blue-200`)

### Filter tabs
Pill-style tabs matching existing design system (navy active state):

| Tab | Filter |
|-----|--------|
| Semua | all statuses |
| Perlu Konfirmasi | `PENDING_ADMIN_CONFIRMATION` |
| Menunggu Bayar | `WAITING_PAYMENT` |
| Bukti Dikirim | `PAYMENT_UPLOADED` — shows `!` amber dot |
| Selesai | `COMPLETED` |
| Dibatalkan | `CANCELLED`, `PAYMENT_REJECTED` |

### Search bar
Full-width input. Filters rows client-side by: customer name, GJP order ID (`gjp_order_id`), customer phone.

### Order list

Each order renders as a collapsible row. Rows are sorted by `created_at` descending.

**Collapsed row layout (all statuses):**
- Customer name (bold)
- Meta line: `GJP-ORD-XXXX · DD Mon YYYY, HH:MM · [item pill]`
- Item pill: first item name + `+N` if more than one item
- Total amount (color varies by status — see Status Colors below)
- Status badge
- Chevron icon (rotates when expanded)

**Left border accents:**
- `PENDING_ADMIN_CONFIRMATION` → 4px solid purple (`#7c3aed`)
- `PAYMENT_UPLOADED` → 4px solid blue (`#3b82f6`)
- All others → transparent

---

## Expanded Row Designs

### PENDING_ADMIN_CONFIRMATION (purple theme)

Expanded body background: `bg-purple-50`, border-top `border-purple-200`.

**Left column:**
- Meta grid (3 cols): Pelanggan · No. WA · Pengiriman
- Items table with purple header row
  - Columns: Produk/SKU · Qty · Harga · Subtotal
  - Footer: Subtotal / Ongkir (belum diset) / Total
- Booking expiry notice: `⏱ Booking berakhir: [date]`

**Right column (action panel, min-width 140px):**
- Label "Tetapkan Ongkir"
- Number input `Rp [____]` — disabled and shows "Rp 0 (Pickup)" if `delivery_type === 'PICKUP'`
- `✓ Approve` button — purple fill; disabled until ongkir is entered (or delivery is PICKUP)
- `✕ Tolak` button — red outline
- On Approve: call `ordersService.approveOrder(id, shippingFee)` → status becomes `APPROVED`
- On Tolak: call `ordersService.rejectOrder(id)` → status becomes `CANCELLED`

### PAYMENT_UPLOADED (blue theme)

Expanded body background: `bg-blue-50`, border-top `border-blue-200`.

**Left column:**
- Meta grid (3 cols): Pelanggan · No. WA · Pengiriman
- Items table with blue header row
- Footer: Subtotal / Ongkir / Total
- Payment proof section:
  - Thumbnail (72×90px indigo placeholder if image unavailable)
  - "Lihat Ukuran Penuh ↗" link — opens `payment_proof_url` in new tab
  - "Dikirim [relative time]" label

**Right column (action panel):**
- Label "Tindakan"
- `✓ Verifikasi` button — green fill
- `✕ Tolak` button — red outline
- On Verifikasi: call `ordersService.verifyPayment(id, adminName)` — saves `verified_by = adminName`, `payment_verified_at = now()`, status → `COMPLETED`
- On Tolak: call `ordersService.rejectPayment(id)` — status → `PAYMENT_REJECTED`
- `adminName` comes from `currentUser.name` — the local auth state in `App.tsx`. Pass as a prop: `<OrderHistoryScreen currentUser={currentUser} />`

### WAITING_PAYMENT

Expanded body: read-only order detail only.
- Meta grid (4 cols): Pelanggan · No. WA · Pengiriman · Total
- Items table (default grey header)
- Footer: Subtotal / Ongkir / Total
- No action buttons

### COMPLETED (green theme)

Expanded body: default grey background.
- Meta grid (4 cols): Pelanggan · No. WA · Pengiriman · **Diverifikasi Oleh**
  - "Diverifikasi Oleh" shows: `[adminName] · [DD Mon YYYY, HH:MM]`
- Items table (default grey header)
- Footer: Subtotal / Ongkir / Total
- Action row (space-between):
  - Left: `✅ Diverifikasi oleh [name] · [date]`
  - Right: `📄 Lihat Invoice` button (white background, navy border + text)

### CANCELLED / PAYMENT_REJECTED

Collapsed row: dimmed to 55% opacity. Expanded: read-only order detail only. No action buttons.

---

## Status Color Reference

| Status | Badge | Total color | Left border |
|--------|-------|-------------|-------------|
| PENDING_ADMIN_CONFIRMATION | purple `bg-purple-100 text-purple-800` | purple | 4px purple |
| WAITING_PAYMENT | amber `bg-yellow-100 text-yellow-800` | amber | none |
| PAYMENT_UPLOADED | blue `bg-blue-100 text-blue-800` | blue | 4px blue |
| COMPLETED | green `bg-green-100 text-green-800` | green | none |
| CANCELLED | red `bg-red-100 text-red-800` | grey | none |
| PAYMENT_REJECTED | rose `bg-rose-100 text-rose-800` | grey | none |

---

## Invoice Modal

Opens when admin clicks "Lihat Invoice" on a COMPLETED order.

### Modal toolbar (navy background)
- Left: document icon + "Invoice [gjp_order_id]"
- Right: `Download PDF` button (green) + `×` close button

### Invoice document (PDF-style, scrollable)

**Header (separated by 2px navy bottom border):**
- Left: Company name (bold navy), address (from `company_settings`), phone + email (from `company_settings`)
  - Address line has `⚙ config` badge to indicate it comes from settings
- Right: "INVOICE" title, order ID (monospace), date

**Bill To / Info section (2-col grid):**
- Left: customer name, address, WA number
- Right: delivery type, payment status badge (`✓ LUNAS`)

**Line items table (navy header row):**
- Columns: No. · Produk/SKU · Qty · Harga Satuan · Subtotal
- Each row: product name (bold) + SKU (monospace grey below)
- No strikethrough on cancellation — COMPLETED orders only

**Totals (right-aligned):**
- Subtotal
- Ongkos Kirim
- **TOTAL** (bold navy, 2px navy top border)

**Bank info box (light blue background):**
- "Informasi Pembayaran" label + `⚙ config` badge
- Bank name · No. Rek: [account_number] · a/n [account_holder] — from `company_settings`
- `✓ Pembayaran diverifikasi oleh [verified_by] pada [payment_verified_at]`

**No-refund notice (amber/orange box):**
> **Catatan Penting:** Barang yang telah dibeli tidak dapat dikembalikan atau direfund dalam kondisi apapun. Pastikan pesanan sudah sesuai sebelum melakukan pembayaran.

**Footer (centered, grey):**
- "Terima kasih atas kepercayaan Anda kepada Garindo Jaya Panel 🙏"
- "Dokumen ini diterbitkan secara otomatis oleh sistem ERP Garindo Jaya Panel."

### Download PDF
Clicking "Download PDF" calls `window.print()` with the invoice div isolated via a print-specific CSS class. No extra library needed.  
The `⚙ config` badges inside the invoice document must have `print:hidden` (Tailwind) so they don't appear in the printed PDF.

### Modal footer
- `Tutup` button (grey outline)
- `Download PDF` button (green fill)

---

## Company Settings

### Supabase table: `company_settings`

```sql
CREATE TABLE company_settings (
  id            integer PRIMARY KEY DEFAULT 1,
  company_name  text NOT NULL DEFAULT 'Garindo Jaya Panel',
  address       text NOT NULL DEFAULT '',
  phone         text NOT NULL DEFAULT '',
  email         text NOT NULL DEFAULT '',
  bank_name     text NOT NULL DEFAULT '',
  bank_account  text NOT NULL DEFAULT '',
  bank_holder   text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Single-row table; enforce with CHECK or application logic
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON company_settings TO anon;
GRANT ALL ON company_settings TO service_role;
```

### Settings screen section
Add a "Profil Perusahaan & Rekening" section to the existing Settings screen with fields for all `company_settings` columns. Save button upserts row with `id = 1`.

### `DbCompanySettings` type (src/types.ts)
```typescript
export interface DbCompanySettings {
  id: number;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  bank_name: string;
  bank_account: string;
  bank_holder: string;
  updated_at: string;
}
```

---

## Supabase: ordersService additions (src/lib/supabaseClient.ts)

```typescript
// Fetch all orders (Order History — all statuses, sorted newest first)
fetchAll(): Promise<DbOrder[]>

// Approve order (PENDING_ADMIN_CONFIRMATION → APPROVED)
approveOrder(orderId: string, shippingFee: number): Promise<void>
// already exists — reuse

// Reject order (PENDING_ADMIN_CONFIRMATION → CANCELLED)
rejectOrder(orderId: string): Promise<void>

// Verify payment (PAYMENT_UPLOADED → COMPLETED)
verifyPayment(orderId: string, adminName: string): Promise<void>
// saves verified_by, payment_verified_at
// already exists — update to accept adminName

// Reject payment (PAYMENT_UPLOADED → PAYMENT_REJECTED)
rejectPayment(orderId: string): Promise<void>
// already exists
```

---

## Dashboard changes

After Order History is built:
- **Remove** the order approval cards panel from DashboardScreen
- **Remove** the `PaymentVerificationCard` panel from DashboardScreen
- **Add** two summary alert links instead:
  - `🔔 N pesanan perlu konfirmasi → Riwayat Pesanan` (purple)
  - `📎 N bukti bayar menunggu verifikasi → Riwayat Pesanan` (blue)
- These link to `/order-history` (or set `activePage` to `order-history`)

---

## Empty states

- Each filter tab that returns 0 results shows a centered empty state with document icon and localized message
- Example: "Tidak ada pesanan yang perlu dikonfirmasi."

---

## Out of scope

- Pagination (fetch all, sort client-side — order volume is low for now)
- Order editing after approval
- WhatsApp re-notification from this screen
- Export to Excel/CSV
