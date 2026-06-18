# Rakit & Custom Panel — Integration into Order Fulfillment Funnel

**Date:** 2026-06-16
**Author:** Tony Wei + Claude (brainstorming session)
**Status:** Draft — awaiting user review
**Parent spec:** [2026-06-15-order-confirmation-fulfillment-revamp-design.md](./2026-06-15-order-confirmation-fulfillment-revamp-design.md)

## 1. Purpose & Scope

Parent spec defines 6-stage order fulfillment funnel (Bertanya → Konfirmasi & Belum Bayar → Diproses → Dikirim/Siap Diambil → Diterima → Dibatalkan) primarily for SKU/komponen orders.

**This spec extends parent to handle service-type orders** (Custom Panel fabrication, Rakit Panel assembly) within the same funnel, plus tightens cancellation rules and clarifies multi-channel entry routing.

**In scope:**
- Order type flag system (3 types) at transaction-level
- Channel × type × payment routing matrix (where order lands in funnel)
- Stage 2-5 flow specifics for Custom Panel & Rakit Panel
- Stage 3 sub-stages restructure (new sub-stages for service-type orders)
- Catat Penjualan / Kasir screen changes
- Cancellation rule simplification (pre-payment only)
- Other menu implications (Persetujuan, Piutang, Pelanggan, Sidebar, WipListScreen deprecation)
- PDF document gap analysis & dual-print support (dotmatrix + browser)
- Concurrent edit strategy
- Calista AI boundary (no autonomous for service-type)
- Reports/KPI additions
- Audit log expansion
- Pengaturan additions

**Out of scope (future / explicitly deferred):**
- Cancellation after DP/payment verified (forfeit logic) — backend `cancel_rakit` RPC stays, UI does not call
- Auto-cancel timeout — admin manual cancel only
- Format nomor SO/Invoice — keep existing format
- Sales Lapangan attribution
- Mobile UI responsive variants
- Multi-step wizard for complex Custom Panel spec
- Calista AI capturing rakit/panel orders autonomously
- Customer-facing status tracking via WA

## 2. Order Type Flag System

### 2.1 Type taxonomy

Every transaction has exactly ONE `order_type` flag set at entry time:

| Flag | Value | Definition |
|---|---|---|
| 📦 **Komponen Saja** | `KOMPONEN` | Pure SKU sales, no labor service. Cart contains only stock items. |
| 📐 **Custom Panel** | `CUSTOM_PANEL` | Fabrication of custom-sized panel from raw material (plat cutting, drilling, finishing, optional wiring). Cart MAY include SKU komponen + must include ≥1 custom panel service line. |
| 🛠️ **Rakit Panel** | `RAKIT_PANEL` | Assembly/wiring of existing panel box with electrical components. Cart MUST include ≥1 rakit service line + typically SKU komponen for fitting. |

### 2.2 Type display

- Each order row shows type badge near customer name: `[📦 Komponen]` / `[📐 Custom Panel]` / `[🛠️ Rakit Panel]`
- Toolbar filter at top of funnel: `Tampilkan: [● Semua] [○ 📦 Komponen] [○ 📐 Custom Panel] [○ 🛠️ Rakit Panel]`
- For Custom Panel & Rakit Panel: extra inline label `⏱️ Estimasi 5 hari` next to badge

### 2.3 Behavior matrix per type

| Aspect | 📦 Komponen | 📐 Custom Panel | 🛠️ Rakit Panel |
|---|---|---|---|
| Cart contents | SKU only | SKU + ≥1 jasa_custom_panel line | SKU + ≥1 jasa_rakit line |
| Customer required? | Optional (anon walk-in OK) | **Wajib** (multi-day need contact) | **Wajib** (multi-day need contact) |
| Payment type allowed | FULL, DP, TEMPO | **DP only** (or TEMPO if eligible) | **DP only** (or TEMPO if eligible) |
| DP percent/amount | Free-form by admin | Free-form by admin | Free-form by admin |
| Estimasi pengerjaan (hari) | N/A | **Wajib** input manual | **Wajib** input manual |
| Owner approval gate? | No | **Yes** at Stage 3b (lock biaya final) | **Yes** at Stage 3b (lock biaya final) |
| WIP tracking (multi-hari) | No | **Yes** with day-N-of-est counter | **Yes** with day-N-of-est counter |
| Stock deduction timing | At payment verify (Stage 2d → 3a) for FULL/DP cash; at Stage 3a entry for TEMPO | At Stage 3b owner approval (existing rakit_lock behavior) | At Stage 3b owner approval (existing rakit_lock behavior) |
| Pure-jasa bypass | N/A | **Removed** (must go through funnel + owner approval) | **Removed** (must go through funnel + owner approval) |

