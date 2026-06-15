# Order Confirmation & Fulfillment Revamp — Design

**Status:** Draft pending user review
**Author:** brainstormed with founder 2026-06-15
**Implements:** Bug fixes A-D + UX gaps surfaced during 2026-06-14 end-to-end payment flow verification

## Goal

Revamp the order management UX so that:

1. Admin actions for every order-status transition (confirm, verify payment, mark ready, mark dispatched, mark received) live in a single coherent workspace.
2. Customer-facing documents (Sales Order, Invoice variants, payment receipts) are auto-generated as PDFs and delivered through the appropriate channel.
3. The lifecycle covers everything from initial inquiry through customer receipt confirmation — including DP handling, customer feedback request, and Google Maps review prompt.
4. The same state machine works across all sales channels (WhatsApp, Walk-in, Grosir, Sales Lapangan, Pameran, Marketplace) with channel-specific paths and entry points.

## Context & Motivation

Three findings drove this revamp:

1. **Stuck `CONFIRMING` state from missing enum values** (Bug A). The Go state machine declared `StateAddMore = "ADD_MORE"` and `StateDelivery = "DELIVERY"` but the DB enum never contained them, so transitions failed silently and orders never reached BOOKED → APPROVED → fulfillment. Fixed mid-test 2026-06-14, but exposed gaps in admin workflow visibility.
2. **`StateConfirming` prompt read empty flat fields** (Bug B). Calista identified the cart correctly, but the prompt rendered "Produk: belum diketahui" because it didn't read `collected_data.cart[]`. Fixed in commit `14dd1de`.
3. **UX fragmentation** — admin had to leave Sales Inbox to confirm orders, lost conversation context, and could not access order detail through normal navigation. The "Riwayat" tab contained both in-flight and historical orders, contradicting its name.

In parallel, the founder requested a complete fulfillment lifecycle: PROCESSING → READY → DISPATCHED → customer confirms received → COMPLETED, with auto-generated documents at each step.

## Scope

**Phase 1** (this spec):

- Rename + restructure: `Penjualan > Riwayat` removed; new top-level `📦 Pesanan` menu with funnel view.
- Inbox keeps its WA conversation focus but gains a per-conversation "Buka Detail" button that deep-links into Pesanan.
- 6-stage funnel: Bertanya → Konfirmasi & Tunggu Bayar → Diproses → Dikirim / Siap Diambil → Diterima → Dibatalkan/Ditolak.
- New order states: `PROCESSING`, `READY_AWAITING_PAYMENT`, `READY`, `DISPATCHED`, `AWAITING_CUSTOMER_CONFIRMATION`, `ASSUMED_COMPLETED`, `WAITING_PAYMENT_TEMPO`, `DELIVERY_ISSUE`.
- Customer confirmation per channel: AI parse + auto-timer (WA/IG), admin manual (offline, marketplace, pickup-via-WA).
- Pengaturan additions: store address (with mandatory Google Maps link), operational hours.
- PDF generation: Sales Order, Invoice DP, Invoice Pelunasan, Invoice Lunas, Invoice Tempo, Surat Jalan.
- WA notification templates for every state transition with customer-visible impact.
- Input Baru form revamped as a channel-aware 3-step wizard.

**Phase 2** (deferred, separate spec):

- Customer self-service link (mobile-friendly order tracking page).
- Marketplace API integrations (Tokopedia, Shopee, Lazada, etc.).
- Mass operations (mass email, bulk export).
- Configurable notification templates in Pengaturan.
- Configurable per-channel "send PDF via WA" toggle.
- B2B document chain for high-volume Grosir (separate Penawaran/SO/Surat Jalan tables with conversion).

## Architecture

### Sidebar structure

```
📥 Inbox       — Chat workspace. Quick-action card per conversation
                  with "Buka Detail" deep-link.
                  Channel: WhatsApp now. Future: IG DM, Marketplace AI chat.

💰 Penjualan   — Order management hub. Tabs:
                    ├ Baru              (Input Baru 3-step wizard)
                    ├ Pesanan Aktif     (6-stage funnel — multi-channel
                    │                    source of truth, REPLACES Riwayat)
                    └ WIP Rakit         (existing)

⚙️ Pengaturan  — Adds: Alamat Toko, Jam Operasional.
```

### Inbox → Penjualan navigation

Inbox right-panel card shows order summary + status badge. The `Buka Detail` button performs same-window navigation to `/penjualan?tab=pesanan-aktif&order={id}` (URL-stateful), which opens the Penjualan menu, selects the Pesanan Aktif tab, scrolls to and expands the order into its action panel. Browser back returns to Inbox at the same conversation.

### Component layering

Single shared React component `<OrderActionPanel order={order} />` renders the per-status action UI. Embedded in both Inbox right-panel and Pesanan expanded-row drawer. Single owner of action logic; no UI duplication.

## 6-Stage Funnel View

