# Stock Fraud Prevention — Design Spec

**Date:** 2026-06-07
**Status:** Approved scope, ready for implementation planning
**Interactive mockup:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-mockups/index.html`

> This is a **roadmap document**. Each Phase is an independently shippable sub-spec with its own Goal · Schema · RPC · Frontend · RLS/Permissions · Acceptance Criteria · Out-of-Scope. The `writing-plans` skill will produce **one implementation plan per phase** (not one mega-plan).

---

## Problem

Garindo Jaya Panel beroperasi dengan 4 karyawan luar (semua bukan keluarga), 2 gudang fisik (Atas, Bawah), dan asumsi trust: "design harus tetap aman walaupun 1 dari 4 karyawan bermaksud curang." Saat ini sistem ERP **tidak punya kontrol fraud apa pun** untuk stok:

- `stocks.stock_atas`, `stock_bawah`, `price`, `harga_modal` dapat di-`UPDATE` langsung lewat Supabase JS (admin client di frontend) tanpa audit, tanpa approval, tanpa alasan.
- `transfer_warehouse` RPC bersifat instan satu-langkah — pengirim diam-diam bisa pindahkan 7 dari 10 unit dan curi 3, sistem percaya 10.
- Kasir bebas mengetik harga jual berapa pun di line item — jual murah, kantongi selisih dengan customer accomplice.
- Tidak ada `kasir_shifts`, jadi tidak ada hitung fisik laci di akhir hari.
- Refund/void tidak ter-tracking sebagai event terpisah.
- Penerimaan barang (`receive_purchase_order`) dijalankan satu orang, tanpa saksi, tanpa cross-check ke faktur supplier, tanpa foto.
- Tidak ada `stock_adjustments` table — kalau ada barang rusak/hilang, tidak ada workflow resmi.
- Tidak ada `stock_opname` — selisih fisik vs sistem tidak pernah ter-reconcile.
- Tidak ada audit trail per pergerakan stok ("siapa adjust apa kapan kenapa").

Untuk MSME 4-orang, ini risiko material: opportunistic fraud bisa terjadi setiap hari tanpa terdeteksi sampai opname tahunan (kalau ada).

## Solution Overview

Empat phase yang dapat di-deliver berurutan namun masing-masing independent shippable:

| Phase | Scope | Value | Depends on |
|---|---|---|---|
| **1** | Immutable `stock_movements` ledger; semua RPC stok-existing dibungkus untuk menulis row ledger | Fondasi forensik; tutup pintu "diam-diam UPDATE" | — |
| **2** | `stock_adjustments` + `stock_opname` + `approval_requests` (WA button + Owner PIN) + `price_change_requests` + RLS column REVOKE untuk `price`/`harga_modal`/`stock_atas`/`stock_bawah` | Semua perubahan harga & stok di luar transaksi normal wajib approval Owner; opname 2-orang | Phase 1 |
| **3a** | Penerimaan PO: saksi wajib (≠ penerima), 3-way match (PO vs fisik vs faktur supplier), foto pengiriman | Tutup fraud penerimaan ("terima 90, catat 100") | Phase 1, 2 |
| **3b** | Kasir: `kasir_shifts` open/close + line price locked + override approval + refund approval + price-floor backstop | Tutup fraud kasir (override harga, void/refund liar, selisih laci) | Phase 1, 2 |
| **3d** | Transfer 2-langkah: `transfer_initiate` debit pengirim → `transfer_receive` credit penerima dengan foto + counted-qty; pengirim ≠ penerima | Tutup bug "transfer instan tanpa konfirmasi"; varians masuk bucket "Hilang Transit" | Phase 1, 2 |
| **4** | Pengawasan Owner: SQL views (top adjustments, diskon kasir, outflow outliers, transfer aging, heatmap aktor) + WA heartbeat report harian | Detective control — catches collusion & pola yang preventive gate tidak bisa tangkap | Phase 1-3 (reads from their tables) |

**Catatan scope:** Phase 3c (Surat Jalan / Customer Receipt QR) **eksplisit dihilangkan** dari spec ini. Semua outflow sudah tercover Kasir (Phase 3b) dan WA Orders (existing). Customer-facing transparency feature dapat di-spec terpisah kalau dibutuhkan ke depan.

## Foundational Decisions (apply across all phases)

### 1. True immutability untuk audit data
RLS `INSERT-only` saja tidak cukup karena `service_role` key (dipakai Go backend) bypass RLS. Untuk semua tabel audit (`stock_movements`, `stock_price_history`, `approval_requests`, `kasir_shifts`):

```sql
-- Belt: column-level grants
REVOKE UPDATE, DELETE ON <table> FROM PUBLIC, anon, authenticated;
-- Service-role tidak bisa di-REVOKE secara langsung untuk built-in role,
-- jadi kita pakai trigger sebagai suspenders:
CREATE OR REPLACE FUNCTION public.deny_mutation_<table>()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '<table> is append-only — corrections must be a new compensating row';
END $$;
CREATE TRIGGER trg_deny_update_<table> BEFORE UPDATE ON <table>
  FOR EACH ROW EXECUTE FUNCTION public.deny_mutation_<table>();
CREATE TRIGGER trg_deny_delete_<table> BEFORE DELETE ON <table>
  FOR EACH ROW EXECUTE FUNCTION public.deny_mutation_<table>();
```

### 2. Corrections are compensating rows, never edits
Jika Owner perlu koreksi row yang salah di `stock_movements`, sistem **tidak edit** row asli. Sistem menulis row baru dengan `source='correction'` dan `related_movement_id=<id row salah>`. Row salah tetap selamanya. Aturan ini di-enforce oleh trigger di poin 1.

### 3. Server-set timestamps everywhere
Semua tabel audit pakai `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Client-provided timestamp **tidak pernah** dipercaya untuk audit-relevant writes.

### 4. Detective + Preventive co-equal
Dengan N=4 dan kemungkinan kolusi 2-orang, gate-based preventive control bisa di-bypass. Phase 4 (anomaly dashboard + daily WA heartbeat) bukan polish-at-end, melainkan equal partner dari Phase 2. Implementasi Phase 4 dapat berjalan paralel dengan Phase 3.

### 5. Action-level permissions extend existing sidebar PermissionSet
Existing `PermissionSet` (11-key, sidebar-level) tetap tidak berubah. Spec ini menambahkan `ActionPermissionSet` (key-value JSONB di `admin_users.action_permissions`) untuk gate per-tindakan:

```ts
export interface ActionPermissionSet {
  // Phase 2
  can_request_adjustment: boolean;
  can_approve_adjustment: boolean;
  can_start_opname: boolean;
  can_witness_opname: boolean;
  can_commit_opname: boolean;
  can_request_price_change: boolean;
  can_approve_price_change: boolean;
  // Phase 3a
  can_witness_po_receipt: boolean;
  // Phase 3b
  can_open_kasir_shift: boolean;
  can_request_kasir_price_override: boolean;
  can_approve_kasir_price_override: boolean;
  can_request_kasir_void: boolean;
  can_approve_kasir_void: boolean;
  can_request_kasir_refund: boolean;
  can_approve_kasir_refund: boolean;
  can_override_price_floor: boolean;
  // Phase 3d
  can_initiate_transfer: boolean;
  can_receive_transfer: boolean;
  // Phase 4
  can_view_pengawasan: boolean;
}
```

