# Task 3 Report — `_assert_super_admin_from_jwt` + `update_plan_admin`

**Status:** DONE
**Commit:** 4897223
**Branch:** worktree-phase-b-wave4a
**Migration:** `20261115000012_phase_b_wave4a_update_plan_admin.sql`

## Test Summary

pgTAP: 9 cases in `supabase/tests/wave4a/update_plan_admin.sql`
- Case 1: non-admin → P0403 PLATFORM_ADMIN_REQUIRED
- Case 2: `_assert_super_admin_from_jwt` with unknown sub (NULL role) → P0403 SUPER_ADMIN_REQUIRED
- Case 3: invalid plan_code ENTERPRISE → 22023 INVALID_PLAN_CODE
- Case 4: unknown key `{bogus}` → 22023 UNKNOWN_FIELD
- Cases 5a–5e: happy path (ok=true, plan_code, updated_keys, plan row updated, audit row present, helper lives_ok for founder)

DO-block smoke: 5 cases verified on Garindo prod, rolled back via T0000. PRO description and audit table clean post-rollback.

## Schema Drift Correction

`platform_admin_audit.tenant_id` was `NOT NULL` in live DB — brief assumed nullable. Relaxed to nullable here: `ALTER TABLE ... ALTER COLUMN tenant_id DROP NOT NULL`. `list_audit_events` uses `LEFT JOIN tenants` and `(v_tenant_id IS NULL OR a.tenant_id = v_tenant_id)` — NULL rows handled correctly. RLS policy gates only on `_is_platform_admin_from_jwt()` — no tenant_id filter issue.

## Concerns / Notes

- None blocking. The non-super admin pgTAP case (Case 2) tests via a UUID absent from platform_admins (role = NULL) rather than inserting a row with role='admin', because the `platform_admins.user_id` FK references `auth.users` — a fake UUID cannot be inserted without a matching auth row. The NULL-role path covers the same code branch.
- `updated_keys` array order from `jsonb_object_keys` is non-deterministic; pgTAP Case 5b uses `@>` containment check rather than equality for robustness.