## 3. Channel × Type × Payment Routing Matrix

Determines which stage an order lands in immediately after wizard submit.

| Channel | Type | Payment | Landing stage |
|---|---|---|---|
| Walk-in | 📦 | Cash FULL + pickup | **Stage 5 (Diterima)** — skip funnel entirely, archive directly |
| Walk-in | 📦 | Cash FULL + delivery | **Stage 4a (Sedang Dikirim)** |
| Walk-in | 📦 | DP cash + transfer sisa | **Stage 3a (Sedang Siapkan Barang)** |
| Walk-in | 📦 | DP/FULL transfer nanti | **Stage 2c (Tunggu Bayar)** |
| Walk-in | 📦 | TEMPO | **Stage 3a (Sedang Siapkan Barang)** — skip Stage 2 |
| Walk-in/Telp/IG | 📐 / 🛠️ | DP cash di toko | **Stage 3a (Sedang Dikerjakan)** — DP verified at POS |
| Walk-in/Telp/IG | 📐 / 🛠️ | DP transfer nanti | **Stage 2c (Tunggu Bayar DP)** |
| Walk-in/Telp/IG | 📐 / 🛠️ | TEMPO (eligible) | **Stage 3a (Sedang Dikerjakan)** |
| WhatsApp (Calista) | 📦 | DP/FULL | **Stage 2c (Tunggu Bayar)** after admin approves 2b |
| WhatsApp (Calista) | 📐 / 🛠️ | Any | **Stage 1 (Bertanya)** — Calista forwards to admin, no autonomous capture |
| Marketplace | 📦 | Marketplace settled | **Stage 3a (Sedang Siapkan Barang)** — payment already settled by marketplace |

### Rationale: walk-in skips 2a/2b

- 2a "Tunggu Konfirmasi Customer" — for WA. Walk-in customer confirms verbally in-store.
- 2b "Perlu Disetujui Admin" — for WA inquiry needing admin to set DP/ongkir. Walk-in admin sets these IN the input wizard before submit.

After wizard submit:
- Cash payment recorded at POS → stage where work or shipping begins
- Transfer-later payment → Stage 2c waiting for customer

## 4. Stage 2-5 Flow for Custom Panel & Rakit Panel

Both types share the same flow; only badge differs (📐 vs 🛠️).

```
═══════════════════════════════════════════════════════════════════
STAGE 2 — Konfirmasi & Belum Bayar
═══════════════════════════════════════════════════════════════════
  2a  📩 Tunggu Konfirmasi Customer            (WA channel only)
       └ Calista forwards inquiry to admin; admin needs to engage manually
       └ NOT applicable for walk-in (skipped per §3 routing)
  2b  ⚡ Perlu Disetujui Admin                 (WA channel only)
       └ Admin sets DP amount (manual), estimasi hari (manual),
         ongkir + alamat (if delivery)
       └ NOT applicable for walk-in (admin sets these in wizard)
  2c  ⏳ Tunggu Customer Bayar DP
       └ Invoice DP dikirim (WA auto, or printed for walk-in to bring home)
       └ Customer transfer DP from home
       └ ⚠️ Only DP — NOT full payment (biaya final tidak known yet)
  2d  ⚡ Perlu Cek Bukti DP
       └ Customer uploads bukti, admin verify
  2e  ❌ Ditolak (bukti salah / customer cancel pre-payment)

                          │ DP verified
                          ▼
═══════════════════════════════════════════════════════════════════
STAGE 3 — Diproses
═══════════════════════════════════════════════════════════════════
  3a  🛠️/📐 Sedang Dikerjakan (Day N of Est)
       └ Counter: "Hari ke-2 dari estimasi 5 hari"
       └ Overdue indicator (🆘 merah) if today > estimated_completion_date
       └ Admin can update progress note + foto progress (optional)
       └ Admin clicks "Selesai Kerja" when physical work done
                          │
                          ▼
  3b  🔒 Tunggu Owner Cek Biaya Final
       └ Admin submits final biaya breakdown:
            • Material actual (vs estimate)
            • Labor actual (vs estimate)
            • TOTAL FINAL (vs estimate)
            • SELISIH + justifikasi (e.g., "plat naik 10%")
       └ Owner opens Persetujuan inbox → reviews → Approve/Reject
       └ Approve → stock komponen deducted (rakit_usage), HPP locked
       └ Reject → bounce back to 3a (admin koreksi biaya)
                          │
                          ▼
  3c  💛 Biaya Final OK · Tunggu Customer Bayar Pelunasan
       └ System computes: sisa = biaya_final - dp_received
       └ Invoice Pelunasan auto-dikirim ke customer via WA
       └ Transparency note if selisih: "Estimasi awal Rp X → Final Rp Y karena Z"
                          │
                          ▼
  3d  ⚡ Perlu Cek Bukti Pelunasan
       └ Customer uploads bukti pelunasan, admin verify
  3e  ❌ Bukti Pelunasan Ditolak (conditional bounce back from 3d)
                          │  bukti OK
                          ▼
  3f  ✓ Lunas · Siap Antar/Ambil

                          │ → Stage 4
                          ▼
═══════════════════════════════════════════════════════════════════
STAGE 4 — Dikirim / Siap Diambil   (shared with regular)
═══════════════════════════════════════════════════════════════════
  4a  🚚 Sedang Dikirim — tracking link displayed read-only
  4b  🏪 Siap Diambil di Toko — admin tunggu customer datang
  4d  🆘 Ada Masalah Pengiriman — resolution panel with retry/return/refund

                          │ Diterima
                          ▼
═══════════════════════════════════════════════════════════════════
STAGE 5 — Diterima   (shared with regular)
═══════════════════════════════════════════════════════════════════
  Archive: Invoice Lunas + Surat Jalan + (optional) Foto Hasil Akhir
  Re-downloadable on demand from action panel
```