Owner = all-true locked. Other roles get sensible defaults (lihat Phase 2 RLS section).

### 6. Hybrid Owner approval (sync + async)
Owner kadang di toko, kadang remote. Spec satu infra approval untuk dua jalur:

- **Async via WhatsApp** — Calista sender infra (sudah ada) push pesan dengan tombol [Setujui] / [Tolak]. Reply customer / button-click webhook → commit RPC.
- **Sync via Owner PIN** — Owner ketik PIN 6-digit di terminal karyawan (column `admin_users.approval_pin_hash`, bcrypt). PIN entry → commit RPC. 5 failed attempts dalam 10 menit → lock PIN 1 jam.

Kedua jalur menulis ke `approval_requests` table yang sama — satu source of truth, satu Approval Inbox UI.

### 7. No threshold — every change needs Owner approval
**Tidak ada** auto-approve threshold. Berapapun nilai adjustment, harga, kasir override, void, refund — semuanya wajib approval Owner. Owner punya bandwidth via PIN sync atau WA button async. Threshold-based auto-approve dapat di-spec terpisah kalau Owner merasa kewalahan pasca-rollout.

---

## Phase 1 — Immutable Stock Movements Ledger

### Goal
Setiap pergerakan kuantitas stok meninggalkan satu row ledger permanen. Mustahil mengubah stok tanpa meninggalkan jejak. Zero perubahan UI yang user-visible.

### Schema

**Migration: `20260607000001_stock_movements.sql`**

```sql
CREATE TYPE stock_movement_source AS ENUM (
  'purchase_receive',
  'sale_wa',
  'sale_kasir',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'opname_variance',
  'correction',
  'return_kasir',
  'seed'
);

CREATE TABLE public.stock_movements (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta           INTEGER NOT NULL,
  qty_before          INTEGER NOT NULL,
  qty_after           INTEGER NOT NULL,
  source              stock_movement_source NOT NULL,
  related_doc_type    TEXT,
  related_doc_id      TEXT,
  related_movement_id BIGINT REFERENCES public.stock_movements(id),
  reason_code         TEXT,
  reason_note         TEXT,
  actor_user_id       UUID NOT NULL,
  actor_role          TEXT NOT NULL,
  evidence_urls       TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_qty_math CHECK (qty_before + qty_delta = qty_after)
);

CREATE INDEX idx_sm_sku_created   ON public.stock_movements(sku, created_at DESC);
CREATE INDEX idx_sm_actor_created ON public.stock_movements(actor_user_id, created_at DESC);
CREATE INDEX idx_sm_source        ON public.stock_movements(source, created_at DESC);
CREATE INDEX idx_sm_related       ON public.stock_movements(related_doc_type, related_doc_id);

-- Immutability (per Foundational Decision #1)
REVOKE UPDATE, DELETE ON public.stock_movements FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.stock_movements TO authenticated;
-- INSERT happens via SECURITY DEFINER RPCs only; direct INSERT remains revoked.

CREATE OR REPLACE FUNCTION public.deny_stock_movement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only — corrections must be a new compensating row';
END $$;

CREATE TRIGGER trg_deny_sm_update BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
CREATE TRIGGER trg_deny_sm_delete BEFORE DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
```

Note: tidak ada virtual `warehouse='transit'`. Selisih kirim vs terima di Phase 3d ditangani lewat workflow eksplisit — receiver hanya credit `counted_qty`, kekurangan menggantungkan transfer di status `disputed` sampai Owner buka stock_adjustment formal (reason `'hilang'` + reference ke transfer_id). Tidak ada auto-write-off.

### RPC changes

Helper function plus wrappers for every existing RPC yang mutate `stocks.stock_atas` / `stock_bawah`. All wrappers are `SECURITY DEFINER`.

**Helper:**
```sql
CREATE OR REPLACE FUNCTION public._log_stock_movement(
  p_sku TEXT, p_warehouse TEXT, p_qty_delta INT,
  p_qty_before INT, p_source stock_movement_source,
  p_related_doc_type TEXT, p_related_doc_id TEXT,
  p_reason_code TEXT, p_reason_note TEXT,
  p_actor_user_id UUID, p_actor_role TEXT,
  p_evidence_urls TEXT[] DEFAULT '{}'
) RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.stock_movements
    (sku, warehouse, qty_delta, qty_before, qty_after, source,
     related_doc_type, related_doc_id, reason_code, reason_note,
     actor_user_id, actor_role, evidence_urls)
  VALUES
    (p_sku, p_warehouse, p_qty_delta, p_qty_before, p_qty_before + p_qty_delta,
     p_source, p_related_doc_type, p_related_doc_id, p_reason_code, p_reason_note,
     p_actor_user_id, p_actor_role, p_evidence_urls)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
```

**Wrapped RPCs (each modified to call `_log_stock_movement` inside the same transaction before/after the existing UPDATE):**
- `receive_purchase_order(po_id, p_warehouse, ...)` — log one row per line item with `source='purchase_receive'`.
- `deduct_stock_fifo(sku, qty, p_warehouse, ...)` — log with `source='sale_kasir'` or `'sale_wa'` (parameterized).
- `transfer_warehouse` — **deprecated** in Phase 3d; if called during Phase 1-only deployment window, must log a `transfer_out` + `transfer_in` row pair.
- `decrement_stock(sku, qty, p_warehouse)` — log with caller-specified source.

All four wrapped RPCs accept new params: `p_actor_user_id UUID` (`auth.uid()` default), `p_reason_note TEXT DEFAULT NULL`, `p_evidence_urls TEXT[] DEFAULT '{}'`.

### Frontend
**None.** Phase 1 is a backend-only foundation. Phase 4 reads from this table.

### RLS / Permissions
See Schema section above. Reading the ledger requires the `can_view_pengawasan` permission (added in Phase 4); during Phase 1 only the Owner role implicitly has it.

### Acceptance Criteria
1. Every existing flow (PO receive, kasir sale, WA order PAYMENT_VERIFIED → stock decrement, transfer) produces ≥ 1 `stock_movements` row.
2. `qty_before + qty_delta = qty_after` enforced by CHECK; violation aborts the wrapping RPC.
3. Direct `UPDATE` or `DELETE` on `stock_movements` raises exception **even as service_role** (verified via test that uses service-role JWT).
4. Wrapped RPCs are idempotent at the row level — same call twice creates two ledger rows (this is correct: each call is a distinct event). Idempotency keys are out of scope.
5. Performance: ledger INSERT adds ≤ 5 ms to wrapped RPC p95 latency.

