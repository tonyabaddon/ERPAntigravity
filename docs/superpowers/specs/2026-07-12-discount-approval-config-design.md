# Discount Approval Workflow + Full Approval Config Exposure — Design

**Status:** Draft (pending user review)
**Author:** Tony Wei + Claude
**Date:** 2026-07-12
**Scope:** Item #4 in the 5-item brainstorm sweep. Bundles a small enhancement to `ApprovalRulesPanel` to expose all `approval_settings` knobs for every request_type (not just discount).

---

## 1. Overview & Goals

### 1.1 Purpose

Add a configurable **approval gate for kasir discounts** so tenants can prevent employee fraud where admin gives unauthorized big discounts to friends/family. Reuse the existing `approval_settings` framework validated in Item #1. Additionally, upgrade `ApprovalRulesPanel` to expose ALL per-gate configuration knobs (currently only threshold_amount + approval_required toggle are exposed).

### 1.2 Goals

1. New `kasir_discount` approval gate configurable per tenant SOP
2. Threshold semantics: invoice-level, Rp AND/OR % (whichever hits first)
3. Verification: APP_INBOX (owner reviews in Persetujuan menu) or PIN inline — tenant chooses
4. Mandatory reason field (fraud audit trail)
5. Full config knobs exposed in Pengaturan for all existing request_types (bundled enhancement)
6. Approval Inbox summary strip showing pending counts per category (bundled enhancement)
7. Zero-impact for tenants who don't opt in (default: `approval_required=false`)

### 1.3 Non-goals

- Per-line discount gating (invoice-level only — 95% real MSME cases)
- WA_BUTTON verification (per memory: PIN + APP_INBOX only)
- Auto-expire on requests (user preference: admin can cancel anytime, no timeout)
- Push notifications requiring PWA setup (defer)
- Historical discount audit backfill (feature is forward-only)
- Threshold at customer-tier level (e.g. VIP gets higher threshold) — future item if needed

---

## 2. Data Model Deltas

### 2.1 Enum extension

```sql
ALTER TYPE approval_request_type ADD VALUE 'kasir_discount';
```

### 2.2 Column additions to `kasir_transactions`

```sql
ALTER TABLE kasir_transactions
  ADD COLUMN discount_approval_request_id BIGINT REFERENCES approval_requests(id),
  ADD COLUMN discount_approval_status TEXT
    CHECK (discount_approval_status IS NULL
        OR discount_approval_status IN ('awaiting','approved','rejected','canceled'));
```

- Nullable — pre-existing sales unaffected.
- `discount_approval_request_id` links to the pending owner-approval request.
- `discount_approval_status` is a shadow of `approval_requests.status` sync'd via the kasir RPCs (avoids the reader having to join for status).

### 2.3 Per-tenant seed of `approval_settings`

Migration seeds `kasir_discount` row for every existing tenant + patches the tenant-provisioning migration:

```sql
INSERT INTO approval_settings (
  tenant_id, request_type, approval_required, verification_method,
  threshold_amount, threshold_percent, threshold_qty,
  approver_role, requestor_bypass_self, reason_required
)
SELECT t.id, 'kasir_discount', false, 'APP_INBOX',
       NULL, NULL, NULL,
       'Owner', false, true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM approval_settings
   WHERE tenant_id = t.id AND request_type = 'kasir_discount'
);
```

**Defaults chosen:**
- `approval_required=false` — opt-in per tenant. No behavior change for existing tenants until they toggle on.
- `verification_method='APP_INBOX'` — matches user preference (fraud prevention > kasir speed).
- Thresholds NULL — tenant fills based on their SOP.
- `reason_required=true` — fraud audit trail is the whole point.
- `requestor_bypass_self=false` — safe default; tenant can toggle on if owner-as-kasir.

### 2.4 CHECK constraint enumeration

Before writing RPCs, enumerate existing CHECK constraints on target tables:
- `kasir_transactions` — verify no constraint conflicts with new nullable columns
- `approval_settings` — no changes to constraints; leverage existing shape
- `approval_requests` — no changes

---

## 3. Backend RPCs

**Convention:** SECURITY DEFINER, owned by `vosi_rpc_owner`. Tenant scope via JWT.