### Differences from regular SKU DP flow

1. **3b "Owner Cek Biaya Final"** is unique to CP/RP. Regular SKU has known cost upfront, no owner approval needed.
2. **Invoice Pelunasan generated at 3c** for CP/RP (with actual cost). Regular SKU's invoice was generated at 2c with full known amount.
3. **3a day-N-of-est counter** is unique to CP/RP. Regular SKU pack typically same-day.

## 5. Stage 3 Sub-Stages Restructure (Unified)

Combining regular and CP/RP sub-stages in one Stage 3 view, filterable by type:

| Sub-stage | Applies to | Description |
|---|---|---|
| 3a 🔧 Sedang Siapkan Barang | KOMPONEN | Pick & pack from stock |
| 3a 🛠️/📐 Sedang Dikerjakan | CP / RP | Multi-day fabrication/assembly with day-N counter |
| 3b 🔒 Tunggu Owner Cek Biaya | CP / RP | Awaiting owner approval of final cost lock |
| 3c 💛 Biaya Final OK · Tunggu Pelunasan | CP / RP | Invoice pelunasan sent, awaiting payment |
| 3d 💛 DP done · Tunggu Pelunasan | KOMPONEN (DP) | Regular DP awaiting customer to pay sisa |
| 3e ⚡ Perlu Cek Bukti Pelunasan | All types | Verify pelunasan proof |
| 3f ❌ Bukti Pelunasan Ditolak | All types | Conditional bounce |
| 3g ✓ Barang Siap, Lanjut Kirim/Ambil | All types | Ready for Stage 4 |

Toolbar filter `Tampilkan: Semua / Komponen / Custom Panel / Rakit Panel` hides irrelevant sub-stages.

## 6. Catat Penjualan / Kasir Screen Changes

Reference file: `src/components/PenjualanBaruScreen.tsx`

### 6.1 New: OrderTypeSelector (top of form)

3 large icon buttons above existing ChannelSelector:
```
[ 📦 KOMPONEN SAJA ]  [ 📐 CUSTOM PANEL ]  [ 🛠️ RAKIT PANEL ]
```
Selected type drives subsequent conditional behavior.

### 6.2 Conditional cart behavior

- **KOMPONEN**: hide RakitButtonsRow, cart accepts SKU only
- **CUSTOM_PANEL**: show "📐 Tambah Custom Panel" button only (jasa_custom_panel lines); SKU allowed
- **RAKIT_PANEL**: show "🛠️ Tambah Rakit Panel" button only (jasa_rakit lines); SKU allowed
- Validation: CP requires ≥1 jasa_custom_panel line; RP requires ≥1 jasa_rakit line

### 6.3 New: Estimasi pengerjaan (hari) field

- Shown in PaymentPanel only when type is CUSTOM_PANEL or RAKIT_PANEL
- Number input, label: "⏱️ Estimasi pengerjaan (hari)"
- Saved as `estimated_completion_days`
- System computes `estimated_completion_date = wip_started_at + N days`