### Out of Scope (Phase 1)
- UI to display ledger (Phase 4).
- Backfill of pre-Phase-1 stock history (data starts fresh from Phase 1 deploy).
- Per-stock-lot ledger (current `stock_lots` table remains the FIFO source; the ledger tracks **aggregate** `stock_atas`/`stock_bawah` movements, not lot consumption order).

---

## Phase 2 — Adjustment + Opname + Approval Infra

### Goal
Tutup loophole "diam-diam ubah stok" dan "diam-diam ubah harga". Setiap perubahan stok di luar transaksi normal (PO/Kasir/WA Order/Transfer) dan setiap perubahan `price`/`harga_modal` wajib Owner approval. Stok opname menjadi proses 2-orang dengan Owner sign-off.

### Schema

**Migration: `20260607000002_approval_requests.sql`**

```sql
-- All request types defined up-front so the enum is stable. Values
-- 'kasir_*' are unused until Phase 3b ships, but adding to the enum
-- later requires ALTER TYPE which is a separate migration; cheaper to
-- enumerate everything here.
CREATE TYPE approval_request_type AS ENUM (
  'adjustment',
  'opname',
  'price_change',
  'kasir_price_override',
  'kasir_void',
  'kasir_refund'
);

CREATE TYPE approval_status AS ENUM ('pending','approved','rejected','expired');

CREATE TABLE public.approval_requests (
  id              BIGSERIAL PRIMARY KEY,
  request_type    approval_request_type NOT NULL,
  payload         JSONB NOT NULL,
  requested_by    UUID NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  status          approval_status NOT NULL DEFAULT 'pending',
  decided_by      UUID,
  decided_at      TIMESTAMPTZ,
  decision_channel TEXT,  -- 'wa_button' | 'owner_pin' | 'app_inbox' | 'auto_expire'
  wa_message_id   TEXT
);

CREATE INDEX idx_ar_status_expires ON public.approval_requests(status, expires_at);
CREATE INDEX idx_ar_requester      ON public.approval_requests(requested_by, requested_at DESC);
CREATE INDEX idx_ar_type_status    ON public.approval_requests(request_type, status);

REVOKE UPDATE, DELETE ON public.approval_requests FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.approval_requests TO authenticated;
-- INSERT and the state machine UPDATE (pending→approved/rejected/expired)
-- happen only via SECURITY DEFINER RPCs that themselves enforce the transition.
```

**Migration: `20260607000003_stock_adjustments.sql`**

```sql
CREATE TYPE stock_adjustment_reason AS ENUM (
  'rusak', 'hilang', 'sampel', 'koreksi_input', 'korjual_admin'
);

CREATE TABLE public.stock_adjustments (
  id                   BIGSERIAL PRIMARY KEY,
  sku                  TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse            TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta            INTEGER NOT NULL CHECK (qty_delta <> 0),
  reason_code          stock_adjustment_reason NOT NULL,
  reason_note          TEXT,
  evidence_urls        TEXT[] NOT NULL DEFAULT '{}',
  requested_by         UUID NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  approval_request_id  BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status               TEXT NOT NULL DEFAULT 'pending_approval'
                       CHECK (status IN ('pending_approval','approved','rejected','expired')),
  committed_at         TIMESTAMPTZ,
  committed_movement_id BIGINT REFERENCES public.stock_movements(id),
  CONSTRAINT chk_evidence_for_loss CHECK (
    reason_code NOT IN ('rusak','hilang') OR array_length(evidence_urls, 1) >= 1
  )
);

CREATE INDEX idx_sa_status ON public.stock_adjustments(status, requested_at DESC);
```

**Migration: `20260607000004_stock_opname.sql`**

```sql
CREATE TYPE opname_type AS ENUM ('full','per_kategori','per_sku_list');
CREATE TYPE opname_status AS ENUM ('in_progress','pending_owner','committed','rejected');

CREATE TABLE public.stock_opname_sessions (
  id                   BIGSERIAL PRIMARY KEY,
  opname_type          opname_type NOT NULL,
  scope_payload        JSONB NOT NULL,  -- e.g. {"categories":["Panel"]} or {"skus":[...]}
  counted_by_user_id   UUID NOT NULL,
  witnessed_by_user_id UUID NOT NULL,
  CONSTRAINT chk_two_person CHECK (counted_by_user_id <> witnessed_by_user_id),
  witness_acknowledged_at TIMESTAMPTZ,
  status               opname_status NOT NULL DEFAULT 'in_progress',
  variance_total_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  approval_request_id  BIGINT REFERENCES public.approval_requests(id),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at         TIMESTAMPTZ,
  committed_at         TIMESTAMPTZ
);

CREATE TABLE public.stock_opname_counts (
  session_id          BIGINT NOT NULL REFERENCES public.stock_opname_sessions(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  system_qty_snapshot INTEGER NOT NULL,  -- snapshot at session start
  counted_qty         INTEGER,
  variance            INTEGER GENERATED ALWAYS AS
                       (COALESCE(counted_qty, 0) - system_qty_snapshot) STORED,
  variance_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, sku, warehouse)
);
```

**Migration: `20260607000005_price_change_requests.sql` + `stock_price_history`**

```sql
CREATE TABLE public.price_change_requests (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  field               TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value           NUMERIC(15,2) NOT NULL,
  new_value           NUMERIC(15,2) NOT NULL CHECK (new_value >= 0),
  reason_note         TEXT NOT NULL,
  approval_request_id BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by        UUID NOT NULL,
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID,
  committed_at        TIMESTAMPTZ
);

CREATE TABLE public.stock_price_history (
  id              BIGSERIAL PRIMARY KEY,
  sku             TEXT NOT NULL REFERENCES public.stocks(sku),
  field           TEXT NOT NULL CHECK (field IN ('price','harga_modal')),
  old_value       NUMERIC(15,2) NOT NULL,
  new_value       NUMERIC(15,2) NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('approval','seed')),
  related_request_id BIGINT REFERENCES public.price_change_requests(id),
  actor_user_id   UUID NOT NULL,
  actor_role      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE UPDATE, DELETE ON public.stock_price_history FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.stock_price_history TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_price_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'stock_price_history is append-only'; END $$;

CREATE TRIGGER trg_deny_sph_update BEFORE UPDATE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
CREATE TRIGGER trg_deny_sph_delete BEFORE DELETE ON public.stock_price_history
  FOR EACH ROW EXECUTE FUNCTION public.deny_price_history_mutation();
```

**Migration: `20260607000006_stocks_revoke_direct_writes.sql`** *(critical — closes the silent-edit hole)*

```sql
-- Column-level grants: forbid direct UPDATE of these columns from JS clients.
-- Only SECURITY DEFINER RPCs (running with elevated rights) can change them.
REVOKE UPDATE (price, harga_modal, stock_atas, stock_bawah) ON public.stocks
  FROM PUBLIC, anon, authenticated;
-- service_role retains its bypass; the workflow trust assumption is that the
-- Go backend only writes via approved RPCs, which is enforced in code.
```

