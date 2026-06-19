# Piutang Write-Off Design

**Status:** Approved 2026-06-19 (founder)
**Phase:** 1C task 2 (Piutang)
**Migration slot range claimed:** `20260626000020`–`20260626000023`

## Goal

Add a flow for Owner-approved write-off of uncollectible tempo (credit) invoices. Currently every unrecoverable `INVOICE_TEMPO` row lingers in PiutangScreen aging buckets forever, distorting the AR view and credit-limit math. After this ships, admin can request a write-off with a reason; Owner approves from the existing Persetujuan inbox; the invoice flips to `INVOICE_WRITTEN_OFF` (column already exists) and drops out of outstanding totals. Owner can revert in one click if the customer unexpectedly pays.

## Non-goals

- Separate "Loss" / "Bad Debt" accounting ledger. The write-off model is "remove from AR via status flip", not "move amount to a loss account". Status filter on outstanding queries is sufficient.
- Bad Debt YTD KPI card on PiutangScreen — YAGNI; can be added later if founder wants accounting visibility.
- Per-tenant write-off policy (auto-write-off after N days overdue, threshold limits, etc.). Founder triggers it manually case-by-case.
- WA notification to customer about write-off. Out of scope per `feedback_no_wa_supplier_reminder` logic — manual is more polite.
- Bulk write-off. One-at-a-time only.

## Architecture

