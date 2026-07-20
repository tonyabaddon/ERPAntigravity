# Task 2 Report — 2D RLS predicate swap (6 WT policies)

## Status: DONE

## Step 1 — 6 broken policies confirmed

Query: `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE (qual ILIKE '%_guard_expiry_write%IS NULL%' OR with_check ILIKE '%_guard_expiry_write%IS NULL%') ORDER BY tablename, policyname;`

Result: **6 rows exactly** (as expected).

| tablename | policyname | cmd | broken predicate location |
|---|---|---|---|
| warehouse_transfer_items | t_delete_own | DELETE | qual: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |
| warehouse_transfer_items | t_insert_own | INSERT | with_check: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |
| warehouse_transfer_items | t_update_own | UPDATE | with_check: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |
| warehouse_transfers | t_delete_own | DELETE | qual: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |
| warehouse_transfers | t_insert_own | INSERT | with_check: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |
| warehouse_transfers | t_update_own | UPDATE | with_check: `((tenant_id = _resolve_tenant_id()) AND (_guard_expiry_write() IS NULL))` |

Note: `t_update_own` on warehouse_transfer_items had broken predicate ONLY in with_check; qual was correct (`tenant_id = _resolve_tenant_id()`).

## Step 2 — _check_expiry_ok() verified

```
returns: boolean
args: (empty)
```

Function exists, returns boolean, takes no arguments. PROCEED.

## Step 3 — Migration file path

`supabase/migrations/20261115000503_rls_fix_guard_expiry_predicate.sql`

Slot 503 confirmed free (502 was last, 504+ untouched).

## Step 5 — Apply output

```
Applying: 20261115000503_rls_fix_guard_expiry_predicate.sql
Project:  ekhhojaezdfjfwuxyjkl

SUCCESS: migration applied to ekhhojaezdfjfwuxyjkl
```

schema_migrations INSERT: `[]` (empty array = success, ON CONFLICT DO NOTHING, no rows returned).

## Step 6 — Regression + smoke results

### Regression (direct verification queries — NOTICE not available via Management API):

| Check | Expected | Actual | Result |
|---|---|---|---|
| `broken_count` (policies still using `_guard_expiry_write() IS NULL`) | 0 | 0 | **PASS** |
| `fixed_count` (WT policies using `_check_expiry_ok()`) | 6 | 6 | **PASS** |

Policy details after migration — all 6 now show `_check_expiry_ok()`:
- `warehouse_transfer_items.t_delete_own`: `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`
- `warehouse_transfer_items.t_insert_own`: with_check `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`
- `warehouse_transfer_items.t_update_own`: qual + with_check both `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`
- `warehouse_transfers.t_delete_own`: `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`
- `warehouse_transfers.t_insert_own`: with_check `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`
- `warehouse_transfers.t_update_own`: qual + with_check both `((tenant_id = _resolve_tenant_id()) AND _check_expiry_ok())`

### Smoke test (direct INSERT into warehouse_transfers as authenticated):

Used tenant `11111111-1111-1111-1111-111111111111` (had 2 warehouses available).

Brief's smoke used incorrect column names (`from_warehouse`, `DRAFT` status) — corrected to actual schema (`from_warehouse_id`, `IN_TRANSIT` status, real FK UUIDs).

Result: `ERROR: P0001: ROLLBACK — smoke complete` — this is the expected outcome. The `RAISE EXCEPTION 'ROLLBACK — smoke complete'` was reached, meaning the INSERT passed RLS check and executed successfully before the intentional rollback. If RLS had blocked, the error would have been `new row violates row-level security policy`.

Cleanup check: `SELECT COUNT(*) FROM warehouse_transfers WHERE doc_no = 'SMOKE-TEST-RLS-503'` → `0` (rollback confirmed clean).

**PASS: direct WT insert succeeded, rolled back cleanly.**

## Step 7 — get_advisors findings (WT-related)

### Security (335 total findings, 6 WT-related):

1. `warehouse_transfer_doc_seq` — `rls_enabled_no_policy` (INFO) — pre-existing, not introduced by this migration. Sequence table; intentional.
2. `cancel_warehouse_transfer` — `authenticated_security_definer_function_executable` (WARN) — intentional SECDEF RPC design.
3. `get_warehouse_transfer_detail` — same WARN — intentional.
4. `initiate_warehouse_transfer` — same WARN — intentional.
5. `list_warehouse_transfers` — same WARN — intentional.
6. `receive_warehouse_transfer` — same WARN — intentional.

**All pre-existing. None introduced by migration 503.**

### Performance (468 total findings, 6 WT-related):

1. `warehouse_transfer_items.warehouse_transfer_items_sku_fkey` — unindexed FK (INFO) — pre-existing.
2. `warehouse_transfers.warehouse_transfers_from_warehouse_id_fkey` — unindexed FK (INFO) — pre-existing.
3. `warehouse_transfers.warehouse_transfers_to_warehouse_id_fkey` — unindexed FK (INFO) — pre-existing.
4. `warehouse_transfers_tenant_status_to` index — unused (INFO) — pre-existing (WT feature newly shipped, stats not yet built).
5. `warehouse_transfer_items_sku` index — unused (INFO) — pre-existing (same reason).
6. `warehouse_transfer_items_transfer` index — unused (INFO) — pre-existing.

**All pre-existing. None introduced by migration 503. Unindexed FKs are candidates for Task 3 (2C perf indexes).**

## Step 8 — Memory correction note

Memory `guard_expiry_write_broken_predicate` states "~100 policies". After this migration, **0 policies remain** with the broken `_guard_expiry_write() IS NULL` predicate. Founder should update memory to reflect completion.

## Commit SHA

`78a02cd` — pushed to origin/main `82f0a03..78a02cd`

## Concerns / Open Items

1. **Smoke test column name discrepancy**: Brief's smoke test used `from_warehouse`, `to_warehouse`, `initiated_by`, `status='DRAFT'` — all incorrect for actual schema. Actual columns are `from_warehouse_id`, `to_warehouse_id`, `sender_user_id`, and valid statuses are `IN_TRANSIT/RECEIVED/PARTIAL/CANCELLED`. Smoke test corrected and passed.

2. **Unindexed FKs on WT tables**: `from_warehouse_id`, `to_warehouse_id`, `sku` FKs have no covering indexes. These are candidates for Task 3 (2C perf indexes) which is the next task.

3. **Unused indexes on WT tables**: 3 indexes flagged as unused. WT feature just shipped so Postgres stats not yet accumulated — these are expected to become used once traffic flows; not actionable now.

4. **NOTICE output not available via Management API**: The regression DO block raises NOTICE messages which are consumed server-side and not returned in API response. Verified equivalent via direct COUNT queries instead. Same pass/fail result.