**Migration: `20260607000007_action_permissions.sql`**

```sql
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS action_permissions JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS approval_pin_hash  TEXT,
  ADD COLUMN IF NOT EXISTS pin_failed_count   INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until   TIMESTAMPTZ;
-- Seed defaults via UPDATE statement (Owner = all-true; others per the matrix
-- documented in Foundational Decision #5).
```

### RPC changes

All new RPCs are `SECURITY DEFINER` and take `actor_user_id UUID DEFAULT auth.uid()`:

- `request_adjustment(sku, warehouse, qty_delta, reason_code, reason_note, evidence_urls[])` — inserts `stock_adjustments` row (status `pending_approval`) + `approval_requests` row (type `adjustment`). Calls Go backend webhook to push WA button to Owner. Returns `approval_request_id`.
- `commit_approved_adjustment(approval_request_id)` — only callable if `approval_requests.status='approved'`. Calls `_log_stock_movement` (source `adjustment`), updates `stocks` via internal helper, sets `stock_adjustments.committed_at` and `committed_movement_id`.
- `reject_adjustment(approval_request_id, reason_note)` — flips `approval_requests.status='rejected'`, sets `stock_adjustments.status='rejected'`. No ledger row.
- `start_opname_session(opname_type, scope_payload, witnessed_by_user_id)` — enforces `counted_by ≠ witnessed_by`; snapshots `stocks.stock_atas`/`stock_bawah` for in-scope SKUs into `stock_opname_counts.system_qty_snapshot`.
- `record_opname_count(session_id, sku, warehouse, counted_qty)` — UPSERT a single count.
- `submit_opname_for_owner(session_id)` — requires `witness_acknowledged_at IS NOT NULL`; computes `variance_total_value`; creates `approval_requests` (type `opname`); status → `pending_owner`.
- `commit_opname(approval_request_id)` — for each varianced SKU, writes one `stock_movements` row (source `opname_variance`, `related_doc_id=session.id`); all-or-nothing in single transaction.
- `request_price_change(sku, field, new_value, reason_note)` — inserts `price_change_requests` + `approval_requests` row.
- `commit_approved_price_change(price_change_request_id)` — UPDATEs `stocks.price` or `stocks.harga_modal` via a temporary `service_role` path inside the SECURITY DEFINER function; writes `stock_price_history` row.
- `verify_owner_pin(approval_request_id, pin)` — bcrypt-compare against `admin_users.approval_pin_hash`. On success, flips request to approved + records `decision_channel='owner_pin'`. On failure, increments `pin_failed_count`; ≥ 5 in 10 min → `pin_locked_until = now() + 1 hour`.
- `decide_via_wa_button(approval_request_id, decision, decided_by_user_id)` — called by WA inbound webhook handler in the Go daemon.
- `expire_pending_approvals()` — sweep job called by existing heartbeat poller every minute; flips status to `expired`, channel `auto_expire`. Sends WA alert to Owner for each expired request.

### Frontend

**New components:**
- `ApprovalInboxScreen.tsx` — sidebar item "Persetujuan", badge = pending count, realtime subscription to `approval_requests`.
- `StockAdjustmentModal.tsx` — replaces inline qty edit. Reason dropdown, evidence upload (Supabase storage bucket `stock-evidence`), submit calls `request_adjustment`.
- `StockOpnameScreen.tsx` — list of past sessions + "Mulai Sesi Baru". Pick scope, pick witness (live filter of online users, excludes self).
- `StockOpnameSessionView.tsx` — table of in-scope SKUs, per-row counted_qty input, variance auto-computed; saksi acknowledgement button; submit.
- `PriceChangeRequestModal.tsx` — opened from `price` / `harga_modal` cell click in StockManager. Reason note required, live margin preview.
- `OwnerPinPad.tsx` — reusable 6-digit PIN component (called from any approval surface).
- `PendingApprovalBadge.tsx` — small yellow dot, tooltip shows who/what/when.
- `ApprovalRequestRow.tsx` — shared template for the inbox.

**Touched components:**
- `StockManagerScreen.tsx` — remove inline-edit of qty / `price` / `harga_modal`; each cell becomes a click target that opens the appropriate modal. Add "Permintaan Anda yang menunggu" banner at top reading from `approval_requests WHERE requested_by = me AND status='pending'`. Add row action: "Lihat riwayat pergerakan stok" → drawer of `stock_movements` for this SKU.
- `Sidebar.tsx` — new items: "Stok Opname" (gated `can_start_opname`), "Persetujuan" (gated by any `can_approve_*`).
- `types.ts` — add `ActionPermissionSet` type, extend `CurrentUser` shape.
- `src/lib/supabaseClient.ts` — service wrapper functions for the new RPCs.

**Realtime:** one Supabase realtime channel per logged-in user on `approval_requests WHERE requested_by = me OR (status='pending' AND I have can_approve_<X>)`. Updates badge counts and inbox without polling.

### Backend (Go daemon)
- New endpoint `POST /api/approval/wa-webhook` — receives WA button click; calls `decide_via_wa_button` RPC.
- New goroutine in `main.go`: `approvalExpiryPoller` running every 60s, calls `expire_pending_approvals` RPC (or extends existing heartbeat poller).
- Sender helper in `internal/whatsapp/handler.go`: `SendApprovalRequest(ownerJID, payload)` formats and sends the WA template with [Setujui]/[Tolak] buttons.

### RLS / Permissions

Default `action_permissions` per existing role:

| Permission | Owner | Finance Mgr | Staff Admin | Sup. Gudang |
|---|---|---|---|---|
| can_request_adjustment | ✅ | ❌ | ✅ | ✅ |
| can_approve_adjustment | ✅ locked | ❌ | ❌ | ❌ |
| can_start_opname | ✅ | ❌ | ❌ | ✅ |
| can_witness_opname | ✅ | ✅ | ✅ | ✅ |
| can_commit_opname | ✅ locked | ❌ | ❌ | ❌ |
| can_request_price_change | ✅ | ✅ | ✅ | ✅ |
| can_approve_price_change | ✅ locked | ❌ | ❌ | ❌ |

All `can_approve_*` permissions are locked-on for Owner and locked-off for everyone else. Owner cannot delegate approval authority through this spec.

### Acceptance Criteria
1. Direct `UPDATE stocks SET price = ...` from `authenticated` Supabase client returns permission denied.
2. Submitting a stock adjustment for any qty > 0 always produces a `pending` `approval_requests` row (no auto-commit). Calling `commit_approved_adjustment` before approval fails.
3. Approving via Owner PIN, WA button, or in-app Inbox all produce identical resulting state (same ledger row, same `decided_by`/`decided_at` shape, only `decision_channel` differs).
4. Opname `submit_opname_for_owner` fails if witness has not acknowledged.
5. Opname `commit_opname` writes one `stock_movements` row per varianced SKU in a single transaction; if any insert fails, none commit.
6. Concurrent sale during an opname session does **not** affect variance calculation — counts compare to the snapshot, not live `stocks`.
7. PIN: after 5 failed attempts within 10 min, the user's PIN is locked for 1 hour; verification function returns a structured error.
8. Approval auto-expires 30 min after creation; `decision_channel='auto_expire'`; Owner receives a "missed approval" WA alert.