### 6.4 Payment type restrictions

PaymentPanel logic per `order_type`:
- KOMPONEN: FULL, DP, TEMPO all allowed (existing behavior)
- CUSTOM_PANEL / RAKIT_PANEL: FULL **disabled** with tooltip "Custom Panel/Rakit Panel wajib DP — biaya final ditentukan setelah pengerjaan selesai"; DP and TEMPO allowed (TEMPO if customer eligible per Pelanggan menu)

### 6.5 New: DeliveryMethodToggle

Replace current "ongkir toggle + address inferred" with explicit picker:
- 🏪 **Pickup di toko** (default for walk-in cash)
- 🚚 **Delivery** (requires address + ongkir)
- 🛒 **Marketplace courier** (auto-selected for marketplace channels)

Pickup info (alamat toko + jam buka) loaded from Pengaturan, no manual entry needed.

### 6.6 Customer required validation

If `order_type` is CUSTOM_PANEL or RAKIT_PANEL:
- Customer selection or new customer name + HP is **wajib** (form submit blocked otherwise)
- Reason: multi-day jobs need contact for progress updates

### 6.7 Rename rakit buttons

- "⚡ Tambah Jasa Rakit" → "🛠️ Tambah Rakit Panel"
- "📦 Tambah Jasa Custom Panel" → "📐 Tambah Custom Panel" (icon conflict with KOMPONEN flag resolved)

### 6.8 Post-submit routing logic (new)

Replace current 3-route logic (TEMPO → piutang; mix-WIP → wip-list; else → invoice) with the channel × type × payment matrix in §3. Each route lands the order at the correct funnel stage.

### 6.9 Remove pure-jasa bypass for CP/RP

Current: pure-jasa cart skips WIP + lock approval, invoices directly Lunas.
New: CP/RP MUST go through funnel + owner approval, regardless of cart contents.
KOMPONEN walk-in cash (the only legitimate bypass case) lands at Stage 5 directly per §3.

## 7. Cancellation Rule Simplification

| Stage | Cancel allowed? |
|---|---|
| Stage 1 (Bertanya) | ✓ Free cancel |
| Stage 2 pre-payment (2a, 2b, 2c, 2d before verify) | ✓ Free cancel |
| Stage 2e (Ditolak) | ✓ Auto-routes to Stage 6 |
| **Stage 2 post-payment verified** | **❌ Future scope** |
| **Stage 3, 4, 5** | **❌ Future scope** |

**UI impact:**
- Remove "❌ Batalkan" button from all Stage 3, 4, 5 action panels
- Replace with small banner: *"Pesanan sudah dibayar — kalau ada masalah, hubungi owner langsung untuk override"* (escape valve via manual stage override §13)
- Stage 6 only contains: pre-payment cancels + final-rejected bukti
- Backend `cancel_rakit` RPC + forfeit logic preserved (not deleted), just unused from UI

## 8. Other Menu Implications

### 8.1 Persetujuan (ApprovalInboxScreen)

- **Source of truth** for owner approvals (rakit lock + customer TEMPO eligibility + others)
- Stage 3b "🔒 Tunggu Owner Cek Biaya" in funnel = surface UI that **deep-links** to Persetujuan inbox for the detail/decision page
- Persetujuan inbox needs new columns: `order_type` badge + `estimasi vs aktual biaya` (transparency)
- **Owner can EDIT biaya values directly during approval** (not just approve/reject) — speeds up operations when owner wants to adjust admin's submitted values without bouncing back. Edit + Approve = single action commits the owner-edited values. Audit log captures before (admin submitted) + after (owner edited) values.
- Editable fields per approval card:
  - Material aktual (Rp)
  - Labor aktual (Rp)
  - Component deduction list (with edit-komponen sub-action — change SKU/qty/warehouse)
  - Owner note (audit trail)
- Approval rejection bounces order back to Stage 3a with rejection reason
- Sales funnel Stage 3b shows STATUS ONLY ("waiting for owner") + deep-link button. **No approval action UI in Sales funnel** — single source in Persetujuan menu.

### 8.2 Piutang (TEMPO menu)

- TEMPO orders functionally live in Stage 3+ funnel (already processed, awaiting collection)
- Piutang menu = filtered view: "Stage 3+ where payment_type=TEMPO and not collected"
- For CP/RP via TEMPO: invoice pelunasan accurate sent only after owner cost lock at Stage 3b. TEMPO countdown (term_days) starts from **this** invoice date, not from order entry
- Aging report logic must adjust to use invoice_pelunasan_sent_at, not transaction_created_at

