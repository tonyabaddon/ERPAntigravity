# Piutang & Tempo (Sales Credit / Net X) — Design Spec

**Date:** 2026-06-14
**Status:** Brainstormed, awaiting user review
**Branch (suggested):** `feat/piutang-tempo`

## 1. Problem & Goals

Toko grosir Indonesia (target Vosi tenant #1 dan seterusnya) sering menjual ke customer langganan dengan model **tempo** — barang diserahkan sekarang, customer bayar 30/60 hari kemudian. Saat ini Vosi tidak punya model data untuk ini: semua sales harus full-paid (Cash, Transfer, atau DP+Balance) sebelum stock keluar. Akibatnya:

- Operator workaround dengan create order "fiktif" atau tidak masuk sistem → piutang tidak tertrack
- Tidak ada visibilitas total piutang per customer atau aging
- Admin/owner tidak diingatkan saat invoice jatuh tempo → follow-up telat → bad debt

**Goal:**

1. Customer grosir terdaftar bisa "boleh tempo" dengan term (Net 7/30/60/90) + credit_limit, di-approve owner
2. Operator buat invoice tempo dari channel apapun (WA, walk-in, kasir, grosir) — gating di level customer, bukan channel
3. Admin & owner tahu invoice yang akan / sudah jatuh tempo, via in-app sidebar badge + halaman Piutang dedicated
4. Single-action follow-up via WhatsApp (operator-triggered, backend send via whatsmeow)
5. Pelunasan reuse existing payment_proof upload + verify flow
6. Hard-block over credit_limit; owner-gated limit changes

**Non-goals (phase 1):**

- Email notification (in-app + manual WA cukup)
- Auto WA reminder (scheduler-driven push) — operator yang trigger send
- Online payment portal (Mekari Pay-style link)
- Cicilan tempo (multi-installment per invoice) — phase 2 jika ada permintaan
- Full RLS enforcement of multi-tenant isolation — owned by Layer A (see `docs/superpowers/specs/2026-06-13-multi-tenant-prerequisites-design.md` §4). This spec is **forward-compatible** with Layer A: new tables use the `tenant_id` pattern (matching `warehouses`); RPC signatures and queries are tenant-aware from day 1. Until Layer A enables `current_setting('app.current_tenant_id')`, code paths fall back to a single sentinel tenant UUID. See §16 for the readiness checklist.
- Statement of account / Join Invoice (kerjaan parallel di tim/terminal lain — lihat §13 Coordination)

## 2. Decisions Made (during brainstorming)

| # | Aspek | Keputusan |
|---|---|---|
| 1 | Tempo gating | Per-customer whitelist (`customers.allows_tempo`, `term_days`, `credit_limit`) |
| 2 | Aktivasi tempo customer | Owner approval via `approval_requests` + PIN |
| 3 | Set/ubah credit_limit | Owner approval **tiap perubahan** |
| 4 | Channel scope | Semua channel boleh tempo asal `customer.allows_tempo=true` (bukan gating per channel) |
| 5 | Invoice tempo creation | Auto `due_date = today + customer.term_days`. Over-limit → **hard block** + minta owner naikan limit |
| 6 | Payment record | Reuse existing payment_proof flow + admin verify → status `PAYMENT_VERIFIED` |
| 7 | Bad-debt write-off | Owner-only action; sets `status='INVOICE_WRITTEN_OFF'` + `write_off_reason` |
| 8 | Notif timing | Default H-3, H0, H+3, H+7, H+14 (owner-configurable) |
| 9 | Notif channel | In-app sidebar badge + halaman Piutang (passive). Plus operator-triggered WA via whatsmeow (active) |
| 10 | UI surface MVP | Halaman Piutang dedicated + sidebar badge counter + AR Aging mini-chart |
| 11 | WA send mechanism | Backend whatsmeow (existing `backend-go/internal/whatsapp/sender.go`), preview modal sebelum send, rate-limited |
| 12 | Concurrency safety | Credit-limit check + invoice creation di-wrap dalam SECURITY DEFINER RPC dengan row-level lock pada `customers` |

## 3. Existing assets being reused

- `customers` table (text PK, wa_number, name, company) — extend
- `orders` table + `order_status` enum — extend
- `approval_requests` table + `approval_request_type` enum + PIN flow — extend (2 new types)
- `wa_recipients` table (admin/owner WA numbers) — read-only consumer (untuk notifikasi internal kalau diperlukan, tidak wajib MVP)
- `backend-go/internal/whatsapp/sender.go` (whatsmeow client) — call from operator-triggered WA send
- `messages` table + `message_sender` enum (`'system'`) — reuse `'system'` for audit log; no enum change needed
- `mark_walkin_paid_with_stock` RPC pattern — mirror untuk `create_tempo_invoice` RPC
- `PendingApprovalBadge` component — pattern reused for piutang sidebar badge
- Existing payment_proof upload flow di order — zero modification

## 4. Schema changes

All migrations are append-only (existing project convention). File numbering uses date + sequence.

### 4.1 `customers` — add tempo fields

```sql
-- supabase/migrations/20260614000001_customers_tempo_fields.sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS allows_tempo  boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS term_days     int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit  numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tempo_activated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_activated_by  uuid;   -- owner user id who approved

CREATE INDEX IF NOT EXISTS idx_customers_allows_tempo
  ON public.customers(allows_tempo) WHERE allows_tempo = true;

COMMENT ON COLUMN public.customers.allows_tempo IS
  'Owner-approved tempo eligibility. Set only via approve_customer_credit_activate RPC.';
COMMENT ON COLUMN public.customers.credit_limit IS
  'Max outstanding INVOICE_TEMPO total per customer. Changes only via approve_customer_credit_limit_change RPC.';
```

**Rationale:** Direct UPDATEs from anon/admin are blocked by RPC-only mutation pattern (matches `approval_requests` defense-in-depth). Document this in column COMMENT so future contributors don't add anon UPDATE policies.

### 4.2 `orders` — add tempo lifecycle fields

```sql
-- supabase/migrations/20260614000002_orders_tempo_fields.sql

-- Extend enums (ALTER TYPE ADD VALUE cannot run in transaction block — apply standalone)
ALTER TYPE public.order_status   ADD VALUE IF NOT EXISTS 'INVOICE_TEMPO';
ALTER TYPE public.order_status   ADD VALUE IF NOT EXISTS 'INVOICE_WRITTEN_OFF';

-- payment_type currently has CHECK constraint chk_payment_type IN ('FULL', 'DP')
-- on both orders and kasir_transactions tables (added in 20260605000005, 20260607000001).
-- Plus a hardcoded validator in record_kasir_sale_rpc (20260609000001).
-- All three must be widened to accept 'TEMPO'.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS due_date           date,
  ADD COLUMN IF NOT EXISTS written_off_at     timestamptz,
  ADD COLUMN IF NOT EXISTS written_off_by     uuid,
  ADD COLUMN IF NOT EXISTS write_off_reason   text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_payment_type,
  ADD  CONSTRAINT chk_payment_type CHECK (payment_type IN ('FULL', 'DP', 'TEMPO'));

ALTER TABLE public.kasir_transactions
  DROP CONSTRAINT IF EXISTS chk_kasir_payment_type,
  ADD  CONSTRAINT chk_kasir_payment_type CHECK (payment_type IN ('FULL', 'DP', 'TEMPO'));

-- Also: REPLACE record_kasir_sale RPC to allow 'TEMPO' in its validator
-- (the existing IF p_payment_type NOT IN ('FULL','DP') THEN RAISE …).
-- See supabase/migrations/20260609000001_record_kasir_sale_rpc.sql for the function
-- body; the new migration CREATE OR REPLACE-s it with the wider IN list and routes
-- 'TEMPO' to create_tempo_invoice instead of the standard PAID/AWAITING_LUNAS branch.

CREATE INDEX IF NOT EXISTS idx_orders_tempo_open
  ON public.orders(due_date)
  WHERE payment_type = 'TEMPO' AND status = 'INVOICE_TEMPO';

COMMENT ON COLUMN public.orders.due_date IS
  'Set ONLY for payment_type=TEMPO; equals created_at::date + customer.term_days at creation time.';
```

### 4.3 `approval_requests` — extend type enum

```sql
-- supabase/migrations/20260614000003_approval_types_tempo.sql

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_activate';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_limit_change';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_deactivate';
```

Payload JSONB schemas (documented; enforced in RPC validation, not DDL):

- `customer_credit_activate`: `{ customer_id, term_days, credit_limit, requested_reason? }`
- `customer_credit_limit_change`: `{ customer_id, new_limit, reason }`
- `customer_credit_deactivate`: `{ customer_id, reason }`

### 4.4 `piutang_settings` — per-tenant config table

```sql
-- supabase/migrations/20260614000004_piutang_settings.sql

-- Per-tenant settings. Pre-Layer-A: one row with the sentinel tenant_id.
-- Layer A migration backfills sentinel → real tenant_id of Garindo, then
-- each newly provisioned tenant gets its own row at onboarding time.
CREATE TABLE IF NOT EXISTS public.piutang_settings (
  tenant_id                uuid PRIMARY KEY
                                DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  reminder_offsets         int[]       NOT NULL DEFAULT '{-3,0,3,7,14}',
  wa_send_rate_per_minute  int         NOT NULL DEFAULT 3,
  wa_template_followup     text        NOT NULL DEFAULT
    'Halo {customer_name}, mohon konfirmasi terkait invoice {invoice_no} senilai {total} yang {tempo_phrase}. Terima kasih.',
  term_days_allowed        int[]       NOT NULL DEFAULT '{7,14,30,60,90}',
  aging_buckets            int[]       NOT NULL DEFAULT '{30,60,90}',  -- bucket boundaries in days
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Seed the sentinel row for current single-tenant deployment.
INSERT INTO public.piutang_settings (tenant_id)
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.piutang_settings ENABLE ROW LEVEL SECURITY;
-- Pre-Layer-A policies: anon SELECT/UPDATE — same pattern as company_settings.
-- Post-Layer-A: policies will be tightened to filter by current_setting('app.current_tenant_id').
```

**Configurable knobs explained:**

| Knob | Purpose | Why per-tenant |
|---|---|---|
| `reminder_offsets` | Timing tiers shown in Piutang page (e.g. `[-3,0,3,7,14]` = H-3, due day, H+3, H+7, H+14) | Different industries want different aging discipline |
| `wa_send_rate_per_minute` | Max WA follow-up sends per minute | Owner-tunable based on WA throughput / risk appetite |
| `wa_template_followup` | Default body of WA follow-up message | Voice/branding per tenant |
| `term_days_allowed` | Net values selectable when activating tempo for a customer (default `[7,14,30,60,90]`) | Toko bangunan kadang pakai Net 45; garment Net 21; tenant-extensible |
| `aging_buckets` | AR Aging chart boundaries in days (default `[30,60,90]` → buckets 0-30 / 31-60 / 61-90 / >90) | Tenant tutup buku cycle berbeda |

**Why a new table (not `notification_config` or `company_settings`):**

- `notification_config` is documented as "readable by Go heartbeat poller" — semantically wrong for in-app-only display knobs
- `company_settings` is identity (name/address/phone) — different concern
- Dedicated table keeps Piutang concerns isolated; future expansion (per-customer overrides) has natural home

### 4.5 Multi-tenant column inheritance

This spec does **not** add `tenant_id` columns to `customers`, `orders`, `approval_requests`, `messages`. Those columns are owned by Layer A (`2026-06-13-multi-tenant-prerequisites-design.md` §4) which runs a project-wide retrofit across all existing tables. New rows inserted by RPCs in §5 inherit `tenant_id` from the customer / conversation row that the new row is associated with — Layer A's backfill propagates correctly.

The only new table this spec adds (`piutang_settings`) has `tenant_id` as PK from day 1 (§4.4), so no retrofit needed.

### 4.6 No other schema changes

- `wa_recipients` unchanged
- `notification_config` unchanged
- `payable_slots` unchanged (not used for tempo; reserved for DP/bank-recon flow)
- `messages` unchanged (reuse `sender='system'` for audit rows from WA send)

## 5. RPCs (server-side mutations)

All mutations go through SECURITY DEFINER RPCs. Direct UPDATEs on `customers.allows_tempo` / `credit_limit` and INSERTs on tempo `orders` from anon/authenticated are blocked.

**Tenant resolution convention (consistent across all RPCs below):** Each RPC begins with a helper `_resolve_tenant_id()` that reads `current_setting('app.current_tenant_id', true)` and falls back to the sentinel `'00000000-0000-0000-0000-000000000000'::uuid` if not set (pre-Layer-A). Every query that joins to `customers`, `orders`, `approval_requests`, or `piutang_settings` adds `AND tenant_id = _tenant_id` once Layer A has added those columns. Pre-Layer-A, the filter is a no-op (all rows share the sentinel via inheritance from associated rows). Indexes on `(tenant_id, …)` are added by Layer A migrations on existing tables; the new index on `piutang_settings` in §4.4 already uses `tenant_id` as PK.

### 5.1 `request_customer_credit_activate(customer_id, term_days, credit_limit, reason)`

- Validates: `customer_id` exists (same tenant), `term_days = ANY(piutang_settings.term_days_allowed)` for the current tenant, `credit_limit > 0`
- Inserts `approval_requests(request_type='customer_credit_activate', payload=…)`
- Returns approval_request id

### 5.2 `approve_customer_credit_activate(approval_id, owner_pin)`

- `_transition_approval(approval_id, 'approved', pin)` (existing helper from stock_adjustments pattern)
- On success: `UPDATE customers SET allows_tempo=true, term_days=…, credit_limit=…, tempo_activated_at=now(), tempo_activated_by=…`
- **Row-level lock**: `SELECT … FROM customers WHERE id = ? FOR UPDATE` before the UPDATE (defense for concurrent activation/deactivation)

### 5.3 `request_customer_credit_limit_change(customer_id, new_limit, reason)` / `approve_customer_credit_limit_change(approval_id, owner_pin)`

Same pattern as 5.1/5.2. Approval payload includes `new_limit`. On approve: locks customer row, updates `credit_limit`.

### 5.4 `request_customer_credit_deactivate(customer_id, reason)` / `approve_customer_credit_deactivate(...)`

Sets `allows_tempo=false`. Does NOT touch existing open `INVOICE_TEMPO` orders — they remain open until paid or written off. This is intentional: deactivation = "no new tempo invoices"; the customer still owes for past invoices.

### 5.5 `create_tempo_invoice(order_payload jsonb)` — **CRITICAL: atomic check + create**

This is the spec's race-safety linchpin (advisor flagged this gap explicitly).

```pseudo
BEGIN
  -- 1. Lock customer row
  SELECT id, allows_tempo, term_days, credit_limit
    INTO _customer
    FROM customers
    WHERE id = order_payload->>'customer_id'
    FOR UPDATE;

  -- 2. Validate
  IF NOT _customer.allows_tempo THEN
    RAISE EXCEPTION 'tempo_not_enabled';
  END IF;

  -- 3. Sum existing outstanding INSIDE the locked transaction
  SELECT COALESCE(SUM(total), 0)
    INTO _outstanding
    FROM orders
    WHERE customer_id = _customer.id
      AND payment_type = 'TEMPO'
      AND status = 'INVOICE_TEMPO';

  -- 4. Hard-block over-limit
  IF (_outstanding + (order_payload->>'total')::numeric) > _customer.credit_limit THEN
    RAISE EXCEPTION 'credit_limit_exceeded';  -- client maps to over-limit modal
  END IF;

  -- 5. Insert order with payment_type='TEMPO', status='INVOICE_TEMPO',
  --    due_date = CURRENT_DATE + _customer.term_days
  -- 6. Stock decrement (call existing wrap_deduct_stock_fifo per line item)
  -- 7. Commit
END
```

**Why row lock on `customers`:** without it, two concurrent invoice creations could each pass the limit check and collectively go over. `FOR UPDATE` serializes per-customer; per-customer parallelism is high enough this is not a hotspot.

### 5.6 `mark_tempo_invoice_paid(order_id, proof_url, verified_by)`

Reuse existing payment-verify path. Sets `status='PAYMENT_VERIFIED'`, `payment_verified_at=now()`, `verified_by`. No new code; just call from the Piutang page "Catat Bayar" button.

### 5.7 `request_tempo_invoice_write_off(order_id, reason)` / `approve_tempo_invoice_write_off(approval_id, owner_pin)`

Owner-only action (admin can request, owner approves with PIN). On approve: `UPDATE orders SET status='INVOICE_WRITTEN_OFF', written_off_at, written_off_by, write_off_reason`.

**Why write-off path matters:** without it, unpaid invoices linger in Piutang forever and AR Aging chart double-counts dead debt. (Advisor flagged this gap.)

### 5.8 `send_tempo_followup_wa(order_id, edited_message_text)` — backend-go endpoint, NOT a Postgres RPC

Backend-go API endpoint that:

1. Loads order + customer
2. Validates rate limit (per `piutang_settings.wa_send_rate_per_minute`)
3. Calls existing `whatsmeow` sender
4. Logs audit row in `messages` table: `conversation_id` (or NULL if no convo), `sender='system'`, `text=edited_message_text`, `created_at=now()`
5. Returns success/error

Operator clicks 💬 WA → frontend shows preview modal → operator edits → confirms → calls this endpoint.

## 6. UI surfaces (5 modifications)

### 6.1 Sidebar — new menu "Piutang" with badge

- Position: under `pelanggan`, above `pipeline` (in `operasional` category)
- Icon: `lucide-react` `Wallet` (matches Rupiah/keuangan semantics; `Receipt` reserved for Kasir menu)
- Permission key: legacy convention `piutang: boolean` in `PermissionSet` (matches `pelanggan: boolean`)
- Badge: red dot+count when `COUNT(orders WHERE payment_type='TEMPO' AND status='INVOICE_TEMPO' AND due_date < CURRENT_DATE) > 0`
- Subscribes via Supabase Realtime on orders table (debounced 2s) — same pattern as `PendingApprovalBadge`
- Cap at `9+` for >9

### 6.2 Halaman Piutang — main new screen

Layout (top to bottom):

1. **Page header** — title "Piutang" + subtitle + `[+ Catat Pembayaran]` quick-action
2. **4 KPI cards** — Total Piutang, Overdue, Due Hari Ini, H-3 (each shows nominal + count)
3. **AR Aging mini-chart** (NEW per Jurnal comparison) — horizontal bar with segments derived from `piutang_settings.aging_buckets`. Default `[30, 60, 90]` → 4 segments: 0-30 days, 31-60, 61-90, >90. Colors: green/yellow/orange/red. Click segment → filter table. Tenant can edit `aging_buckets` via Pengaturan → Piutang.
4. **Filter pills** — Semua | Overdue | Due Hari Ini | H-3 | Akan Datang + search input
5. **Invoice table** — rows colored by tier (red bg for overdue, orange for today, yellow for H-3, neutral for future)
   - Columns: Customer (name+phone), Invoice (no+source+date), Total (+Net), Jatuh Tempo (date+days delta), Status pill, Actions
   - Actions per row: `💬 WA` (opens preview modal → confirm send → calls `send_tempo_followup_wa`) and `✓ Catat Bayar` (opens existing payment_proof upload modal)
6. **Pagination** — page size 25, sorted by `due_date ASC` within tier groups

Sort priority (default): `(tier_urgency DESC, due_date ASC)` so overdue oldest is at top.

### 6.3 Customer Profile (Pelanggan screen) — "Tempo & Limit" section

State A: **Not activated** — form (Net X buttons + limit input) + `[🔐 Minta Persetujuan Owner]` button → calls `request_customer_credit_activate` → toast "Permintaan dikirim ke owner".

State B: **Pending approval** — disabled form, badge "Menunggu Persetujuan Owner (sejak X menit lalu)".

State C: **Active** — readonly term + limit + usage meter (computed: SUM open TEMPO orders / credit_limit, % bar) + 2 buttons:
- `[✏️ Ubah Limit]` → modal with new limit input + reason → `request_customer_credit_limit_change`
- `[🚫 Nonaktifkan]` → confirm modal + reason → `request_customer_credit_deactivate`

State D: **Deactivated, has open invoices** — shows "TIDAK AKTIF" badge but still shows usage meter (so admin sees outstanding to chase).

### 6.4 Penjualan Baru / Kasir — payment method picker

- If `selectedCustomer.allows_tempo`: show 4th radio option "📋 Tempo (Net X)" — purple `channel-grosir` color
- Below radio when Tempo selected: pill "Barang diserahkan sekarang, bayar paling lambat {DD MMM YYYY}"
- Show breakdown panel: current outstanding + this invoice + remaining limit + horizontal usage bar
- On submit: call `create_tempo_invoice` RPC
- On `credit_limit_exceeded` error from RPC: render hard-block modal with:
  - Plain-language explanation (total this + outstanding > limit; shortage amount)
  - 3 options listed: minta naik limit / ubah metode bayar / kurangi item
  - `[🔐 Minta Owner Naikkan Limit]` button → opens `request_customer_credit_limit_change` modal pre-filled with required new limit

### 6.5 Persetujuan (owner approval inbox) — 4 new card types

Reuse existing `Persetujuan` screen render-by-type pattern. Add card renderers for:

- `customer_credit_activate` — purple card; shows customer name, term, limit, customer history snippet (count past orders + paid-on-time rate). Approve = PIN. **Phase 1A.**
- `customer_credit_limit_change` — orange card; shows old → new limit, reason, customer history. **Phase 1A.**
- `customer_credit_deactivate` — gray card; shows customer + reason. **Phase 1A.**
- `tempo_invoice_write_off` — red card; shows invoice + customer + outstanding + reason. **Phase 1C** (since the write-off flow itself ships in 1C).

## 7. Data flow

### 7.1 Activate tempo
```
Admin edits customer profile → request RPC → approval_requests inserted
  → Owner sees in Persetujuan inbox (Realtime push)
  → Owner approves with PIN → approve RPC → customers.allows_tempo=true
  → Customer profile shows State C
```

### 7.2 Create tempo invoice
```
Operator picks customer → allows_tempo=true → Tempo radio shows
  → Operator submits → create_tempo_invoice RPC
    → row-lock customer → recheck outstanding+this <= limit → INSERT order → stock deduct
  → if exception 'credit_limit_exceeded' → frontend renders over-limit modal
  → on success → toast "Invoice tempo dibuat, jatuh tempo {date}"
```

### 7.3 Receive payment
```
Customer transfers → admin opens Piutang page → clicks ✓ Catat Bayar on row
  → modal: upload bukti + verify amount → existing payment_proof RPC
  → orders.status='PAYMENT_VERIFIED' → row disappears from Piutang
  → sidebar badge re-counts
```

### 7.4 Operator-triggered WA follow-up
```
Admin opens Piutang page → row with 💬 WA button
  → modal opens with pre-filled template (from piutang_settings.wa_template_followup)
  → admin edits text → confirm
  → frontend POST /api/wa/send-tempo-followup { order_id, text }
  → backend rate-check → whatsmeow.send() → audit row to messages
  → toast "WA terkirim"
```

### 7.5 Write off bad debt
```
After H+90 (or owner judgment) → admin opens invoice → "Tandai Tidak Tertagih" → reason
  → request RPC → approval_requests
  → owner approves → status='INVOICE_WRITTEN_OFF'
  → invoice removed from Piutang page; appears in separate "Riwayat Write-off" report (phase 2)
```

## 8. Error handling

| Error | Where caught | UX |
|---|---|---|
| `tempo_not_enabled` (allows_tempo=false) | RPC | Frontend prevents radio show; if forced via API, toast "Tempo belum aktif untuk customer ini" |
| `credit_limit_exceeded` | RPC | Modal with breakdown + 3 options (see §6.4) |
| `approval_expired` (>30min) | RPC | Toast "Permintaan sudah expired, silakan request ulang" |
| `wa_rate_limited` | Backend-go | Toast "Tunggu N detik sebelum kirim lagi" |
| `whatsmeow_disconnected` | Backend-go | Toast "WhatsApp belum terhubung, hubungi admin. Sementara, hubungi customer manual." |
| `pin_invalid` (3 wrong attempts) | RPC (existing) | Existing lockout behavior |

## 9. Permissions

Add to `PermissionSet`:

| Key | Type | Default | Who |
|---|---|---|---|
| `piutang` | legacy boolean | true | admin, owner |
| `can_request_credit_activate` | action `can_*` | true | admin, owner |
| `can_approve_credit_activate` | action `can_*` | owner only | owner |
| `can_request_limit_change` | action `can_*` | true | admin, owner |
| `can_approve_limit_change` | action `can_*` | owner only | owner |
| `can_send_tempo_wa` | action `can_*` | true | admin, owner |
| `can_request_write_off` | action `can_*` | true | admin, owner |
| `can_approve_write_off` | action `can_*` | owner only | owner |

Convention follows existing project: legacy keys = menu visibility; `can_*` = action gate.

## 10. Telemetry & audit

- Every approval request → `approval_requests` row (existing)
- Every approval decision → `decided_by`, `decided_at`, `decision_channel` on the same row (existing)
- Every WA send → audit row in `messages` (sender='system') with text + timestamp; existing `conversations` table can be searched per customer
- Every status transition on order — existing `orders.updated_at` + future audit log (out of scope here)
- AR Aging chart query: aggregated read-only, no write

## 11. Testing strategy

### 11.1 Database tests (pgTAP or via Go test calling Supabase)

- `customers` UPDATE on `allows_tempo` from anon → REJECTED (no policy)
- `request_customer_credit_activate` → insert + approve_customer_credit_activate → `allows_tempo=true`
- Concurrent `create_tempo_invoice` from two sessions for the same customer — only one passes when both would push over limit (test the row-lock works)
- Over-limit invoice creation raises `credit_limit_exceeded` exception
- Approve credit with wrong PIN → rejected
- Write-off then attempt to pay → rejected

### 11.2 Frontend integration tests (Vitest)

- Piutang page renders rows from mocked Supabase response, tier coloring correct
- Sidebar badge count matches `COUNT` query response
- Over-limit modal opens with correct shortage amount
- "Catat Bayar" button opens existing payment proof modal (re-using existing component)

### 11.3 Manual QA scenarios (write into spec; reviewer follows)

1. Owner approves tempo activation → customer profile shows State C with limit Rp 50jt
2. Create invoice Rp 30jt → success, usage 30/50 (60%)
3. Create invoice Rp 25jt → over-limit modal → click "Minta Owner Naikkan Limit" → owner approves new limit Rp 100jt → retry → success, usage 55/100
4. Wait until invoice due_date passes → Piutang page row turns red, sidebar badge appears
5. Click 💬 WA → modal opens with template → confirm → check WA delivered to customer's number → check audit row in messages
6. Admin uploads bukti pembayaran → verifies → invoice disappears from Piutang
7. Mark second invoice as write-off → owner approves → invoice gone from Piutang
8. AR Aging mini-chart segments match invoice ages

## 12. Open questions & follow-ups

1. **Realtime subscription vs polling for badge** — Supabase Realtime on `orders` table is fine but adds load. Alternative: poll every 60s when page mounted. Decide during implementation based on existing pattern in `PendingApprovalBadge`.
2. **Localization for `due_date` display** — use existing `formatDate` helper (id-ID locale)
3. **PDF export of Piutang report** — phase 2; not in MVP
4. **Per-customer reminder toggle** — Jurnal has this; YAGNI for MVP (small tenant base, all relevant)

## 13. Coordination with parallel work

> **⚠️ Important: There is parallel work on a Join Invoice feature in another terminal/branch. Coordinate before merge.**

Open questions to ask the parallel team **before implementation starts**:

- Does Join Invoice plan a new menu (e.g. "Tagihan Gabungan") or extend halaman Piutang?
- Does it touch `customers.allows_tempo` / `orders.payment_type='TEMPO'` schemas?
- Does it introduce a new `orders` status (e.g. `INVOICE_JOINED`)?
- Does it touch the WA send mechanism (whatsmeow integration)?

Risk areas if both ship simultaneously without coordination:

- **Menu collision** in sidebar (two new menus, possibly redundant)
- **Schema conflict** if both ALTER `orders` payment_type / status in same migration window
- **WA spam** if both register independent send endpoints (rate limits become per-feature not per-customer)

Mitigations baked into this spec:

- Halaman Piutang uses a simple per-row table; if Join Invoice needs to inject a "Gabungkan" button, the row component is small and easily extended
- All schema migrations are dated `20260614000xxx`; parallel work should use different date prefix to avoid migration filename collision
- `send_tempo_followup_wa` endpoint must use a shared rate-limit pool that any future join-invoice WA send can also call (extract a `WaSendLimiter` helper in `backend-go/internal/whatsapp/` during Phase 1C — both features bound to the same per-customer and global limits)

**Coordination with Multi-Tenant Layer A (`2026-06-13-multi-tenant-prerequisites-design.md`):**

Layer A is the project-wide retrofit that adds `tenant_id` + composite FKs + RLS policies to every existing table. It is sequenced AFTER D-min (staging + migration dry-run discipline). This Piutang spec lands BEFORE Layer A and is designed to be forward-compatible:

- New table `piutang_settings` already uses `tenant_id` as PK (sentinel UUID for current single tenant; Layer A backfills sentinel → Garindo's real tenant_id at migration time).
- All RPCs use the `_resolve_tenant_id()` convention (§5 preamble) so they begin filtering correctly the moment Layer A enables `current_setting('app.current_tenant_id')`.
- No new RLS policies are written in this spec — Layer A writes them centrally for consistency (avoids drift). Until then, anon/authenticated policies match the existing project pattern.
- New columns on `customers` / `orders` / `approval_requests` (added in §4.1, §4.2, §4.3) ride on the host row's `tenant_id` — Layer A's per-table retrofit covers them automatically.

## 14. Phasing

**Phase 1A — Schema & customer credit (this spec):**

- Migrations §4.1, §4.3, §4.4
- RPCs §5.1-5.4
- UI §6.3 (Customer profile section) + §6.5 (Persetujuan cards 1-3)
- Tests for activation/limit-change flows

**Phase 1B — Tempo invoice creation & Piutang page:**

- Migrations §4.2
- RPCs §5.5, §5.6
- UI §6.1 (Sidebar badge), §6.2 (Piutang page), §6.4 (Penjualan/Kasir payment picker)
- Tests for race-safety, over-limit, payment flow

**Phase 1C — Reminder UX polish + write-off + WA send:**

- RPCs §5.7
- Backend-go endpoint §5.8
- UI: WA preview modal, write-off flow, AR Aging chart, `piutang_settings` page
- E2E test scenarios from §11.3

Each sub-phase is its own implementation plan + PR. Plan starting Phase 1A.

## 15. Out of scope (explicit)

- Email/SMS reminders
- Cron-scheduled push notifications
- Project-wide multi-tenant retrofit (RLS policies, tenant_id on `customers`/`orders`/`approval_requests`/`messages`, composite FKs) — owned by Layer A (`2026-06-13-multi-tenant-prerequisites-design.md`). This spec is forward-compatible (§4.5, §16) but does not perform the retrofit itself.
- Cicilan tempo (multi-installment per single tempo invoice)
- Statement of account / Join Invoice (parallel team)
- Per-customer reminder timing override (global setting only in MVP)
- AR aging "PDF print/export" — view only in MVP
- Auto-write-off after H+N — manual only

## 16. Multi-tenant readiness checklist

Below: every multi-tenant concern this spec is responsible for, and whether it's solved here or owned by Layer A.

| Concern | Status | Owner | Notes |
|---|---|---|---|
| `piutang_settings` per-tenant PK | ✅ Solved | This spec (§4.4) | `tenant_id uuid PRIMARY KEY` with sentinel default; Layer A backfills sentinel → Garindo's tenant_id |
| `term_days` validator extensible per tenant | ✅ Solved | This spec (§4.4, §5.1) | Moved from hardcoded `IN (7,14,30,60,90)` to `piutang_settings.term_days_allowed int[]` |
| AR Aging bucket boundaries per tenant | ✅ Solved | This spec (§4.4, §6.2) | `piutang_settings.aging_buckets int[]` (default `[30,60,90]`) |
| WA template per tenant | ✅ Solved | This spec (§4.4) | `piutang_settings.wa_template_followup text` |
| WA rate limit per tenant | ✅ Solved | This spec (§4.4, §5.8) | `piutang_settings.wa_send_rate_per_minute int` |
| Reminder timing per tenant | ✅ Solved | This spec (§4.4) | `piutang_settings.reminder_offsets int[]` |
| RPC tenant resolution convention | ✅ Solved | This spec (§5 preamble) | `_resolve_tenant_id()` helper; no-op pre-Layer-A; filter active post-Layer-A |
| `customers.tenant_id` column | ⏳ Deferred | Layer A | This spec's new customer columns (allows_tempo, term_days, credit_limit) ride on the row's tenant_id |
| `orders.tenant_id` column | ⏳ Deferred | Layer A | Same — new columns (due_date, write-off fields) inherit |
| `approval_requests.tenant_id` column | ⏳ Deferred | Layer A | This spec's new approval request types ride on the row's tenant_id |
| `messages.tenant_id` for WA audit rows | ⏳ Deferred | Layer A | Audit row written via `messages` table inherits tenant_id once Layer A runs |
| RLS policies tightened to filter by tenant_id | ⏳ Deferred | Layer A | This spec keeps existing anon/authenticated full-access pattern; Layer A rewrites centrally |
| Composite FK `(tenant_id, ref_id)` | ⏳ Deferred | Layer A | All cross-table FKs in this spec are single-column; Layer A widens them project-wide |
| Storage bucket per-tenant scoping (for proof uploads) | ⏳ Deferred | Layer A | Existing payment_proof bucket has its own RLS; Layer A retrofits |
| Currency per tenant | ❌ Out of scope | (No owner) | Vosi = Indonesia-only foreseeable future. Reopen if non-IDR tenant signs. |
| Locale per tenant | ❌ Out of scope | (No owner) | Same — id-ID hardcoded throughout codebase |
| UI color theme per tenant | ❌ Out of scope | (No owner) | Brand consistency > per-tenant theming for ≤50 tenants |

**Pre-launch verification (before merging this spec's implementation):**

1. `piutang_settings` sentinel row is created by migration and reachable from frontend
2. `term_days_allowed` and `aging_buckets` Pengaturan UI works (admin can save new values; cache invalidates)
3. RPCs do not regress when `current_setting('app.current_tenant_id')` is unset (must fall back to sentinel without erroring)
4. Layer A leak-test suite (when implemented) includes assertions for: `piutang_settings`, new `customers` columns, new `orders` columns, tempo invoice RPC

## Acceptance criteria (one-liner)

A toko-grosir admin can: (1) request tempo activation for a customer; (2) after owner-PIN approval, create an INVOICE_TEMPO order from any sales channel; (3) be hard-blocked when over credit_limit with a clear path to request a limit raise; (4) see all outstanding tempo invoices on a dedicated Piutang page with tier-colored urgency, sidebar badge, AR aging chart; (5) one-click WhatsApp-follow-up from the page (operator preview before send); (6) one-click record-payment using existing proof-upload flow; (7) owner can write off bad debt with PIN. All credit-limit and tempo-activation changes require owner approval. No race condition lets two concurrent invoices push a customer over limit.