### Out of Scope (Phase 2)
- Mobile-native barcode scan for opname (manual count only).
- Multi-witness opname (1 witness sufficient).
- Adjustment scheduling / batching.
- Reason-code expansion beyond the 5 listed (`rusak`, `hilang`, `sampel`, `koreksi_input`, `korjual_admin`).
- Delegated approval (Owner cannot temporarily assign approve authority to someone else).

---

## Phase 3a — Penerimaan PO

### Goal
Penerimaan barang dari supplier menjadi proses 2-orang dengan 3-way match (PO vs fisik vs faktur supplier) dan foto wajib. Selisih apa pun memicu Owner WA alert.

### Schema

**Migration: `20260607000008_purchase_order_receipts.sql`**

```sql
CREATE TABLE public.purchase_order_receipts (
  id                    BIGSERIAL PRIMARY KEY,
  po_id                 TEXT NOT NULL UNIQUE REFERENCES public.purchase_orders(id),  -- one receipt per PO
  received_by_user_id   UUID NOT NULL,
  witnessed_by_user_id  UUID NOT NULL,
  CONSTRAINT chk_two_person_receipt CHECK (received_by_user_id <> witnessed_by_user_id),
  warehouse             TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  photo_urls            TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT chk_photo_required CHECK (array_length(photo_urls, 1) >= 1),
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  has_variance          BOOLEAN NOT NULL DEFAULT FALSE,
  variance_note         TEXT
);

CREATE TABLE public.purchase_order_receipt_lines (
  receipt_id          BIGINT NOT NULL REFERENCES public.purchase_order_receipts(id) ON DELETE CASCADE,
  po_line_id          BIGINT NOT NULL,  -- references purchase_order_items
  sku                 TEXT NOT NULL,
  ordered_qty         INTEGER NOT NULL,
  received_qty        INTEGER NOT NULL CHECK (received_qty >= 0),
  invoice_qty         INTEGER NOT NULL CHECK (invoice_qty >= 0),
  variance_flag       BOOLEAN GENERATED ALWAYS AS
                      (ordered_qty <> received_qty OR received_qty <> invoice_qty) STORED,
  PRIMARY KEY (receipt_id, po_line_id)
);
```

### RPC changes
- Extend `receive_purchase_order(po_id, ...)` with new params: `p_witnessed_by_user_id UUID`, `p_photo_urls TEXT[]`, `p_lines JSONB` (each line: `{po_line_id, received_qty, invoice_qty}`). Validations: witness ≠ receiver; ≥ 1 photo. Writes `purchase_order_receipts` + lines, then runs existing `stock_lots` + `stocks` updates inside same txn, each line emits one Phase-1 `stock_movements` row (source `purchase_receive`). On any variance, sets `has_variance=TRUE` and calls Go-side webhook → Owner WA alert.

### Frontend
Touch `src/components/pembelian/ReceiveGoodsModal.tsx`:
- Add saksi dropdown (live list of online users, ≠ current).
- Add foto pengiriman dropzone (required, stored in `stock-evidence` bucket under `po-receipts/<po_id>/`).
- Per-line item: 3 columns — `ordered_qty` (display), `received_qty` (input), `invoice_qty` (input). Live variance column.
- Submit button disabled until: witness selected + ≥ 1 photo uploaded + every line has both qty fields.
- Variance warning banner appears when any line shows mismatch.

### RLS / Permissions
- `can_witness_po_receipt` default: Staff Admin Toko, Supervisor Gudang, Owner.
- Cannot witness own receipt (RPC enforce).

### Acceptance Criteria
1. `receive_purchase_order` without witness → returns error, no rows written.
2. `receive_purchase_order` without ≥ 1 photo URL → returns error.
3. Any line where `ordered_qty ≠ received_qty` OR `received_qty ≠ invoice_qty` flips `has_variance=TRUE` AND triggers a WA notification to Owner within 30s.
4. Each accepted line writes exactly one `stock_movements` row.

### Out of Scope (Phase 3a)
- Partial receipt of a single PO across multiple sessions (current model: one receipt = one PO closed).
- Supplier-side electronic invoice integration.
- Auto-OCR of supplier invoice photo to extract qty.

---

## Phase 3b — Kasir Controls

### Goal
Setiap transaksi Kasir terikat shift dengan actor jelas. Harga jual terkunci default, override butuh approval Owner, refund butuh approval Owner, price floor sebagai backstop hard, akhir shift hitung fisik laci untuk catch selisih.

### Schema

**Migration: `20260607000009_kasir_shifts.sql`**

```sql
CREATE TABLE public.kasir_shifts (
  id                    BIGSERIAL PRIMARY KEY,
  opened_by_user_id     UUID NOT NULL,
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash_amount   NUMERIC(15,2) NOT NULL CHECK (opening_cash_amount >= 0),
  opening_photo_url     TEXT,
  closed_at             TIMESTAMPTZ,
  closed_by_user_id     UUID,
  closing_cash_counted  NUMERIC(15,2),
  closing_cash_expected NUMERIC(15,2),
  variance              NUMERIC(15,2) GENERATED ALWAYS AS
                        (COALESCE(closing_cash_counted, 0) - COALESCE(closing_cash_expected, 0)) STORED,
  variance_note         TEXT,
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','closed','disputed'))
);
-- Enforce "exactly one open shift per user" via partial unique index:
CREATE UNIQUE INDEX uniq_open_shift_per_user
  ON public.kasir_shifts(opened_by_user_id) WHERE status = 'open';

-- Link transactions to shifts + cashier identity + void/refund state. The
-- IF NOT EXISTS guards make this safe to apply on top of the current schema
-- whether or not those columns are already present.
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS shift_id         BIGINT REFERENCES public.kasir_shifts(id),
  ADD COLUMN IF NOT EXISTS cashier_user_id  UUID,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'committed'
                                            CHECK (status IN ('committed','voided','partial_refunded'));
CREATE INDEX idx_kt_shift   ON public.kasir_transactions(shift_id);
CREATE INDEX idx_kt_cashier ON public.kasir_transactions(cashier_user_id);
```

**Migration: `20260607000010_kasir_price_override_requests.sql`**

```sql
CREATE TABLE public.kasir_price_override_requests (
  id                    BIGSERIAL PRIMARY KEY,
  kasir_session_id      UUID NOT NULL,  -- frontend cart id, ephemeral
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  default_price         NUMERIC(15,2) NOT NULL,
  requested_price       NUMERIC(15,2) NOT NULL CHECK (requested_price > 0),
  reason_code           TEXT NOT NULL
                        CHECK (reason_code IN ('negosiasi_customer','promo_tidak_terdaftar','barang_demo','lainnya')),
  reason_note           TEXT,
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at            TIMESTAMPTZ,
  decided_by            UUID,
  committed_kasir_tx_id BIGINT,
  CONSTRAINT chk_diff CHECK (requested_price <> default_price)
);
CREATE UNIQUE INDEX uniq_override_single_use
  ON public.kasir_price_override_requests(id) WHERE committed_kasir_tx_id IS NULL AND status='approved';
```

