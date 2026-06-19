# Owner Biaya Final — Inbox Integration Design

**Status:** Approved 2026-06-19 — ready for implementation planning.

**Author:** Tony (founder) + assistant (Phase 1B follow-up brainstorm).

**Background:** Phase 1B PR #25 added an inline "✓ Setujui Biaya Final" button at sub-stage 3g in the Sales funnel as a stopgap. This spec replaces that stopgap with proper integration to the existing approval inbox infrastructure (which already supports CP/RP cost approval as `rakit_lock`).

## Goal

When admin marks a Custom Panel / Rakit Panel order as done at funnel sub-stage **3f Sedang Dirakit**, the funnel should open the existing `LockSubmissionModal` so admin can submit actual material + labor costs. The submission appears in the existing **Persetujuan** inbox under the existing "Rakit Lock" filter. Owner reviews, optionally edits the values, and approves in one step. On approve, the funnel row moves to **3h Biaya Final OK · Tunggu Pelunasan**. On reject, the row returns to 3f with a visible reject-reason chip so admin can revise.

## Non-goals

- No new approval enum value, table, screen, or sub-stage.
- No Owner PIN enforcement (deferred — server-side role check is enough for now).
- No expires_at enforcement (`approval_requests.expires_at` 30-min default stays in the schema but UI ignores it; admin can withdraw + resubmit if stale).
- No Persetujuan sidebar visibility change for non-Owner — affects 4 other approval types that are out of scope here.
- No WA notification to admin on reject — deferred to Phase 1C (Calista WA wiring).
- No Komponen-order changes; the integration is strictly CP/RP-only.

## What already exists (no work needed)

| Piece | Where | Role |
|---|---|---|
| `approval_requests` table | migration 20260607000007 | Generic approval queue with `request_type` enum, JSONB payload, status enum, decided_by, audit columns |
| `request_type='rakit_lock'` enum value | migration 20260609000010 | The approval type we reuse |
| `LockSubmissionModal.tsx` | `src/components/penjualan/` (375 lines) | Cost entry UI — final_price, tracking_mode, labor_cost, components, FIFO snapshot |
| `request_rakit_lock(transaction_id, lines)` RPC | migration 20260609000010 | Backend: insert approval_request + lock job_lines + insert components |
| `commit_approved_rakit_lock(approval_id, hpp_overrides)` RPC | migration 20260609000010 | Backend: write stock_movements, lock HPP, set tx status |
| `withdraw_rakit_lock(approval_id)` RPC | migration 20260609000010 | Backend: revert pending approval, set tx back to WIP |
| `ApprovalInboxScreen.tsx` | `src/components/approval/` (340 lines) | Owner inbox — already has "Rakit Lock" filter pill |
| `RakitLockApprovalRequestRow.tsx` | `src/components/approval/` | Inbox row component for rakit_lock entries |
| `fetchRakitLockRequestByApprovalId` | `src/lib/supabaseClient.ts` | Hydrates row component with line/component details |

## The gap

