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
📥 Inbox       — WA-channel chat workspace. Quick-action card per
                  conversation with "Buka Detail" deep-link.
                  Future: IG DM, Marketplace AI chat.

📦 Pesanan     — Multi-channel order workspace (single source of truth).
                  Funnel view, all channels, full action capabilities.

💰 Penjualan   — Stays for new transaction input.
                  Tabs: Baru (Input Baru wizard) | WIP Rakit
                  Riwayat tab REMOVED (now in Pesanan menu).

⚙️ Pengaturan  — Adds: Alamat Toko, Jam Operasional.
```

### Inbox → Pesanan navigation

Inbox right-panel card shows order summary + status badge. The `Buka Detail` button performs same-window navigation to `/pesanan?order={id}` (URL-stateful), which opens the Pesanan funnel view with that order pre-expanded into its action panel. Browser back returns to Inbox at the same conversation.

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
| WhatsApp / IG | PICKUP | **Admin manual mark only** (customer often forgets to reply) | None |
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
  ADD COLUMN IF NOT EXISTS surat_jalan_printed_at TIMESTAMPTZ;

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

### Phase 1A — Foundation (1–2 weeks)

- Migration `20260615000002` applied.
- Pesanan top-level menu in sidebar (`/pesanan` route).
- 6-stage funnel skeleton with stage-to-status mapping.
- Global controls (search, channel, date, sort) and per-stage summary headers.
- `<OrderActionPanel>` component with per-status action layouts.
- State machine code paths for all new transitions.
- Inbox `Buka Detail` button + deep-link routing.
- Remove `Penjualan > Riwayat` tab.
- Channel-specific entry rules for Input Baru (paths defined but form unchanged in this sub-phase).

### Phase 1B — Documents & Notifications (1–2 weeks)

- Pengaturan additions: Alamat Toko, Jam Operasional.
- PDF generation pipeline (library choice + templates for SO, Invoice variants, Surat Jalan).
- Document numbering counters.
- WA template wiring (10 templates) with conditional channel logic.
- WA attachment delivery (whatsmeow `SendDocument`).
- Counter print mechanism for offline channels (PDF download + print dialog).

### Phase 1C — Input Baru Wizard Revamp (1 week)

- Three-step wizard component.
- Channel-aware field conditional rendering.
- Live status preview ("→ akan masuk ke Stage X").
- Smart save button label.
- Keep Jasa Rakit + Jasa Custom Panel paths intact.

### Acceptance criteria for Phase 1

1. Existing customer order from WA (Calista flow) progresses end-to-end without admin manual intervention except verification steps. Verified by repeating the 2026-06-14 test scenario.
2. Walk-in cash sale completes with one click and no funnel pollution.
3. Marketplace manual input lands directly in Stage 3 with `external_order_ref` populated.
4. DP-then-pelunasan customer receives 2 distinct invoice PDFs (Invoice DP, Invoice Pelunasan) via WA.
5. Customer received receives `order_completed` WA with Google Maps review link.
6. Pickup orders cannot be auto-completed; admin must manually mark.
7. Auto-timer fires exactly once at 24h reminder + 72h auto-complete (no spam).

## Out of Scope (Phase 2+)

- Customer self-service order tracking page (mobile-friendly URL).
- Marketplace API integrations (Tokopedia/Shopee/etc. webhooks).
- Mass operations (mass email, bulk export, mass mark-as-paid).
- Configurable WA notification templates in Pengaturan.
- Configurable per-channel "send PDF via WA" toggle.
- B2B document chain for high-volume Grosir (separate Penawaran/SO/Surat Jalan as distinct documents with conversion UI à la Jurnal.id).
- Dot Matrix print format support.
- IG DM channel implementation.
- Website Sendiri channel implementation.

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
- **WAITING_PAYMENT_TEMPO integration**: state exists in this spec, but actual integration with existing piutang/tempo system (Pelanggan menu) is out of scope and will be handled in the implementation plan.