### Tab `Pesanan Aktif` layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 Pesanan                                                          │
│                                                                     │
│ 🔍 Cari: [order/customer/produk]   Channel: [Semua ▾]              │
│ Date range: [30 hari ▾]            Sort: [Terbaru ▾]                │
│ Summary: ⏳ 8 aktif · ✓ 142 selesai · ✗ 5 dibatalkan               │
│ ─────────────────────────────────────────────                       │
│                                                                     │
│ ━━━━ AKTIF ━━━━                                                    │
│ 💬 1. Bertanya                              [3]  ⏱ avg 8m   ▼     │
│ 💰 2. Konfirmasi & Tunggu Bayar             [2]  💵 Rp 760K  ▼     │
│ 📦 3. Diproses                              [5]  💵 Rp 2.1M  ▼     │
│ 🚚 4. Dikirim / Siap Diambil                [2]  💵 Rp 850K  ▼     │
│                                                                     │
│ ━━━━ SELESAI ━━━━                                                   │
│ ✓ 5. Diterima                            [142]  💵 Rp 54M    ▶     │
│ ✗ 6. Dibatalkan / Ditolak                  [5]  💵 Rp 380K   ▶     │
└─────────────────────────────────────────────────────────────────────┘
```

Active stages (1-4) default expanded. Completed stages (5-6) default collapsed.

### Stage-to-status mapping

| Stage | Funnel label | Sources |
|---|---|---|
| 1 | 💬 Bertanya | `conversations` rows with no linked order; `conversation.state IN (GREETING, COLLECTING, CLARIFYING, STOCK_CHECK, CONFIRMING, ADD_MORE, DELIVERY)` |
| 2 | 💰 Konfirmasi & Tunggu Bayar | `orders` with `status IN (PENDING_ADMIN_CONFIRMATION, WAITING_PAYMENT, PAYMENT_UPLOADED, DP_UPLOADED)` |
| 3 | 📦 Diproses | `orders` with `status IN (DP_VERIFIED, PAYMENT_VERIFIED, PROCESSING, READY_AWAITING_PAYMENT)` |
| 4 | 🚚 Dikirim / Siap Diambil | `orders` with `status IN (READY, DISPATCHED, AWAITING_CUSTOMER_CONFIRMATION, DELIVERY_ISSUE)` |
| 5 | ✓ Diterima | `orders` with `status IN (COMPLETED, ASSUMED_COMPLETED)` |
| 6 | ✗ Dibatalkan / Ditolak | `orders` with `status IN (CANCELLED, PAYMENT_REJECTED, DP_PROOF_REJECTED)` |

### Per-stage controls

| Stage | Header summary | Sub-filters |
|---|---|---|
| 1 Bertanya | count + avg waiting time | by conversation state |
| 2 Konfirmasi & Tunggu Bayar | count + Rp total + overdue indicator | by payment sub-status |
| 3 Diproses | count + Rp total + DP-only and tempo badge counts | payment type, delivery method |
| 4 Dikirim / Siap Diambil | count + Rp total + awaiting-confirmation indicator | delivery method, confirmation status |
| 5 Diterima | count + Rp total closed | confirmation source, payment type |
| 6 Dibatalkan / Ditolak | count + Rp value lost | reason category |

Stage 5 defaults to all-time view with pagination (10 per load + "Load more"). Cancelled/Rejected (Stage 6) same.

### Per-row interactions

- Click row in stages 2–6: expand inline detail with `<OrderActionPanel>`.
- Click row in stage 1: navigate back to Inbox at that conversation (no order to act on yet).
- Right-click or `⋯` menu: quick actions (View, Send Reminder, Mark, Cancel).

### Empty states

- Stage with 0 entries: muted message ("Belum ada customer yang sedang chat 🤖").
- Filter yields 0 in stage: "Tidak ada hasil dengan filter saat ini."

### Mobile

Filter controls collapse to a single "🔍 Filter & Sort" button. Stages remain vertical; rows compact to one-line info.

## State Machine

### `order_status` enum (additions in **bold**)

```
PENDING_ADMIN_CONFIRMATION
APPROVED
WAITING_PAYMENT
**WAITING_PAYMENT_TEMPO**
PAYMENT_UPLOADED
DP_UPLOADED
PAYMENT_VERIFIED
DP_VERIFIED
**PROCESSING**
**READY_AWAITING_PAYMENT**
**READY**
**DISPATCHED**
**AWAITING_CUSTOMER_CONFIRMATION**
**DELIVERY_ISSUE**
COMPLETED
**ASSUMED_COMPLETED**
CANCELLED
PAYMENT_REJECTED
DP_PROOF_REJECTED
```

### Universal transition graph (WA happy path)

```
PENDING_ADMIN_CONFIRMATION
  → APPROVED → WAITING_PAYMENT
  ↘ CANCELLED

WAITING_PAYMENT
  ↗ PAYMENT_UPLOADED → admin verify → PAYMENT_VERIFIED
                                     ↘ PAYMENT_REJECTED → WAITING_PAYMENT
  ↘ DP_UPLOADED → admin verify → DP_VERIFIED
                                ↘ DP_PROOF_REJECTED → WAITING_PAYMENT

DP_VERIFIED or PAYMENT_VERIFIED
  → PROCESSING