Mirror the existing **rakit_lock approval workflow** (precedent: PR #27 Owner Biaya Final Inbox Integration). All structural pieces — `approval_requests` table, `approval_request_type` enum, Persetujuan inbox screen, realtime subscriptions, `_transition_approval` helper — are already in place; this feature adds a new request type into that framework.

Two-step approval:
1. Admin clicks `Tulis-off` on a piutang row → modal collects required reason → RPC `request_tempo_write_off` creates pending approval.
2. Owner opens Persetujuan inbox → reviews → `Setujui Tulis-off` or `Tolak` → RPC `approve_tempo_write_off` / `reject_tempo_write_off`.

Revert is a one-step Owner-only action (no inbox cycle) because it's restoring a state the Owner already approved as undoable, not creating new accounting liability.

All RPCs are `SECURITY DEFINER` with `auth.uid()` binding and `role='Owner' AND status='Aktif'` filter for approve/reject/revert paths (lesson from PR #34: deactivated Owners must not be able to approve, audit attribution must reflect the actual caller).

## Components

### Backend (SQL migrations)

| # | File | Purpose |
|---|------|---------|
| `20260626000020` | `extend_approval_for_piutang_write_off.sql` | (a) Add `'piutang_write_off'` value to `approval_request_type` enum. (b) Create satellite table `piutang_write_off_requests(approval_id BIGINT PK FK → approval_requests(id) ON DELETE CASCADE, order_id UUID NOT NULL FK → orders(id), reason TEXT NOT NULL CHECK length(trim(reason)) >= 10, created_at TIMESTAMPTZ DEFAULT now())`. (c) Partial unique index on `(order_id) WHERE approval_id IN (SELECT id FROM approval_requests WHERE status='pending')` — enforces "one pending write-off request per order". |
| `20260626000021` | `request_tempo_write_off_rpc.sql` | `request_tempo_write_off(p_order_id UUID, p_reason TEXT) RETURNS BIGINT`. `SECURITY DEFINER`, search_path public. Body: validate `auth.uid()` non-null; validate order exists + `status='INVOICE_TEMPO'` (else raise `ORDER_NOT_TEMPO`); validate reason length (else `REASON_REQUIRED`); INSERT `approval_requests` (type=`piutang_write_off`, requested_by=`auth.uid()`, status=`pending`, expires_at=NULL — founder explicitly chose no-expiry earlier); INSERT `piutang_write_off_requests`; INSERT audit_log event `tempo_write_off_requested` with payload `{approval_id, order_id, reason, customer_id, amount}`; return approval_id. Duplicate guard: unique index on satellite raises on second pending submit; catch + re-raise as `WRITE_OFF_ALREADY_PENDING: approval_id=%`. |
| `20260626000022` | `approve_reject_tempo_write_off_rpcs.sql` | (a) `approve_tempo_write_off(p_approval_id BIGINT) RETURNS JSONB`. Verify caller is Aktif Owner via `auth.uid()`-bound lookup (same shape as fixed `verify_owner_pin`); lock approval row + verify `status='pending'` (else raise `APPROVAL_NOT_PENDING`); fetch satellite + order; if order no longer `INVOICE_TEMPO` (race), `_transition_approval(rejected)` + INSERT audit `tempo_write_off_rejected` with `auto=true` + **RETURN `jsonb_build_object('status', 'auto_rejected_race', 'new_order_status', v_order.status::text)`** (do NOT raise — raising would roll back the auto-reject due to PL/pgSQL subtransaction semantics); else UPDATE `orders` SET `status='INVOICE_WRITTEN_OFF'`, `written_off_at=now()`, `written_off_by=v_caller_admin_id`, `write_off_reason=v_satellite.reason`; call `_transition_approval(approval_id, 'approved', v_caller_admin_id, 'piutang_write_off_approve')`; INSERT audit_log `tempo_write_off_approved`; **RETURN `jsonb_build_object('status', 'approved')`**. Only OWNER_ONLY / APPROVAL_NOT_FOUND / WRONG_TYPE / APPROVAL_NOT_PENDING / ORDER_NOT_FOUND / SATELLITE_NOT_FOUND remain as raised errors. (b) `reject_tempo_write_off(p_approval_id BIGINT, p_reason TEXT) RETURNS VOID`. Same caller check; lock approval; call `_transition_approval` with status `rejected` and the reject reason; INSERT audit `tempo_write_off_rejected` with payload `{approval_id, order_id, reject_reason, auto=false}`. Order untouched. |
| `20260626000023` | `revert_tempo_write_off_rpc.sql` | `revert_tempo_write_off(p_order_id UUID) RETURNS VOID`. Verify caller is Aktif Owner via `auth.uid()`. Lock order + verify `status='INVOICE_WRITTEN_OFF'` (else `NOT_WRITTEN_OFF`). Capture previous `write_off_reason` for audit forensics. UPDATE `orders` SET `status='INVOICE_TEMPO'`, `written_off_at=NULL`, `written_off_by=NULL`, `write_off_reason=NULL`. INSERT audit_log `tempo_write_off_reverted` with payload `{order_id, previous_reason, previous_written_off_at, previous_written_off_by}`. |

All migrations end with `GRANT EXECUTE … TO authenticated` on the relevant RPCs.

### Frontend

| File | Change |
|---|---|
| `src/types.ts` | Extend `ApprovalRequestType` union to include `'piutang_write_off'`. Add row type `DbPiutangWriteOffRequest = { approval_id: number; order_id: string; reason: string; created_at: string }`. |
| `src/lib/piutangService.ts` | Add all 4 wrappers: `requestTempoWriteOff(orderId, reason)`, `approveTempoWriteOff(approvalId)`, `rejectTempoWriteOff(approvalId, reason)`, `revertTempoWriteOff(orderId)`. Same convention as existing `rakitLockOwnerEdit.ts` — thin Supabase RPC wrappers that re-throw errors with the raised prefix intact so consumers can pattern-match (`ORDER_NOT_TEMPO:`, `OWNER_ONLY:` etc.). Extend `fetchPiutangRows(opts?: { includeWrittenOff?: boolean })` — opt-in extension of the existing status filter to include `INVOICE_WRITTEN_OFF`. |
| `src/components/piutang/PiutangScreen.tsx` | (a) Add 6th filter pill `Tulis-off` next to existing `[Semua | Overdue | Today | H-3 | Future]`. When selected, calls `fetchPiutangRows({ includeWrittenOff: true })` and filters client-side to `status='INVOICE_WRITTEN_OFF'`. Count shown in pill chip. (b) Per-row action: when `status='INVOICE_TEMPO'`, render `Tulis-off` button alongside existing `WA`/`Catat Bayar`. Click opens `WriteOffRequestModal`. (c) Per-row action: when `status='INVOICE_WRITTEN_OFF'` AND current user is Aktif Owner, render `Batal Tulis-off` button. Click opens confirm modal with destructive styling → on confirm, call `revertTempoWriteOff`. (d) Show `written_off_at` + `write_off_reason` in the row's secondary line when on the `Tulis-off` pill. |
| `src/components/piutang/WriteOffRequestModal.tsx` (NEW) | Reason textarea (`minLength=10`, trim check, char counter), Batal/Ajukan Tulis-off buttons. On submit calls `requestTempoWriteOff`. Pattern-matches errors and surfaces specific Indonesian toast messages. |
| `src/components/approval/TempoWriteOffApprovalRequestRow.tsx` (NEW) | Mirrors `RakitLockApprovalRequestRow` shape. Reads satellite via existing approval payload fetch pattern. Shows customer/invoice/amount/reason/requestor name. Buttons: `Tolak` (opens reason input modal → `rejectTempoWriteOff`) and `✓ Setujui Tulis-off` (confirm → `approveTempoWriteOff`). |
| `src/components/approval/ApprovalInboxScreen.tsx` | Wire new request type into inbox row dispatch (extend the existing switch/discriminator that picks `RakitLockApprovalRequestRow` etc.). |

### Audit log conventions

Event types follow snake_case precedent: `tempo_write_off_requested`, `tempo_write_off_approved`, `tempo_write_off_rejected`, `tempo_write_off_reverted`. Payloads carry factual data only — order_id, approval_id, amount, customer_id, reason — no narrative actor text. `actor_user_id` set to caller's `auth.uid()` (not the admin_users.id) for cross-table consistency with audit_log convention.

## Data flow

**Admin requests write-off:**
1. Admin clicks `Tulis-off` on a `INVOICE_TEMPO` row.
2. `WriteOffRequestModal` opens with customer/invoice/amount summary + required reason textarea.
3. On Ajukan: `requestTempoWriteOff(orderId, reason)` → RPC inside one tx → returns approval_id.
4. Modal closes; toast "Tulis-off diajukan ke Owner". Row stays `INVOICE_TEMPO` (no status change yet).

**Owner approves in inbox:**
1. Owner opens Persetujuan inbox; `TempoWriteOffApprovalRequestRow` renders with details.
2. On Setujui: `approveTempoWriteOff(approval_id)` → RPC inside one tx.
3. Order flips to `INVOICE_WRITTEN_OFF`; written_off_* stamped; approval marked approved; audit logged.
4. Realtime removes the inbox row. PiutangScreen `Tulis-off` pill count increments.

**Owner rejects:**
- Same shape with `rejectTempoWriteOff(approval_id, reason)`. Approval marked rejected, audit logged, order untouched.

**Owner reverts:**
1. Owner switches to `Tulis-off` pill in PiutangScreen.
2. Clicks `Batal Tulis-off` → destructive-style confirm modal → Konfirmasi.
3. `revertTempoWriteOff(orderId)` → RPC inside one tx → order restored, audit logged with previous reason in payload.
4. Realtime moves the row back to its aging bucket pill.

## Error handling

### RPC raises (Indonesian-prefixed for client pattern-match)

| Scenario | RPC behavior | Client toast |
|---|---|---|
| Caller not authenticated (approve/reject/revert) | `OWNER_ONLY: no authenticated user` | "Sesi habis, login ulang" |
| Caller not Aktif Owner (approve/reject/revert) | `OWNER_ONLY: caller is not an active Owner` | "Hanya Owner aktif yang bisa setujui" |
| `request` — order not INVOICE_TEMPO | `ORDER_NOT_TEMPO: cannot write off status=%` | "Invoice tidak bisa di-tulis-off (sudah lunas / sudah ditulis-off)" |
| `request` — order not found | `ORDER_NOT_FOUND: %` | "Invoice tidak ditemukan" |
| `request` — reason too short / empty | `REASON_REQUIRED` | "Alasan wajib diisi (min 10 karakter)" — client validation catches first |
| `request` — duplicate pending request | `WRITE_OFF_ALREADY_PENDING: approval_id=%` | "Tulis-off untuk invoice ini sudah diajukan" |
| `approve` — approval no longer pending | `APPROVAL_NOT_PENDING: status=%` | "Sudah diproses" — inbox row gone via realtime anyway |
| `approve` — race: order paid before approve | Returns `{status: 'auto_rejected_race', new_order_status: '...'}` (no raise); approval auto-marked rejected with system reason | Client dispatches on `result.status`: "Invoice sudah dibayar sebelum disetujui — pengajuan dibatalkan otomatis" |
| `revert` — order not INVOICE_WRITTEN_OFF | `NOT_WRITTEN_OFF: status=%` | "Invoice tidak dalam status tulis-off" |

### Client-side

- Reason textarea enforces `minLength=10` + trim before enabling Ajukan button.
- Revert confirm modal uses destructive (red) styling.
- All RPC errors caught in lib layer; re-thrown with prefix preserved.

### Race notes

The race "customer pays while write-off pending" is handled by lazy check at approve time: the `approve` RPC re-reads the order status and **atomically auto-rejects the approval, writes an audit row, and returns `{status: 'auto_rejected_race', new_order_status}` — without raising**. The reason: PL/pgSQL subtransaction semantics roll back all in-function writes when the function raises, so a raise after auto-reject would discard the rejection. The discriminated JSONB return lets the client toast appropriately.

We do NOT proactively reject pending write-offs from inside `markTempoInvoicePaid` (extra coupling, no real benefit — the lazy check is sufficient).

## Testing

### vitest (client lib, mocked Supabase)

- `requestTempoWriteOff(orderId, reason)`:
  - Calls RPC `request_tempo_write_off` with correct args
  - Returns approval_id from RPC response
  - Re-throws RPC error preserving prefix
- `revertTempoWriteOff(orderId)`:
  - Calls RPC `revert_tempo_write_off` with `p_order_id`
  - Re-throws RPC error preserving prefix
- `fetchPiutangRows({ includeWrittenOff: true })`:
  - Query status filter includes both `INVOICE_TEMPO` and `INVOICE_WRITTEN_OFF`
  - Default (no flag): returns INVOICE_TEMPO only
- `approveTempoWriteOff` / `rejectTempoWriteOff` wrappers: arg passthrough + error re-throw

### SQL smoke via Supabase MCP `execute_sql`

Run each scenario inside `BEGIN; … ROLLBACK;` to leave DB pristine. Use `set_config('request.jwt.claims', ...)` to simulate caller identity per the verify_owner_pin smoke pattern from PR #34.

| # | Path | Setup | Expected |
|---|---|---|---|
| 1 | `request` happy | Authenticated admin uid; seeded `INVOICE_TEMPO` order | Returns approval_id; satellite row exists; audit row `tempo_write_off_requested` |
| 2 | `request` wrong status | Order is `PAYMENT_VERIFIED` | Raises `ORDER_NOT_TEMPO:` |
| 3 | `request` duplicate | Call twice on same order | Second call raises `WRITE_OFF_ALREADY_PENDING:` |
| 4 | `approve` non-Owner | Authenticated as admin (not Owner) | Raises `OWNER_ONLY: caller is not an active Owner` |
| 5 | `approve` Tidak Aktif Owner | Authenticated as deactivated Owner | Raises `OWNER_ONLY: caller is not an active Owner` |
| 6 | `approve` happy | Aktif Owner; pending approval | Order is `INVOICE_WRITTEN_OFF`; written_off_* stamped; approval `approved`; audit `tempo_write_off_approved` |
| 7 | `approve` race | Order flipped to `PAYMENT_VERIFIED` between request and approve | Raises `ORDER_NO_LONGER_TEMPO:`; approval auto-marked rejected with system reason |
| 8 | `reject` | Owner rejects with reason | Approval `rejected`; order untouched; audit `tempo_write_off_rejected` |
| 9 | `revert` happy | Aktif Owner; order `INVOICE_WRITTEN_OFF` | Order restored to `INVOICE_TEMPO`; written_off_* cleared; audit `tempo_write_off_reverted` with previous reason in payload |
| 10 | `revert` wrong status | Order is `INVOICE_TEMPO` | Raises `NOT_WRITTEN_OFF:` |

### Manual UI smoke (after merge, via Chrome DevTools MCP)

- Drive admin: open Piutang, click Tulis-off on a row, enter reason ≥ 10 chars, submit → toast appears, row stays in original bucket.
- Drive Owner: open Persetujuan, see the new request, click Setujui Tulis-off → row leaves inbox; switch to PiutangScreen Tulis-off pill, see the order.
- Drive Owner revert: click Batal Tulis-off → confirm → toast; switch back to original aging bucket pill, row reappears.
- Negative paths: try to write-off an already-paid invoice (button shouldn't show); try to submit reason < 10 chars (Ajukan stays disabled).

## Open considerations (deferred)

- **Bulk write-off** — single-row at a time is fine for v1. Add later if founder routinely writes off in batches.
- **Auto-write-off policy** — could automate write-off proposal after N days overdue. Out of scope; founder triggers manually.
- **Bad Debt YTD KPI card** — once `INVOICE_WRITTEN_OFF` rows accumulate, may be worth a 5th KPI. YAGNI for now.
- **Customer-side credit-limit feedback** — when write-off lands, the customer's credit utilization mathematics change. Today, outstanding_amount calc filters to `INVOICE_TEMPO`, so a write-off naturally lowers utilization. No additional work needed but worth verifying in smoke.
- **Markdown of `markTempoInvoicePaid`** — out of scope. Could later proactively reject pending write-offs but extra coupling for no real benefit (current lazy check is sufficient).
