---
name: pembelian-purchase-orders-design
description: Design spec for the Pembelian module — supplier management and purchase orders with automatic stock update on goods receipt
metadata:
  type: project
---

# Pembelian Module — Design Spec

**Date:** 2026-06-04  
**Status:** Approved

## Overview

A new "Pembelian" page in the ERP sidebar for managing suppliers and purchase orders (PO). When goods are received from a supplier, stock quantities in the `stocks` table are automatically incremented. Payment tracking (outstanding → paid) is handled inside the ERP with support for supplier invoice and payment proof uploads.

---

## 1. Data Model

### `suppliers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | Supplier name |
| `contact_name` | text | PIC name |
| `phone` | text | |
| `payment_term_days` | int NOT NULL DEFAULT 0 | 0 = cash, 30 = Net 30, etc. |
| `created_at` | timestamptz DEFAULT now() | |

### `purchase_orders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `po_number` | text UNIQUE NOT NULL | Auto-generated: `PO-YYYY-MM-NNN` |
| `supplier_id` | uuid FK → suppliers NOT NULL | |
| `status` | text NOT NULL DEFAULT 'DRAFT' | See lifecycle below |
| `notes` | text | Optional |
| `ordered_at` | timestamptz | Set when status → ORDERED |
| `received_at` | timestamptz | Set when status → RECEIVED |
| `payment_due_at` | date | Editable; pre-filled from supplier term on receipt |
| `paid_at` | timestamptz | Set when status → PAID |
| `invoice_url` | text | Supabase Storage URL; uploaded on goods receipt |
| `payment_proof_url` | text | Supabase Storage URL; uploaded on mark as paid |
| `tax_rate` | numeric NOT NULL DEFAULT 0 | Optional PPN (e.g. 0.11). Defaults to 0 — company is individual, not subject to tax |
| `tax_amount` | numeric NOT NULL DEFAULT 0 | Computed: subtotal × tax_rate |
| `subtotal` | numeric NOT NULL DEFAULT 0 | Sum of all line item subtotals |
| `total` | numeric NOT NULL DEFAULT 0 | subtotal + tax_amount |
| `created_at` | timestamptz DEFAULT now() | |

**PO Status Lifecycle:**
```
DRAFT → ORDERED → RECEIVED → PAID
```

### `purchase_order_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `po_id` | uuid FK → purchase_orders ON DELETE CASCADE | |
| `sku` | varchar FK → stocks | |
| `product_name` | text NOT NULL | Snapshot of stock name at time of purchase |
| `qty` | int NOT NULL | Total quantity ordered |
| `unit_cost` | numeric NOT NULL | Buying price per unit from supplier |
| `subtotal` | numeric NOT NULL | qty × unit_cost |
| `qty_received` | int NOT NULL DEFAULT 0 | Good condition — added to stock on receipt |
| `qty_damaged` | int NOT NULL DEFAULT 0 | Excluded from stock; tracked for return/replacement |
| `damage_notes` | text | Description of damage (required if qty_damaged > 0) |
| `damage_status` | text NOT NULL DEFAULT 'NONE' | `NONE` / `PENDING_RETURN` / `RETURNED` / `REPLACED` |

**Damage constraint:** `qty_received + qty_damaged = qty` (enforced on the receive goods form)

---

## 2. Frontend Architecture

### Sidebar
- New entry: **"Pembelian"** with `ShoppingCart` icon
- `ActivePage` type extended with `'pembelian'`
- Permission key: `pembelian` added to `PermissionSet`

### `PembelianScreen.tsx`
Single page with two tabs:

#### Summary Bar (top of page, always visible)
Four stat cards:
| Card | Metric |
|---|---|
| Total PO Bulan Ini | Sum of `total` for all POs created this month (MTD) |
| Jatuh Tempo Bulan Ini | Sum of `total` for RECEIVED POs where `payment_due_at` is this month and status ≠ PAID |
| Total Belum Dibayar | Sum of `total` for all RECEIVED POs not yet PAID (any month) |
| Jumlah PO Bulan Ini | Count of POs created this month |

#### Tab 1: Purchase Orders
- Search bar (filter by PO number or supplier name)
- Status filter dropdown (Semua / Draft / Dipesan / Diterima / Lunas)
- **Buat PO Baru** button
- PO list table: No. PO · Supplier · Tgl Pesan · Jatuh Tempo · Total · Status badge · Actions
- Left border accent on actionable rows (RECEIVED = amber, ORDERED = blue)
- Context-sensitive action buttons per status:
  - DRAFT: Edit · Pesan
  - ORDERED: Detail · Terima
  - RECEIVED: Detail · Bayar
  - PAID: Detail (read-only)

#### Tab 2: Supplier
- Search bar
- **Tambah Supplier** button
- Supplier table: Nama · Kontak · Term Bayar badge · Edit · Hapus
- Add/Edit via inline modal