### 8.3 Sales sidebar restructure

- Rename sidebar "Penjualan" → "Sales" (per parent spec)
- Sub-tabs under Sales:
  - **Catat Penjualan** (input/wizard — existing PenjualanBaruScreen)
  - **Daftar Pesanan** (funnel 6-stage monitor — new from parent spec)
  - **Pesanan Selesai** (Stage 5 archive — new)
- Keep separate sidebar menu "Kasir" if it serves another purpose (cash management?), otherwise merge into Sales

### 8.4 WipListScreen — deprecate

- Functionality absorbed into funnel Stage 3 with `?filter=type:rakit_panel,custom_panel`
- Old route `/wip-list` redirects to `/sales/funnel?stage=3&type=rakit_panel,custom_panel`
- Component file can be removed in cleanup phase

### 8.5 Sales Inbox

- Source of Stage 1 (Bertanya) — WA messages from customers not yet converted to orders
- "Convert ke Order" button in inbox opens Catat Penjualan wizard pre-filled with WA conversation context
- Handoff rule: an inquiry "promotes" to Stage 1 only when admin clicks "Add to Funnel"; otherwise stays in Sales Inbox

### 8.6 Pelanggan (CustomerDetailScreen)

- Tab "Riwayat Order" shows funnel stage badge per past order
- Tab "Eligibilitas TEMPO" shows owner-approved limit, used credit, history (existing)
- For CP/RP customers: optional photo gallery of previous panel work (future scope)

### 8.7 Pengaturan additions

- **Bank account list** — for invoice DP/Pelunasan rendering (multiple bank options)
- **WA templates** — 15-20 templates total (per stage + per type variants where text differs meaningfully). Parent spec lists 10; extend to cover CP/RP-specific events (e.g., "biaya final ready" at 3c, "panel selesai dirakit" at 3f for RP)
- **Default estimasi hari per type** — suggested defaults (e.g., RP=5, CP=10) that admin can override per order
- **Pickup info** (alamat toko + jam buka + telp) — already in Pengaturan, ensure linked into Stage 4b mark-received panel
- **No auto-cancel timeout** — explicitly removed per decision
- **No invoice number format config** — keep existing format

## 9. PDF Document Plan

Reference audit: existing `SalesInvoicePDF.tsx` covers DP + Lunas variants via browser print. Library = jsPDF + jspdf-autotable. Library reused for all new variants.

### 9.1 Documents — reuse / extend / build new

| Document | Status | Action |
|---|---|---|
| Sales Order (quotation) | ⚠️ Partial | **Add variant** `quotation` to SalesInvoicePDF — shows estimated total only, no payment status, marked "QUOTATION" |
| Invoice DP (Komponen) | ✅ Exists | Reuse — items table shows each SKU line |
| Invoice DP (CP/RP) | ⚠️ Enhance | Items table shows **SINGLE LUMP SUM LINE** (e.g., "Jasa Custom Panel 600×400×200 — Rp X"), NO component breakdown · footer note "Detail material/labor internal di Persetujuan inbox" |
| Invoice Lunas | ✅ Exists | Reuse |
| Invoice Pelunasan (regular DP) | ✅ Exists | Reuse |
| Invoice Pelunasan (CP/RP) | ⚠️ Enhance | **Lump sum item line** + payment breakdown table with: Estimasi Awal, Total Final, Selisih (Rp + %), DP sebelumnya, Pelunasan hari ini, Total Sudah Dibayar, Sisa · justifikasi selisih shown |
| Invoice Tempo | ❌ Gap | **Add variant** `tempo` to SalesInvoicePDF — shows term_days, jatuh tempo date, bank info |
| Surat Jalan | ❌ Gap | **Build new** component reusing SalesInvoicePDF layout convention. No nominal — focus: daftar barang + spec + alamat antar + TTD penerima |
| Kwitansi | N/A (dropped) | — |
| Catatan Pembatalan | ❌ Gap | **Build new** simple printable: nomor order, customer, items, alasan cancel, tanggal, TTD admin |

### 9.1a Customer-facing vs Internal cost detail

**CRITICAL CONVENTION** untuk Custom Panel & Rakit Panel:

| Where shown | Detail level |
|---|---|
| **Customer-facing PDF** (Sales Order, Invoice DP, Invoice Pelunasan) | **LUMP SUM only** — single line item with type label + spec description (mis. "Jasa Custom Panel 600×400×200 · 1 pintu · 8 slot MCB"). NO breakdown of material qty, FIFO cost, labor hours, component SKUs |
| **Internal UI** (Persetujuan inbox, HPP lock detail, accounting laporan) | **Full breakdown** — material aktual + labor aktual + FIFO snapshot per komponen + warehouse source |

