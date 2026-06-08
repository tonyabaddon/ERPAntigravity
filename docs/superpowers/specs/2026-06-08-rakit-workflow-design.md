# Sub-project B — Rakit Workflow Design

**Date:** 2026-06-08
**Sub-project:** B (Tier 1 — service-type transaction lifecycle)
**Status:** Design — pending approval
**Predecessor:** Sub-project A (Sales Recording overhaul) — schema + UI foundation
**Related:** Stock Fraud Prevention Phase 2 (approval infra — B is first-mover, Phase 2 will unify)

---

## Overview

Toko material jual 3 jenis transaksi yang sifat-nya beda:

1. **Beli komponen aja** — pelanggan ambil barang, bayar, transaksi selesai. *Handled by sub-project A.*
2. **Jasa Rakit** (electrical wiring assembly) — pelanggan order box wiring lengkap, toko rakit selama beberapa hari, pelanggan ambil saat selesai.
3. **Jasa Custom Panel** — sama seperti wiring, tapi untuk panel listrik custom.

Untuk #2 dan #3, transaksi punya **lifecycle multi-day** yang sub-project A tidak handle:

- Customer butuh komit dengan **DP** di muka (toko mulai invest waktu + komponen)
- **Harga rakit** bisa berubah selama proses (scope adjustment)
- **Komponen yang dipakai = rahasia bisnis** (BOM = competitive moat); customer-facing invoice cuma lump-sum
- Owner butuh **kontrol akhir** sebelum rakit di-finalize (approval gate untuk decrement stok + set HPP final)

Sub-project B menambah lifecycle `WIP → PENDING_LOCK_APPROVAL → AWAITING_LUNAS/PAID → COMPLETED` untuk transaksi jasa-type, owner approval gate, dan flexible HPP tracking (detail mode dengan komponen list, atau lump-sum mode dengan single HPP number).

---

## Scope

### In scope

