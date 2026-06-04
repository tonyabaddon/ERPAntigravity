---
name: dp-multipayment-design
description: Design spec for DP (downpayment) + full payment flow — admin sets payment type on order confirmation, customer sends up to 2 proof photos via WhatsApp, auto-replace if not yet verified, admin can reject with reason
metadata:
  type: project
---

# DP & Multi-Payment Proof Design Spec

**Date:** 2026-06-05
**Status:** Approved

## Overview

Extend the order payment flow to support two modes: **Full Payment** (existing behavior) and **DP (downpayment)** where admin sets a custom DP amount (by nominal or percentage) at order confirmation. Customer sends payment proof photos via WhatsApp; if a photo is sent before the previous one is verified, it automatically replaces the previous one. Admin can reject a proof with an optional reason, resetting status to waiting and notifying the customer via WhatsApp.

---

## 1. Data Model

### `orders` table — new columns

| Column | Type | Default | Notes |
|---|---|---|---|
| `payment_type` | text | `'FULL'` | `'FULL'` or `'DP'` |
| `dp_input_type` | text | `null` | `'AMOUNT'` or `'PERCENTAGE'` — only set when `payment_type = 'DP'` |
| `dp_value` | numeric | `0` | What admin entered: IDR amount or percentage number (e.g. `30` for 30%) |
| `dp_amount` | numeric | `0` | Always stored in IDR. Computed: if AMOUNT → dp_value; if PERCENTAGE → order total × dp_value / 100 |
| `dp_proof_url` | text | `null` | Supabase Storage URL for DP payment proof |
| `full_proof_url` | text | `null` | Supabase Storage URL for full/final payment proof (rename from `payment_proof_url`) |

> **Migration note:** Rename existing `payment_proof_url` → `full_proof_url`. All existing rows get `payment_type = 'FULL'`, `dp_amount = 0`, `dp_proof_url = null`.

### Status lifecycle

**Full Payment (unchanged, backward compatible):**
```
WAITING_PAYMENT → PAYMENT_UPLOADED → PAYMENT_VERIFIED
                        ↑ admin reject → back to WAITING_PAYMENT
```

**DP:**
```
WAITING_DP → DP_UPLOADED → DP_VERIFIED → WAITING_PAYMENT → PAYMENT_UPLOADED → PAYMENT_VERIFIED
                  ↑ reject                                        ↑ reject
           → WAITING_DP                                    → WAITING_PAYMENT
```

Three new statuses: `WAITING_DP`, `DP_UPLOADED`, `DP_VERIFIED`. After DP is verified, the flow reuses the existing `WAITING_PAYMENT → PAYMENT_UPLOADED → PAYMENT_VERIFIED` statuses.

---

## 2. Admin UI

### Order Confirmation Modal

When admin confirms an order, add payment type selection:

```
Tipe Pembayaran
  ○ Full Payment
  ● DP

Input DP (shown only when DP selected):
  [Nominal ▾] [____________ Rp]
  [Persentase] [____________ %]  →  preview: "= Rp 600.000"
```

- Switching between Nominal/Persentase recalculates the preview in real time using order total
- `dp_amount` stored in IDR always; `dp_input_type` and `dp_value` stored for display reference
- Validation: DP amount must be > 0 and < order total

### Order Detail / History — Payment Proof Section

**FULL orders** (same as current, only column name changes):
```
Bukti Transfer
[foto]  Lihat Ukuran Penuh ↗      [Verifikasi]  [Tolak]
```

**DP orders:**
```
Bukti DP  (Rp 600.000)
[foto]  Lihat Ukuran Penuh ↗      [Verifikasi DP]  [Tolak]    ← visible when status = DP_UPLOADED
                                   ✓ Terverifikasi             ← visible when status ≥ DP_VERIFIED

Bukti Pelunasan  (Rp 1.400.000)
[foto]  Lihat Ukuran Penuh ↗      [Verifikasi]  [Tolak]       ← visible when status = PAYMENT_UPLOADED
[Menunggu bukti pelunasan]                                     ← visible when status = WAITING_PAYMENT
```

### Reject Modal

Clicking Tolak opens a small modal:
- Label: "Alasan penolakan (opsional)"
- Text input
- Buttons: Batal · Tolak & Notifikasi Customer

On confirm:
- Status resets to `WAITING_DP` (if rejecting DP proof) or `WAITING_PAYMENT` (if rejecting full proof)
- `dp_proof_url` or `full_proof_url` set to `null`
- Bot sends rejection message to customer via WhatsApp

---

## 3. WhatsApp Bot Flow

### On order confirmation by admin

Bot sends automatic message to customer:

- **FULL:** *"Order kamu sudah dikonfirmasi! Silakan transfer Rp {total} ke rekening kami dan kirim foto bukti transfernya di sini."*
- **DP:** *"Order kamu sudah dikonfirmasi! Silakan transfer DP sebesar Rp {dp_amount} ({dp_value}% dari total) ke rekening kami dan kirim foto bukti transfernya di sini."*

