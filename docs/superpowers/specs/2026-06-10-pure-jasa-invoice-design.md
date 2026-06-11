# Pure-Jasa Lunas Invoice (no SKU required)

**Date:** 2026-06-10
**Status:** Approved (brainstorming) — pending spec review
**Owner:** tonywei
**Related:** Session 1 rakit workflow (`progress.md` 2026-06-09), `2026-06-10-session1-debug-checkpoint.md`

## Problem

On `PenjualanBaruScreen` (Catat Penjualan), adding only Jasa Rakit or Jasa Custom Panel lines — without any SKU items — prevents the owner from finishing the sale. Two gates fail in sequence:

1. `PenjualanBaruScreen.tsx:163` validates `cart.length === 0` and toasts "Tambahkan minimal 1 item." That toast fires even when `rakitLines.length > 0`.
2. Past that gate, the `if (hasRakit)` branch at `PenjualanBaruScreen.tsx:183` forces every cart with rakit lines through `insertWipWithRakit` → status `PENDING_LOCK_APPROVAL` → Lock Submission Modal → owner approval inbox. The Lunas/DP invoice cannot print until that loop closes.

For pure-service jobs (the owner quoted a price up front, no SKU components to lock against), the WIP+lock cycle is overhead. The owner wants to bill the service and print the invoice in one click.

## Goals

1. Cart with only Jasa Rakit / Jasa Custom Panel lines saves and prints an invoice directly, same flow as a normal Lunas/DP SKU sale.
2. Service-line HPP is captured at cart time so `kasir_transactions.hpp_total` and laporan margin reflect the cost.
3. Mixed carts (SKU + jasa) keep the existing WIP+lock-approval flow — no regression.

## Non-goals

- Bypass WIP for mixed carts. SKU lines still need component HPP tracking + stock deduction, which the lock flow provides.
- Edit-HPP-after-the-fact UI. Cart-time number is final for a pure-jasa invoice.
- Track inventory for components implicitly consumed by a pure-jasa job. Owner manages those components separately (or uses the existing WIP+lock flow when component-level accuracy matters).
- Touch `LockSubmissionModal`, `ApprovalInboxScreen`, `rakit_lock_requests`, or the rakit_lock approval inbox. Those stay as-is for the mixed-cart flow.

## Design

### User-facing behavior

Two code paths after this change:

| Cart contents | Save behavior |
|---|---|
| Only SKU items | Lunas/DP via `record_kasir_sale` (unchanged) |
| Only Jasa Rakit / Custom Panel lines | **New**: Lunas/DP via `record_kasir_sale`, service lines billed as items with `sku=null` |
| Mixed (SKU + jasa) | WIP via `insertWipWithRakit` (unchanged) |

The amber WIP banner ("Transaksi ini akan masuk status WIP…") at `PenjualanBaruScreen.tsx:369-374` shows only when the mixed-cart branch will fire — i.e., when `cart.length > 0 && rakitLines.length > 0`.

### Cart-time HPP capture

`RakitInlineForm` gains one number input next to "Estimasi Harga":

- **HPP (modal)** — owner-typed cost estimate. Defaults to 0 if blank.

`RakitLine` type gains `hppEstimate: number`. The field flows through to `record_kasir_sale` as `hpp_per_unit` and `hpp_subtotal` on the service line, so `kasir_transactions.hpp_total` includes service-line cost.

### `record_kasir_sale` RPC changes

New migration `20260610000001_record_kasir_sale_service_lines.sql` updates the RPC body (highest existing migration is `20260609000011`, this slot is clear):

- **Aggregation loop (line 132-169)**: skip items where `sku IS NULL`. They don't aggregate, don't call `decrement_stock`, don't call `deduct_stock_fifo`, don't contribute to `v_cost_map`.
- **Re-emit loop (line 172-184)**: when `v_sku IS NULL`, use `hpp_per_unit` and `hpp_subtotal` from the input item verbatim (the cart-supplied values). Add the input `hpp_subtotal` to `v_hpp_total` so totals stay consistent.
- **Input validation**: the check at line 140-141 (`v_agg.sku IS NULL OR v_agg.qty IS NULL OR v_agg.qty <= 0`) is unreachable for service lines after the skip but stays as defense-in-depth for malformed SKU items.

The RPC continues to require at least one item (line 85-87) — a fully empty cart still rejects.

### Frontend code surface