PROCESSING
  → admin "Mark Ready" + delivery details
    → if fully paid: READY → DISPATCHED
    → if DP only: READY_AWAITING_PAYMENT (Mark Ready button blocked
                  with prompt "Customer belum lunasi Rp X. Kirim
                  reminder?")
       → customer upload remaining → REMAINING_UPLOADED (sub-state)
       → admin verify → PAYMENT_VERIFIED (now fully paid) → READY → DISPATCHED

DISPATCHED → AWAITING_CUSTOMER_CONFIRMATION
  → customer reply positive → COMPLETED (audit: ai_reply)
  → customer reply negative → DELIVERY_ISSUE → admin resolves → COMPLETED or CANCELLED
  → admin manual mark → COMPLETED (audit: manual)
  → auto-timer 3 days → ASSUMED_COMPLETED (audit: auto_timer)
```

### Path per channel

| State | WA / IG | Walk-in cash | Walk-in DP/delivery | Walk-in Tempo | Grosir / Sales Lap | Pameran cash | Pameran order | Marketplace |
|---|---|---|---|---|---|---|---|---|
| Conversation only | ✅ | — | — | — | — | — | — | — |
| `PENDING_ADMIN_CONFIRMATION` | ✅ | — | — | — | ✅ | — | ✅ | — |
| `WAITING_PAYMENT` | ✅ | — | ✅ | — | ✅ | — | ✅ | — |
| `WAITING_PAYMENT_TEMPO` | — | — | — | ✅ | ✅ | — | — | — |
| Payment/DP variants | ✅ | — | ✅ | — | ✅ | — | ✅ | — |
| `PROCESSING` | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `READY_AWAITING_PAYMENT` | ✅ | — | ✅ | — | ✅ | — | ✅ | — |
| `READY` / `DISPATCHED` | ✅ | — | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| `AWAITING_CUSTOMER_CONFIRMATION` | ✅ | — | optional | optional | optional | — | optional | optional |
| `COMPLETED` | ✅ | ✅ direct | ✅ | ✅ | ✅ | ✅ direct | ✅ | ✅ |
| `ASSUMED_COMPLETED` | ✅ | — | — | — | — | — | — | — |
| `DELIVERY_ISSUE` | ✅ | — | optional | optional | optional | — | optional | optional |

### Channel-specific entry points (Input Baru form behaviour)

- **Walk-in + bayar full + ambil langsung (no alamat):** save → `COMPLETED` direct → Stage 6/Riwayat as `Lunas Kasir`. Skip funnel.
- **Walk-in + bayar full + kirim later:** save → `PROCESSING` → Stage 3.
- **Walk-in + DP + delivery:** save → `PROCESSING` with `DP_VERIFIED` substate badge → Stage 3.
- **Walk-in + Tempo:** save → `WAITING_PAYMENT_TEMPO` → Stage 2 (or Stage 3 with badge if barang already released).
- **Grosir / Sales Lapangan / Pameran (order):** same as Walk-in matrix above, depending on payment type.
- **Pameran (cash + ambil):** save → `COMPLETED` direct → Riwayat.
- **Marketplace:** save → `PROCESSING` (skip stages 1–2, payment already verified by marketplace) → Stage 3.

## Customer Confirmation Handling

### Per-channel matrix

| Channel | Delivery method | Confirmation method | Auto-timer |
|---|---|---|---|
| WhatsApp / IG | DELIVERY | Calista AI parse customer reply (`sudah/diterima/ok/sampai/thanks` → `COMPLETED`; `rusak/belum/salah` → `DELIVERY_ISSUE`) + admin override | 3 days → `ASSUMED_COMPLETED` |
| WhatsApp / IG | PICKUP | **Both allowed (whichever fires first wins):** Calista AI parse customer reply (`sudah ambil/sudah/ok/thanks`) **OR** admin manual mark on physical handover. Both routes flag `customer_confirm_source` accordingly. | **No auto-timer** — pickup-never-shown stays in Stage 4 and surfaces via stuck-order alert (3-day threshold) so admin can decide to cancel or contact customer. |
| Walk-in (delivery, saved WA) | DELIVERY | Calista AI parse + admin override | 3 days |
| Walk-in (delivery, no WA) | DELIVERY | Admin manual mark only | None |
| Walk-in (pickup) | PICKUP | Admin marks on physical handover at counter | None |
| Grosir / Sales Lapangan | any | Admin manual mark | None |
| Pameran (cash) | PICKUP | Instan at booth | None |
| Pameran (order) | DELIVERY | Admin manual mark | None |
| Marketplace | any | **Admin manual mark only** | None |

### Reminder cadence

Single reminder only:

```
DISPATCHED → wait 24h
  ↘ if AWAITING_CUSTOMER_CONFIRMATION still: send `confirmation_reminder` (one time)
  → wait additional 48h (total 72h from DISPATCHED)
  ↘ if still pending: auto-timer fires → ASSUMED_COMPLETED
```

No multi-reminder spam.

### `DELIVERY_ISSUE` resolution

Admin handles offline (call customer, send replacement, etc.). Order detail UI exposes "Resolve to COMPLETED" or "Resolve to CANCELLED" buttons with required `resolution_note`.

## Pengaturan Additions

Located under `Pengaturan > Operasional`.

### Alamat Toko

| Field | Required | Notes |
|---|---|---|
| Nama toko | ✅ | |
| Alamat lengkap | ✅ | Multiline |
| Kota | ✅ | |
| Link Google Maps | ✅ | Required because `order_completed` template embeds it for review prompt |
| Parking info | optional | |
| Catatan pickup | optional | e.g. "Tanya bagian gudang lantai 2" |

### Jam Operasional

Per-day toggle (Senin–Minggu) + open/close time. Holiday override dates list.

Used in `dispatched_pickup` template to tell customer when to come.

### Out of scope this phase

- Numbering format configuration. Fixed format used:
  - `SO/{YYYY}/{####}` — Sales Order, reset annually
  - `INV/{YYYY}/{####}` — Invoice
  - `INV-DP/{YYYY}/{####}` — Invoice DP
  - `SJ/{YYYY}/{####}` — Surat Jalan
- DP/Tempo rules — already handled in menu Pelanggan (existing piutang/tempo).

## Document Generation

PDF generation runs server-side in Go using a PDF library (gopdf, unipdf, or chromedp HTML→PDF). PDFs stored in Supabase storage bucket `sales-documents/{order_id}/`.

### Documents & triggers

| Document | Triggered by | Stored at |
|---|---|---|
| Sales Order | `PENDING_ADMIN_CONFIRMATION → APPROVED` | `orders.sales_order_pdf_url` |
| Invoice DP | `DP_UPLOADED → DP_VERIFIED` | `orders.invoice_dp_pdf_url` |
| Invoice Pelunasan | becomes fully paid (any path) | `orders.invoice_final_pdf_url` |
| Invoice Lunas | Input Baru save with `COMPLETED` status (cash at counter) | `orders.invoice_final_pdf_url` |
| Invoice Tempo | Input Baru save with `WAITING_PAYMENT_TEMPO` | `orders.invoice_final_pdf_url` (with status TEMPO) |
| Surat Jalan | admin "Print Surat Jalan" in `PROCESSING` | `orders.surat_jalan_pdf_url` + `surat_jalan_printed_at` |

### Delivery per channel

| Document | Chat channels (WA / IG) | All offline (Walk-in / Pameran / Grosir / Sales Lap) | Marketplace |
|---|---|---|---|
| Sales Order | WA attachment | Counter print only | Not generated (marketplace has own) |
| Invoice DP | WA attachment | Counter print only | Not generated |
| Invoice Pelunasan | WA attachment | Counter print only | Not generated |
| Invoice Lunas | (if applicable) | Counter print only | Not generated |
| Invoice Tempo | (N/A — no chat-channel tempo) | Counter print only | N/A |
| Surat Jalan | Admin print for courier | Admin print | Admin print |

**Rule:** chat-channel customers get docs via WA attachment; offline-channel customers get docs via counter print.

**Future Phase 2:** per-channel "send via WA" toggle in Pengaturan so admin can opt in for, e.g., Grosir customers who actually prefer WA delivery.

### Versioning (SO revisions)

`orders.sales_order_revision` integer column. If admin edits an `APPROVED` order (e.g. ongkir change), a new SO PDF is generated with revision suffix in filename (`SO-2026-00012-Rev2.pdf`) and `sales_order_revision++`. Old revision PDFs retained for audit.

### Print format support

- **A4 PDF**: default for all customer-facing documents (SO, Invoice variants, Surat Jalan). Standard browser print dialog.
- **Dot Matrix**: supported for Invoice (Lunas, Tempo) and Surat Jalan at counter print. Uses the existing dot matrix print path (per progress.md history, Kasir flow already supports dot matrix). Admin chooses "Print A4" or "Print Dot Matrix" at the print moment.
- **Thermal printer**: out of scope this phase.

## Stock Reservation & Inventory

### Decision: stock decrements on payment commitment, not on approval

Stock change events:

| Event | Stock change | Reason |
|---|---|---|
| Order created (`PENDING_ADMIN_CONFIRMATION`) | None | Customer not yet committed |
| Admin approves (`PENDING → APPROVED`) | None | Still waiting customer to pay |
| `DP_UPLOADED → DP_VERIFIED` | **Decrement** | Customer paid DP — committed |
| `PAYMENT_UPLOADED → PAYMENT_VERIFIED` (when no prior DP) | **Decrement** | Customer paid full — committed |
| Walk-in / Pameran / Marketplace direct `PROCESSING` save | **Decrement on save** | Payment already verified |
| Walk-in cash `COMPLETED` direct (Lunas Kasir) | **Decrement on save** | Cash received at counter |
| Order cancelled or rejected AFTER stock decremented | **Restock** | Goods returned to available inventory |
| Order modification reduces qty | **Restock the delta** | Reduced demand |
| Order modification increases qty | **Decrement the delta** | Increased demand; check availability first |

### Why not earlier (e.g., at APPROVED)?

A customer who confirms but never pays is common. Reserving stock at APPROVED would leak inventory to phantom orders, blocking real paying customers. By tying decrement to DP_VERIFIED / PAYMENT_VERIFIED, stock only moves when there's real commitment.

### Overselling guard

The `verify_payment` / `verify_dp` actions must run an atomic check: if any cart item lacks enough stock, the verify fails with `STOCK_INSUFFICIENT`. Admin sees a modal listing shortfall per SKU and decides:

1. Reject the payment (and notify customer for refund).
2. Substitute item (modify order — see next section).
3. Override (rare; allows negative stock for accounting hand-correction).

Stored procedure / RPC ensures atomicity: stock check + decrement + status update all in one transaction.

### Cancel + restock

When admin cancels or system auto-cancels an order:

- Check `orders.stock_decremented_at` timestamp column (new).
- If not null, restock each item via inverse of decrement RPC.
- Set `orders.stock_restocked_at`, retain `stock_decremented_at` for audit.

## Order Modification After APPROVED

### Allowed edits

Editable until `DISPATCHED`. After `DISPATCHED`, frozen — modifications require Cancel + create new order.

| Field | Editable in | Side effects |
|---|---|---|
| Ongkir | APPROVED → READY_AWAITING_PAYMENT | Update `total`, regenerate SO PDF (rev++), notify customer (`order_modified` template) |
| Alamat | APPROVED → DISPATCHED | Update `customer_address`, no SO regenerate (cosmetic) |
| Cart items (add) | APPROVED → PROCESSING | Recompute total, stock check delta, regenerate SO PDF |
| Cart items (remove) | APPROVED → PROCESSING | Recompute total, restock delta, regenerate SO PDF |
| Cart item qty | APPROVED → PROCESSING | Recompute, stock delta, regenerate SO PDF |
| Customer name / phone | any pre-DISPATCHED | Update fields, no doc regen |
| Notes (internal) | any | Update field only |

### Modification audit

New table `order_modifications`:

```sql
CREATE TABLE order_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  modified_by_user_id UUID,
  modification_type TEXT,    -- 'ongkir' | 'cart_add' | 'cart_remove' | 'address' | etc
  before_value JSONB,
  after_value JSONB,
  reason TEXT,                -- required from admin
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Admin must provide a short `reason` (free-text, e.g., "customer minta tambah 5 unit") before saving any modification.

### UI

Order action panel exposes "Edit Order" button when status allows. Opens a modal with editable fields highlighted. Save triggers SO regenerate + WA notification + audit log entry.

## Admin Alerts & Stuck Order Detection

### Stuck definitions

| Stage | Stuck threshold | Reason |
|---|---|---|
| Stage 2 Konfirmasi & Tunggu Bayar | 7 days no payment | Customer ghosted or forgot |
| Stage 2 with `DP_VERIFIED` (waiting full) | 7 days no pelunasan | Customer needs reminder |
| Stage 3 Diproses | 3 days no progress | Admin forgot |
| Stage 4 `AWAITING_CUSTOMER_CONFIRMATION` (pickup, no auto-timer) | 3 days no admin mark | Admin forgot pickup confirmation |
| Stage 4 `DELIVERY_ISSUE` | 1 day unresolved | Customer waiting for response |

### Alert delivery

Phase 1: **Dashboard widget** on the home dashboard page. Shows stuck order count per category with link to the relevant stage in funnel. Updates via Supabase realtime.

```
┌─────────────────────────────────────────┐
│ ⚠️  Pesanan Perlu Perhatian             │
├─────────────────────────────────────────┤
│ 💰 3 tunggu bayar > 7 hari   →          │
│ 📦 1 sedang DP_VERIFIED > 7 hari →      │
│ 🚚 2 pickup tunggu konfirmasi > 3 hari →│
│ 🆘 1 DELIVERY_ISSUE unresolved →        │
└─────────────────────────────────────────┘
```

Phase 2 (deferred): WA push to admin owner number when stuck conditions arise (configurable in Pengaturan).

### Background job

A cron-like Go routine runs every hour:

1. Query orders matching stuck criteria.
2. Update internal `stuck_alert_flag` field (new column `orders.stuck_alert_at`) so frontend can highlight rows in funnel.
3. (Phase 2) Send WA to admin numbers in `notification_recipients` table.

## PDF Template Layouts

### Common header (all customer-facing documents)

```
┌─────────────────────────────────────────────────────┐
│ {store_name}                              {doc_no}  │
│ {store_address}                           {date}    │
│ {store_city}                                        │
│ Telp/WA: {store_phone}                              │
│ ────────────────────────────────────────────────── │
```

### Sales Order layout (`SO/2026/00001`)

```
[COMMON HEADER]

PESANAN PENJUALAN

Kepada:                          Pengiriman:
{customer_name}                  {delivery_type}
{customer_company (if any)}      {customer_address}
Telp/WA: {customer_phone}

ITEM:
┌────┬─────────────────────────┬─────┬───────────┬──────────────┐
│ No │ Nama Produk             │ Qty │ Harga     │ Subtotal     │
├────┼─────────────────────────┼─────┼───────────┼──────────────┤
│ 1  │ Kabel NYM 2.5mm² 100m   │ 10  │ 380,000   │ 3,800,000    │
│ 2  │ MCB Schneider 16A       │ 2   │ 120,000   │   240,000    │
└────┴─────────────────────────┴─────┴───────────┴──────────────┘

Subtotal:                                          4,040,000
Ongkir:                                              100,000
Diskon (-):                                                0
                                                  ───────────
TOTAL:                                  Rp       4,140,000

Tipe Pembayaran: {payment_type}     (Lunas / DP / Tempo)
Jika DP:
  DP wajib dibayar:                   Rp       2,070,000  (50%)
  Sisa pelunasan:                     Rp       2,070,000

Cara Pembayaran:
  Transfer ke: {bank_info_from_settings}
  Atau Cash/EDC di toko

CATATAN:
{notes_if_any}

Mohon konfirmasi pembayaran dengan upload bukti transfer
via WhatsApp ke nomor kami.

Terima kasih atas kepercayaannya 🙏
```

### Invoice DP layout (`INV-DP/2026/00001`)

```
[COMMON HEADER]

KWITANSI DOWN PAYMENT (DP)

Pelanggan: {customer_name}
Nomor Pesanan: {order_id_short}

Total Pesanan:                          Rp       4,140,000
DP Diterima:                            Rp       2,070,000  ← bold
Sisa Pelunasan:                         Rp       2,070,000
Tanggal Pelunasan: paling lambat sebelum barang dikirim

Metode Pembayaran: {payment_method}
Tanggal Diterima: {dp_verified_at}
Diverifikasi oleh: {verified_by}

[STATUS: DP DITERIMA — Menunggu Pelunasan]

Item pesanan (sebagaimana SO #{sales_order_no}):
[items table same format as SO]

Terima kasih 🙏
```

### Invoice Pelunasan / Lunas layout (`INV/2026/00001`)

```
[COMMON HEADER]

INVOICE PENJUALAN

Pelanggan: {customer_name}
Nomor Pesanan: {order_id_short}

[items table]

Subtotal:                                          4,040,000
Ongkir:                                              100,000
                                                  ───────────
TOTAL:                                  Rp       4,140,000

PEMBAYARAN:
  {if DP path:}
    DP (verified {dp_date}):              Rp     2,070,000
    Pelunasan (verified {final_date}):    Rp     2,070,000
  {else:}
    Lunas (verified {final_date}):        Rp     4,140,000

═══════════════════════════════════════════════════════════
   STATUS: ✓ LUNAS                                          
═══════════════════════════════════════════════════════════

Diverifikasi oleh: {verified_by}
Metode Pembayaran: {payment_method}
```

### Invoice Tempo layout (`INV/2026/00001-T`)

Same as Invoice but with `STATUS: TEMPO — Jatuh Tempo {due_date}` and bank info displayed for payment.

### Surat Jalan layout (`SJ/2026/00001`)

```
[COMMON HEADER]

SURAT JALAN / DELIVERY ORDER

Kepada:                          Dari:
{customer_name}                  {store_name}
{customer_company (if any)}      {store_address}
{customer_address}               (Pengirim)

Nomor Pesanan: {order_id_short}
Metode: {delivery_type}        ({delivery / pickup})
Tanggal Cetak: {today}
Kurir / Tracking: {courier_tracking_link (jika delivery)}

ITEM YANG DIKIRIM:
┌────┬─────────────────────────┬─────┬──────────────┐
│ No │ Nama Produk             │ Qty │ Catatan      │
├────┼─────────────────────────┼─────┼──────────────┤
│ 1  │ Kabel NYM 2.5mm² 100m   │ 10  │ Roll terikat │
│ 2  │ MCB Schneider 16A       │ 2   │              │
└────┴─────────────────────────┴─────┴──────────────┘

TANDA TERIMA:

Nama Penerima:    ____________________

Tanggal/Jam:      ____________________

Tanda Tangan:     ____________________


Diserahkan oleh: ____________________
{store_name} Staff
```

## WA Notification Templates

Hardcoded in code this phase (configurable in Pengaturan Phase 2). Templates fire only for channels with customer WA contact.

| Template id | Triggered when | Active for channels | Variables |
|---|---|---|---|
| `order_approved` | `PENDING → APPROVED` | WA, IG, (offline if WA saved → Phase 2) | `{customer_name}`, `{order_id}`, `{total}`, `{bank_info_from_settings}` + SO PDF attachment |
| `payment_dp_verified` | `DP_UPLOADED → DP_VERIFIED` | WA, IG | `{customer_name}`, `{dp_amount}`, `{remaining}`, `{order_id}` + Invoice DP PDF |
| `payment_full_verified` | becomes fully paid | WA, IG | `{customer_name}`, `{total}`, `{order_id}` + Invoice Pelunasan PDF |
| `payment_rejected` | `PAYMENT_UPLOADED → PAYMENT_REJECTED` | WA, IG | `{reason}` |
| `dp_rejected` | `DP_UPLOADED → DP_PROOF_REJECTED` | WA, IG | `{reason}` |
| `ready_awaiting_full_payment` | admin Mark Ready blocked due to DP-only | WA, IG | `{remaining}` |
| `dispatched_delivery` | `DISPATCHED` with delivery type DELIVERY | WA, IG | `{courier_link}`, `{customer_name}` |
| `dispatched_pickup` | `DISPATCHED` with delivery type PICKUP | WA, IG | `{store_address}`, `{operational_hours}`, `{pickup_notes}` |
| `confirmation_reminder` | 24h post-DISPATCHED + no reply | WA, IG | `{customer_name}` |
| `order_completed` | `COMPLETED` | WA, IG | `{order_id}`, `{google_maps_link}` — see below |

### `order_completed` template content

```
Terima kasih atas kepercayaannya 🙏

Pesanan #{order_id} telah selesai. Semoga produk kami
memenuhi kebutuhan Anda!

Boleh kami minta feedback singkat tentang pengalaman Anda?
Saran/kritik sangat membantu kami untuk berkembang.

Jika Anda berkenan, mohon dukung kami dengan bintang 5
di Google Maps 🌟
👉 {google_maps_link}

Terima kasih atas waktunya! Sampai jumpa di pesanan
berikutnya 🙏
```

## Input Baru Revamp

Three-step wizard replacing the current monolithic form. Channel-aware fields. Search and Jasa Rakit / Jasa Custom Panel remain (regression-protected).

### Step 1 — Kanal & Pelanggan

```
[KANAL PENJUALAN]
Chip selector:
  OFFLINE: Walk-in · Grosir · Sales Lapangan · Pameran
  MARKETPLACE: Tokopedia · Shopee · Lazada · Blibli · Bukalapak · Ralali · Bhinneka
  DIRECT ONLINE: WhatsApp · Instagram DM · Website Sendiri (future)

[PELANGGAN]
Search existing (nama/HP/perusahaan) OR + Daftar Pelanggan Baru
(form: nama, HP/WA, perusahaan)

[CATATAN]
Free-text optional
```

### Step 2 — Items & Pembayaran

```
🔍 CARI BARANG
[___________________________________________________]
  Live dropdown showing SKU, name, price, stock.

🛠 ATAU TAMBAH JASA (KEPT from current form):
  ⚡ + Tambah Jasa Rakit
  📦 + Tambah Jasa Custom Panel

🛒 KERANJANG (live preview):
  rows with qty +/-, harga, subtotal per row, total

💳 TIPE PEMBAYARAN:
  ◯ Lunas  ◯ DP  ◯ Tempo
  (DP: amount + due date; Tempo: due date)

💰 METODE PEMBAYARAN (untuk Lunas/DP at counter):
  💵 Cash | 🏦 Transfer | 💳 EDC

(IF channel = Marketplace:
  Auto-set: "✓ Sudah dibayar via [Marketplace]" — read-only.
  Hide payment method UI.)

DISKON / ONGKIR / PAJAK (optional rows)
```

### Step 3 — Fulfillment & Save

```
🚚 FULFILLMENT
☐ Customer ambil langsung? (toggle)
   YES → no address needed, no funnel (jumps to COMPLETED on Save if Lunas)
   NO → input alamat pengiriman

(IF channel = Marketplace:)
📦 Order ID dari Marketplace: [_________________________]
   (optional, for cross-reference)

📝 CATATAN INTERNAL
Free-text optional

🔮 PREVIEW STATUS SAAT SAVE:
  "→ Order akan masuk ke Stage 3 Diproses"
  (computed live based on selections above)

💾 [Save & Lanjut Proses]   |   [Save & Cetak Invoice Lunas]
   ↑ button label changes based on resulting status
```

### Channel-aware behaviour matrix

| Channel | Show "Customer ambil langsung?" | Show payment method | Show Marketplace Order ID | Save button label |
|---|---|---|---|---|
| Walk-in | ✅ | ✅ | — | "Save & Cetak Invoice Lunas" if Lunas+ambil, else "Save & Lanjut Proses" |
| Grosir / Sales Lap | ✅ | ✅ | — | same |
| Pameran | ✅ | ✅ | — | same |
| Marketplace > * | — (always delivery) | — (read-only "paid") | ✅ | "Save & Lanjut Proses" |
| WhatsApp | this form is unusual (Calista handles WA flow); used only for manual admin entry | ✅ | — | normal |
| Instagram DM | same as WhatsApp | ✅ | — | normal |

## Data Model & Migration

### Migration `20260615000002_order_fulfillment_lifecycle.sql`

```sql
-- 1. Order status enum additions (idempotent)
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY_AWAITING_PAYMENT';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DISPATCHED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'AWAITING_CUSTOMER_CONFIRMATION';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ASSUMED_COMPLETED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'WAITING_PAYMENT_TEMPO';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DELIVERY_ISSUE';

-- 2. New columns on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_order_ref TEXT,           -- marketplace order ID
  ADD COLUMN IF NOT EXISTS courier_tracking_link TEXT,        -- input at Mark Ready
  ADD COLUMN IF NOT EXISTS customer_confirm_source TEXT,      -- 'ai' | 'manual' | 'auto_timer' | 'marketplace_api'
  ADD COLUMN IF NOT EXISTS customer_confirm_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_issue_reason TEXT,
  ADD COLUMN IF NOT EXISTS delivery_issue_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sales_order_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS sales_order_revision INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS invoice_dp_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_final_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS surat_jalan_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS surat_jalan_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stock_decremented_at TIMESTAMPTZ,  -- when inventory was decremented
  ADD COLUMN IF NOT EXISTS stock_restocked_at TIMESTAMPTZ,    -- when inventory was returned (cancel)
  ADD COLUMN IF NOT EXISTS stuck_alert_at TIMESTAMPTZ;        -- flagged by stuck-order job

-- 2b. Order modification audit log
CREATE TABLE IF NOT EXISTS order_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  modified_by_user_id UUID,
  modification_type TEXT NOT NULL,
    -- 'ongkir' | 'cart_add' | 'cart_remove' | 'cart_qty' | 'address' | 'customer' | 'notes'
  before_value JSONB,
  after_value JSONB,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_modifications_order_id ON order_modifications(order_id);

-- 3. Store settings
CREATE TABLE IF NOT EXISTS store_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  gmaps_link TEXT NOT NULL,         -- required
  parking_info TEXT,
  pickup_notes TEXT,
  operational_hours JSONB,          -- {"monday": {"open": "08:00", "close": "17:00"}, ...}
  holidays_overrides DATE[],
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Document numbering counters (fixed format, not configurable this phase)
CREATE TABLE IF NOT EXISTS doc_number_counters (
  doc_type TEXT PRIMARY KEY,        -- 'sales_order', 'invoice', 'invoice_dp', 'surat_jalan'
  current_year INT NOT NULL,
  last_number INT NOT NULL DEFAULT 0
);

-- Seed
INSERT INTO doc_number_counters (doc_type, current_year, last_number) VALUES
  ('sales_order', EXTRACT(YEAR FROM NOW())::INT, 0),
  ('invoice',     EXTRACT(YEAR FROM NOW())::INT, 0),
  ('invoice_dp',  EXTRACT(YEAR FROM NOW())::INT, 0),
  ('surat_jalan', EXTRACT(YEAR FROM NOW())::INT, 0)
ON CONFLICT (doc_type) DO NOTHING;

-- 5. Funnel summary view (optional optimisation; can defer to Phase 2)
-- For now, frontend queries with stage-specific WHERE clauses.
```

### Compatibility with existing orders

Existing rows (before migration) have legacy statuses that map naturally:

- `COMPLETED` rows → continue to appear in Stage 5.
- `PENDING`, `WAITING_PAYMENT`, payment/DP variants → Stage 2 as before.
- No backfill needed for new columns — they're nullable.

The `Riwayat` tab's data simply moves to Stage 5 and Stage 6 in the new Pesanan menu. Frontend reads same orders table; only the rendering location changes.

## Phase 1 Sub-Phase Breakdown

Total effort estimate: 3–5 weeks solo dev.

### Phase 1A — Foundation + Inventory (2 weeks)

- Migration `20260615000002` applied (enum + columns + `order_modifications` + `store_settings` + `doc_number_counters`).
- New `Penjualan > Pesanan Aktif` tab (replaces `Riwayat`).
- 6-stage funnel skeleton with stage-to-status mapping.
- Global controls (search, channel, date, sort) and per-stage summary headers.
- `<OrderActionPanel>` component with per-status action layouts.
- State machine code paths for all new transitions.
- Inbox `Buka Detail` button + deep-link routing to `/penjualan?tab=pesanan-aktif&order={id}`.
- Channel-specific entry rules for Input Baru (paths defined; form revamp deferred to 1C).
- **Stock reservation + cancel restock** (atomic RPC, `verify_payment` / `verify_dp` integrated).
- **Order modification flow** with `order_modifications` audit table.
- Supabase realtime subscription pattern for funnel auto-update.

### Phase 1B — Documents, Notifications & Alerts (2 weeks)

- Pengaturan additions: Alamat Toko (with required Google Maps), Jam Operasional.
- PDF generation pipeline (library choice — gopdf or chromedp HTML→PDF).
- Six PDF templates wired (SO, Invoice DP, Invoice Pelunasan, Invoice Lunas, Invoice Tempo, Surat Jalan) matching layout specs.
- Document numbering counters with annual reset logic.
- WA template wiring (10 templates) with conditional channel logic (chat-only).
- WA attachment delivery (whatsmeow `SendDocument`).
- Counter print for offline channels — A4 default + **Dot Matrix support** (reuse existing Kasir dot matrix path).
- **Stuck-order detection cron + dashboard widget** (5 stuck categories).

### Phase 1C — Input Baru Wizard Revamp (1 week)

- Three-step wizard component.
- Channel-aware field conditional rendering.
- Live status preview ("→ akan masuk ke Stage X").
- Smart save button label.
- Keep Jasa Rakit + Jasa Custom Panel paths intact.
- Channel-aware print trigger on save (A4 / dot matrix selector).

### Acceptance criteria for Phase 1

1. Existing customer order from WA (Calista flow) progresses end-to-end without admin manual intervention except verification steps. Verified by repeating the 2026-06-14 test scenario.
2. Walk-in cash sale completes with one click and no funnel pollution.
3. Marketplace manual input lands directly in Stage 3 with `external_order_ref` populated.
4. DP-then-pelunasan customer receives 2 distinct invoice PDFs (Invoice DP, Invoice Pelunasan) via WA.
5. Customer received receives `order_completed` WA with Google Maps review link.
6. Pickup orders never auto-complete from a timer. For WA/IG pickup, completion may come from either Calista AI parsing a customer reply OR admin manual mark — whichever fires first. For all other pickup channels (Walk-in, Grosir, Pameran), admin manual mark only. If neither path resolves after 3 days post-DISPATCHED, the stuck-order alert fires.
7. Auto-timer fires exactly once at 24h reminder + 72h auto-complete (no spam).
8. **Stock decrements at DP/Full payment verification, NOT at APPROVED.** Cancel after decrement restocks atomically. Concurrent payment verifies cannot oversell (atomic check + decrement).
9. **Order modification (ongkir/items/address) recorded in `order_modifications` audit table** with reason field. SO PDF regenerated with `Rev2` suffix when ongkir or items change.
10. **Stuck-order dashboard widget** shows correct counts and links into the relevant funnel stage. Background cron fires hourly.
11. **Dot matrix print works** for Invoice + Surat Jalan at counter — reuses existing Kasir dot matrix print path.

## Out of Scope (Phase 2+)

- Customer self-service order tracking page (mobile-friendly URL).
- Marketplace API integrations (Tokopedia/Shopee/etc. webhooks).
- Mass operations (mass print, bulk export, mass mark-as-paid).
- Configurable WA notification templates in Pengaturan.
- Configurable per-channel "send PDF via WA" toggle.
- B2B document chain for high-volume Grosir (separate Penawaran/SO/Surat Jalan as distinct documents with conversion UI à la Jurnal.id).
- IG DM channel implementation.
- Website Sendiri channel implementation.
- WA push alerts to admin for stuck orders (Phase 1 = dashboard widget only).
- Refund flow (post-cancellation customer reimbursement).
- Multi-admin row locking (rare for current solo founder team).
- **Email delivery for SO/Invoice** — confirmed NOT needed per founder; offline channels use counter print, chat channels use WA attachment.
- Thermal printer format.
- Full piutang/tempo workflow integration — `WAITING_PAYMENT_TEMPO` state exists as a placeholder; deeper integration with menu Pelanggan piutang remains in existing tempo flow until a dedicated tempo spec.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Funnel performance with thousands of completed orders in Stage 5 | Default collapse + pagination 10 per load + lazy fetch |
| PDF generation latency at peak | Background job queue; admin sees "Generating..." then PDF link |
| WA attachment delivery failures (file size, network) | Retry queue; fallback to plain WA text with hosted PDF link |
| Existing orders in `Riwayat` confusing during rollout | One-time announcement banner: "Riwayat moved to Pesanan menu" |
| Customer reply intent misclassified by Calista AI | Admin override always available; auto-timer fallback prevents permanent stuck state |
| Pickup orders never completed because admin forgets to mark | Daily admin dashboard widget: "X orders stuck in AWAITING_CONFIRMATION > 3 days" |
| Migration enum ALTER blocking on prod | Non-blocking; ALTER TYPE ADD VALUE is fast. Apply during low traffic; rollback impossible but safe (additive only). |
| Admin learning curve for new Pesanan menu + funnel layout | One-time onboarding modal on first visit explaining funnel; help-tooltip on each stage header; "Riwayat" old tab returns 301-style banner pointing to new location. |

## Glossary

- **"Saved WA"** — customer profile in Pelanggan has a non-null WA phone number. Used to decide whether non-chat-channel orders (e.g. Walk-in delivery, Grosir) can receive WA notifications and/or AI-parsed confirmation replies.
- **"Counter print"** — admin prints PDF at the kasir/sales counter and hands the printed paper to the customer in person. PDF is downloaded by the browser; no WA delivery.
- **"Confirmation source"** — `customer_confirm_source` value: `ai` (Calista parsed positive reply), `manual` (admin clicked Mark Diterima), `auto_timer` (3-day timer fired → ASSUMED_COMPLETED), or `marketplace_api` (future).
- **"Channel-aware"** — UI or business logic that branches on `orders.channel` value. e.g. Input Baru form hides payment-method selector when channel is Marketplace.

## Open Questions

- **Walk-in (delivery, saved WA) confirmation watcher**: when admin sends a dispatch WA to a walk-in customer with saved WA number, does the Calista listener route their reply through the same confirmation parser as native WA orders? Spec assumes yes (any incoming WA reply to an order in `AWAITING_CUSTOMER_CONFIRMATION` is parsed regardless of origin channel). Implementation should verify whatsmeow's message-routing scope.
- **`WAITING_PAYMENT_TEMPO` minimal integration**: state exists for funnel visibility; the actual tempo workflow (aging buckets, reminders, follow-up cadence) continues to live in menu Pelanggan's piutang/tempo features. Implementation plan needs to confirm the read-only link from this funnel stage back to the Pelanggan piutang detail view.
- **Concurrent payment verification ordering**: if two admins click "Verify Payment" on different orders that share a low-stock SKU simultaneously, the atomic RPC will let the first succeed and the second receive `STOCK_INSUFFICIENT`. Implementation plan should define exact RPC semantics and admin-facing error messages.