### 3.1 `check_kasir_discount_gate(discount_amount_rp NUMERIC, subtotal_rp NUMERIC) → JSONB`

Read-only gate check. Frontend calls before showing the reason input.

```
Returns:
{
  "gate_triggered": bool,
  "trigger_reason": 'exceeds_amount' | 'exceeds_percent' | 'both' | null,
  "threshold_amount": NUMERIC | null,
  "threshold_percent": NUMERIC | null,
  "approval_required": bool,   -- if false, gate always returns triggered=false
  "verification_method": 'APP_INBOX' | 'PIN' | 'NONE'
}
```

Logic:
```
IF NOT approval_required → return triggered=false
computed_percent = discount_amount_rp / subtotal_rp * 100
trigger = (threshold_amount IS NOT NULL AND discount_amount_rp > threshold_amount)
       OR (threshold_percent IS NOT NULL AND computed_percent > threshold_percent)
```

### 3.2 `request_kasir_discount_approval(sale_draft_id BIGINT, discount_amount_rp NUMERIC, discount_type TEXT, discount_value NUMERIC, subtotal_rp NUMERIC, reason TEXT) → BIGINT`

Creates an approval request when gate is triggered.

- Validate `reason` non-empty (matches `approval_settings.reason_required`)
- Insert `approval_requests` row with `request_type='kasir_discount'`, `payload=jsonb {sale_draft_id, discount, subtotal, reason, admin_user_id, customer_id}`, `expires_at=NULL` (no auto-expire), `status='pending'`
- Set `kasir_transactions.discount_approval_request_id + status='awaiting'` on the sale draft
- Return approval_request_id

### 3.3 `complete_kasir_sale_after_approval(sale_draft_id BIGINT) → JSONB`

Called after owner approves in inbox.

- Verify `kasir_transactions.discount_approval_status='awaiting'` AND linked `approval_requests.status='approved'`
- Call existing `record_kasir_sale` with the pre-set discount → sale committed
- Update `discount_approval_status='approved'`
- Return `{sale_id, journal_id}` from record_kasir_sale

### 3.4 `cancel_kasir_discount_request(sale_draft_id BIGINT) → VOID`

Admin action from kasir UI.

- Guard: caller must be the requesting admin OR owner
- Update `approval_requests.status='canceled'` (via `_transition_approval`)
- Update `kasir_transactions.discount_approval_status='canceled'`
- Clear `discount_amount_rp / discount_type / discount_value` on the draft (admin can now edit)

### 3.5 Existing RPC modifications

**`record_kasir_sale`** — no change to behavior. Existing signature preserved.
- If gate not triggered (`gate_triggered=false` from check), admin submits normally via `record_kasir_sale`.
- If gate triggered, admin submits via `request_kasir_discount_approval` → later `complete_kasir_sale_after_approval` calls existing `record_kasir_sale`.

**`_transition_approval`** — no change. Already handles all state transitions.

---

## 4. Frontend

### 4.1 Kasir wizard `Step3Payment.tsx`

**Trigger logic in DiscountRow onBlur:**
```
onBlur → call check_kasir_discount_gate(discount, subtotal)
  IF gate_triggered:
    show inline warning: "Diskon Rp X (Y%) > ambang threshold. Butuh approval owner."
    show reason textarea (required)
  ELSE:
    normal flow
```

**Submit button behavior:**
- Gate NOT triggered → normal `record_kasir_sale` → sale committed
- Gate triggered → `request_kasir_discount_approval` → UI state changes to:

```
┌── Menunggu Approval Owner ────────────────────────┐
│                                                   │
│  Diskon Rp 200.000 (14% dari Rp 1.400.000)        │
│  Alasan: "Customer loyal 5 tahun"                 │
│                                                   │
│  Owner sudah dinotifikasi.                        │
│  ⏱ Menunggu 0:23 detik                            │
│                                                   │
│  [Batalkan request]                               │
└───────────────────────────────────────────────────┘
```

