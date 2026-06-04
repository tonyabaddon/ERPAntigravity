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

## 5. Out of Scope

- More than 2 payment stages (e.g., 3-installment plans)
- Customer-initiated rejection ("salah foto" keyword) — auto-replace covers this
- DP amount changes after order is confirmed
- Partial payment tracking (e.g., customer pays DP in two transfers)