| File | Change |
|---|---|
| `src/types.ts` | `RakitLine.hppEstimate: number` added. |
| `src/components/penjualan/RakitInlineForm.tsx` | Second number input "HPP (modal)" wired to local state, included in `onAdd` payload. |
| `src/components/PenjualanBaruScreen.tsx` | (1) `handleSave` line 163: allow `cart.length === 0` when `rakitLines.length > 0`. (2) Rename `hasRakit` branch trigger to `isMixedCart = hasRakit && cart.length > 0`. (3) Pure-jasa cart (`hasRakit && cart.length === 0`) falls through to the existing `recordSale` path. (4) Build a unified `items[]` for `recordSale`: SKU items as today, service lines as `{sku: null, name: description, qty: 1, unit_price: estimatedPrice, hpp_per_unit: hppEstimate, hpp_subtotal: hppEstimate, warehouse: null, subtotal: estimatedPrice}`. (5) WIP banner gated on `isMixedCart`. |
| `src/components/penjualan/SalesInvoicePDF.tsx` | Line 209: render the `item.sku` div only when `item.sku` is truthy, so service lines don't show an empty subtitle. |

### Data shape — service line in `kasir_transactions.items`

```json
{
  "sku": null,
  "name": "Box Wiring untuk PT XYZ — 1 unit",
  "qty": 1,
  "unit_price": 1500000,
  "subtotal": 1500000,
  "hpp_per_unit": 800000,
  "hpp_subtotal": 800000,
  "warehouse": null
}
```

Existing SKU-line shape is unchanged. The PDF, daily summary (`computeDailySummary` at `supabaseClient.ts:1060+`), and any downstream readers tolerate the new shape because `items` is `jsonb` and they only read fields that exist on both shapes (`qty`, `unit_price`, `subtotal`, `name`).

## Verification

1. **Pure-jasa Lunas** (primary): cart with one Jasa Rakit line, no SKU. Click Simpan & Cetak Invoice Lunas. Expect: kasir_transactions row inserted with status `PAID`, no rakit_lock_requests row, invoice PDF opens with the service description and no SKU subtitle.
2. **Pure-jasa DP**: same as #1 but paymentType=DP. Expect: status `AWAITING_LUNAS`, dp_amount populated.
3. **Mixed cart regression**: cart with one SKU item + one Jasa Rakit line. Click Simpan. Expect: WIP+lock flow runs exactly as today (status `PENDING_LOCK_APPROVAL`, transaction visible in WIP list, lock submission modal works).
4. **HPP propagation**: pure-jasa cart with Estimasi Harga 100k and HPP 30k. After save, `kasir_transactions.hpp_total = 30000` and the service line's `hpp_subtotal = 30000`. Laporan margin reflects 70k laba kotor.
5. **Empty cart still rejects**: no SKU, no jasa lines. Click Simpan. Expect: existing "Tambahkan minimal 1 item" toast.
6. **RPC null-sku unit test**: psql call to `record_kasir_sale` with a single service-line item (`sku: null`). Expect: success, no `decrement_stock` call (verified by absence of `stock_movements` row for that invoice number), `hpp_total` matches input `hpp_subtotal`.

## Migration plan

1. Land the SQL migration locally; verify with the psql test in step 6.
2. Land the frontend changes.
3. `vite build` clean, `tsc --noEmit` clean.
4. Push to main → Cloud Build → Cloud Run.
5. Verify steps 1–5 in chrome-devtools-mcp against the deployed bundle.
6. Update `progress.md` with the change log entry.

## Risks

- **RPC change is the load-bearing piece.** If the skip-null-sku branch is wrong, mixed-cart sales could either double-deduct stock (if service lines are routed through the aggregation by mistake) or skip SKU lines (if the filter is too broad). The psql verification step is the gate.
- **`items` jsonb schema drift.** Service lines introduce `null` and missing `warehouse`. Anything that iterates `items` and assumes a string `sku` will silently degrade. `computeDailySummary`, `SalesInvoicePDF`, and `markLunas` are the known readers — quick scan for other readers needed during implementation.
- **Lump-sum margin signal in laporan.** Service-line HPP is owner-typed, not FIFO-derived. Margin reports will mix "true" HPP (FIFO from stock_lots) with "estimated" HPP (cart-typed). Acceptable for the MSME scale per project context, but worth surfacing in a future "trust" badge if reporting matures.
