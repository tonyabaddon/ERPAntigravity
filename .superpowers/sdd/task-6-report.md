# Task 6 Report: deprovision_tenant RPC + Zona Bahaya UI

## MCP Verification Outputs

### FK Cascade Query (all tenants FKs)
- 60+ tables: all `ON DELETE CASCADE` except two blockers:
  - `platform_admin_audit.tenant_id` → `ON DELETE NO ACTION` (condeferrable=false)
  - `tenant_payments.tenant_id` → `ON DELETE RESTRICT`
- Both resolved in migration by ALTER to `ON DELETE SET NULL`

### 4 Delete Targets
All confirmed present: `admin_users`, `store_settings`, `tenant_subscriptions`, `tenant_users`

### DEPROVISION_TENANT in CHECK
Confirmed present in `platform_admin_audit_action_check` (Task 16 pre-requisite landed)

## What Was Built

### Migration: `20261115000035_deprovision_tenant_rpc.sql`
- **FK patches** (Note C/B design decision): `platform_admin_audit` + `tenant_payments` both changed to `ON DELETE SET NULL`
  - Rationale: "insert audit BEFORE cascade" (Note B Option 1) physically works with SET NULL — audit row inserted while tenant FK is valid; after `DELETE FROM tenants`, FK cascade sets `audit.tenant_id = NULL`. Revenue history in `tenant_payments` preserved.
- **RPC** `deprovision_tenant(p_tenant_id UUID, p_reason TEXT) → JSONB`
  - Auth gate: `_is_super_admin_from_jwt()` → P0403 SUPER_ADMIN_REQUIRED
  - Tenant snapshot → audit INSERT (before cascade) → explicit DELETEs → DELETE tenants
  - OWNER TO postgres, SECDEF, GRANT to authenticated

### pgTAP: `supabase/tests/wave6/deprovision_tenant.sql`
6 tests: sales_rep P0403 / unknown UUID P0002 / happy path lives_ok / tenant deleted / subscriptions deleted / audit row shape (tenant_id NULL, snapshot id preserved)

### MCP Smoke (prod, no real tenant touched)
- RPC exists: `owner=postgres`, `security_definer=true` ✓
- FK patches: both `confdeltype='n'` (SET NULL) ✓
- super_admin + fabricated UUID → P0002 ✓
- sales_rep JWT → P0403 ✓

### UI Files
- `DeleteTenantModal.tsx` — confirm-slug + alasan textarea, Hapus Permanen disabled until slug matches exactly, adminToast on success/error
- `DeleteTenantModal.test.tsx` — 9 tests (open/closed, slug gate, submit happy path, error toast, Batal, backdrop)
- `TenantDangerZone.tsx` — red-bordered section, "Hapus Tenant" button triggers modal
- `TenantDetailShell.tsx` modified — imports `isSuperAdmin` + `TenantDangerZone`; useEffect resolves `isSuperAdmin()` into state; mounts `<TenantDangerZone>` at bottom when true; `onDeleted` → `window.location.href = '/admin/tenants'`
- `TenantDetailShell.test.tsx` updated — mock for `adminAuth.isSuperAdmin`; 2 new tests (super_admin shows zone, sales_rep hides zone)
- `adminApi.ts` updated — `deprovisionTenant()` function + P0002 handler in `normalizeRpcError`

## Test Results
- `npx vitest run src/components/admin/TenantDetail/` → **51/51 passed** (no regressions)
- `npx tsc --noEmit` → **clean**

## Commit
See git log.

## Concerns / Deviations from Note B letter
- Note B literally says "insert BEFORE cascade" + keep FK intact — physically impossible with NO ACTION. The advisor confirmed this. Chosen fix: ALTER both problem FKs to SET NULL. This is a deliberate schema change beyond the spec letter; documented here and in migration header.
- No Chrome MCP UI smoke (browser not wired to local dev server in this environment).

## Fix Applied (Post-Review)

Reviewer feedback: remove redundant explicit DELETEs + make FK drops idempotent.

**Removed lines (4-81 before, 71-72 after):**
```sql
-- Before (lines 73–77):
  DELETE FROM public.admin_users         WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_users        WHERE tenant_id = p_tenant_id;
  DELETE FROM public.store_settings      WHERE tenant_id = p_tenant_id;
  DELETE FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
```

All four tables have `ON DELETE CASCADE` FKs; cascade from `DELETE FROM tenants` handles them.

**FK drops now idempotent:**
- Line 19: `DROP CONSTRAINT IF EXISTS platform_admin_audit_tenant_id_fkey`
- Line 24: `DROP CONSTRAINT IF EXISTS tenant_payments_tenant_id_fkey`

**Commit:** `0358dbc` — `fix(rls): remove redundant explicit DELETEs + idempotent FK drops (Task 6)`

Note: Migration 000035 already applied to prod; re-application would fail on constraint-drop step unless IF EXISTS present in source. This fix ensures source is idempotent for future re-deployments.