### `PurchaseOrderModal.tsx`
Used for create and edit (DRAFT only). Contains:
- Supplier dropdown (from suppliers list)
- Notes field
- Line item editor: search/select SKU from existing `stocks`, auto-fills product name, input qty and unit_cost, computed subtotal
- Optional PPN toggle (checkbox); when enabled, tax_rate input (default 11%)
- Totals summary: subtotal · tax · **total**
- Footer: Batal · Simpan Draft · Simpan & Pesan

### Receive Goods Modal
Triggered from "Terima" action on ORDERED PO:
- Tanggal Terima (date picker, defaults today)
- Jatuh Tempo Pembayaran (date, pre-filled from `ordered_at + payment_term_days`, editable)
- Invoice upload (PDF/JPG → Supabase Storage)
- **Per-item condition inputs:** for each line item, two fields: Qty Baik + Qty Rusak (must sum to ordered qty). If Qty Rusak > 0, a damage notes field appears.
- Info banner: "Stok akan bertambah sesuai Qty Baik yang diterima."
- Confirm button → calls `receive_purchase_order(po_id, item_conditions[])` RPC

### Damaged Items Tracking
In the PO detail view, a **"Barang Rusak"** section appears when any item has `qty_damaged > 0`. Each damaged line shows:
- Product name · SKU · Qty rusak · Damage notes
- Damage status badge: `PENDING_RETURN` → `RETURNED` → `REPLACED`
- Admin can update damage status manually via dropdown
- When status → `REPLACED`, admin creates a new PO or manually adjusts stock (no automatic flow)

### Mark as Paid Modal
- Payment proof upload (PDF/JPG → Supabase Storage)
- Confirm button → sets status = PAID, paid_at = now()

### Print View
- Route: rendered conditionally when print mode is active (e.g., `isPrinting` state)
- Clean layout: company header, supplier info, PO number/date, line items table, tax, total
- Triggered via `window.print()`
- Print-only CSS hides sidebar and action buttons

### Margin Visibility
In PO detail view, each line item shows:
- Unit cost (buying price)
- Current selling price from `stocks.price`
- Margin = selling price − unit_cost (shown as Rp and %)

---

## 3. Backend / Database Logic

### Stock Update — `receive_purchase_order(po_id uuid, conditions jsonb)`
A Supabase database function that runs inside a single transaction:
1. Validates PO status is `ORDERED`
2. For each entry in `conditions` (keyed by `purchase_order_item.id`): updates `qty_received`, `qty_damaged`, `damage_notes`, `damage_status` on the item
3. Increments `stocks.stock += qty_received` for each SKU (damaged qty excluded)
4. Updates `purchase_orders.status = 'RECEIVED'`, sets `received_at = now()`

Called from the frontend via `supabase.rpc('receive_purchase_order', { po_id, conditions })`. Atomic — no partial stock updates on failure.

### PO Reference Number — `PO-YYYY-MM-NNN`
Generated at PO creation time:
- Query `MAX(po_number)` for the current year-month prefix
- Increment the sequence: `NNN` zero-padded to 3 digits
- Handled in a Supabase function or short client-side logic with a unique constraint as safety net

### RLS Policies
- `suppliers`: anon full access (consistent with existing pattern)
- `purchase_orders`: anon full access
- `purchase_order_items`: anon full access

### Supabase Storage
- Bucket: `purchase-documents` (private or public depending on existing storage setup)
- Invoice path: `invoices/{po_id}.{ext}`
- Payment proof path: `payment-proofs/{po_id}.{ext}`

---

## 4. Workflow Summary

| Step | Who | Action | Result |
|---|---|---|---|
| 1 | Admin | Create PO, pick supplier, add items | Status: DRAFT, po_number assigned |
| 2 | Admin | Click "Pesan" | Status: ORDERED, ordered_at set |
| 3 | Admin | Click "Terima", fill qty baik/rusak per item, upload invoice, confirm due date | Status: RECEIVED, stock incremented by qty_received only |
| 3a | Admin | Update damage status on damaged items (Pending → Returned → Replaced) | Damage tracked; replacement handled via new PO or manual stock adjust |
| 4 | Admin | Click "Bayar", upload proof | Status: PAID, paid_at set |

---

## 5. UI Mockup

Mockup file: `docs/superpowers/mockups/pembelian-mockup.html`

Covers:
- Summary cards
- PO list with status badges and action buttons
- Create/Edit PO modal with line item editor and optional PPN
- Receive Goods modal with invoice upload
- Supplier tab

---

## 6. Out of Scope

- Partial receiving (all POs arrive in one complete shipment)
- Automatic selling price updates from PO cost (selling price managed separately)
- WhatsApp / email notifications for PO events
- Stock alert → auto-suggest PO creation