**Why:**
- Customer tidak butuh tahu margin/HPP breakdown — confusing + reveals internal cost structure
- Customer cuma butuh: nominal yang harus dibayar + spec barang yang dipesan
- Internal breakdown krusial untuk: HPP lock, accounting, stock movement audit, profit analysis

**Implementation:** SalesInvoicePDF renders items differently based on `order_type`:
- `KOMPONEN` → loop through cart SKU lines
- `CUSTOM_PANEL` / `RAKIT_PANEL` → single line: jasa type + description + total final price

### 9.2 Re-download from Stage 5

Action panel button → trigger re-render PDF from transaction data on demand. No storage required (regeneration is cheap, data is in DB).

### 9.2a Bukti Pembayaran (Customer-uploaded photos)

Customer-uploaded payment proofs (via WhatsApp or manual upload) are stored in Supabase storage and displayed at the verify action panels:

- **Storage**: existing buckets — fields `dp_proof_url`, `full_proof_url`, `payment_proof_url` on `kasir_transactions` (already exist per PDF audit). Add new field `pelunasan_proof_url` for the post-DP pelunasan proof (separate from initial DP proof).
- **Upload sources** (3 paths):
  1. **WhatsApp via Calista bot (AI-driven)** — customer sends photo in WA conversation; Calista detects payment receipt context, uploads to bucket, attaches URL to transaction (auto)
  2. **Manual admin upload** — admin uploads via file picker on behalf of customer. Use cases:
     - Customer sent via SMS / email / in-person (admin received photo outside Calista flow)
     - Walk-in cash dengan struk fisik (admin foto + upload)
     - Customer WA owner langsung instead of bot
  3. **Marketplace screenshot upload** — for Tokopedia/Shopee/Lazada orders where payment is settled by the marketplace platform. Admin opens seller dashboard → screenshot order detail / settlement status → upload as `payment_proof_url`. Provides audit trail bahwa marketplace sudah confirm payment received.
- **Display at verify panels** (Stage 2d `verify`, Stage 3b `verify-pelunasan`):
  - Thumbnail preview (90×120 mock receipt style) inside action panel
  - Metadata: source ("📱 Dikirim via WhatsApp" / "📤 Upload manual"), upload time, file size
  - Click thumbnail or "🔍 Lihat ukuran penuh" link → open lightbox modal
- **Lightbox modal features**:
  - Full-size image viewer (zoom, pan)
  - Sidebar/footer with verify tips ("cek nominal & nomor rekening tujuan benar")
  - Inline action buttons: ✓ Bukti Benar · Approve / ❌ Tolak Bukti / 💾 Download
  - Multi-photo navigation (← / → arrows) if customer uploads multiple
- **Verify decision audit**:
  - Approve: store `verified_by_user_id`, `verified_at`, `verified_proof_url`
  - Reject: store rejection reason + auto-send WA message asking for re-upload
  - Rejected proofs kept (not deleted) for audit trail; new upload replaces displayed thumbnail but old URL preserved in transaction history

### 9.3 Dual print support (dotmatrix + browser)

**Current state:** only browser print (laser/inkjet) works. Dotmatrix comment in PaymentPanel = aspirational TODO.

**Plan:**
- Keep existing `SalesInvoicePDF` browser-print path as-is (default for laser/inkjet)
- Add new dotmatrix output mode generating column-mode plain text (80 char narrow / 132 char wide carriage) with ESC/POS init codes
- Single source of truth: shared data extraction function; renders to either format
- Print modal gets toggle: `[● Dotmatrix] [○ Printer Biasa]`. Default per user preference saved in Pengaturan (per workstation if needed)
- ESC/POS library: use minimal hand-rolled implementation, no npm dependency (dotmatrix protocol is simple init + raw text)

### 9.4 Effort estimate

| Item | Days |
|---|---|
| Quotation variant | 0.5 |
| Invoice Tempo variant | 0.5 |
| Invoice Pelunasan CP/RP enhancement | 0.5 |
| Surat Jalan new component | 1.0 |
| Catatan Pembatalan new component | 0.5 |
| Re-download from Stage 5 | 0.5 |
| Dotmatrix dual-print layer | 1.5 |
| **Total PDF effort** | **5.0 days** |

## 10. Concurrent Edit Strategy