**Migration: `20260607000011_kasir_returns.sql`**

```sql
CREATE TABLE public.kasir_returns (
  id                    BIGSERIAL PRIMARY KEY,
  original_tx_id        BIGINT NOT NULL REFERENCES public.kasir_transactions(id),
  sku                   TEXT NOT NULL REFERENCES public.stocks(sku),
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  refund_amount         NUMERIC(15,2) NOT NULL CHECK (refund_amount >= 0),
  reason                TEXT NOT NULL,
  evidence_urls         TEXT[] NOT NULL DEFAULT '{}',
  approval_request_id   BIGINT NOT NULL REFERENCES public.approval_requests(id),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by          UUID NOT NULL,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_movement_id BIGINT REFERENCES public.stock_movements(id)
);
```

**Migration: `20260607000012_kasir_price_floor.sql`**

```sql
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS kasir_min_margin_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00;
-- 1.00 = floor at exactly HPP (no loss-leader allowed by default).
-- 0.90 would allow selling at 90% of HPP, etc.
```

### RPC changes
- `open_kasir_shift(opening_cash_amount, photo_url)` — fails if caller already has an open shift; returns new `shift_id`.
- `close_kasir_shift(shift_id, closing_cash_counted, note)` — computes `closing_cash_expected` from sum of cash transactions during shift; sets `status='closed'` (or `'disputed'` if `|variance| > company_settings.kasir_max_variance` — new column default Rp 50.000). Triggers Owner WA alert if disputed.
- `create_kasir_transaction(...)` — existing RPC extended: requires `shift_id`; for each line where `unit_price ≠ stocks.price`, requires a matching `kasir_price_override_requests` row with `status='approved'` AND `committed_kasir_tx_id IS NULL`. On commit, sets the override's `committed_kasir_tx_id`. Floor check: `unit_price >= stocks.harga_modal × company_settings.kasir_min_margin_pct` (errors out even on approved override).
- `request_kasir_price_override(session_id, sku, requested_price, reason_code, reason_note)` — creates `approval_requests` + `kasir_price_override_requests`.
- `request_kasir_refund(original_tx_id, sku, qty, refund_amount, reason, evidence_urls[])` — creates `approval_requests` + `kasir_returns`.
- `commit_approved_kasir_refund(approval_request_id)` — writes `stock_movements` row (source `return_kasir`, qty_delta positive), restores stock to the original warehouse, updates `kasir_returns.committed_movement_id`.
- `request_kasir_void(tx_id, reason)` — void of a committed transaction; creates approval request; on approval, writes compensating stock movements + voids the `kasir_transactions` row (status column).

### Frontend
**New components:**
- `KasirShiftOpenModal.tsx`, `KasirShiftCloseModal.tsx`, `KasirPriceOverrideModal.tsx`, `KasirRefundModal.tsx`.

**Touched:**
- `KasirScreen.tsx` — gate entire UI behind open-shift check. Show shift bar at top. "Tutup Shift" button.
- `KasirInvoiceModal.tsx` — line item `unit_price` becomes read-only; lock icon 🔒. "Ubah harga" button opens override modal. Pending/Approved states with badge. Checkout disabled while any line is pending. "Refund" action on past transactions opens refund modal.

### RLS / Permissions
- `can_open_kasir_shift` default: Staff Admin Toko, Owner.
- `can_request_kasir_price_override` default: Staff Admin Toko, Owner.
- `can_approve_kasir_price_override` locked: Owner only.
- `can_request_kasir_void` default: Staff Admin Toko, Owner.
- `can_approve_kasir_void` locked: Owner only.
- `can_request_kasir_refund` default: Staff Admin Toko, Owner.
- `can_approve_kasir_refund` locked: Owner only.
- `can_override_price_floor` locked: Owner only (and even then requires explicit per-request flag — see Out of Scope).

### Acceptance Criteria
1. Calling `create_kasir_transaction` without an open shift for the caller → error.
2. Any line with `unit_price ≠ stocks.price` without a matching approved unused override → error.
3. Floor: any line with `unit_price < stocks.harga_modal × company_settings.kasir_min_margin_pct` → error, even with approved override.
4. Closing a shift writes `closing_cash_expected` derived from transaction sum (cash-only), not from client input.
5. Refund commits write `stock_movements` row with positive `qty_delta` to restore stock.
6. Void commits write compensating `stock_movements` row and flip `kasir_transactions.status`.

### Out of Scope (Phase 3b)
- Multi-currency.
- Loss-leader sales below floor with Owner explicit override (would require extending the approval payload with a `floor_override:true` flag — defer).
- Cash drawer hardware integration.
- Receipt printing changes (existing `InvoiceModal` unchanged).
- Shift handover between users mid-day (one user closes, next opens fresh).

---

## Phase 3d — Transfer Two-Step

### Goal
Tutup bug "transfer instan" yang sekarang masih ada. Pemindahan stok antara Gudang Atas dan Bawah menjadi dua langkah eksplisit dengan dua user berbeda dan foto wajib di kedua sisi. Selisih kirim vs terima masuk virtual "transit" bucket sampai Owner adjust.

### Schema

**Migration: `20260607000013_transfers.sql`**

```sql
CREATE TYPE transfer_status AS ENUM ('initiated','received','disputed','cancelled');

CREATE TABLE public.warehouse_transfers (
  id                       BIGSERIAL PRIMARY KEY,
  sku                      TEXT NOT NULL REFERENCES public.stocks(sku),
  from_warehouse           TEXT NOT NULL CHECK (from_warehouse IN ('atas','bawah')),
  to_warehouse             TEXT NOT NULL CHECK (to_warehouse IN ('atas','bawah')),
  CONSTRAINT chk_different_warehouses CHECK (from_warehouse <> to_warehouse),
  initiated_qty            INTEGER NOT NULL CHECK (initiated_qty > 0),
  initiated_by_user_id     UUID NOT NULL,
  intended_receiver_user_id UUID NOT NULL,
  CONSTRAINT chk_two_person_transfer CHECK (initiated_by_user_id <> intended_receiver_user_id),
  initiated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_photo_urls          TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT chk_send_photo CHECK (array_length(send_photo_urls, 1) >= 1),
  received_qty             INTEGER,
  received_at              TIMESTAMPTZ,
  received_by_user_id      UUID,
  receive_photo_urls       TEXT[] NOT NULL DEFAULT '{}',
  variance                 INTEGER GENERATED ALWAYS AS
                           (COALESCE(received_qty, 0) - initiated_qty) STORED,
  status                   transfer_status NOT NULL DEFAULT 'initiated',
  initiate_movement_id     BIGINT REFERENCES public.stock_movements(id),
  receive_movement_id      BIGINT REFERENCES public.stock_movements(id)
);
CREATE INDEX idx_wt_status_initiated ON public.warehouse_transfers(status, initiated_at DESC);
CREATE INDEX idx_wt_receiver_status  ON public.warehouse_transfers(intended_receiver_user_id, status);
```