| Gap | Effect today |
|---|---|
| Funnel 3f "Selesai" calls `transition_order_stage('3f' → '3g')` directly, not `request_rakit_lock` | Order at 3g has no `approval_requests` row. Owner inbox shows nothing. |
| `commit_approved_rakit_lock` updates `kasir_transactions.status` but not `funnel_sub_stage` | After Owner approves, funnel position diverges from legacy status. Stays at 3g forever. |
| `withdraw_rakit_lock` likewise doesn't touch `funnel_sub_stage` | Admin withdraws → funnel still at 3g. |
| Inline "Setujui Biaya Final" button at 3g (shipped in PR #25) bypasses inbox | Owner can approve without recording cost data, no audit trail. |
| Reject path doesn't exist for the funnel | If `rejectRakitLock` is called today, funnel position is unchanged. |
| Owner has no way to edit-then-approve in a single step | Existing inbox UI is approve-or-reject only; Owner has to reject + admin resubmit even for tiny adjustments. |

## Workflow after this change

### Admin side — submit costs

1. Admin opens Daftar Pesanan → Workshop tab → Stage 3 → expands sub-stage **3f Sedang Dirakit**.
2. Admin clicks the **Selesai** pill on a row.
3. Frontend opens **`LockSubmissionModal`** (existing). Prefills with `rakit_job_lines` for that order (estimated price + tracking mode default).
4. Admin fills: `final_price`, `tracking_mode` (detail/lumpsum), `labor_cost`, `components` (SKU + qty + warehouse + FIFO snapshot picked automatically).
5. Admin clicks **Submit** → frontend calls `requestRakitLock(transaction_id, lines)`.
6. Backend RPC (extended) does everything it does today PLUS sets `funnel_sub_stage='3g'` at the end.
7. Modal closes, toast "Biaya final dikirim ke owner untuk review." Admin sees the row at 3g sub-stage with a passive "Tunggu Owner" label.

### Owner side — approve, edit-and-approve, or reject

1. Owner opens sidebar **Persetujuan** → filter pill **Rakit Lock**. Row appears with admin's submission summary (customer, estimate vs final, labor, margin, +/- delta).
2. Three buttons per row: **✓ Approve**, **✏️ Edit & Approve**, **✗ Reject**.
3. **✓ Approve path:** Frontend calls `commit_approved_rakit_lock(approval_id)` (after also flipping `approval_requests.status='approved'`).
   - RPC (extended) writes stock_movements, locks HPP, sets `kasir_transactions.status='AWAITING_LUNAS'` AND `funnel_sub_stage='3h'`. Atomic.
4. **✏️ Edit & Approve path:** Frontend opens **`LockSubmissionModal` in `owner-amend` mode** (new prop), prefilled from the approval request's snapshot. Owner adjusts any field. Click Submit → frontend calls new RPC `approve_and_amend_rakit_lock(approval_id, amended_lines)`.
   - RPC verifies caller is Owner (`auth.uid() ∈ admin_users WHERE role='Owner' AND status='active'`).
   - UPDATEs rakit_job_lines + replaces rakit_components atomically.
   - Sets approval status='approved' with decision_channel='owner_app_edit'.
   - Runs commit logic (stock_movements, HPP lock, `funnel_sub_stage='3h'`).
   - INSERTs audit_log with event_type='rakit_lock_approved_with_edit', payload `{ admin_submitted, owner_amended, diff_keys }`.
5. **✗ Reject path:** Frontend opens `ReasonInputModal` (from PR #25) → Owner types reason → calls new RPC `reject_rakit_lock_to_funnel(approval_id, reason)`.
   - RPC verifies Owner role.
   - Sets approval status='rejected' with decision_channel='owner_app_inbox'.
   - INSERTs audit_log event_type='rakit_lock_rejected' with `{ reason }` in payload.
   - UPDATEs `kasir_transactions.funnel_sub_stage='3f'`.

### Admin sees Owner's verdict

- **Approve / Edit & Approve:** Row moves to 3h. Admin opens ActionPanel → sees PDF buttons (Sales Order / Invoice DP / Invoice Pelunasan) — Invoice Pelunasan uses the final values that committed (Owner's amended values if Edit & Approve was used). A new **Riwayat Persetujuan** panel on the row shows the diff if applicable.
- **Reject:** Row returns to 3f. The row carries a small `⚠️ Owner: <reason snippet>` chip next to the customer name. Row is auto-urgent (gold background, auto-expanded sub-stage) so admin doesn't miss it. Admin clicks **Selesai** again → `LockSubmissionModal` opens prefilled from the previous submission → admin revises → resubmits.

## Components to add or modify

### Backend (4 migrations, all idempotent CREATE OR REPLACE)

| File | Change |
|---|---|
| `..._extend_request_rakit_lock_funnel.sql` | CREATE OR REPLACE `request_rakit_lock`; add `UPDATE kasir_transactions SET funnel_sub_stage='3g' WHERE id=p_transaction_id;` at end. |
| `..._extend_commit_rakit_lock_funnel.sql` | CREATE OR REPLACE `commit_approved_rakit_lock`; add `UPDATE kasir_transactions SET funnel_sub_stage='3h' WHERE id=v_rr.transaction_id;` at end. Also CREATE OR REPLACE `withdraw_rakit_lock`; add `UPDATE kasir_transactions SET funnel_sub_stage='3f' WHERE id=v_rr.transaction_id;` at end. |
| `..._approve_and_amend_rakit_lock.sql` | NEW RPC `approve_and_amend_rakit_lock(p_approval_id BIGINT, p_amended_lines JSONB) RETURNS VOID`. Owner-role check via `auth.uid()` + `admin_users`. UPDATE rakit_job_lines, DELETE+INSERT rakit_components, set approval='approved' channel='owner_app_edit', run commit logic, insert audit_log entry with diff. |
| `..._reject_rakit_lock_to_funnel.sql` | NEW RPC `reject_rakit_lock_to_funnel(p_approval_id BIGINT, p_reason TEXT) RETURNS VOID`. Owner-role check. Set approval='rejected' channel='owner_app_inbox', insert audit_log event_type='rakit_lock_rejected', UPDATE funnel_sub_stage='3f'. |

No new enum values, no new tables.

### Lib layer

| File | Change |
|---|---|
| `src/lib/supabaseClient.ts` | Add wrappers `approveAndAmendRakitLock(approvalId, amendedLines)` and `rejectRakitLockToFunnel(approvalId, reason)`. Existing `requestRakitLock` and `commitApprovedRakitLock` stay as-is. |
| `src/lib/sales/queries.ts` | Add `fetchRakitLockHistory(orderId): Promise<RakitLockEvent[]>` — query `audit_log` filtered to event_types `rakit_lock_requested`, `rakit_lock_approved`, `rakit_lock_approved_with_edit`, `rakit_lock_rejected` for that order, sorted by created_at DESC. |
| `src/lib/sales/recentRejects.ts` (NEW) | `fetchRecentRejectsByOrder(orderIds: string[]): Promise<Record<orderId, RejectInfo>>` — batch query for rejects within last 7 days. Returns map. |

### UI layer

| File | Change |
|---|---|
| `src/components/sales/DaftarPesananScreen.tsx` | (a) `handleQuickAction`: if order is CP/RP at `funnel_sub_stage='3f'` and action.label === 'Selesai', open `LockSubmissionModal` instead of calling `transitionOrder`. (b) Remove `handleApproveBiayaFinal`. (c) On mount, fetch recent rejects for 3f rows; pass map to SubStageSection. |
| `src/components/sales/SubStageSection.tsx` | Pass `rejectInfoMap` through to OrderRow. |
| `src/components/sales/OrderRow.tsx` | When `funnel_sub_stage='3f'` and an entry exists in `rejectInfoMap` for the order, render a `⚠️ Owner: <reason snippet>` chip next to the customer name. Tooltip on hover: "Direject pada <date>. Klik untuk lihat history." |
| `src/components/sales/ActionPanel.tsx` | Remove the `✓ Setujui Biaya Final` button and its prop `onApproveBiayaFinal`. Add a `Withdraw` button visible at 3g sub-stage when there's a pending rakit_lock approval. Calls existing `withdrawRakitLock` wrapper. |
| `src/components/sales/RiwayatPersetujuanPanel.tsx` (NEW) | Renders in ActionPanel when sub-stage is 3g or 3h and order_type is CP/RP. Calls `fetchRakitLockHistory`. Lists events chronologically with type, actor, timestamp. For `rakit_lock_approved_with_edit`, expandable diff section showing field-by-field before → after. |
| `src/components/approval/RakitLockApprovalRequestRow.tsx` | Add a third button `✏️ Edit & Approve` between Approve and Reject. Hidden when current user is not Owner (already partly there for action buttons — confirm pattern). On click: open `LockSubmissionModal` in `owner-amend` mode. |
| `src/components/penjualan/LockSubmissionModal.tsx` | Add prop `mode: 'admin-submit' \| 'owner-amend'` (default 'admin-submit'). When 'owner-amend': prefill from approval payload, label header "Edit oleh Owner", Submit button calls `approveAndAmendRakitLock` instead of `requestRakitLock`. |

### Files NOT touched

- `src/App.tsx` sidebar nav — Persetujuan menu visibility unchanged.
- `ApprovalInboxScreen.tsx` filter pills layout — unchanged.
- `OwnerPinPad.tsx` — PIN flow not used here.
- `quickActionMap.ts` and `stageMapping.ts` — no new sub-stages, no quick-action label changes.
- PDF generators — they already read fresh data from `kasir_transactions` and `rakit_job_lines`, so Owner's amended values flow through automatically.

## Data flow contract

Every transition between funnel sub-stages 3f/3g/3h MUST go through one of:

- `request_rakit_lock` — admin path, 3f → 3g
- `withdraw_rakit_lock` — admin escape, 3g → 3f
- `commit_approved_rakit_lock` — Owner approve plain, 3g → 3h
- `approve_and_amend_rakit_lock` — Owner approve with edit, 3g → 3h
- `reject_rakit_lock_to_funnel` — Owner reject, 3g → 3f
- `transition_order_stage` to 6a — universal cancel (existing, from PR #25), any 3* → 6a

The frontend `transitionOrder` wrapper SHOULD NOT be called directly for 3f/3g/3h transitions on CP/RP orders, except for the cancel path. This keeps the contract single-sourced.

## Error handling

| Scenario | Behavior |
|---|---|
| Non-Owner calls `approve_and_amend_rakit_lock` or `reject_rakit_lock_to_funnel` | RPC raises `OWNER_ONLY`. Frontend already hides buttons; this is defense in depth. |
| Approval already approved/rejected when Owner clicks (race) | `SELECT ... FOR UPDATE` blocks; second caller sees non-pending status, RPC raises `APPROVAL_NOT_PENDING`. UI shows toast and refreshes via realtime. |
| Stock insufficient at commit | Commit logic raises `INSUFFICIENT_STOCK_FOR_SKU: <sku>`. Transaction rolls back, approval stays pending. Toast surfaces error. Admin must adjust components via Withdraw + resubmit. |
| Order already cancelled while approval pending | `transition_order_stage` to 6a should auto-withdraw any pending rakit_lock approval for that order_id. Extend cancel path to call `withdraw_rakit_lock` first. |
| `rakit_job_lines` empty when modal opens | Modal shows empty state "Belum ada line item rakit untuk order ini." Submit disabled. |
| Audit log INSERT failure | Per PR #25 precedent: audit-first ordering. INSERT audit_log BEFORE the data mutations. If audit fails, abort entire RPC; no data mutates. |
| Owner Edit & Approve with no actual changes | Detect at RPC level (compare amended_lines hash to existing). If no diff, log as `rakit_lock_approved` (not `_with_edit`) for cleaner audit. |
| Multiple historical rejects on same order | Chip shows most recent reject only. Tooltip says "Sudah direject X kali." Riwayat Persetujuan panel shows full chronological list. |

## Out of scope (deferred or separate work)

- **Owner PIN re-authentication** — deferred. Server role check is sufficient for current threat model.
- **30-minute expiry enforcement** — deferred. Admin can withdraw + resubmit if a request goes stale.
- **WA notification to admin on Owner action** — deferred to Phase 1C Calista wiring.
- **Persetujuan sidebar visibility for non-Owner** — explicitly out of scope (affects 4 other approval types). Decision: keep visible, hide only action buttons within inbox.
- **`verify_owner_pin` security gap** (memory) — separate issue, independent of this work.
- **Auto-expire cron for old approvals** — separate hardening, not blocking.

## Testing approach

### Backend (manual via Supabase MCP `execute_sql` / test order seed)

Per-RPC smoke:

| RPC | Test |
|---|---|
| `request_rakit_lock` (extended) | Seed order at funnel_sub_stage='3f' → call → assert funnel_sub_stage='3g' + 1 row in approval_requests. |
| `commit_approved_rakit_lock` (extended) | Seed approval='approved' → call → assert funnel_sub_stage='3h' + stock_movements present + hpp_final filled. |
| `approve_and_amend_rakit_lock` (new) | Owner caller: success + audit_log entry with diff. Non-Owner caller: error 'OWNER_ONLY'. Amend labor cost from Rp 1.2jt to Rp 1.0jt → assert rakit_job_lines.labor_cost reflects Owner's value. |
| `reject_rakit_lock_to_funnel` (new) | Owner caller: success, funnel_sub_stage='3f', audit_log 'rakit_lock_rejected' with reason. Non-Owner: 'OWNER_ONLY'. |
| `withdraw_rakit_lock` (extended) | Call → assert funnel_sub_stage='3f'. |

Cleanup: delete seed order after each test.

### Frontend (Vitest)

| File | New tests |
|---|---|
| `src/lib/sales/recentRejects.test.ts` (new) | Mock supabase: orderIds map. Cases: no rejects → empty map; reject < 7 days → present; reject > 7 days → absent. |
| `src/lib/sales/queries.test.ts` | Add `fetchRakitLockHistory` cases — 4 events ordered by time, diff_keys for edit event preserved. |
| `src/lib/supabaseClient.test.ts` (or wherever wrappers are tested) | Mock `supabase.rpc` for `approveAndAmendRakitLock` and `rejectRakitLockToFunnel` — assert correct RPC name + param shape; throw on error response. |

Target: +12-15 unit tests; keep "tests up, never down."

### Manual smoke (chrome MCP or browser)

Before merge, validate 5 scenarios in production or up-to-date localhost:

1. Happy path: admin submit at 3f → Owner Approve → row at 3h.
2. Edit & Approve: admin submits Rp 1.2jt labor → Owner edits to Rp 1.0jt → Submit → Daftar Pesanan row at 3h, Invoice Pelunasan PDF reflects Owner's value, Riwayat Persetujuan panel shows diff.
3. Reject: Owner Reject with reason → row back to 3f, chip visible, auto-urgent expansion. Click Selesai again → modal prefilled.
4. Withdraw: admin submits → admin clicks Withdraw at 3g → row back to 3f, approval status='withdrawn' in inbox.
5. Non-Owner: log in as Kasir role → open inbox → Rakit Lock row visible but Approve/Edit&Approve/Reject buttons hidden.

### Regression (no new tests, just smoke)

- Funnel hotfixes #21 + #22 + #25 still work.
- Existing rakit_lock flow via `WipListScreen` (legacy entry) still works — don't break that path.
- Komponen orders at 3a/3b/3c flow untouched.

## Open questions for implementation

None blocking. The following are confirmable during planning:

- Exact field naming for the chip's tooltip date format — use existing date format helper.
- Whether `LockSubmissionModal` needs split into `LockSubmissionForm` + thin wrapper for admin vs owner mode — if the diff is small, prop-mode is enough; if substantial, extract form. Trust the implementer's judgment with TDD.
- Whether `OrderRow` should show the chip inline or push it to a second line on narrow viewports — pick inline first; revisit if it looks crowded in smoke.