### Photo message handling (by status)

| Order status when photo received | Action | New status |
|---|---|---|
| `WAITING_DP` | Save photo → `dp_proof_url` | `DP_UPLOADED` |
| `DP_UPLOADED` | Replace `dp_proof_url` (auto, no admin action needed) | `DP_UPLOADED` |
| `WAITING_PAYMENT` | Save photo → `full_proof_url` | `PAYMENT_UPLOADED` |
| `PAYMENT_UPLOADED` | Replace `full_proof_url` (auto) | `PAYMENT_UPLOADED` |
| `DP_VERIFIED` | Same as `WAITING_PAYMENT` — save as full proof | `PAYMENT_UPLOADED` |
| `PAYMENT_VERIFIED` | Ignored — order already complete | — |

Auto-reply on successful photo receipt: *"Bukti transfer sudah kami terima 🙏 Tim kami akan memverifikasi segera."*

Auto-reply on upload failure: *"Mohon maaf, foto bukti transfer gagal kami terima. Tolong kirim ulang."* (order status unchanged)

### On admin verify DP (`DP_VERIFIED`)

Bot sends: *"DP kamu sudah terverifikasi ✅ Silakan lunasi sisa Rp {remaining} dan kirim bukti transfernya."*

Where `remaining = order total − dp_amount`.

### On admin reject

Bot sends: *"Bukti transfer kamu ditolak{reason}. Tolong kirim ulang foto yang benar."*

Where `{reason}` = `" — {alasan}"` if reason was provided, empty string if not.

---

## 4. Backend / Handler Changes

### `handler.go` — payment proof routing

Replace current single-status check (`WAITING_PAYMENT`) with:

```go
switch order.Status {
case "WAITING_DP", "DP_UPLOADED":
    // upload → save to dp_proof_url → set status DP_UPLOADED
case "WAITING_PAYMENT", "PAYMENT_UPLOADED", "DP_VERIFIED":
    // upload → save to full_proof_url → set status PAYMENT_UPLOADED
}
```

### DB methods needed

- `UpdateDPProof(orderID, proofURL string) error` — sets `dp_proof_url`, status → `DP_UPLOADED`
- Existing `UpdatePaymentProof` — update to write to `full_proof_url` column (rename)
- `RejectDPProof(orderID, reason string) error` — clears `dp_proof_url`, status → `WAITING_DP`
- `RejectFullProof(orderID, reason string) error` — clears `full_proof_url`, status → `WAITING_PAYMENT`
- `VerifyDPPayment(orderID string) error` — sets status → `DP_VERIFIED`, triggers bot notification

### Notification trigger

When admin calls VerifyDPPayment or RejectProof, backend sends WhatsApp message to customer using existing sender infrastructure.

---

## 5. Supabase Migration

One migration file: `supabase/migrations/YYYYMMDD_dp_payment.sql`

```sql
-- 1. Rename existing column
ALTER TABLE orders RENAME COLUMN payment_proof_url TO full_proof_url;

-- 2. Add new columns
ALTER TABLE orders
  ADD COLUMN payment_type     text    NOT NULL DEFAULT 'FULL',
  ADD COLUMN dp_input_type    text,
  ADD COLUMN dp_value         numeric NOT NULL DEFAULT 0,
  ADD COLUMN dp_amount        numeric NOT NULL DEFAULT 0,
  ADD COLUMN dp_proof_url     text;

-- 3. Backfill existing rows (all are FULL payment)
UPDATE orders SET payment_type = 'FULL' WHERE payment_type IS NULL OR payment_type = '';

-- 4. Add check constraint
ALTER TABLE orders ADD CONSTRAINT chk_payment_type CHECK (payment_type IN ('FULL', 'DP'));
ALTER TABLE orders ADD CONSTRAINT chk_dp_input_type CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT', 'PERCENTAGE'));
```

No RLS changes needed — existing anon/authenticated policies on `orders` already cover the new columns.

---

## 6. Frontend Changes

### `src/types.ts`

Add new status values to `OrderStatus` union type:
```typescript
| 'WAITING_DP'
| 'DP_UPLOADED'
| 'DP_VERIFIED'
```

Add new fields to `Order` / `DbOrder` type:
```typescript
payment_type?: 'FULL' | 'DP';
dp_input_type?: 'AMOUNT' | 'PERCENTAGE';
dp_value?: number;
dp_amount?: number;
dp_proof_url?: string | null;
full_proof_url?: string | null;  // replaces payment_proof_url
```

### `src/lib/supabaseClient.ts`

**Status label/color maps** — add three new entries:
```typescript
WAITING_DP:   { label: '⏳ Menunggu DP',     className: 'bg-yellow-100 text-yellow-800' },
DP_UPLOADED:  { label: '📎 Bukti DP Dikirim', className: 'bg-indigo-100 text-indigo-800' },
DP_VERIFIED:  { label: '✓ DP Lunas',          className: 'bg-teal-100 text-teal-800' },
```