### RPC changes
Replace old single-shot `transfer_warehouse` RPC with:

- `transfer_initiate(sku, from_warehouse, to_warehouse, qty, intended_receiver_user_id, photo_urls[])` — atomically: validates qty ≤ source warehouse, validates receiver ≠ self, validates ≥ 1 photo. UPDATEs `stocks.<from_warehouse>` (qty -=) inside RPC; writes `warehouse_transfers` row; writes `stock_movements` (source `transfer_out`, warehouse=from). Note: `to_warehouse` is **not** credited yet; the difference resides in virtual `warehouse='transit'` in the ledger.
- `transfer_receive(transfer_id, counted_qty, photo_urls[])` — caller must be `intended_receiver_user_id`; ≥ 1 photo required. Writes `stock_movements` row with `warehouse=to_warehouse`, qty_delta=`counted_qty`, source `transfer_in`. If `counted_qty < initiated_qty`: `warehouse_transfers.status='disputed'`, Owner WA alert, transfer remains in disputed state until Owner files a `stock_adjustment` (reason `'hilang'`, reason_note referencing transfer_id) to write off the missing qty. **No auto-write-off** — the shortfall must go through the normal adjustment+approval flow.
- `transfer_dispute(transfer_id, note)` — receiver can dispute (e.g. wrong SKU); status → `disputed`; Owner alerted.

Old `transfer_warehouse` function is dropped after Phase 1 wrappers are removed.

### Frontend
**Touched:**
- `WarehouseTransferModal.tsx` — extend with intended-receiver dropdown (live users, ≠ self), send-photo dropzone (required), submit calls `transfer_initiate`.

**New:**
- `TransferMasukScreen.tsx` — sidebar item conditional on any pending receive for current user. Lists transfers where `intended_receiver_user_id = me AND status='initiated'`. Each row → "Konfirmasi Terima" → opens `TransferReceiveModal.tsx` with counted_qty input + receive-photo dropzone.

### RLS / Permissions
- `can_initiate_transfer` default: Staff Admin Toko, Supervisor Gudang, Owner.
- `can_receive_transfer` default: same.

### Acceptance Criteria
1. `transfer_initiate` with `intended_receiver_user_id = caller` → error.
2. `transfer_initiate` without ≥ 1 send photo → error.
3. After initiate: `stocks.<from_warehouse>` -=qty, `stocks.<to_warehouse>` unchanged; ledger has one row with `warehouse=<from_warehouse>` source `transfer_out`.
4. `transfer_receive` callable only by `intended_receiver_user_id`; others → error.
5. After receive with matching qty: `stocks.<to_warehouse>` += qty; ledger has one row source `transfer_in`.
6. After receive with shortfall: `stocks.<to_warehouse>` += counted_qty only; transfer goes to `disputed` status; Owner alerted; the missing qty stays as a logical "deficit" until Owner files a stock_adjustment via Phase 2 workflow. No phantom transit row in the ledger.
7. Transfer pending > 24h → flagged in Phase 4 dashboard + daily WA report.

### Out of Scope (Phase 3d)
- Multi-step (3+) routing between warehouses (we only have Atas/Bawah).
- Bulk transfers (multiple SKUs per transfer record — current model: one SKU per transfer).
- Auto-receive after N hours (Owner must manually adjust transit losses).

---

## Phase 4 — Owner Anomaly Dashboard

### Goal
Detective control yang menyajikan pola fraud yang preventive gate tidak bisa tangkap (terutama collusion). Owner-only section di Dashboard + daily WA heartbeat report.

### Schema

No new tables. SQL views and one config row.

**Migration: `20260607000014_pengawasan_views.sql`**

```sql
-- Top adjustments by absolute value
CREATE OR REPLACE VIEW public.v_pengawasan_top_adjustments AS
SELECT
  sa.id, sa.sku, s.name AS sku_name, sa.warehouse, sa.qty_delta,
  sa.reason_code, sa.reason_note, sa.evidence_urls,
  ABS(sa.qty_delta) * COALESCE(s.harga_modal, 0) AS value_rp,
  sa.requested_by, au.name AS actor_name, sa.requested_at,
  sa.status
FROM public.stock_adjustments sa
JOIN public.stocks s ON s.sku = sa.sku
LEFT JOIN public.admin_users au ON au.id = sa.requested_by
WHERE sa.committed_at IS NOT NULL
ORDER BY value_rp DESC;

-- Kasir discount summary per cashier, last 7 days
CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
SELECT
  kt.cashier_user_id, au.name AS cashier_name,
  SUM((s.price - kti.unit_price) * kti.qty) AS total_discount_rp,
  SUM(kti.unit_price * kti.qty) AS total_revenue_rp,
  CASE WHEN SUM(kti.unit_price * kti.qty) > 0
       THEN SUM((s.price - kti.unit_price) * kti.qty) / SUM(kti.unit_price * kti.qty)
       ELSE 0 END AS discount_pct_of_revenue
FROM public.kasir_transactions kt
JOIN LATERAL jsonb_to_recordset(kt.items) AS kti(sku TEXT, unit_price NUMERIC, qty INT) ON TRUE
JOIN public.stocks s ON s.sku = kti.sku
LEFT JOIN public.admin_users au ON au.id = kt.cashier_user_id
WHERE kt.created_at >= now() - INTERVAL '7 days'
  AND kt.status = 'committed'
GROUP BY kt.cashier_user_id, au.name;

-- Outflow velocity outliers: SKUs whose 7-day outflow > 3× 90-day daily avg
CREATE OR REPLACE VIEW public.v_pengawasan_outflow_outliers AS
WITH outflow_7 AS (
  SELECT sku, SUM(ABS(qty_delta)) AS sum_7d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '7 days'
  GROUP BY sku
),
avg_90 AS (
  SELECT sku, SUM(ABS(qty_delta))::numeric / 90 AS avg_daily_90d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '90 days'
  GROUP BY sku
)
SELECT o.sku, s.name, o.sum_7d, a.avg_daily_90d,
       o.sum_7d / NULLIF(a.avg_daily_90d * 7, 0) AS multiplier
FROM outflow_7 o
JOIN avg_90 a USING (sku)
JOIN public.stocks s ON s.sku = o.sku
WHERE o.sum_7d > 3 * a.avg_daily_90d * 7
ORDER BY multiplier DESC;

-- Transfer aging
CREATE OR REPLACE VIEW public.v_pengawasan_transfer_aging AS
SELECT id, sku, from_warehouse, to_warehouse, initiated_qty,
       initiated_by_user_id, intended_receiver_user_id, initiated_at,
       EXTRACT(EPOCH FROM (now() - initiated_at)) / 3600 AS hours_pending
FROM public.warehouse_transfers
WHERE status = 'initiated'
  AND initiated_at < now() - INTERVAL '24 hours'
ORDER BY initiated_at ASC;

-- Actor activity heatmap (30 days)
CREATE OR REPLACE VIEW public.v_pengawasan_actor_activity_30d AS
SELECT
  au.id, au.name, au.role,
  COUNT(*) FILTER (WHERE sa.id IS NOT NULL) AS adjust_count,
  COUNT(*) FILTER (WHERE kpo.id IS NOT NULL) AS override_count,
  COUNT(*) FILTER (WHERE kr.id IS NOT NULL) AS refund_count
  -- (void, opname variance follow same pattern; omitted for brevity)
FROM public.admin_users au
LEFT JOIN public.stock_adjustments sa
  ON sa.requested_by = au.id AND sa.requested_at >= now() - INTERVAL '30 days'
LEFT JOIN public.kasir_price_override_requests kpo
  ON kpo.requested_by = au.id AND kpo.requested_at >= now() - INTERVAL '30 days'
LEFT JOIN public.kasir_returns kr
  ON kr.requested_by = au.id AND kr.requested_at >= now() - INTERVAL '30 days'
GROUP BY au.id, au.name, au.role;
```