- Tambah flag `service_type` di line-level (komponen / jasa_rakit / jasa_custom_panel) — **implicit transaction type, derived from cart contents**
- **2 tombol baru** di kasir UI: `+ Tambah Jasa Rakit` dan `+ Tambah Jasa Custom Panel`
- **Multi-rakit per order** — 1 transaksi bisa punya N rakit lines + mixed dengan komponen lines
- Lifecycle states untuk service-type transactions: `WIP`, `PENDING_LOCK_APPROVAL`, `AWAITING_LUNAS`, `PAID`, `COMPLETED`, `CANCELLED`
- **Lock Submission Modal** dengan mode toggle: Detail (komponen list + FIFO HPP) atau Lump-sum (manual HPP only)
- **Owner Approval Inbox** screen + Review Modal — owner-only access
- **Approve action** fires Stock Adjustment (detail mode) atau no adjustment (lump-sum mode)
- **Reject action** dengan reason → status revert to WIP
- **Cancel flow** with owner-decided refund + forfeit + reason — WIP-only
- **Edit policy** dengan tier (cosmetic vs material) dan automatic re-approval saat material edit di AWAITING_LUNAS
- Customer-facing invoice **ALWAYS lump-sum** — komponen NEVER shown (uses existing A's `SalesInvoicePDF`)

### Out of scope

- Post-lock cancel (after status PAID/COMPLETED) — manual owner reversal as edge case
- WhatsApp / push notifications untuk pending approvals (badge count only)
- BOM templates / reusable rakit templates — tiap rakit input from scratch
- Mobile-optimized approval UI — desktop-first (mobile audit di sub-project I)
- Phase 2 stock-fraud approval infra unification — Phase 2 nanti reuse pattern dari B
- Multi-currency, multi-tax (existing A's model carries over)

### Dependencies

- **Sub-project A (Sales Recording overhaul)** — schema + UI foundation. Currently in QA round 1 (worktree `sales-recording-overhaul`). B's schema is **additive** on top of A's; A's plan does NOT need modification.
- **Stock Fraud Prevention Phase 1** — immutable stock movements ledger (in progress on `main`). B's Stock Adjustment writes via this ledger.
- **Stock Fraud Prevention Phase 2** (Adjustment + Opname + Approval Infra) — NOT yet started. B builds light approval infra first; Phase 2 nanti generalize untuk Stock Adjustment + Opname.

---

## Architecture

### Data flow at a glance

```
[Kasir creates rakit transaction]
       │
       ▼
[Cart: komponen + rakit lines]      ← B addition: rakit lines + 2 buttons
       │
       ▼
[Save → invoice DP otomatis cetak]
       │
       ▼
   ┌───status: WIP (jika ada rakit line)
   │
   │   admin edit / kasir edit (full)
   │   ↓
   │   admin submit lock
   │   ↓
   │
   ▼
[PENDING_LOCK_APPROVAL]              ← B addition: approval queue
       │
       │   admin can withdraw → WIP
       │   owner approve / reject
       │
   approve ─→ [Stock Adjustment fires (detail mode)]
       │      [Status → AWAITING_LUNAS or PAID]
       │
   reject ──→ [WIP with rejected_reason]
       │
       ▼
[AWAITING_LUNAS]                     ← editable: cosmetic direct,
       │                                material → revert to PENDING
       │   customer pickup + lunas
       ▼
[COMPLETED] ←── terminal, locked
```

### UI surfaces

| Screen | Existing (from A) | Added by B |
|---|---|---|
| `PenjualanBaruScreen` | Channel selector, Tokpoed/WhatsApp strips, item search, cart, customer search + lock, payment method (Cash/Transfer/EDC + sub-type), DP nominal/persen, ongkir toggle, delivery address, notes, totals, save+print | `+ Tambah Jasa Rakit` button (orange), `+ Tambah Jasa Custom Panel` button (sky-blue), inline form (deskripsi + estimasi), cart line type chip + accent, WIP warning banner |
| WIP List screen | (none — kasir transactions list di A) | **New** screen — list transactions with status `WIP`, with action buttons "Selesaikan Rakit" + "Cancel Job" |
| Lock Submission Modal | (none) | **New** modal — per-rakit-line: mode toggle (Detail / Lump-sum), final price input, komponen list with FIFO auto (detail mode), lump-sum HPP input (lump-sum mode), labor cost, margin preview, submit |
| Approval Inbox screen | (none) | **New** screen — sidebar nav item with badge count, filter tabs (Rakit Lock / Stock Adj / Opname), list pending |
| Review Modal | (none) | **New** modal — per-rakit-line review: estimated→final delta, komponen breakdown (detail) or lump-sum HPP (lump-sum), HPP override field, margin preview, approve / reject buttons |
| Reject Modal | (none) | **New** small modal — reason textarea, confirm reject |
| Cancel Modal | (none) | **New** modal — refund nominal, forfeit auto, reason textarea, confirm cancel |
| Edit affordance in AWAITING_LUNAS | (none) | **New** — "Edit" button on transaction detail, opens cart-like modal with edit fields. Material edits revert to PENDING_LOCK_APPROVAL. |

---

## State machine

### States (service-type transactions only)

For komponen-only transactions, sub-project A's state machine applies unchanged (`PAID` or `AWAITING_LUNAS → COMPLETED`).

| State | Description | Terminal? |
|---|---|---|
| `WIP` | Saved as draft / DP paid / awaiting rakit completion. Fully editable. | No |
| `PENDING_LOCK_APPROVAL` | Admin submitted lock, owner review pending. Not editable directly (admin can withdraw). | No |
| `AWAITING_LUNAS` | Approved, DP paid + sisa belum lunas. Editable with tier policy. | No |
| `PAID` | Approved + full payment at lock time (no DP). | Yes |
| `COMPLETED` | After pelunasan from AWAITING_LUNAS. | Yes |
| `CANCELLED` | Cancelled during WIP. | Yes |

### Transitions

```
[create with rakit line(s)]    → WIP
[create komponen-only]          → PAID or AWAITING_LUNAS (existing A flow)

WIP ──(admin submit lock)──→        PENDING_LOCK_APPROVAL
WIP ──(admin/owner cancel)──→       CANCELLED
WIP ──(continuous edit)              stays WIP

PENDING_LOCK_APPROVAL ──(admin withdraw)──→   WIP
PENDING_LOCK_APPROVAL ──(owner approve, sisa>0)──→  AWAITING_LUNAS
                                                    + Stock Adjustment fires (detail mode)
PENDING_LOCK_APPROVAL ──(owner approve, sisa=0)──→  PAID (terminal)
                                                    + Stock Adjustment fires (detail mode)
PENDING_LOCK_APPROVAL ──(owner reject + reason)──→  WIP

AWAITING_LUNAS ──(cosmetic edit)──→           AWAITING_LUNAS (audit logged)
AWAITING_LUNAS ──(material edit)──→           PENDING_LOCK_APPROVAL (re-approval)
                                              + old Stock Adjustment reversed
AWAITING_LUNAS ──(pelunasan)──→               COMPLETED (terminal)

PAID / COMPLETED / CANCELLED  =  terminal, locked, no transitions
```

### Edit tier policy (in AWAITING_LUNAS only)

**Cosmetic edits** (direct save, audit logged, no re-approval):
- `description` of rakit lines
- `notes`
- `delivery_address`
- `harga_rakit_final` (without changing components/HPP)

**Material edits** (auto-revert to PENDING_LOCK_APPROVAL):
- Komponen list change (add/remove/qty)
- Tracking mode change (Detail ↔ Lump-sum)
- `lumpSumHpp` value change (in lump-sum mode)
- `laborCost` change (in detail mode)

System behavior on material edit:
1. Reverse old Stock Adjustment (if any exists from prior approval)
2. Status → `PENDING_LOCK_APPROVAL`
3. Owner notified, can re-review
4. On re-approve → new Stock Adjustment fires (detail mode) or no adjustment (lump-sum)

---

## Data model

### Schema changes — extend `kasir_transactions` (additive)

Sub-project A defines `kasir_transactions` columns. B adds these columns via separate migration `2026-06-08_001_rakit_workflow.sql`:

```sql
ALTER TABLE kasir_transactions
  ADD COLUMN service_summary           TEXT,           -- Cached: 'komponen' | 'jasa_rakit' | 'jasa_custom_panel' | 'mixed'
                                                      -- derived from rakit_job_lines existence + types
  ADD COLUMN lock_submitted_by         UUID REFERENCES users(id),
  ADD COLUMN lock_submitted_at         TIMESTAMPTZ,
  ADD COLUMN lock_approved_by          UUID REFERENCES users(id),
  ADD COLUMN lock_approved_at          TIMESTAMPTZ,
  ADD COLUMN lock_rejected_reason      TEXT,
  ADD COLUMN cancel_refund_amount      NUMERIC(15,2),
  ADD COLUMN cancel_forfeit_amount     NUMERIC(15,2),
  ADD COLUMN cancel_reason             TEXT,
  ADD COLUMN cancelled_by              UUID REFERENCES users(id),
  ADD COLUMN cancelled_at              TIMESTAMPTZ;

-- Extend status enum
ALTER TABLE kasir_transactions DROP CONSTRAINT chk_kasir_status;
ALTER TABLE kasir_transactions ADD CONSTRAINT chk_kasir_status
  CHECK (status IN ('PAID','AWAITING_LUNAS','COMPLETED','CANCELLED',
                    'WIP','PENDING_LOCK_APPROVAL'));

-- Consistency: WIP / PENDING_LOCK_APPROVAL must have at least one rakit line
-- Enforced via application logic + trigger (since referential check on child table)
```

### New table: `rakit_job_lines`

```sql
CREATE TABLE rakit_job_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES kasir_transactions(id) ON DELETE CASCADE,
  line_number           INT NOT NULL,                     -- 1-based order within transaction
  service_type          TEXT NOT NULL,                    -- 'jasa_rakit' | 'jasa_custom_panel'
  description           TEXT NOT NULL,                    -- displayed on customer invoice as lump-sum line
  estimated_price       NUMERIC(15,2) NOT NULL,           -- quote at creation
  final_price           NUMERIC(15,2),                    -- set during lock; defaults to estimated
  tracking_mode         TEXT NOT NULL DEFAULT 'detail',  -- 'detail' | 'lumpsum'
  labor_cost            NUMERIC(15,2) DEFAULT 0,         -- detail mode: manual labor add-on
  lump_sum_hpp          NUMERIC(15,2) DEFAULT 0,         -- lumpsum mode: single HPP value
  hpp_owner_override    NUMERIC(15,2),                   -- nullable; if set, used as HPP final
  hpp_final             NUMERIC(15,2),                   -- computed at approve time, frozen after
  stock_adjustment_id   UUID REFERENCES stock_adjustments(id),  -- nullable; only detail mode
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rakit_service_type     CHECK (service_type IN ('jasa_rakit', 'jasa_custom_panel')),
  CONSTRAINT chk_rakit_tracking_mode    CHECK (tracking_mode IN ('detail', 'lumpsum')),
  CONSTRAINT chk_rakit_prices_positive  CHECK (estimated_price > 0 AND (final_price IS NULL OR final_price > 0)),
  CONSTRAINT chk_rakit_lump_or_labor    CHECK (
    (tracking_mode = 'detail' AND lump_sum_hpp = 0) OR
    (tracking_mode = 'lumpsum' AND labor_cost = 0)
  ),
  UNIQUE (transaction_id, line_number)
);

CREATE INDEX idx_rakit_lines_transaction ON rakit_job_lines(transaction_id);
CREATE INDEX idx_rakit_lines_type ON rakit_job_lines(service_type);
```

### New table: `rakit_components`

For detail-mode tracking — komponen yang dipakai per rakit line. Used to drive Stock Adjustment.

```sql
CREATE TABLE rakit_components (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rakit_line_id         UUID NOT NULL REFERENCES rakit_job_lines(id) ON DELETE CASCADE,
  sku                   TEXT NOT NULL,
  name                  TEXT NOT NULL,                   -- snapshot at lock time
  qty                   NUMERIC(15,3) NOT NULL,
  warehouse             TEXT NOT NULL DEFAULT 'atas',   -- 'atas' | 'bawah'
  fifo_cost_snapshot    NUMERIC(15,2) NOT NULL,         -- computed FIFO cost at lock time
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rakit_comp_qty_pos     CHECK (qty > 0),
  CONSTRAINT chk_rakit_comp_warehouse   CHECK (warehouse IN ('atas', 'bawah'))
);

CREATE INDEX idx_rakit_components_line ON rakit_components(rakit_line_id);
CREATE INDEX idx_rakit_components_sku ON rakit_components(sku);
```

### New table: `rakit_audit_log` (for edit tracking)

```sql
CREATE TABLE rakit_audit_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        UUID NOT NULL REFERENCES kasir_transactions(id),
  rakit_line_id         UUID REFERENCES rakit_job_lines(id),
  action                TEXT NOT NULL,                    -- 'create' | 'edit_cosmetic' | 'edit_material' | 'submit' | 'withdraw' | 'approve' | 'reject' | 'cancel' | 'pelunasan'
  field_changed         TEXT,                             -- 'description' | 'final_price' | 'components' | ...
  old_value             JSONB,
  new_value             JSONB,
  reason                TEXT,
  actor_id              UUID NOT NULL REFERENCES users(id),
  actor_role            TEXT NOT NULL,                    -- 'kasir' | 'admin' | 'owner'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rakit_audit_transaction ON rakit_audit_log(transaction_id);
CREATE INDEX idx_rakit_audit_created ON rakit_audit_log(created_at DESC);
```

### Forfeit revenue tracking

Cancelled rakit transactions with non-zero forfeit_amount feed into a separate revenue stream untuk laporan owner. Add view:

```sql
CREATE OR REPLACE VIEW kasir_rakit_forfeit_summary AS
SELECT
  date_trunc('month', cancelled_at) AS month,
  SUM(cancel_forfeit_amount) AS total_forfeit,
  COUNT(*) AS cancel_count
FROM kasir_transactions
WHERE status = 'CANCELLED'
  AND cancel_forfeit_amount > 0
GROUP BY date_trunc('month', cancelled_at);
```

---

## UI changes

### `PenjualanBaruScreen` extensions

Everything from sub-project A preserved. Additions:

**Left panel (below ItemSearchPanel):**

New panel "Tambah Jasa" with 2 side-by-side buttons:
- `+ Tambah Jasa Rakit` (orange — `bg-amber-500`, hover `bg-amber-600`)
- `+ Tambah Jasa Custom Panel` (sky-blue — `bg-sky-500`, hover `bg-sky-600`)

Click either → reveals **inline form** (not modal) with the type pre-set:
- Deskripsi singkat (text input) — displayed on customer invoice as lump-sum line
- Estimasi Harga Rakit (numeric input) — quote disepakati dengan customer

Submit → push rakit line ke cart. Form collapses. Cart line has:
- Type chip badge (orange for rakit, sky-blue for custom panel)
- Description
- Estimated price (right-aligned)
- ✕ Remove button

**Cart visual cues:**
- Komponen lines: existing A style (slate background)
- Rakit lines: distinct accent (orange or sky-blue border-left, subtle background gradient)
- Sub-headers: "📦 Komponen" and "🛠 Jasa Rakit" (with dotted separator)

**WIP warning banner** appears below cart when cart contains any rakit line:
> ⚠ **Transaksi ini akan masuk status WIP** karena ada jasa rakit. Lock + approval owner diperlukan sebelum stock decrement & pelunasan.

**Save button** behavior:
- Cart komponen-only: existing A behavior (green if Lunas, amber if DP)
- Cart contains rakit line: amber button, label `💾 Simpan & Cetak Invoice DP (Status: WIP)`

After save, invoice prints to dotmatrix (existing A flow). Transaction redirects to **WIP List** screen if has rakit, else stays in normal kasir flow.

### WIP List screen

Sidebar nav item: "⏳ WIP" with count badge.

Top bar: "⏳ WIP — Rakit Job in Progress"

List of all transactions with `status = 'WIP'`:
- Invoice no + state pill (WIP)
- Customer name + phone
- Created timestamp
- Total invoice (right) + DP paid (subtitle)
- Brief contents: N komponen + each rakit line (type chip + description + estimated price)
- Two actions per row: `❌ Cancel Job` (red) and `🔒 Selesaikan Rakit` (navy primary)

Empty state: "Belum ada transaksi WIP. Buat transaksi baru dengan jasa rakit di tab Catat Penjualan."

### Lock Submission Modal

**Header:**
- Title: `🔒 Selesaikan Rakit & Submit untuk Approval`
- Subtitle: invoice no + customer name

**Body — per rakit line:**

Section per line, amber-tinted card:

1. **Line header**: type chip + description + line counter (e.g., "Line 1 dari 2")

2. **Price block** (2 cols):
   - Estimasi awal (read-only)
   - Harga Rakit Final * (editable input) — shows delta if changed

3. **Mode toggle** (segmented control):
   - 📋 **Detail** (komponen + FIFO auto) — recommended
   - 💰 **Lump-sum HPP** (manual)

   Helper text changes per mode:
   - Detail: "✓ Audit trail komplit. Stock decrement otomatis per komponen via Stock Adjustment saat approve."
   - Lump-sum: "⚠ Stok tidak otomatis decrement. Owner input HPP manual. Drift accepted untuk transaksi ini."

4a. **Detail mode** content:
   - "+ Tambah Komponen" details/summary — opens dropdown with catalog search
   - List komponen yang sudah ditambah: SKU + qty stepper + FIFO cost + ✕ remove
   - HPP block:
     - HPP komponen (FIFO sum)
     - + Labor & overhead (manual numeric input)
     - HPP Total (computed)
     - Margin estimasi (color-coded: red <0, amber <10%, green ≥10%)

4b. **Lump-sum mode** content:
   - HPP Total (single numeric input)
   - Helper text: "ℹ Single number — total cost komponen + labor + overhead."
   - Margin computation (harga rakit − HPP total)

**Footer:**
- Info text: "Submit → status: PENDING_LOCK_APPROVAL. Stock decrement belum terjadi sampai owner approve."
- `Batal` ghost button
- `📤 Submit untuk Approval Owner` navy primary button

**Validation:**
- Final price > 0 wajib
- Detail mode: minimal 1 komponen wajib
- Lump-sum mode: HPP total > 0 wajib
- Labor cost ≥ 0 (detail mode)

### Approval Inbox

Sidebar nav item: "✅ Approval" with count badge (number of pending across all categories).

Top bar: "✅ Approval Inbox · Owner-only · review & approve pending locks"

If user is NOT owner: amber banner "⚠ Halaman ini cuma bisa diakses oleh Owner..."

**Filter tabs** (segmented control):
- Semua (count)
- Rakit Lock (count)
- Stock Adj (count — placeholder, populated by Phase 2)
- Opname (count — placeholder, populated by Phase 2)

Sortir: "Terlama dulu" (default) / "Tertinggi value"

**List per pending item:**
- Type chip (Rakit / Panel)
- Invoice no + state pill
- Customer + first rakit line description
- Submitted by + submission timestamp + komponen count
- Right: harga rakit final + margin preview (red if <10%, green otherwise)
- Click anywhere → opens Review Modal

### Review Modal (owner action)

**Header:**
- Title: `✅ Review & Approve — Rakit Lock`
- Subtitle: invoice no + customer

**Summary header** (3 cards):
- Submitted by + when
- Total invoice + DP/sisa breakdown
- Margin preview (color-coded card — green or red)

**Body — per rakit line:**

Amber-tinted card per line:

1. Type chip + description + tracking mode chip (📋 Detail or 💰 Lump-sum)

2. Price block: estimasi vs final with delta

3. **Komponen breakdown** (detail mode only):
   - Expandable `<details>` (open by default)
   - List with name, qty, FIFO cost
   - Total FIFO komponen subtotal

3'. **Lump-sum notice** (lump-sum mode only):
   - Amber-tinted info: "⚠ Mode lump-sum dipilih admin. Tidak ada komponen breakdown. Stock tidak otomatis decrement saat approve — drift accepted untuk transaksi ini."

4. **HPP block**:
   - Detail mode: HPP komponen + labor (read-only) + Total
   - Lump-sum mode: HPP lump-sum (read-only)
   - Owner override input — owner can change HPP final
   - Margin final (auto-recomputed when override changes)

**Footer:**
- Info: "Approve → Stock Adjustment otomatis dibuat (detail mode), status → AWAITING_LUNAS (atau PAID kalau sisa=0)"
- `❌ Reject (input alasan)` danger button
- `✅ Approve & Decrement Stock` primary button

### Reject Modal

Small modal triggered from Review Modal "Reject" button.

- Header: "❌ Reject Lock — Alasan"
- Single field: textarea wajib for reason
- Info: "Status akan kembali ke WIP. Admin akan dapat notifikasi untuk fix & resubmit."
- `← Kembali ke Review` ghost button
- `Confirm Reject` danger button

### Cancel Modal

Triggered from WIP List "Cancel Job" button.

- Header: "❌ Cancel Rakit Job"
- DP info card: DP awal diterima + current status
- Refund split:
  - 💰 Refund ke customer (numeric input, max = DP)
  - 🔒 Forfeit (auto-computed = DP − refund, read-only)
- Reason textarea (wajib)
- Info: "Confirm → status: CANCELLED. Forfeit Rp X masuk laporan 'Pendapatan Forfeit Rakit'"
- `Jangan cancel` ghost button
- `❌ Confirm Cancel` danger button

### Edit affordance in AWAITING_LUNAS

Transaction detail view (kasir history / transaction detail screen) shows an "Edit" button when status = AWAITING_LUNAS AND transaction has rakit lines.

Click "Edit" → opens **Edit Modal** (similar layout to Lock Submission Modal but pre-filled with existing values):
- Banner at top:
  > ⚠ Stok sudah decrement berdasarkan komponen yang lalu. Edit komponen / mode / HPP akan revert ke pending re-approval.

- Editable fields:
  - Description (cosmetic)
  - Final price (cosmetic if no component change; material if changed alone)
  - Labor cost (material — detail mode)
  - Lump-sum HPP (material — lump-sum mode)
  - Komponen list (material)
  - Mode toggle (material)

- Footer behavior:
  - If only cosmetic edits made: `💾 Save Changes` button → status stays AWAITING_LUNAS, audit log entry created
  - If any material edit made: button label changes to `📤 Save & Re-Submit for Approval` (amber) → old Stock Adjustment reversed, status → PENDING_LOCK_APPROVAL, audit log entry

### PENDING_LOCK_APPROVAL withdraw button

In transaction detail view, when status = PENDING_LOCK_APPROVAL AND viewer is the submitter (or any admin), show:
- Banner: "🔵 Pending owner approval. Submitted X ago."
- Button: `⬅ Withdraw Submission` (ghost) — clicking returns status to WIP for further edits.

---

## Stock Adjustment integration

### Detail mode — automatic Stock Adjustment

When owner approves a rakit line in **detail mode**, system creates one `stock_adjustments` row per rakit line with:

```
adjustment_type: 'rakit_usage'
reason: 'Pemakaian Rakit (auto)'
reference_type: 'rakit_job_line'
reference_id: <rakit_line.id>
approved_by: <owner.id>
approved_at: <now>
```

Linked `stock_adjustment_lines` rows per component:

```
sku: <component.sku>
qty: -<component.qty>     -- negative = decrement
warehouse: <component.warehouse>
fifo_cost: <component.fifo_cost_snapshot>
```

The `stock_adjustments` writes via Phase 1's `stock_movements` immutable ledger (existing pattern).

### Lump-sum mode — no automatic Stock Adjustment

For lump-sum mode rakit lines, no `stock_adjustments` row created on approve. Owner accepts stock drift for that transaction. Owner can manually create a Stock Adjustment via Phase 2's standard Stock Adjustment screen (when Phase 2 ships) referencing the rakit line for audit trail — but this is voluntary.

### Material edit in AWAITING_LUNAS — reverse + recreate

When admin makes material edit in AWAITING_LUNAS:
1. System checks if `stock_adjustments.id` exists on rakit line (i.e., was detail mode previously approved)
2. If yes: creates a **reversal** Stock Adjustment with opposite signs (i.e., increment stock back). Stock movements ledger writes both reversal entries.
3. Original Stock Adjustment marked `reversed_by_id` pointing to the reversal.
4. Status revert to PENDING_LOCK_APPROVAL — owner re-reviews.
5. On re-approve: new Stock Adjustment created (per current komponen list), with reference back to the original via `replaces_id`.

---

## Invoice rendering

**Customer-facing PDF** uses A's `SalesInvoicePDF.tsx` — no changes to that component.

### Two kinds of "komponen" — clarification

This distinction is critical for invoice rendering:

| Concept | Storage | Source | On invoice? |
|---|---|---|---|
| **Komponen sale** | `kasir_transaction_items` | Customer beli komponen sebagai barang yang dibawa pulang (separate dari rakit job) | ✅ YES — customer dapat barang fisik, harus muncul di invoice |
| **Komponen rakit (internal)** | `rakit_components` | Komponen yang admin input di Lock Modal — komponen yang dipakai oleh toko untuk merakit (di dalam box wiring / panel) | ❌ NEVER — customer dapat assembled product, internal BOM = rahasia bisnis |

Example real-world scenarios:

1. **Customer order box wiring + ALSO ambil 1 roll kabel buat di rumah:**
   - Cart: `Kabel NYM 50m` (komponen sale) + `Jasa Rakit: Box Wiring untuk rumah` (rakit line)
   - Invoice: 2 lines — Kabel NYM (di-show, customer dapat fisik) + Jasa Rakit (lump-sum)
   - Internal rakit_components: MCB Schneider 1pc, Kontaktor 2pc, Kabel NYY 20m (different from take-home Kabel NYM!) — NOT on invoice

2. **Customer order box wiring saja, no take-home items:**
   - Cart: `Jasa Rakit: Box Wiring untuk PT XYZ` (rakit line only)
   - Invoice: 1 line — Jasa Rakit (lump-sum)
   - Internal rakit_components: full BOM, NOT on invoice

3. **Customer beli komponen biasa, no rakit:**
   - Cart: only `kasir_transaction_items`
   - Existing A flow — no changes from B

### Items table rendering

For rakit lines, the invoice renders a single line per rakit_job_line:

```
─────────────────────────────────────────────────
 ITEM                                       HARGA
─────────────────────────────────────────────────
 Jasa Rakit                                       
   Box Wiring untuk PT XYZ — 1 unit            
                                  Rp 4.750.000
                                                  
 Jasa Custom Panel                                
   Custom Panel Distribusi 3-fase — PLN 50kVA
                                  Rp 12.500.000
                                                  
 (komponen lines — existing A format)            
 1x MCB Schneider 3p 25A          Rp   250.000  
 ...                                              
─────────────────────────────────────────────────
            SUBTOTAL                Rp 18.500.000
            ONGKIR                  Rp    150.000
            TOTAL                   Rp 18.650.000
            DP Diterima             Rp  5.000.000
            SISA PELUNASAN          Rp 13.650.000
─────────────────────────────────────────────────
```

**Komponen detail NEVER appears on invoice**, regardless of tracking mode (Detail or Lump-sum). The internal `rakit_components` data is for internal audit + Stock Adjustment trigger only.

The two pre-existing variants from A (`dp` stamp orange / `lunas` stamp green) work as-is. Status PAID → lunas variant. Status AWAITING_LUNAS → dp variant. Status COMPLETED → lunas variant (with reference to original DP invoice).

---

## Acceptance criteria

### Functional

- [ ] Kasir bisa add komponen + rakit lines + custom panel lines dalam 1 transaksi
- [ ] 2 tombol terpisah: `+ Tambah Jasa Rakit` dan `+ Tambah Jasa Custom Panel`
- [ ] Cart line type chip visual distinct
- [ ] Save dengan rakit line → status WIP, invoice DP cetak otomatis
- [ ] WIP List screen menampilkan all WIP transactions
- [ ] Cancel di WIP membuka modal dengan refund + forfeit + reason — submit transitions ke CANCELLED
- [ ] Lock Submission Modal mode toggle berfungsi:
  - [ ] Detail mode: add komponen + FIFO auto-compute + margin preview
  - [ ] Lump-sum mode: single HPP input + margin preview
- [ ] Submit lock → status PENDING_LOCK_APPROVAL
- [ ] Owner dapat akses Approval Inbox (non-owner blocked dengan banner)
- [ ] Review Modal nampilkan mode + komponen breakdown (detail) atau lump-sum notice
- [ ] Owner approve (detail mode) → Stock Adjustment otomatis dibuat per komponen
- [ ] Owner approve (lump-sum mode) → no Stock Adjustment, status transition only
- [ ] Owner approve (sisa>0) → status AWAITING_LUNAS
- [ ] Owner approve (sisa=0) → status PAID
- [ ] Owner reject + reason → status WIP, audit logged
- [ ] Admin withdraw di PENDING_LOCK_APPROVAL → status WIP
- [ ] Edit di AWAITING_LUNAS cosmetic-only → audit logged, status stays
- [ ] Edit di AWAITING_LUNAS material → status PENDING_LOCK_APPROVAL, old Stock Adjustment reversed
- [ ] Pelunasan dari AWAITING_LUNAS → status COMPLETED (existing A "Tandai Lunas" flow)
- [ ] Customer invoice (PDF) tidak menampilkan komponen breakdown
- [ ] Multi-rakit (N lines per transaction) handled correctly: lock modal scrolls, all lines must be configured before submit

### Data integrity

- [ ] Status enum constraint enforced
- [ ] `rakit_job_lines.service_type` constraint enforced ('jasa_rakit' | 'jasa_custom_panel')
- [ ] `rakit_job_lines.tracking_mode` constraint enforced ('detail' | 'lumpsum')
- [ ] Detail mode: `lump_sum_hpp = 0`, lump-sum mode: `labor_cost = 0` (DB constraint)
- [ ] Stock Adjustment writes to `stock_movements` immutable ledger (Phase 1)
- [ ] Audit log entries created for every state transition + every edit

### UI/UX

- [ ] All existing A fields preserved (customer search lock, EDC sub-type, DP nominal/persen, ongkir, notes, delivery, channel strips)
- [ ] Mockup style tokens match A (`#012749` navy, slate-100 bg, rounded-2xl cards, `seg` toggles)
- [ ] Rakit vs Custom Panel visual differentiation (orange vs sky-blue)
- [ ] State pill colors consistent across all views

### Permissions

- [ ] Kasir role: create/edit rakit transactions (WIP), submit lock, cancel WIP. Cannot approve.
- [ ] Admin role: same as kasir + edit AWAITING_LUNAS, withdraw PENDING_LOCK_APPROVAL submissions
- [ ] Owner role: same as admin + approve / reject lock submissions, override HPP at approval time, override cancel decisions

---

## Implementation phases (suggested)

A natural sequence for implementation plan:

1. **Phase B1 — Schema + types** (~1 day)
   - Migration: extend `kasir_transactions` + new tables (`rakit_job_lines`, `rakit_components`, `rakit_audit_log`)
   - TypeScript types updated
   - Service-layer functions: `rakitService` (create/update/submit/approve/reject/cancel)

2. **Phase B2 — UI: Cart + 2 buttons + cart line rendering** (~1 day)
   - 2 buttons in PenjualanBaruScreen left panel
   - Inline form (deskripsi + estimasi)
   - Cart line visual distinct + chip badges
   - WIP warning banner
   - Save behavior creates WIP status

3. **Phase B3 — WIP List screen** (~0.5 day)
   - List with filters + cancel/lock actions

4. **Phase B4 — Lock Submission Modal** (~1.5 days)
   - Mode toggle + conditional rendering
   - Detail mode: komponen search + FIFO fetch + manage list
   - Lump-sum mode: single HPP input
   - Submit transitions to PENDING_LOCK_APPROVAL

5. **Phase B5 — Approval Inbox + Review Modal** (~1.5 days)
   - Sidebar nav with badge count
   - List with filter tabs
   - Review modal with HPP override + approve/reject
   - Approve: write Stock Adjustment (detail), state transition
   - Reject: state transition + reason

6. **Phase B6 — Cancel + Withdraw flows** (~0.5 day)
   - Cancel modal with refund + forfeit + reason
   - Withdraw button in PENDING transaction detail
   - Audit logging

7. **Phase B7 — Edit in AWAITING_LUNAS** (~1 day)
   - Edit Modal with tier detection
   - Material edit triggers Stock Adjustment reversal + status revert
   - Cosmetic edit direct save + audit

8. **Phase B8 — Forfeit revenue view + finalize** (~0.5 day)
   - DB view for forfeit summary
   - Integration testing across all flows

**Total estimate:** ~7 days. (Compared to A's ~5 days; B is bigger due to approval infra + multi-table schema.)

---

## Out of scope clarifications

- **Sub-project F dependency:** Tier-1 next item after B. F's name not yet documented; brainstorm separately.
- **Notification system:** Owner getting WA notification when there's pending approval — defer to Heartbeat extension or sub-project G's notification overhaul.
- **Re-print invoice on edit:** If admin edits AWAITING_LUNAS and total changes, customer-facing invoice should reflect new total. Reprint behavior: "Print updated invoice" button in transaction detail. Customer gets the new copy; old copy void.
- **Component picker UX:** Current design uses simple search dropdown in lock modal. A richer picker (with quick-add favorites, recent BOM templates) is defer to B v2.

---

## Open questions for review

1. **PENDING_LOCK_APPROVAL UI surface for admin:** Where does admin go to "withdraw" a pending submission? Options: (a) transaction detail page, (b) a "My Submissions" tab in Approval Inbox visible to admin, (c) banner on top of WIP List. Recommended: **(a)** transaction detail page.

2. **Multi-rakit lock submission:** All rakit lines submitted as one approval, or each line approved independently? **Recommended: all together** (single approval covers full transaction). Simpler. Multi-step partial approval defers to B v2.

3. **Permission for material edit at AWAITING_LUNAS:** Admin only, or kasir too? **Recommended: admin only** (kasir might not understand impact of triggering re-approval).

4. **Forfeit revenue accounting:** Forfeit is a kind of revenue but not from sale of goods/services. Owner reporting view should separate this. **Recommended: dedicated category "Pendapatan Forfeit Rakit" in P&L laporan** (handled via DB view, no extra table).

---

**End of design spec.**