Two-layer approach: optimistic locking + realtime viewer indicator.

### 10.1 Layer A: Optimistic locking (data integrity)

- Add `version int NOT NULL DEFAULT 1` column to `kasir_transactions`
- Frontend reads `version` when loading order detail
- All update RPCs require `version` parameter, check `WHERE id = $1 AND version = $2`
- On match: increment version, commit. On mismatch: return `STALE_VERSION` error
- Frontend shows toast: *"Order #abc baru di-update oleh admin lain. Refresh dulu, lalu coba lagi."* + auto-reload current view

### 10.2 Layer B: Realtime viewer badge (collision prevention)

- On open order detail: send Supabase realtime broadcast with `{order_id, user_id, user_name, opened_at}`
- Subscribe to channel `order_viewers_<order_id>` on detail page
- Show inline badge near order title if another admin is viewing: `👁️ Andi sedang lihat ini juga (since 2 min ago)`
- Heartbeat every 30s; auto-cleanup viewer after 90s no heartbeat (admin closed tab)
- No blocking — purely informational signal

### 10.3 Not pursued: pessimistic explicit lock

Considered and rejected: too heavy for MSME 2-3 person team; release logic + crash-stuck risk outweighs benefit.

## 11. Calista AI Boundary

- KOMPONEN orders via WhatsApp: Calista may capture order details autonomously (existing capability)
- **CUSTOM_PANEL / RAKIT_PANEL orders via WhatsApp**: Calista does NOT capture autonomously
  - Calista detects intent (e.g., customer mentions "minta dibuatkan panel" or "minta dirakit")
  - Auto-tags conversation: `🛠️ Need admin — service-type inquiry`
  - Sends polite reply: *"Untuk pesanan rakit/custom panel, admin kami akan langsung balas Bapak/Ibu — mohon ditunggu sebentar 🙏"*
  - Moves conversation to Sales Inbox marked urgent
- Reason: spec complexity (panel dimensions, layout, finishing IP rating) cannot be captured accurately by AI; risk of mis-spec = costly material waste

## 12. TEMPO + CP/RP Intersection

- TEMPO eligibility for any customer determined **only** in Pelanggan menu (set limit + owner approval) — same rule as KOMPONEN. No new eligibility logic for CP/RP.
- Eligible customer ordering CP/RP via TEMPO:
  - Skip Stage 2 entirely (no DP upfront)
  - Lands at Stage 3a (Sedang Dikerjakan)
  - Standard CP/RP flow: 3a → 3b (owner cost lock) → 3c (invoice TEMPO with final cost)
  - TEMPO countdown (term_days) starts from invoice TEMPO send date (NOT from order entry)
  - Stage 4 → 5 as normal
- Stage 3c for TEMPO sends invoice tempo (not invoice pelunasan), with biaya final embedded + jatuh tempo date

## 13. Owner Manual Stage Override

Owner-only capability for emergency cases (e.g., force-cancel post-payment, force-advance stuck order, etc.).

- New button on order detail visible to owner role only: `🔧 Override Stage`
- Modal: select target stage + required note (audit reason)
- All transitions logged in audit log with `event_type = manual_override`, includes from_stage, to_stage, owner_user_id, reason
- Used as escape valve for: post-payment cancel (until forfeit logic ships), bad data, unusual customer situations

## 14. Reports & KPI Additions

New section in Laporan menu: **"Funnel & Operasional"**

| KPI | Source |
|---|---|
| Conversion rate per stage (Stage 1 → 5 %) | Stage transition timestamps |
| Average WIP duration per type (CP, RP) | `wip_started_at` → Stage 3f exit timestamp |
| Owner approval turnaround (Stage 3b dwell time) | 3b enter → 3c exit timestamp |
| Biaya estimasi vs final variance per type | `estimated_total` vs `final_total` columns |
| Overdue CP/RP orders | `estimated_completion_date < CURRENT_DATE AND funnel_stage = 3a` |
| Channel performance | Conversion by channel |
| Cancellation rate per stage (Stage 1-2 only in MVP) | Stage 6 entries by from_stage |

## 15. Audit Log Expansion

Existing `kasir_audit_logs` table extended with event types:

- `stage_transition` (from_stage, to_stage, by_user_id, reason_text)
- `owner_approval_decision` (approve/reject, estimate_total, submitted_total, locked_total, override_notes)
- `payment_verification` (DP/pelunasan, bukti_url, decision, by_user_id)
- `cancellation` (Stage 1-2 only in MVP, reason_code, reason_text)
- `manual_override` (from_stage, to_stage, by_owner_user_id, reason_text)