**Tab filters** — extend tab `'uploaded'` to include `DP_UPLOADED`, tab `'waiting'` to include `WAITING_DP`.

**`handleApprove` service call** — add `payment_type`, `dp_input_type`, `dp_value`, `dp_amount` to the PATCH payload.

**New service functions:**
- `verifyDPPayment(orderId: string)` — PATCH status → `DP_VERIFIED`, triggers backend notification
- `rejectDPProof(orderId: string, reason: string)` — PATCH status → `WAITING_DP`, dp_proof_url → null
- `rejectFullProof(orderId: string, reason: string)` — PATCH status → `WAITING_PAYMENT`, full_proof_url → null (existing `handleRejectPayment` extended with reason)

### `src/components/OrderHistoryScreen.tsx`

**`PENDING_ADMIN_CONFIRMATION` expand panel** — add payment type selector below shipping fee:
```
[Tetapkan Ongkir]   [Tipe Pembayaran]
Rp [______]         ○ Full Payment
                    ● DP
                      [Nominal ▾] [_____ Rp]
                      [Persentase] [_____ %] → = Rp 600.000
```

`handleApprove` extended to pass `payment_type`, `dp_input_type`, `dp_value`, `dp_amount`.

**New `DP_UPLOADED` expand panel** — mirror of `PAYMENT_UPLOADED` panel but for DP proof:
- Shows `dp_proof_url` photo (or placeholder)
- "Verifikasi DP" button → calls `verifyDPPayment`
- "Tolak" button → opens `RejectProofModal` → calls `rejectDPProof`

**`PAYMENT_UPLOADED` expand panel** — extended for DP orders:
- If `payment_type === 'DP'`: show read-only DP proof section (already verified) above full proof section
- Full proof section unchanged (verify + reject buttons)

**`DP_VERIFIED` expand panel** — waiting state, no photo action yet:
- Shows DP verified badge + dp_amount
- Shows "Menunggu bukti pelunasan dari customer" placeholder

**New `RejectProofModal` component** — small modal with:
- Title: "Tolak Bukti Transfer"
- Optional reason text input
- Buttons: Batal · Tolak & Notifikasi

**Status badge/color maps** — add `WAITING_DP`, `DP_UPLOADED`, `DP_VERIFIED` entries.

**Left border accent** — add `DP_UPLOADED: 'border-l-4 border-l-indigo-500'`.

**Tab counts** — `uploadedCount` includes `DP_UPLOADED`; `waitingCount` includes `WAITING_DP`.

---

## 7. Backend (Go) Changes

### `internal/whatsapp/handler.go`

Replace single `WAITING_PAYMENT` check with a switch:

```go
switch order.Status {
case "WAITING_DP", "DP_UPLOADED":
    // upload photo → db.UpdateDPProof(order.ID, proofURL) → status DP_UPLOADED
case "WAITING_PAYMENT", "PAYMENT_UPLOADED", "DP_VERIFIED":
    // upload photo → db.UpdatePaymentProof(order.ID, proofURL) → status PAYMENT_UPLOADED
    // (UpdatePaymentProof now writes to full_proof_url column)
default:
    // ignore photo (order already complete or not in payment flow)
}
```

Auto-replace behavior is implicit: both `UpdateDPProof` and `UpdatePaymentProof` overwrite the URL column unconditionally.

### `internal/db/` — new/updated DB methods

- `UpdateDPProof(orderID, proofURL string) error` — UPDATE orders SET dp_proof_url = $1, status = 'DP_UPLOADED' WHERE id = $2
- `UpdatePaymentProof` — update SQL to write to `full_proof_url` (column rename)
- `VerifyDPPayment(orderID string) error` — UPDATE status → `DP_VERIFIED`; then send WA notification "DP terverifikasi, silakan lunasi sisa Rp X"
- `RejectProof(orderID, proofColumn, resetStatus, reason string) error` — clears the specified proof URL column, sets status to resetStatus, sends WA notification with reason

### Bot notification on order confirmation

When admin approves order (`PENDING_ADMIN_CONFIRMATION` → `WAITING_PAYMENT` or `WAITING_DP`), backend sends automatic WA message. This requires a webhook or polling trigger — admin approve action on frontend calls a backend endpoint or Supabase function that dispatches the message.

> **Implementation note:** Simplest approach — frontend calls a new `/notify-order-confirmed` endpoint on the Go daemon after patching the order status. Daemon sends the WA message using existing sender infrastructure.

---

## 8. Out of Scope

- More than 2 payment stages (e.g., 3-installment plans)
- Customer-initiated rejection ("salah foto" keyword) — auto-replace covers this
- DP amount changes after order is confirmed
- Partial payment tracking (e.g., customer pays DP in two transfers)
