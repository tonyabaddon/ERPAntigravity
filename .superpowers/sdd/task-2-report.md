# Task 2 Report — tenant_payments table + RLS + audit CHECK

**Status:** COMPLETE

**Migration:** `supabase/migrations/20261115000021_phase_b_wave5_tenant_payments_table.sql`
**Test:** `supabase/tests/wave5/tenant_payments_table.sql`
**Applied:** Garindo prod `ekhhojaezdfjfwuxyjkl` — `apply_migration` success

## Verifications (all passed)

| Check | Result |
|-------|--------|
| Table `tenant_payments` exists | PASS |
| Index `idx_tenant_payments_tenant_date` | PASS |
| Index `idx_tenant_payments_period` | PASS |
| `relrowsecurity = true` | PASS |
| `relforcerowsecurity = true` | PASS |
| Policy `p_platform_admin_only` on `{authenticated, vosi_rpc_owner}` | PASS |
| Audit CHECK includes all 16 codes (through UPLOAD_PAYMENT_PROOF) | PASS |
| Smoke INSERT (BANK_TRANSFER + BCA, valid row) + RAISE rollback | PASS |

## pgTAP coverage (9 assertions)

1. `has_table` — table exists
2. `has_index` — idx_tenant_payments_tenant_date
3. `has_index` — idx_tenant_payments_period
4. `ok(relrowsecurity)` — RLS enabled
5. `ok(relforcerowsecurity)` — FORCE RLS enabled
6. `has_row_policy` — p_platform_admin_only
7. `ok(constraint LIKE '%RECORD_PAYMENT%')` — audit CHECK includes RECORD_PAYMENT
8. `ok(all 4 Wave 5 codes present)` — RECORD/UPDATE/DELETE/UPLOAD_PAYMENT_PROOF
9. `throws_ok(23514)` — BANK_TRANSFER + NULL bank_name rejects with payment_bank_required CHECK

## Drift corrections

- `audit_id BIGINT` (spec said UUID; platform_admin_audit.id is BIGINT per Wave 1 Task 3)
- Added `set_updated_at` trigger (project convention; not in spec but consistent with all tables carrying `updated_at`)

## Pre-flight checks performed

- `vosi_rpc_owner` role: EXISTS
- `auth.users` cross-schema FK: PERMITTED (kasir_transactions + stock_adjustments both FK to auth.users)
- `platform_admin_audit.id` type: BIGINT confirmed
- Existing audit CHECK codes: 12 (through UPDATE_PLAN) confirmed

## Concerns

None. All schema assumptions verified before writing. Smoke test passed with intended RAISE rollback pattern.