**Polling:**
- Poll `approval_requests.status` every 5 seconds via a query
- Alternative (chosen): Supabase realtime subscription on `approval_requests` filtered by id — instant update, no polling overhead
- On `status='approved'` → call `complete_kasir_sale_after_approval` → success screen
- On `status='rejected'` → show reject reason, admin can clear discount or cancel sale
- On `status='canceled'` (from admin's own click) → sale returns to editable state

**Browser Notification API** (owner side):
- Request permission on first VOSI login as owner
- Fire `new Notification("Diskon menunggu approval — kasir X", { icon, body })` when a new `kasir_discount` request appears (subscription-based)
- Skip if permission denied — no fallback (owner inbox badge covers it)

### 4.2 Owner Approval Inbox `ApprovalInboxScreen.tsx` enhancement

**Add summary strip at top (bundled):**

```
┌─ Persetujuan Menunggu ─────────────────────────────────────────────────┐
│                                                                        │
│  Total: 8                                                              │
│                                                                        │
│  [Kasir Diskon 3]  [Opname 2]  [Adjustment 1]  [Purchase Return 1]     │
│  [Supplier Claim Resolve 1]                                            │
│                                                                        │
│  ↑ chip horizontal, click filter tab yang sesuai                       │
└────────────────────────────────────────────────────────────────────────┘
```

- Chip layout: horizontal, wrap on small screens
- Number = count of `pending` requests per `request_type`
- Click chip → filter/switch to that tab
- Total badge already exists at sidebar — unchanged

**Kasir Diskon detail row:**

```
┌─ Kasir Diskon — 12 Jul 2026, 09:23 ────────────────────────┐
│                                                            │
│  Admin: Sari (kasir 1)                                     │
│  Customer: PT Sinar Jaya (VIP)                             │
│                                                            │
│  Cart (view-only):                                         │
│    MCB Schneider 16A × 10 = Rp 500.000                     │
│    Kabel NYA 2.5mm × 5   = Rp 100.000                      │
│    Kontaktor 3P × 1      = Rp 800.000                      │
│    ─────────────────────                                   │
│    Subtotal: Rp 1.400.000                                  │
│    Diskon:   Rp 200.000 (14%)  ⚠ > threshold 10%           │
│    Total:    Rp 1.200.000                                  │
│                                                            │
│  Alasan admin: "Customer loyal 5 tahun, orderan bulanan"   │
│                                                            │
│  Catatan owner (opsional): [_______________________]       │
│                                                            │
│  [Tolak]  [Setujui]                                        │
└────────────────────────────────────────────────────────────┘
```

### 4.3 Pengaturan `ApprovalRulesPanel.tsx` full config exposure (bundled)

Currently only `approval_required` toggle + `threshold_amount` input are shown. Upgrade to expose all knobs for every request_type row:

```
┌─ Diskon manual di kasir ─────────────────────────────────┐
│                                                          │
│  ☑ Aktifkan approval owner                               │
│                                                          │
│  Ambang batas approval:                                  │
│    Nominal Rp:  [500.000]      (kosong = tidak dicek)   │
│    Persentase:  [10] %         (kosong = tidak dicek)   │
│    ℹ Approval trigger kalau discount melewati salah satu │
│                                                          │
│  Verifikasi:                                             │
│    ○ Approval Inbox (owner review di menu Persetujuan)  │
│    ● PIN inline    (owner input PIN 6 digit langsung)   │
│                                                          │
│  ☑ Wajib isi alasan diskon                               │
│  ☐ Owner bypass approval untuk sale-nya sendiri          │
│                                                          │
│  Approver role: [Owner ▾]                                │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Same shape applied to all existing rows (opname, adjustment, kasir_price_override, purchase_return, resolve_supplier_claim, etc.) — behavior unchanged (defaults preserve current state).

**Grouping preserved:**
- STOK: opname, adjustment, initial_stock
- KASIR/POS: **kasir_discount** (new), kasir_price_override, kasir_void, kasir_refund
- HARGA & PRODUK: price_change
- PELANGGAN & TEMPO: customer_credit_*, piutang_write_off
- PEMBELIAN: purchase_order_*, tagihan_create, bnl_create, supplier_payment, tukar_faktur, purchase_return, resolve_supplier_claim
- JASA: rakit_lock

**Save flow:**
- Batch update via `upsert_approval_settings(tenant_id, request_type, fields...)` RPC (exists) or new bulk RPC
- Optimistic UI: save on blur per row, show toast confirm

---

## 5. Approval Flow Sequence

```
┌────────────┐   ┌─────────┐   ┌──────────────────┐   ┌───────┐   ┌───────────────┐
│  Admin     │   │ Kasir   │   │ approval_requests│   │ Owner │   │Owner Inbox UI │
│  (Sari)    │   │ Frontend│   │ (DB)             │   │       │   │               │
└─────┬──────┘   └────┬────┘   └────────┬─────────┘   └───┬───┘   └───────┬───────┘
      │               │                 │                 │               │
      │ Fill discount │                 │                 │               │
      ├──────────────>│                 │                 │               │
      │               │ check_kasir_discount_gate         │               │
      │               ├─────────────────>                 │               │
      │               │<─── gate_triggered=true ──────────│               │
      │               │                 │                 │               │
      │               │ Show reason input                 │               │
      │               │<────────────────                  │               │
      │ Type reason   │                                   │               │
      ├──────────────>│                                   │               │
      │ Submit        │                                   │               │
      ├──────────────>│                                   │               │
      │               │ request_kasir_discount_approval   │               │
      │               ├─────────────────>                 │               │
      │               │       INSERT approval_requests    │               │
      │               │       status='pending'            │               │
      │               │<── approval_request_id ───────────│               │
      │               │                                   │               │
      │               │ Show "Menunggu owner..." UI       │               │
      │               │  + realtime subscribe             │               │
      │               │                                   │               │
      │               │              Browser notification ├───(if opted in)>│
      │               │                                   │               │
      │               │                                   │  Open inbox   │
      │               │                                   ├──────────────>│
      │               │                                   │               │
      │               │                                   │  Review detail│
      │               │                                   │<──────────────┤
      │               │                                   │               │
      │               │                                   │  Click Setujui│
      │               │                                   ├──────────────>│
      │               │                                   │               │
      │               │       _transition_approval        │               │
      │               │                 <─────────────────────────────────┤
      │               │       status='approved'           │               │
      │               │                                   │               │
      │               │<─── realtime event: approved ─────│               │
      │               │                                   │               │
      │               │ complete_kasir_sale_after_approval │               │
      │               ├─────────────────>                 │               │
      │               │       record_kasir_sale runs      │               │
      │               │<─── sale_id ──────────────────────│               │
      │               │                                   │               │
      │               │ Success screen                    │               │
      │<──────────────┤                                   │               │
      │               │                                   │               │
```

---

## 6. Testing Strategy

### 6.1 Migration + smoke

- Apply schema migration → verify columns exist, enum value added, seed rows present
- SECDEF rollback-marker smoke test for each new RPC

### 6.2 SQL rollback-marker (5 assertions)

Fake JWT as admin → run through the flow → verify:
1. `check_kasir_discount_gate` returns `gate_triggered=true` when discount > threshold
2. `request_kasir_discount_approval` creates `approval_requests` row + updates `kasir_transactions`
3. `complete_kasir_sale_after_approval` fails if status is not 'approved'
4. Simulate owner approve → `complete_kasir_sale_after_approval` succeeds → sale committed
5. `cancel_kasir_discount_request` transitions status='canceled' + clears discount fields

### 6.3 Chrome UI smoke

- Open kasir → add items with total Rp 1.4jt
- Apply discount Rp 200rb → verify inline warning + reason input
- Submit → verify "Menunggu owner" state
- Open inbox in another session (Owner) → verify Kasir Diskon chip = 1 → click through → verify detail view → approve
- Return to kasir → verify sale auto-completes

### 6.4 Frontend unit tests

- `DiscountRow.test.tsx` — trigger check + show/hide reason field
- `ApprovalInboxScreen.test.tsx` — summary strip renders with counts
- `ApprovalRulesPanel.test.tsx` — full config knobs render + save

---

## 7. Migration Slot Allocation

Item #1 used slots 100-108. Leave 109 as buffer. Item #4 claims **20261115000110 - 20261115000113**:

| Slot | Content |
|---|---|
| 110 | Schema: enum value + kasir_transactions columns + approval_settings seed for kasir_discount + upgrade tenant provisioning script |
| 111 | RPCs: check_kasir_discount_gate, request_kasir_discount_approval, complete_kasir_sale_after_approval, cancel_kasir_discount_request |
| 112 | (Reserved for follow-up RPC extensions if needed) |
| 113 | (Reserved) |

Update project memory `project_migration_slot_allocation.md` after applying.

---

## 8. Edge Cases

| # | Case | Handling |
|---|---|---|
| 1 | Admin cancels request while owner is mid-approving | `_transition_approval` uses SELECT ... FOR UPDATE; first writer wins. Loser gets 'already_transitioned' error → UI refresh shows current status. |
| 2 | Sale has zero subtotal (unusual) | `check_kasir_discount_gate` divide-by-zero guard: if subtotal=0, return `gate_triggered=false` (no meaningful discount possible). |
| 3 | Threshold both NULL AND approval_required=true | Approval always triggers on ANY discount > 0. Documented default = "gate on all discounts". Owner may want this for warung-level control. |
| 4 | Owner bypass = true AND owner is the requester | Gate skipped entirely at `check_kasir_discount_gate` when `requesting_user_id = owner_user_id`. Standard existing pattern. |
| 5 | Owner rejects with note | `_transition_approval(status='rejected', reason)` — reason stored on `approval_requests.decision_notes` (existing column). Admin sees in kasir UI. |
| 6 | Approval_settings row missing for tenant (edge case new tenant) | Fallback: read defaults (approval_required=false). Auto-seed on next admin action. Alternative: hard error. Prefer fallback for smoother onboarding. |
| 7 | Multiple concurrent sales from same admin with pending discount approvals | Each sale draft has its own approval_request_id. Independent. Owner sees each as separate row in inbox. |
| 8 | Owner bypasses threshold via Pengaturan mid-transaction | Kasir UI checks gate on Blur; if setting changed after check but before submit, race condition possible. Mitigation: re-check at submit time on backend (`request_kasir_discount_approval` runs its own gate check + short-circuits if setting changed). |
| 9 | Reason field empty when reason_required=true | Backend rejects with error; frontend prevents submit via validation. |
| 10 | Owner uses PIN inline instead of APP_INBOX (tenant chose PIN) | `check_kasir_discount_gate` returns `verification_method='PIN'`; frontend shows `<OwnerPinPad>` modal instead of "Menunggu owner..." state. Existing pattern from other gates. |

---

## 9. Success Criteria (definition of done)

- [ ] Admin fills discount > threshold → inline warning + reason input appears
- [ ] Submit triggers `request_kasir_discount_approval` → row appears in owner inbox
- [ ] Inbox summary strip shows "Kasir Diskon 1" chip
- [ ] Owner clicks detail → cart, discount, reason all visible
- [ ] Owner approves → sale auto-completes with discount
- [ ] Owner rejects → admin can clear discount + resubmit
- [ ] Admin cancel button works → sale editable again
- [ ] Discount below threshold → no gate, normal flow
- [ ] `approval_required=false` → no gate ever, even for large discount
- [ ] Pengaturan panel exposes all 7 knobs per gate for every existing request_type
- [ ] Owner bypass_self=true skips gate when owner is the kasir
- [ ] Reason field required when reason_required=true (backend + frontend)
- [ ] Chrome UI smoke passes end-to-end

---

## 10. Sequencing with other items

- Item #4 (this spec) — small, high-value fraud prevention
- Item #5 (mid-year P&L opening) — independent
- Item #3 (dashboard vs laporan) — independent
- Item #2 (BOM re-architecture) — biggest, independent

---

## 11. Open Items / Future Work

Explicitly deferred:
1. Per-line discount gating — could add per-line threshold as separate approval_settings row (`kasir_line_discount`) if a tenant asks; not built now
2. Customer-tier discount rules — VIP customer gets higher threshold auto-applied; needs customer segmentation, defer to Item #2 (custom panel) sync
3. Push notifications via PWA — needs service worker + PWA setup, defer
4. Aging report for pending approvals — dashboard card, defer
5. Historical fraud audit — retro analysis of old sales for suspicious discounts, defer (SQL query is fine for now)