Schema review needed to ensure adequate columns exist; add if missing.

## 16. Database Schema Changes

New columns on `kasir_transactions`:

| Column | Type | Notes |
|---|---|---|
| `order_type` | enum('KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL') NOT NULL | Type flag |
| `funnel_stage` | smallint NOT NULL DEFAULT 1 | 1-6 main stage |
| `funnel_sub_stage` | text NOT NULL | e.g., '2a', '3b', '4d' |
| `estimated_completion_days` | int NULL | Manual input, NULL for KOMPONEN |
| `estimated_completion_date` | date NULL | Computed `wip_started_at::date + estimated_completion_days` |
| `wip_started_at` | timestamptz NULL | When entered Stage 3a |
| `delivery_method` | enum('PICKUP', 'DELIVERY', 'MARKETPLACE_COURIER') NOT NULL | Replace inferred logic |
| `version` | int NOT NULL DEFAULT 1 | Optimistic locking |

Existing enum `kasir_transactions.status` retained for backward compat but funnel_stage becomes the new source of truth. Migration: backfill funnel_stage from status enum on deploy (no real tenant data — safe).

## 17. Migration Plan

**Status: low risk** — no real tenant data exists yet.

- Run migration that adds new columns + backfills `funnel_stage` from existing `status` enum
- Mapping table for backfill:
  | Old status | New funnel_stage / sub_stage |
  |---|---|
  | WIP | 3a |
  | PENDING_LOCK_APPROVAL | 3b |
  | AWAITING_LUNAS | 3d (if DP exists) / 2c (if no DP yet) |
  | LUNAS / PAID / COMPLETED | 5 |
  | CANCELLED | 6 |
- No coordination with tenant required (no production tenant)
- Old `status` enum kept for one cycle as fallback; deprecated in subsequent release

## 18. Acceptance Criteria

1. Admin can create KOMPONEN, CUSTOM_PANEL, or RAKIT_PANEL order from Catat Penjualan with correct type-specific validation
2. Order lands at correct funnel stage per channel × type × payment matrix (§3) immediately after submit
3. CP/RP orders show day-N-of-est counter at Stage 3a; overdue indicator appears when overdue
4. Admin can submit cost lock at Stage 3a → owner sees in Persetujuan inbox → approve/reject works end-to-end with stock deduction + HPP lock
5. Invoice Pelunasan for CP/RP shows estimasi vs aktual breakdown + justifikasi text
6. Surat Jalan PDF generates with items + spec + alamat + TTD field
7. Catatan Pembatalan PDF generates for Stage 6 archives
8. Cancel button absent from Stage 3, 4, 5 action panels
9. TEMPO + CP/RP works end-to-end with TEMPO countdown starting from invoice send
10. Concurrent edit: optimistic locking rejects stale writes with clear toast; realtime viewer badge appears on shared order
11. Calista does NOT auto-capture CP/RP orders; auto-tags to admin Sales Inbox
12. Owner manual stage override logged in audit log with reason
13. New Reports KPIs query correctly
14. Dotmatrix and browser print both work from the same data source

## 19. Open Questions

None at this time. All clarifications resolved during brainstorming session.

## 20. Effort Summary

| Workstream | Days |
|---|---|
| OrderTypeSelector + cart conditional logic | 2 |
| Estimasi hari field + payment restriction | 1 |
| DeliveryMethodToggle + ongkir validation | 1 |
| Post-submit routing matrix in kasirService | 2 |
| Funnel Stage 3 new sub-stages UI | 3 |
| Owner approval deep-link from 3b to Persetujuan | 1 |
| Stage 3a day-N counter + overdue indicator | 1 |
| Cancel button removal + banner text | 0.5 |
| Concurrent edit (optimistic + realtime) | 2 |
| WipListScreen deprecation + redirect | 0.5 |
| Sidebar Sales restructure (sub-tabs) | 1 |
| Pengaturan additions (bank list, WA templates) | 2 |
| Calista AI prompt update | 1 |
| Owner manual stage override | 1 |
| Reports/KPI new section | 3 |
| Audit log schema extension + logging | 1 |
| PDF gap (all variants + Surat Jalan + dual print) | 5 |
| Migration scripts | 1 |
| Testing + bug fixes | 3 |
| **Total** | **~31 days solo dev (~6 weeks)** |

Comparable to Phase 1 of parent spec; can be implemented as Phase 2 extension OR woven into Phase 1B/1C of parent plan.