**Heartbeat config extension:**
```sql
ALTER TABLE public.heartbeat_config
  ADD COLUMN IF NOT EXISTS pengawasan_report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pengawasan_report_hour    INT NOT NULL DEFAULT 18;  -- WIB hour
```

### Frontend
**Touched:**
- `DashboardScreen.tsx` — add Owner-only "Pengawasan" section reading from the five views. Sections:
  - Top adjustments 30d (with photo thumbnails clickable to full-size).
  - Kasir discount 7d per cashier.
  - Outflow outliers 7d vs 90d.
  - Transfer aging > 24h.
  - Actor activity heatmap 30d with risk score (z-score of combined activity).
  - Period filter (30d / 7d / hari ini).
- `NotificationSettingsScreen.tsx` — toggles for `pengawasan_report_enabled` + sub-toggles per report section.

**New (optional but recommended for drilldown UX):**
- `PengawasanDrilldownModal.tsx` — opens from heatmap row click; shows full activity list for that actor.

### Backend (Go)
Extend `internal/heartbeat/poller.go`:
- Add `pengawasan` report type. Fires once per day at `pengawasan_report_hour` WIB.
- Builds payload from views, formats as a single WA message (or up to 4 if > 1500 chars).
- Owner JID resolution: from existing `company_settings.owner_jid`.

### RLS / Permissions
- `can_view_pengawasan` locked: Owner only.
- All five views: `GRANT SELECT TO authenticated` but filtered at the API layer (frontend checks permission before querying). Hardened via RLS later if needed.

### Acceptance Criteria
1. Pengawasan section is hidden for any user without `can_view_pengawasan`.
2. All views compute without joins or table changes outside the spec (no ETL/cron-built materialized views).
3. Daily heartbeat WA report sends exactly once per day at the configured WIB hour; if heartbeat config is disabled, no send.
4. Risk score = z-score of `(adjust + override + refund + void)` relative to team mean; rendered as `Rendah / Sedang / Tinggi` pill (cutoffs: z ≤ 0.5 / 0.5–1.5 / > 1.5).
5. Period filter swaps data without page reload.

### Out of Scope (Phase 4)
- Drilldown CSV export beyond simple browser print.
- Configurable alert thresholds per metric (use defaults).
- Multi-shop aggregation.
- ML-based anomaly detection.

---

## Cross-Phase Notes

### Storage bucket
- Create `stock-evidence` bucket mirroring `payment-proof` policies from `20260604000012_storage_authenticated_policies.sql`.
- Path conventions:
  - `adjustments/<adjustment_id>/<filename>`
  - `opname/<session_id>/<sku>/<filename>`
  - `po-receipts/<po_id>/<filename>`
  - `transfers/<transfer_id>/send/<filename>` and `transfers/<transfer_id>/receive/<filename>`
  - `kasir-returns/<return_id>/<filename>`

### WA approval button infrastructure
- One new endpoint in Go daemon: `POST /api/approval/wa-webhook` — receives WA inbound messages, parses button payload `approve:<id>` or `reject:<id>`, calls the appropriate RPC.
- WA template (sent from `internal/whatsapp/sender.go`):
  ```
  🔐 Approval — {{request_type}}
  Karyawan: {{actor_name}}
  Item: {{item_summary}}
  Detail: {{detail}}
  Alasan: {{reason}}
  Nilai: {{value_rp}}
  {{evidence_link}}
  [✓ Setujui]  [✗ Tolak]
  ```

### Realtime
One Supabase realtime channel per logged-in user. Listens on `approval_requests`. UI updates: badge counts, inbox row appear/disappear, pending banner state.

### Test strategy
- **Unit (DB):** trigger denial (`UPDATE`/`DELETE` on append-only tables); CHECK constraints; two-person constraints; floor check.
- **Unit (Go):** WA webhook payload parsing; PIN bcrypt verify; PIN lockout state machine; heartbeat report payload formatting.
- **Integration:** end-to-end for each entrypoint — invoke RPC, assert ledger row count + content + immutability; service_role attempt UPDATE asserts exception.
- **Manual QA:** scenarios in `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-mockups/index.html` (every interactive flow is also a QA script).

### Rollout order
Phase 1 ships first (zero user-visible change, foundation for all). Phase 2 and Phase 4 ship in parallel (Phase 4 only needs Phase 1 + Phase 2 tables). Phase 3a, 3b, 3d ship independently after Phase 2; order between them is flexible.

### Data seeding bypass
For initial CSV import (`stock-csv-upsert` flow) and brand-new SKU creation: `price`, `harga_modal`, `stock_atas`, `stock_bawah` are set via a dedicated `seed_stock_row` RPC that requires `Owner` role to call. Each seeded value is recorded in `stock_price_history` with `source='seed'` and a single initial `stock_movements` row with `source='seed'` (qty_before=0, qty_after=seeded_qty). Pre-Phase-1 stock balances are not backfilled — ledger history starts fresh from Phase 1 deploy, with one `seed` row per (sku, warehouse) for any pre-existing stock at cutover.

---

## Out of Scope (Whole Spec)

- Phase 3c (Surat Jalan / Customer Receipt QR) — dropped per scope review on 2026-06-07.
- Multi-shop / multi-tenant.
- Mobile-native barcode scan UX for opname.
- Auto-OCR of supplier invoice or kasir receipt photos.
- ML-based anomaly detection.
- Customer-facing self-service receipt verification.
- Backfill of pre-Phase-1 stock history.
- Backwards-compat shims for the deprecated `transfer_warehouse` single-shot RPC after Phase 3d ships.
- Threshold-based auto-approve (Owner explicitly chose: no thresholds).
- Loss-leader override (selling below HPP) — would need explicit per-request flag, deferred.
