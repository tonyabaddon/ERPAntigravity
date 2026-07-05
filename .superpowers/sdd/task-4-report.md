## Task 4 — record_payment + update_payment + delete_payment RPCs (COMPLETE)

- Migration: `supabase/migrations/20261115000023_phase_b_wave5_payment_write_rpcs.sql`
- Tests: `supabase/tests/wave5/record_payment.sql` (12 assertions) + `supabase/tests/wave5/update_delete_payment.sql` (18 assertions)
- Applied to Garindo prod (`ekhhojaezdfjfwuxyjkl`).

### Verified via MCP

All 3 functions — owner=postgres, is_secdef=true, authenticated_execute=true, search_path=public, pg_catalog.

**Smoke test end-to-end (live, not rolled back):**

1. `record_payment` — BANK_TRANSFER + BCA + 1,000,000 IDR → returned `coverage_status=OVERDUE`, `coverage_ok=false`, `amount_paid_ytd=1000000` ✓  
   (1M / 9M PREMIUM = 11.1% < 30% threshold → OVERDUE, matches spec §15.5)
2. `update_payment` — changed amount to 3,000,000 → returned `{ok:true, updated_keys:["amount"]}`. DB row confirmed amount=3000000.00 ✓
3. `delete_payment` — reason='smoke-test cleanup' → returned `{ok:true}`. Row gone from tenant_payments. ✓
4. Audit trail: RECORD_PAYMENT=1, UPDATE_PAYMENT=1, DELETE_PAYMENT=1 each with correct detail shape ✓
5. DELETE_PAYMENT audit has full snapshot including `id`, `amount`, `payment_method` ✓

**Validation checks (22023):** UNKNOWN_FIELD, INVALID_AMOUNT (0 and negative), INVALID_PERIOD (period_to < period_from), REASON_REQUIRED (empty string) — all raised correctly ✓

**P0403 checks:** record_payment, update_payment, delete_payment all block non-admin JWT ✓

### Schema drift notes

- `tenant_subscriptions` has no `status` column — coverage formula uses `expires_at >= CURRENT_DATE` for "active" check (not needed for OVERDUE logic; threshold math is purely amount-based)
- `plans.price_annual` NULL case handled gracefully → coverage_ok=false, coverage_status='UNKNOWN'
- `proof_object_key` payload key correctly maps to `proof_url` column in both record_payment and update_payment

### Coverage formula implemented (§15.5)

| Status  | Condition |
|---------|-----------|
| LUNAS   | amount_paid_ytd >= price_annual |
| DP_60   | >= 0.6 × price_annual AND < price_annual |
| DP_30   | >= 0.3 × price_annual AND < 0.6 × price_annual |
| OVERDUE | > 0 AND < 0.3 × price_annual |
| UNPAID  | = 0 |
| UNKNOWN | price_annual IS NULL |
