# Multi-Tier Pricing — Garindo No-Regression Smoke

**Date:** 2026-06-24  
**DB project:** `ekhhojaezdfjfwuxyjkl` (ERP MSME AI Studio, ap-northeast-1)  
**modul_multi_tier_price at time of smoke:** `false` (Garindo default)  
**Method:** DO blocks with `RAISE EXCEPTION 'smoke rollback'` at end (zero side-effects)

---

## Fixtures used

| Field | Value |
|---|---|
| Product SKU | `55b947c5` (Panel Besi Indoor 60×40×20cm, price=850000, price_grosir=null) |
| Stock available | 24 units in warehouse `27c8f45f-00eb-47d3-a47b-70d532e01843` |
| Kasir customer | None (anonymous walk-in) |
| Tempo customer | `GJP-CUST-SMOKE-TP` (allows_tempo=true, term_days=14, credit_limit=5000000) |

---

## Smoke 1 — `record_kasir_sale` without `pricing_tier_used`

**Intent:** Verify existing kasir path still works when modul is OFF and no tier field is sent.

**Input (key fields):**
```json
{
  "channel": "walkin",
  "items": [{"sku":"55b947c5","qty":1,"unit_price":850000,"master_price_at_sale":850000}],
  "payment_method": "cash",
  "payment_type": "FULL"
}
```

**Expected:** RPC succeeds, returns kasir_transaction row with non-null `id`. DO block hits `RAISE EXCEPTION 'smoke rollback'` (not null-result branch).

**Observed:** `ERROR: P0001: smoke rollback` — PASS

---

## Smoke 2 — `create_tempo_invoice` without `pricing_tier_used`

**Intent:** Verify existing tempo path still works when modul is OFF and no tier field is sent.

**Input (key fields):**
```json
{
  "customer_id": "GJP-CUST-SMOKE-TP",
  "items": [{"sku":"55b947c5","qty":1,"unit_price":850000,"master_price_at_sale":850000}]
}
```

**Expected:** RPC succeeds, returns UUID. DO block hits `RAISE EXCEPTION 'smoke rollback'`.

**Observed:** `ERROR: P0001: smoke rollback` — PASS

---

## Smoke 3 — `record_kasir_sale` WITH `pricing_tier_used='grosir'` (modul OFF)

**Intent:** Verify that passing `pricing_tier_used` in an item when modul is OFF does NOT trigger any validation error — field is silently ignored.

**Input (key fields):**
```json
{
  "channel": "walkin",
  "items": [{"sku":"55b947c5","qty":1,"unit_price":850000,"master_price_at_sale":850000,"pricing_tier_used":"grosir"}],
  "payment_method": "cash",
  "payment_type": "FULL"
}
```

**Expected:** RPC succeeds (tier guard block only fires when `v_tier_modul_on = true`). DO block hits `RAISE EXCEPTION 'smoke rollback'`.

**Observed:** `ERROR: P0001: smoke rollback` — PASS

---

## Smoke 4 — `create_tempo_invoice` WITH `pricing_tier_used='grosir'` (modul OFF)

**Intent:** Verify that passing `pricing_tier_used` in a tempo invoice item when modul is OFF does NOT trigger any validation error.

**Input (key fields):**
```json
{
  "customer_id": "GJP-CUST-SMOKE-TP",
  "items": [{"sku":"55b947c5","qty":1,"unit_price":850000,"master_price_at_sale":850000,"pricing_tier_used":"grosir"}]
}
```

**Expected:** RPC succeeds. DO block hits `RAISE EXCEPTION 'smoke rollback'`.

**Observed:** `ERROR: P0001: smoke rollback` — PASS

---

## Summary

| # | Scenario | Expected | Observed | Result |
|---|---|---|---|---|
| 1 | kasir_sale, no tier field, modul OFF | smoke rollback (success) | smoke rollback | PASS |
| 2 | tempo_invoice, no tier field, modul OFF | smoke rollback (success) | smoke rollback | PASS |
| 3 | kasir_sale, tier=grosir, modul OFF | smoke rollback (tier silently ignored) | smoke rollback | PASS |
| 4 | tempo_invoice, tier=grosir, modul OFF | smoke rollback (tier silently ignored) | smoke rollback | PASS |

**4/4 PASS** — Garindo no-regression confirmed. Existing kasir + tempo paths are unaffected by multi-tier pricing feature when `modul_multi_tier_price=false`.
