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

A new "Pembelian" page in the ERP sidebar for managing suppliers and purchase orders (PO). When goods are received from a supplier, stock quantities in the `stocks` table are automatically incremented and a FIFO lot is recorded so that each unit's cost is tracked to the exact batch it came from. Payment tracking (outstanding → paid) is handled inside the ERP with support for supplier invoice and payment proof uploads. Marking a PO as paid automatically records a Kasir expense entry.

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

### `stock_lots`

Tracks each batch of stock received from a PO. Used for FIFO cost accounting — when a Kasir sale deducts stock, it deducts from the oldest lot first and uses that lot's `unit_cost` as the COGS for that unit.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK DEFAULT gen_random_uuid() | |
| `sku` | varchar FK → stocks NOT NULL | |
| `po_id` | uuid FK → purchase_orders | NULL for initial/manual stock entries |
| `unit_cost` | numeric NOT NULL | Cost per unit from the PO (or manually set for initial stock) |
| `qty_received` | int NOT NULL | Total units received in this lot |
| `qty_remaining` | int NOT NULL | Units not yet sold; decremented by FIFO deductions |
| `received_at` | timestamptz NOT NULL DEFAULT now() | FIFO ordering key — oldest first |

**Initial stock migration:** When the Pembelian module is first deployed, a migration script creates one `stock_lots` row per SKU using `stocks.hpp_per_unit` as `unit_cost` and `stocks.stock` as `qty_received` / `qty_remaining`. This seeds FIFO with the current inventory state.

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
  - DRAFT: Edit · Pesan · Hapus (delete with confirmation modal)
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
- Admin updates damage status via dropdown
- When status changes to `RETURNED`, a **"Terima Pengganti"** button appears on that row
- Clicking "Terima Pengganti" opens a small confirmation modal showing qty to receive; on confirm, calls `receive_replacement(item_id)` RPC which increments `stocks.stock += qty_damaged` and sets `damage_status = 'REPLACED'`
- Full audit trail: damaged qty → returned → replacement received → stock restored, all linked to the original PO

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
4. Creates a `stock_lots` row for each SKU: `unit_cost` = item's `unit_cost`, `qty_received` = qty_received, `qty_remaining` = qty_received, `po_id` = this PO, `received_at` = now()
5. Updates `purchase_orders.status = 'RECEIVED'`, sets `received_at = now()`

Called from the frontend via `supabase.rpc('receive_purchase_order', { po_id, conditions })`. Atomic — no partial stock updates on failure.

### FIFO Cost Deduction — `deduct_stock_fifo(sku text, qty int)`
A Supabase database function called by the Kasir transaction flow when recording a sale:
1. Queries `stock_lots` WHERE `sku = ?` AND `qty_remaining > 0` ORDER BY `received_at ASC` (oldest first)
2. Walks through lots, deducting qty from each until the total sold qty is satisfied
3. For each lot consumed: decrements `qty_remaining`, accumulates `cost += deducted_qty × unit_cost`
4. Returns `total_cost` (the true COGS for that line item)

The Kasir sale flow uses this return value to populate `hpp_per_unit = total_cost / qty` and `hpp_subtotal = total_cost` in the `kasir_transactions.items` JSONB. This replaces the previous static `stocks.hpp_per_unit` lookup.

### Kasir Expense on PO Payment
When admin marks a PO as PAID (frontend `MarkAsPaidModal`), after updating PO status the frontend calls `kasirService.insertExpense()` to record a matching expense in `kasir_transactions`:
- `type = 'expense'`
- `description = 'Bayar PO {po_number} — {supplier_name}'`
- `subtotal = purchase_orders.total`
- `date = today`

This ensures PO payments appear in Kasir reconciliation and Laporan expense totals.

### Replacement Receipt — `receive_replacement(item_id uuid)`

A Supabase database function called when admin confirms replacement goods have arrived:
1. Validates `damage_status = 'RETURNED'` on the item
2. Increments `stocks.stock += qty_damaged` for the item's SKU
3. Sets `damage_status = 'REPLACED'`

Called via `supabase.rpc('receive_replacement', { item_id })`. Atomic.

### PO Reference Number — `PO-YYYY-MM-NNN`
Generated at PO creation time:
- Query `MAX(po_number)` for the current year-month prefix
- Increment the sequence: `NNN` zero-padded to 3 digits
- Handled in a Supabase function or short client-side logic with a unique constraint as safety net

### RLS Policies
- `suppliers`: anon full access (consistent with existing pattern)
- `purchase_orders`: anon full access
- `purchase_order_items`: anon full access
- `stock_lots`: anon full access

### Supabase Storage
- Bucket: `purchase-documents` (private or public depending on existing storage setup)
- Invoice path: `invoices/{po_id}.{ext}`
- Payment proof path: `payment-proofs/{po_id}.{ext}`

---

## 4. Workflow Summary

| Step | Who | Action | Result |
|---|---|---|---|
| 1 | Admin | Create PO, pick supplier, add items | Status: DRAFT, po_number assigned |
| 1a | Admin | Click "Hapus" on DRAFT | PO deleted with confirmation |
| 2 | Admin | Click "Pesan" | Status: ORDERED, ordered_at set |
| 3 | Admin | Click "Terima", fill qty baik/rusak per item, upload invoice, confirm due date | Status: RECEIVED, stock incremented by qty_received; FIFO lot created per SKU |
| 3a | Admin | Update damage status on damaged items (Pending → Returned → Replaced) | Damage tracked; replacement handled via new PO or manual stock adjust |
| 4 | Admin | Click "Bayar", upload proof | Status: PAID, paid_at set; Kasir expense recorded automatically |
| — | System (Kasir sale) | Customer buys items | FIFO lots deducted oldest-first; true COGS written to kasir_transactions.items |

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
- Multi-currency support (all amounts in IDR)
