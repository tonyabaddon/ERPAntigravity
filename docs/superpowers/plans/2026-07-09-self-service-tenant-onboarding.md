# Self-Service Tenant Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sales rep bisa jual, onboard tenant baru, kirim payment instruction ke customer, dan validasi payment sampai LUNAS — semua via VOSI admin, tanpa lewat founder / BE support. Founder tetap kontrol destructive actions (delete tenant, suspend, renew) + verify payment daily batch.

**Architecture:** Additive ke Waves 1 + 4a + 5. Foundation: new enum `platform_admins.role` (super_admin | sales_rep) + status column + JWT claim `platform_admin_role`. New Edge Function wraps `auth.admin.inviteUserByEmail` + calls existing `provision_tenant`. New RPCs for sales rep lifecycle (create/deactivate), tenant destructive (deprovision), module toggle (update_tenant_feature_override), and payment verification (verify_payment, reject_payment). Two-step payment workflow: rep records `PENDING_VERIFICATION`, founder approves `VERIFIED` — only VERIFIED count for LUNAS. Payment view rewritten to filter by status. Extended audit_log capture provisions/plan changes/module toggles/payments/rep lifecycle. Plan reads open to both roles; direct writes narrow to super_admin (sales_rep goes through SECDEF RPCs).

**Tech Stack:** Same as Wave 5 — React 19 + TypeScript + Vite + Tailwind CSS v4 + custom urlRoute.ts router + Vitest + Supabase (Postgres + Auth + RPC + Storage) + sonner + Supabase Edge Functions (Deno TypeScript). One new dep: `@supabase/supabase-js` service_role client inside Edge Function (uses existing SUPABASE_SERVICE_ROLE_KEY secret).

**Not in scope (per spec §Deferred):** multi-rep operational tooling (per-rep pipeline filter, tenant reassignment, per-rep dashboard), tenant list search + pagination, bulk operations, custom SMTP for invite email deliverability, anomaly detection dashboard, reset owner credentials RPC. Founded on "1 rep dulu" assumption — foundation scales without migration rewrite.

## Global Constraints

Every task inherits these. Reviewers reject work that violates them.

- **Migration slot range:** `20261115000032–20261115000040` (9 slots reserved; Wave 5 used 000020–000031).
- **Every SECDEF RPC platform_admin gate:** `IF NOT public._is_platform_admin_from_jwt() THEN RAISE EXCEPTION USING errcode='P0403', message='PLATFORM_ADMIN_REQUIRED'; END IF;`. **Super_admin narrower gate:** `IF NOT public._is_super_admin_from_jwt() THEN RAISE EXCEPTION USING errcode='P0403', message='SUPER_ADMIN_REQUIRED'; END IF;`.
- **RPC ownership pattern (from Wave 5):** any SECDEF RPC that calls `auth.uid()` or SELECTs from `platform_admins` MUST be owned by `postgres` (vosi_rpc_owner can't USAGE the auth schema). Pure reads OK as vosi_rpc_owner.
- **Unknown filter key** in any RPC payload: raise `errcode='22023'`.
- **Whitelist enforcement** on all UPDATE-style payloads.
- **Bahasa Indonesia** for ALL user-facing copy. Reviewers reject English labels.
- **VOSI Design System v1.0** — `bg-vosi-*`, `text-vosi-*`, `font-vosi` tokens. Navy dominant, one gold focal per screen/modal.
- **Font size floor:** 11px minimum.
- **Data fetching:** `useEffect + async` (no react-query). Loading = skeleton in VOSI palette. Error = sonner error toast + inline retry.
- **Custom router:** `src/lib/urlRoute.ts`. New routes extend inline regex dispatch in `AdminRoutes.tsx`.
- **Test files:** `.test.tsx` co-located. No `any` types. Full suite: no NEW failures.
- **Toast wrapper:** `adminToast` from `src/lib/adminToast.ts`. Never `sonner.toast` directly.
- **Error mapping:** extend `src/lib/adminApi.ts`'s `normalizeRpcError` for new SQLSTATEs.
- **Garindo tenant regression:** must continue rendering normally at end of each frontend task.
- **No writes to prod from tests** — pgTAP rolls back; smoke tests use `DO`-block + RAISE-abort.
- **Extended audit_log INSERT** in every sensitive RPC per spec §C6.
- **Deploy sequence** (per spec): migration → auth hook → force JWT refresh → frontend → edge function. Any change to auth hook validated as founder retains super_admin after JWT refresh.

## Migration ordering

Wave 6 migrations MUST apply in slot order:

- `20261115000032` — `platform_admins.role` + `status` columns + `_is_super_admin_from_jwt()` helper + backward-compat auth hook update.
- `20261115000033` — RLS updates: tenants/tenant_subscriptions UPDATE/DELETE narrow to super_admin; plans SELECT open to both roles.
- `20261115000034` — Narrow existing RPC gates: `suspend_tenant`, `activate_tenant`, `renew_subscription` → super_admin only.
- `20261115000035` — `deprovision_tenant(p_tenant_id UUID, p_reason TEXT)` RPC (super_admin).
- `20261115000036` — `create_sales_rep`, `deactivate_sales_rep` RPCs (super_admin).
- `20261115000037` — `platform_settings` table + seed row + RLS.
- `20261115000038` — `update_tenant_feature_override(p_tenant_id, p_module_key, p_enabled, p_reason)` RPC (both roles).
- `20261115000039` — `tenant_payments` verification workflow: status column + `verify_payment` + `reject_payment` RPCs + updated `record_payment` (proof + anomaly check) + updated `v_tenant_payment_coverage`.
- `20261115000040` — Extended audit_log INSERT in `provision_tenant`, `update_plan_admin`, `record_payment` (append event with anomaly flag), plus `TOGGLE_MODULE`, `VERIFY_PAYMENT`, `REJECT_PAYMENT`, `CREATE_SALES_REP`, `DEACTIVATE_SALES_REP`, `DEPROVISION_TENANT` in the RPC bodies themselves. This slot exists as a coordinated bundle; each RPC's audit call is added during its own defining migration above and this slot is a NO-OP unless we discovered gaps in an earlier migration.

**Audit CHECK constraint update** happens in slot 000040 as a single `ALTER TABLE audit_log` extending the allowed `event_type` enum values.

---

## File Structure

**Backend (SQL migrations):**
- `supabase/migrations/20261115000032_sales_rep_role_and_status.sql`
- `supabase/migrations/20261115000033_rls_role_gates.sql`
- `supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql`
- `supabase/migrations/20261115000035_deprovision_tenant_rpc.sql`
- `supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql`
- `supabase/migrations/20261115000037_platform_settings_table.sql`
- `supabase/migrations/20261115000038_update_tenant_feature_override_rpc.sql`
- `supabase/migrations/20261115000039_payment_verification_workflow.sql`
- `supabase/migrations/20261115000040_audit_event_type_extension.sql`

**Backend (Edge Function):**
- `supabase/functions/create-tenant-owner/index.ts` — invite + provision + rollback
- `supabase/functions/create-tenant-owner/blocklist.ts` — reserved slugs constant
- `supabase/functions/create-tenant-owner/deno.json` — Deno config
- `supabase/functions/create-tenant-owner/index.test.ts` — Deno unit tests

**Backend (pgTAP tests, co-located per project convention):**
- `supabase/tests/wave6/sales_rep_role_column.sql`
- `supabase/tests/wave6/is_super_admin_helper.sql`
- `supabase/tests/wave6/rls_role_gates.sql`
- `supabase/tests/wave6/narrow_rpc_gates.sql`
- `supabase/tests/wave6/deprovision_tenant.sql`
- `supabase/tests/wave6/sales_rep_lifecycle.sql`
- `supabase/tests/wave6/platform_settings.sql`
- `supabase/tests/wave6/update_tenant_feature_override.sql`
- `supabase/tests/wave6/payment_verification.sql`
- `supabase/tests/wave6/audit_event_types.sql`

**Frontend (new files):**
- `src/lib/adminAuth.ts` — MODIFY existing `isSuperAdmin()` to read `platform_admin_role` JWT claim
- `src/lib/salesRepsApi.ts` — typed wrappers for create/deactivate/list sales reps
- `src/lib/platformSettingsApi.ts` — typed wrappers for platform_settings
- `src/lib/paymentVerificationApi.ts` — typed wrappers for verify_payment + reject_payment + pending list
- `src/components/admin/SalesRepsList.tsx` — `/admin/sales-reps` orchestrator
- `src/components/admin/SalesRepCreateModal.tsx` — form: email + name
- `src/components/admin/SalesRepDeactivateModal.tsx` — confirm + reason
- `src/components/admin/PlatformSettings.tsx` — `/admin/settings/payment` route
- `src/components/admin/TenantDetail/DeleteTenantModal.tsx` — confirm-slug pattern
- `src/components/admin/TenantDetail/TenantDangerZone.tsx` — section with Delete button (super_admin only)
- `src/components/admin/TenantDetail/ModuleTogglePanel.tsx` — module on/off matrix for a tenant
- `src/components/admin/PendingPaymentsQueue.tsx` — `/admin/payments/pending` orchestrator
- `src/components/admin/PendingPaymentRow.tsx` — single-row approve/reject action
- `src/components/admin/PaymentInstructionBlock.tsx` — copy-pasteable message in wizard result
- `src/components/admin/TenantWizard.tsx` — MODIFY existing wizard (call Edge Function; ResultStep integrates PaymentInstructionBlock)
- `src/components/admin/AdminLayout.tsx` — MODIFY sidebar for role-based filter + pending badge
- `src/components/admin/AdminRoutes.tsx` — MODIFY to add 3 new routes

**Frontend (co-located tests):**
- `src/lib/adminAuth.test.ts`
- `src/lib/salesRepsApi.test.ts`
- `src/lib/paymentVerificationApi.test.ts`
- `src/components/admin/SalesRepsList.test.tsx`
- `src/components/admin/PlatformSettings.test.tsx`
- `src/components/admin/TenantDetail/DeleteTenantModal.test.tsx`
- `src/components/admin/TenantDetail/ModuleTogglePanel.test.tsx`
- `src/components/admin/PendingPaymentsQueue.test.tsx`
- `src/components/admin/PaymentInstructionBlock.test.tsx`
- `src/components/admin/TenantWizard.test.tsx` (extends existing)

**Deno tests:**
- `supabase/functions/create-tenant-owner/index.test.ts`

---

## Task Dependencies

```
Task 1 (Sales Rep role + auth hook)
  ├─→ Task 2 (RLS + narrowed RPC gates)
  │     ├─→ Task 3 (Frontend isSuperAdmin + sidebar filter)
  │     ├─→ Task 4 (create/deactivate rep RPCs)
  │     │     └─→ Task 5 (SalesRepsList UI)
  │     ├─→ Task 6 (deprovision_tenant RPC + UI)
  │     ├─→ Task 7 (Plans read policy + UI toggle)
  │     ├─→ Task 8 (platform_settings + UI)
  │     ├─→ Task 9 (Edge Function create-tenant-owner)
  │     │     └─→ Task 10 (Wizard integrate Edge Function + PaymentInstructionBlock)
  │     ├─→ Task 11 (update_tenant_feature_override RPC + UI)
  │     ├─→ Task 12 (Payment verification schema)
  │     │     ├─→ Task 13 (record_payment update + fraud checks)
  │     │     └─→ Task 14 (verify + reject RPCs)
  │     │           └─→ Task 15 (PendingPaymentsQueue UI + sidebar badge)
  │     └─→ Task 16 (audit event type CHECK extension)
  └─→ Task 17 (Full E2E smoke test + Garindo regression)
```

Tasks 3-15 can be worked in parallel by subagents once Tasks 1+2 land.

---

## Task 1: Sales Rep role + status + auth hook

**Files:**
- Create: `supabase/migrations/20261115000032_sales_rep_role_and_status.sql`
- Create: `supabase/tests/wave6/sales_rep_role_column.sql`
- Create: `supabase/tests/wave6/is_super_admin_helper.sql`

**Interfaces:**
- Consumes: existing `platform_admins` table; existing `custom_access_token_hook` function
- Produces:
  - `platform_admins.role` TEXT NOT NULL DEFAULT 'super_admin' CHECK IN ('super_admin', 'sales_rep')
  - `platform_admins.status` TEXT NOT NULL DEFAULT 'active' CHECK IN ('active', 'disabled')
  - `platform_admins.name` TEXT (add if missing — for display in SalesRepsList)
  - `_is_super_admin_from_jwt()` boolean helper, SECDEF STABLE, GRANT to authenticated + vosi_rpc_owner
  - Modified `custom_access_token_hook` — adds `platform_admin_role` claim to JWT when caller is active platform_admin

- [ ] **Step 1: Write pgTAP test for column presence + default**

```sql
-- supabase/tests/wave6/sales_rep_role_column.sql
BEGIN;
SELECT plan(6);

SELECT has_column('public', 'platform_admins', 'role');
SELECT col_type_is('public', 'platform_admins', 'role', 'text');
SELECT col_not_null('public', 'platform_admins', 'role');
SELECT col_default_is('public', 'platform_admins', 'role', 'super_admin');

SELECT has_column('public', 'platform_admins', 'status');
SELECT col_default_is('public', 'platform_admins', 'status', 'active');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Write pgTAP test for `_is_super_admin_from_jwt()` semantics**

```sql
-- supabase/tests/wave6/is_super_admin_helper.sql
BEGIN;
SELECT plan(3);

-- Simulate JWT with super_admin claim
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"aaaa","platform_admin_role":"super_admin","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), true, 'super_admin claim → true');

-- sales_rep claim → false
SET LOCAL request.jwt.claims = '{"sub":"bbbb","platform_admin_role":"sales_rep","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), false, 'sales_rep claim → false');

-- missing claim → false (backward compat safe: no lockout)
SET LOCAL request.jwt.claims = '{"sub":"cccc","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), false, 'missing claim → false');

SELECT finish();
ROLLBACK;
```

- [ ] **Step 3: Run tests to verify failing**

```bash
supabase db reset
supabase test db supabase/tests/wave6/sales_rep_role_column.sql
supabase test db supabase/tests/wave6/is_super_admin_helper.sql
# Expected: FAIL — column/helper doesn't exist yet
```

- [ ] **Step 4: Write migration**

```sql
-- supabase/migrations/20261115000032_sales_rep_role_and_status.sql
BEGIN;

ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin'
    CHECK (role IN ('super_admin', 'sales_rep')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS name TEXT;

-- Backward compat: all existing platform_admins default to super_admin + active.

-- NEW helper: strict super_admin check via JWT claim
CREATE OR REPLACE FUNCTION public._is_super_admin_from_jwt()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'platform_admin_role') = 'super_admin',
    false
  );
$function$;

ALTER FUNCTION public._is_super_admin_from_jwt() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._is_super_admin_from_jwt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_super_admin_from_jwt() TO authenticated, vosi_rpc_owner;

COMMENT ON FUNCTION public._is_super_admin_from_jwt() IS
  'Reads platform_admin_role JWT claim (super_admin | sales_rep) — returns true only if super_admin. Missing claim = false (safe default).';

-- Update custom_access_token_hook to expose platform_admin_role claim.
-- The existing hook computes is_platform_admin + tenant_id claims; extend
-- to add platform_admin_role when caller is an ACTIVE platform_admin.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := (event->'user_id')::uuid;
  v_claims jsonb := COALESCE(event->'claims', '{}'::jsonb);
  v_role TEXT;
  v_status TEXT;
BEGIN
  -- Existing logic (tenant_id + is_platform_admin) preserved.
  -- Fetch role + status only if the user is a platform_admin.
  SELECT pa.role, pa.status INTO v_role, v_status
  FROM public.platform_admins pa
  WHERE pa.user_id = v_user_id;

  IF v_role IS NOT NULL AND v_status = 'active' THEN
    v_claims := v_claims || jsonb_build_object(
      'is_platform_admin', true,
      'platform_admin_role', v_role
    );
  END IF;

  -- Preserve tenant_id claim path from existing hook.
  -- (Full function body includes the tenant_users lookup — copy verbatim
  -- from existing definition and append the role claim setup above.)

  event := jsonb_set(event, '{claims}', v_claims);
  RETURN event;
END;
$function$;

COMMIT;
```

**⚠️ IMPORTANT:** Before deploying, read the existing `custom_access_token_hook` body from prod (`SELECT pg_get_functiondef('public.custom_access_token_hook'::regproc)`) and merge the platform_admin_role claim into the existing tenant_id claim logic — do NOT wipe existing claim assignments.

- [ ] **Step 5: Apply migration + rerun tests**

```bash
supabase db reset
supabase test db supabase/tests/wave6/sales_rep_role_column.sql
supabase test db supabase/tests/wave6/is_super_admin_helper.sql
# Expected: PASS all 9 assertions
```

- [ ] **Step 6: Smoke test against prod database via MCP**

```sql
-- Verify migration applied to prod
SELECT column_name, column_default 
FROM information_schema.columns
WHERE table_schema='public' AND table_name='platform_admins' 
  AND column_name IN ('role', 'status', 'name');

-- Verify existing platform_admins auto-set to super_admin + active
SELECT count(*), count(*) FILTER (WHERE role='super_admin' AND status='active') FROM platform_admins;
-- Expected: both counts equal
```

- [ ] **Step 7: Force JWT refresh (deploy sequence checkpoint)**

Sign out founder, sign back in → verify `platform_admin_role: 'super_admin'` claim present in new JWT via DevTools decode.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261115000032_sales_rep_role_and_status.sql \
        supabase/tests/wave6/sales_rep_role_column.sql \
        supabase/tests/wave6/is_super_admin_helper.sql
git commit -m "feat(rls): sales_rep role + status columns + _is_super_admin_from_jwt helper

- Add platform_admins.role (super_admin|sales_rep, default super_admin)
- Add platform_admins.status (active|disabled, default active)
- Add platform_admins.name for display
- New _is_super_admin_from_jwt() helper (SECDEF, checks JWT claim)
- Update custom_access_token_hook to expose platform_admin_role claim
- Backward compat: existing platform_admins auto-upgraded to super_admin

Wave 6 Task 1. Foundation for sales rep autonomy per spec."
```

---

## Task 2: RLS + narrowed RPC gates

**Files:**
- Create: `supabase/migrations/20261115000033_rls_role_gates.sql`
- Create: `supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql`
- Create: `supabase/tests/wave6/rls_role_gates.sql`
- Create: `supabase/tests/wave6/narrow_rpc_gates.sql`

**Interfaces:**
- Consumes: `_is_super_admin_from_jwt()` (Task 1)
- Produces:
  - `tenants` UPDATE/DELETE → super_admin only (SELECT/INSERT unchanged)
  - `tenant_subscriptions` UPDATE/DELETE → super_admin only
  - `plans` SELECT → both roles (write unchanged super_admin only)
  - `suspend_tenant`, `activate_tenant`, `renew_subscription` RPCs → super_admin only

- [ ] **Step 1: Write pgTAP test — sales_rep blocked from tenant UPDATE**

```sql
-- supabase/tests/wave6/rls_role_gates.sql
BEGIN;
SELECT plan(4);

-- Simulate sales_rep JWT
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';

-- sales_rep can SELECT tenants
SELECT lives_ok(
  $$SELECT 1 FROM public.tenants LIMIT 1$$,
  'sales_rep can SELECT tenants'
);

-- sales_rep CANNOT UPDATE tenants (blocked by RLS)
SELECT throws_ok(
  $$UPDATE public.tenants SET name = 'hack' WHERE slug = 'garindo'$$,
  '42501',
  'new row violates row-level security policy for table "tenants"',
  'sales_rep blocked from direct UPDATE tenants'
);

-- sales_rep CAN SELECT plans
SELECT lives_ok(
  $$SELECT 1 FROM public.plans LIMIT 1$$,
  'sales_rep can SELECT plans'
);

-- Now super_admin
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';
SELECT lives_ok(
  $$UPDATE public.tenants SET updated_at = now() WHERE slug = 'garindo'$$,
  'super_admin can UPDATE tenants'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Write pgTAP test — sales_rep blocked from suspend_tenant/renew/activate**

```sql
-- supabase/tests/wave6/narrow_rpc_gates.sql
BEGIN;
SELECT plan(3);

SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';

-- Assume there's an active tenant to target
INSERT INTO public.tenants (id, slug, name, status)
  VALUES ('99999999-9999-9999-9999-999999999999'::uuid, 'test-narrow', 'Test', 'ACTIVE')
  ON CONFLICT DO NOTHING;

SELECT throws_ok(
  $$SELECT public.suspend_tenant('99999999-9999-9999-9999-999999999999'::uuid, 'test')$$,
  'P0403',
  NULL,
  'sales_rep blocked from suspend_tenant'
);

SELECT throws_ok(
  $$SELECT public.activate_tenant('99999999-9999-9999-9999-999999999999'::uuid)$$,
  'P0403',
  NULL,
  'sales_rep blocked from activate_tenant'
);

SELECT throws_ok(
  $$SELECT public.renew_subscription('{"p_tenant_id":"99999999-9999-9999-9999-999999999999","p_new_expires_at":"2027-01-01"}'::jsonb)$$,
  'P0403',
  NULL,
  'sales_rep blocked from renew_subscription'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 3: Write migration 000033 (RLS updates)**

```sql
-- supabase/migrations/20261115000033_rls_role_gates.sql
BEGIN;

-- tenants: split existing p_platform_admin_only policy into SELECT vs write
DROP POLICY IF EXISTS p_platform_admin_only ON public.tenants;

CREATE POLICY p_platform_admin_select ON public.tenants
  FOR SELECT
  USING (public._is_platform_admin_from_jwt());

CREATE POLICY p_super_admin_write ON public.tenants
  FOR INSERT
  WITH CHECK (public._is_super_admin_from_jwt());

CREATE POLICY p_super_admin_update ON public.tenants
  FOR UPDATE
  USING (public._is_super_admin_from_jwt())
  WITH CHECK (public._is_super_admin_from_jwt());

CREATE POLICY p_super_admin_delete ON public.tenants
  FOR DELETE
  USING (public._is_super_admin_from_jwt());

-- tenant_subscriptions: same pattern
DROP POLICY IF EXISTS p_platform_admin_only ON public.tenant_subscriptions;
CREATE POLICY p_platform_admin_select ON public.tenant_subscriptions
  FOR SELECT USING (public._is_platform_admin_from_jwt());
CREATE POLICY p_super_admin_write ON public.tenant_subscriptions
  FOR INSERT WITH CHECK (public._is_super_admin_from_jwt());
CREATE POLICY p_super_admin_update ON public.tenant_subscriptions
  FOR UPDATE USING (public._is_super_admin_from_jwt())
  WITH CHECK (public._is_super_admin_from_jwt());
CREATE POLICY p_super_admin_delete ON public.tenant_subscriptions
  FOR DELETE USING (public._is_super_admin_from_jwt());

-- plans: open SELECT to both roles (write already super_admin)
DROP POLICY IF EXISTS g_read_all ON public.plans;
CREATE POLICY g_read_all ON public.plans
  FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (public._is_platform_admin_from_jwt());

COMMIT;
```

- [ ] **Step 4: Write migration 000034 (narrowed RPC gates)**

```sql
-- supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql
BEGIN;

-- Read each existing RPC body via pg_get_functiondef and inline-edit the
-- gate. Below shows only the gate diff — full body preserved.

-- suspend_tenant: change from _is_platform_admin_from_jwt to _is_super_admin_from_jwt
-- ... existing body ...
-- IF NOT public._is_super_admin_from_jwt() THEN
--   RAISE EXCEPTION 'suspend_tenant: super_admin required' USING errcode='P0403';
-- END IF;
-- ... rest preserved ...

-- activate_tenant: same replacement pattern
-- renew_subscription: same replacement pattern

-- Fetch each existing function body, apply the ONE gate line change, and
-- CREATE OR REPLACE. Do NOT introduce other changes.

COMMIT;
```

**⚠️ Prior to writing 000034:** run `SELECT pg_get_functiondef('public.suspend_tenant(uuid,text)'::regproc)` etc. to capture the current body verbatim, then modify only the auth-gate line. Preserving parameter types and existing logic is critical — the wizard/RenewSubscriptionModal callers rely on unchanged signatures.

- [ ] **Step 5: Apply migrations + run tests**

```bash
supabase db reset
supabase test db supabase/tests/wave6/rls_role_gates.sql
supabase test db supabase/tests/wave6/narrow_rpc_gates.sql
# Expected: all PASS
```

- [ ] **Step 6: Smoke on prod**

Via MCP `execute_sql`, simulate sales_rep JWT and confirm suspend_tenant + renew_subscription raise P0403.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261115000033_rls_role_gates.sql \
        supabase/migrations/20261115000034_narrow_rpc_gates_to_super.sql \
        supabase/tests/wave6/rls_role_gates.sql \
        supabase/tests/wave6/narrow_rpc_gates.sql
git commit -m "feat(rls): narrow tenant writes + suspend/activate/renew to super_admin

- Split tenants/tenant_subscriptions RLS: SELECT open to both roles, write super only
- Open plans SELECT to both roles (rep needs to quote pricing)
- Narrow suspend_tenant/activate_tenant/renew_subscription RPC gates to super_admin

Wave 6 Task 2. Sales rep can view but not destructively modify tenant state."
```

---

## Task 3: Frontend isSuperAdmin helper + sidebar role filter

**Files:**
- Modify: `src/lib/adminAuth.ts` — extend `isSuperAdmin()` to read `platform_admin_role` JWT claim
- Modify: `src/components/admin/AdminLayout.tsx` — sidebar filter (hide `/admin/plans` + `/admin/revenue` + `/admin/sales-reps` + `/admin/settings/payment` for sales_rep)
- Create: `src/lib/adminAuth.test.ts` — unit test for claim reading

**Interfaces:**
- Consumes: JWT `platform_admin_role` claim (Task 1)
- Produces:
  - `isSuperAdmin(): boolean` — reads decoded JWT via `supabase.auth.getSession()` synchronously (cached in AuthContext or session-scoped)
  - `isSalesRep(): boolean` — inverse
  - Sidebar routes filtered: sales_rep only sees Beranda, Tenant, Log aktivitas, Bantuan (Paket/Pendapatan/SalesReps/PaymentSettings hidden)

- [ ] **Step 1: Write test for `isSuperAdmin()` claim behavior**

```typescript
// src/lib/adminAuth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isSuperAdmin, isSalesRep } from './adminAuth';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

function mockClaim(role: string | null): void {
  const payload = role ? { platform_admin_role: role } : {};
  const encoded = btoa(JSON.stringify(payload));
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: `hdr.${encoded}.sig` } as any },
    error: null,
  });
}

describe('isSuperAdmin', () => {
  it('returns true when JWT platform_admin_role=super_admin', async () => {
    mockClaim('super_admin');
    expect(await isSuperAdmin()).toBe(true);
  });

  it('returns false when platform_admin_role=sales_rep', async () => {
    mockClaim('sales_rep');
    expect(await isSuperAdmin()).toBe(false);
  });

  it('returns false when claim missing', async () => {
    mockClaim(null);
    expect(await isSuperAdmin()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
npx vitest run src/lib/adminAuth.test.ts
# FAIL — helper doesn't read the new claim yet
```

- [ ] **Step 3: Update `src/lib/adminAuth.ts`**

```typescript
// src/lib/adminAuth.ts
import { supabase } from './supabaseClient';

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    if (!payload) return {};
    return JSON.parse(atob(payload));
  } catch {
    return {};
  }
}

export async function isSuperAdmin(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;
  const claims = decodeJwtPayload(session.access_token);
  return claims['platform_admin_role'] === 'super_admin';
}

export async function isSalesRep(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;
  const claims = decodeJwtPayload(session.access_token);
  return claims['platform_admin_role'] === 'sales_rep';
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/lib/adminAuth.test.ts
# Expected: PASS
```

- [ ] **Step 5: Update `AdminLayout.tsx` sidebar**

Read current sidebar nav config. Add `superAdminOnly: true` marker on `/admin/plans`, `/admin/revenue`, `/admin/sales-reps`, `/admin/settings/payment` entries. Filter render loop:

```typescript
const [superAdmin, setSuperAdmin] = useState(false);
useEffect(() => { isSuperAdmin().then(setSuperAdmin); }, []);

const visibleNavItems = NAV_ITEMS.filter(item => 
  !item.superAdminOnly || superAdmin
);
```

- [ ] **Step 6: Smoke via Chrome MCP**

Sign in as super_admin (tonywei) → sidebar shows all items. Log in as sales_rep (via SQL: `UPDATE platform_admins SET role='sales_rep' WHERE email='test@example.com'` + fresh JWT) → sidebar hides restricted routes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/adminAuth.ts src/lib/adminAuth.test.ts src/components/admin/AdminLayout.tsx
git commit -m "feat(admin): sidebar filter by role via platform_admin_role JWT claim

- isSuperAdmin() reads JWT platform_admin_role claim
- isSalesRep() inverse
- AdminLayout hides plans/revenue/sales-reps/payment-settings for sales_rep
- Backward compat: missing claim → not super (safe default)

Wave 6 Task 3."
```

---

## Task 4: create_sales_rep + deactivate_sales_rep RPCs

**Files:**
- Create: `supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql`
- Create: `supabase/tests/wave6/sales_rep_lifecycle.sql`

**Interfaces:**
- Consumes: `_is_super_admin_from_jwt()` (Task 1); existing `platform_admins` schema (Task 1)
- Produces:
  - `create_sales_rep(p_user_id UUID, p_email TEXT, p_name TEXT) → JSONB` — super_admin only. Inserts into `platform_admins` with `role='sales_rep', status='active'`. Assumes auth.users row already exists (Edge Function will create it).
  - `deactivate_sales_rep(p_user_id UUID, p_reason TEXT) → JSONB` — super_admin only. Sets `status='disabled'`. Existing JWT still valid until expiry (~1h).
  - Both emit `CREATE_SALES_REP` / `DEACTIVATE_SALES_REP` audit_log events.

- [ ] **Step 1: Write pgTAP test**

```sql
-- supabase/tests/wave6/sales_rep_lifecycle.sql
BEGIN;
SELECT plan(4);

SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';

-- Pre-seed a fake auth.users
INSERT INTO auth.users (id, email, aud, role, instance_id, confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token, phone_change, phone_change_token)
VALUES ('55555555-5555-5555-5555-555555555555', 'rep@test.com', 'authenticated', 'authenticated',
        '00000000-0000-0000-0000-000000000000', '', '', '', '', '', '', '', '')
ON CONFLICT DO NOTHING;

-- create_sales_rep should insert row
SELECT lives_ok(
  $$SELECT public.create_sales_rep('55555555-5555-5555-5555-555555555555'::uuid, 'rep@test.com', 'Test Rep')$$,
  'create_sales_rep succeeds for super_admin'
);

SELECT results_eq(
  $$SELECT role, status FROM public.platform_admins WHERE user_id='55555555-5555-5555-5555-555555555555'$$,
  $$VALUES ('sales_rep', 'active')$$,
  'row inserted with sales_rep/active'
);

-- Sales rep tries create — should fail
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","is_platform_admin":true,"platform_admin_role":"sales_rep"}';
SELECT throws_ok(
  $$SELECT public.create_sales_rep('66666666-6666-6666-6666-666666666666'::uuid, 'x@x.com', 'X')$$,
  'P0403',
  NULL,
  'sales_rep cannot create another rep'
);

-- Super deactivates
SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","is_platform_admin":true,"platform_admin_role":"super_admin"}';
SELECT lives_ok(
  $$SELECT public.deactivate_sales_rep('55555555-5555-5555-5555-555555555555'::uuid, 'resigned')$$,
  'deactivate_sales_rep succeeds'
);

SELECT finish();
ROLLBACK;
```

- [ ] **Step 2: Write migration**

```sql
-- supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.create_sales_rep(
  p_user_id UUID,
  p_email TEXT,
  p_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION 'create_sales_rep: super_admin required' USING errcode = 'P0403';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required' USING errcode = '22023';
  END IF;
  IF p_email IS NULL OR p_email !~ '^[^ ]+@[^ ]+\.[^ ]+$' THEN
    RAISE EXCEPTION 'invalid email format' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'auth.users % not found — create via Edge Function first', p_user_id USING errcode = 'P0002';
  END IF;

  INSERT INTO public.platform_admins (user_id, role, status, name)
  VALUES (p_user_id, 'sales_rep', 'active', p_name)
  ON CONFLICT (user_id) DO UPDATE SET
    role = 'sales_rep',
    status = 'active',
    name = EXCLUDED.name;

  INSERT INTO public.audit_log (event_type, payload, created_at)
  VALUES ('CREATE_SALES_REP',
          jsonb_build_object('user_id', p_user_id, 'email', p_email, 'name', p_name, 'actor_user_id', auth.uid()),
          now());

  RETURN jsonb_build_object('user_id', p_user_id, 'email', p_email, 'name', p_name);
END;
$function$;

ALTER FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.deactivate_sales_rep(
  p_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION 'deactivate_sales_rep: super_admin required' USING errcode = 'P0403';
  END IF;

  UPDATE public.platform_admins
  SET status = 'disabled'
  WHERE user_id = p_user_id AND role = 'sales_rep';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_rep % not found', p_user_id USING errcode = 'P0002';
  END IF;

  INSERT INTO public.audit_log (event_type, payload, created_at)
  VALUES ('DEACTIVATE_SALES_REP',
          jsonb_build_object('user_id', p_user_id, 'reason', p_reason, 'actor_user_id', auth.uid()),
          now());

  RETURN jsonb_build_object('user_id', p_user_id, 'status', 'disabled');
END;
$function$;

ALTER FUNCTION public.deactivate_sales_rep(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deactivate_sales_rep(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_sales_rep(UUID, TEXT) TO authenticated;

COMMIT;
```

- [ ] **Step 3: Test + apply + smoke**

Standard pgTAP + MCP smoke: create fake auth.users → call RPC as super_admin → verify row inserted → check audit_log.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql \
        supabase/tests/wave6/sales_rep_lifecycle.sql
git commit -m "feat(rls): create_sales_rep + deactivate_sales_rep RPCs (super_admin only)

- create_sales_rep: assumes auth.users pre-exists (Edge Function creates it)
- deactivate_sales_rep: sets status='disabled', preserves audit trail
- Both emit CREATE_SALES_REP / DEACTIVATE_SALES_REP audit_log events

Wave 6 Task 4."
```

---

## Task 5: `/admin/sales-reps` UI (list + create + deactivate)

**Files:**
- Create: `src/lib/salesRepsApi.ts` (+ `.test.ts`)
- Create: `src/components/admin/SalesRepsList.tsx` (+ `.test.tsx`)
- Create: `src/components/admin/SalesRepCreateModal.tsx`
- Create: `src/components/admin/SalesRepDeactivateModal.tsx`
- Modify: `src/components/admin/AdminRoutes.tsx` — add `/admin/sales-reps` route
- Modify: `src/components/admin/AdminLayout.tsx` — add sidebar item "Sales Reps" (super_admin only)

**Interfaces:**
- Consumes: `create_sales_rep` + `deactivate_sales_rep` RPCs (Task 4). Edge Function `invite-sales-rep` (deferred — for now, super_admin creates auth.users manually via Supabase Dashboard, pastes UUID into form)
- Produces:
  - `salesRepsApi.list()` → `SalesRep[]`
  - `salesRepsApi.create(userId, email, name)` → `SalesRep`
  - `salesRepsApi.deactivate(userId, reason)` → void
  - Route `/admin/sales-reps` renders list; new SalesRepsList page

- [ ] **Step 1: Write typed API wrappers**

```typescript
// src/lib/salesRepsApi.ts
import { supabase } from './supabaseClient';
import { normalizeRpcError } from './adminApi';

export interface SalesRep {
  user_id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'sales_rep';
  status: 'active' | 'disabled';
  created_at: string;
}

export const salesRepsApi = {
  async list(): Promise<SalesRep[]> {
    const { data, error } = await supabase
      .from('platform_admins')
      .select('user_id, email, name, role, status, created_at')
      .eq('role', 'sales_rep')
      .order('created_at', { ascending: false });
    if (error) throw normalizeRpcError(error);
    return (data ?? []) as SalesRep[];
  },
  async create(userId: string, email: string, name: string): Promise<SalesRep> {
    const { data, error } = await supabase.rpc('create_sales_rep', {
      p_user_id: userId, p_email: email, p_name: name,
    });
    if (error) throw normalizeRpcError(error);
    return { user_id: userId, email, name, role: 'sales_rep', status: 'active', created_at: new Date().toISOString() };
  },
  async deactivate(userId: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('deactivate_sales_rep', {
      p_user_id: userId, p_reason: reason,
    });
    if (error) throw normalizeRpcError(error);
  },
};
```

- [ ] **Step 2: Write SalesRepsList component + tests**

Follow Wave 5 `TenantsList.tsx` pattern for VOSI Design System tokens + table structure. Each row: name / email / status badge / "Nonaktifkan" button (opens `SalesRepDeactivateModal`). Top-right "Tambah Sales Rep" button opens `SalesRepCreateModal`.

- [ ] **Step 3: Wire route + sidebar item**

- [ ] **Step 4: Smoke test on staging tenant**

Create test sales_rep via SQL → verify listed in UI → deactivate via modal → verify status change.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(admin): /admin/sales-reps UI (list + create + deactivate)

- SalesRepsList orchestrator using existing TenantsList pattern
- SalesRepCreateModal: user_id (UUID paste) + email + name form
- SalesRepDeactivateModal: reason field + confirm
- salesRepsApi.ts typed wrappers around create_sales_rep + deactivate_sales_rep RPCs
- Route gated to super_admin via AdminLayout sidebar filter

Wave 6 Task 5."
```

---

## Task 6: deprovision_tenant RPC + Zona Bahaya UI

**Files:**
- Create: `supabase/migrations/20261115000035_deprovision_tenant_rpc.sql`
- Create: `supabase/tests/wave6/deprovision_tenant.sql`
- Create: `src/components/admin/TenantDetail/TenantDangerZone.tsx`
- Create: `src/components/admin/TenantDetail/DeleteTenantModal.tsx` (+ `.test.tsx`)
- Modify: `src/components/admin/TenantDetail/TenantDetailShell.tsx` — mount TenantDangerZone at bottom when super_admin

**Interfaces:**
- Consumes: `_is_super_admin_from_jwt()` (Task 1)
- Produces:
  - `deprovision_tenant(p_tenant_id UUID, p_reason TEXT) → JSONB` — super_admin only. Deletes: admin_users → tenant_users → store_settings → tenant_subscriptions → tenants. Keeps auth.users. Emits DEPROVISION_TENANT audit_log.
  - UI: modal with confirm-slug (Vercel pattern) + reason textarea

- [ ] **Step 1: Write pgTAP test — auth gate + happy path**

Refer to spec §C3 for full RPC body. Test super_admin succeeds, sales_rep fails P0403, deleted counts match (5 tables to 0).

- [ ] **Step 2: Write migration + apply**

Full RPC body verbatim from spec §C3. `ALTER FUNCTION ... OWNER TO postgres` since it references `auth.uid()`.

- [ ] **Step 3: Frontend — DeleteTenantModal**

Confirm-slug pattern: text input that must match `tenant.slug` exactly to enable submit. Reason textarea required. adminToast on success/error.

- [ ] **Step 4: Frontend — TenantDangerZone**

Render at bottom of TenantDetailShell, conditional on `isSuperAdmin()`. Section heading "Zona Bahaya" red styled, Delete button with description "Ini akan hapus semua data tenant permanen."

- [ ] **Step 5: Chrome MCP smoke on test tenant**

Onboard `test-delete-me` → super_admin opens detail → click Delete → confirm slug → verify tenant gone from list + audit_log entry present.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(admin): deprovision_tenant RPC + Zona Bahaya UI (super_admin only)

- New RPC: deletes 5 tenant tables atomically, preserves auth.users
- TenantDangerZone section in TenantDetailShell (super_admin conditional)
- DeleteTenantModal: confirm-slug pattern + reason
- Emits DEPROVISION_TENANT audit_log with snapshot

Wave 6 Task 6."
```

---

## Task 7: Plans read policy verification + UI toggle

**Files:**
- Modify: `src/components/admin/PlansManagement.tsx` — add `readOnly` prop; when `!isSuperAdmin()`, hide Edit/Create buttons

**Interfaces:**
- Consumes: RLS updates from Task 2 (plans SELECT already allowed both roles)
- Produces: PlansManagement respects role — read-only display for sales_rep

- [ ] **Step 1: Add role check to PlansManagement**

```typescript
const [readOnly, setReadOnly] = useState(false);
useEffect(() => { isSuperAdmin().then(v => setReadOnly(!v)); }, []);

// Hide Edit / Create buttons when readOnly
{!readOnly && <button>Edit</button>}
```

- [ ] **Step 2: Update AdminLayout sidebar**

Remove `superAdminOnly` marker from `/admin/plans` (both roles see it now). Sales_rep sees read-only.

- [ ] **Step 3: Smoke via Chrome MCP**

sales_rep → sees /admin/plans → prices visible → no Edit buttons.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(admin): PlansManagement read-only mode for sales_rep

- Sales rep sees pricing (needed to quote customer) but cannot edit
- Remove superAdminOnly marker on /admin/plans nav item
- Edit/Create buttons hidden via role check

Wave 6 Task 7."
```

---

## Task 8: platform_settings + Payment Settings UI

**Files:**
- Create: `supabase/migrations/20261115000037_platform_settings_table.sql`
- Create: `supabase/tests/wave6/platform_settings.sql`
- Create: `src/lib/platformSettingsApi.ts`
- Create: `src/components/admin/PlatformSettings.tsx` (+ `.test.tsx`)
- Modify: `src/components/admin/AdminRoutes.tsx` — add `/admin/settings/payment` route
- Modify: `src/components/admin/AdminLayout.tsx` — add sidebar item (super_admin only)

**Interfaces:**
- Consumes: `_is_super_admin_from_jwt()` (Task 1)
- Produces:
  - `platform_settings` singleton table (id=1 CHECK): bank_name, bank_account_no, bank_account_name, admin_wa_number
  - `platformSettingsApi.get() → PlatformSettings`
  - `platformSettingsApi.update(patch) → PlatformSettings` (super_admin only via RLS)

- [ ] **Step 1: Write migration**

Per spec §C8 — singleton table with CHECK (id=1), RLS super_admin write / platform_admin read.

- [ ] **Step 2: Write pgTAP test**

Verify super_admin can UPDATE, sales_rep cannot; both can SELECT.

- [ ] **Step 3: API wrapper + UI**

Simple form (super_admin route): 4 text inputs, Save button. Sonner toast on success.

- [ ] **Step 4: Smoke via Chrome MCP**

super_admin sets bank info → saves → refresh page → values persist.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(admin): platform_settings singleton + /admin/settings/payment UI

- New singleton table for VOSI bank/WA info (used by wizard result screen)
- RLS: super_admin write, both roles read
- Simple 4-field form UI (super_admin route)

Wave 6 Task 8."
```

---

## Task 9: Edge Function `create-tenant-owner`

**Files:**
- Create: `supabase/functions/create-tenant-owner/index.ts`
- Create: `supabase/functions/create-tenant-owner/blocklist.ts`
- Create: `supabase/functions/create-tenant-owner/deno.json`
- Create: `supabase/functions/create-tenant-owner/index.test.ts`

**Interfaces:**
- Consumes: Supabase Auth Admin API (via service_role); existing `provision_tenant` RPC (Wave 5)
- Produces:
  - HTTP endpoint `POST /functions/v1/create-tenant-owner`
  - Input: `{ slug, name, plan_code, expires_in_months, owner_email, owner_name }`
  - Output: `{ tenant_id, slug, owner_user_id, expires_at }` or `{ error, code, message }`
  - Compensating rollback: deletes auth.users if provision_tenant fails
  - Slug validation: format regex + blocklist

- [ ] **Step 1: Write blocklist constant**

```typescript
// supabase/functions/create-tenant-owner/blocklist.ts
export const RESERVED_SLUGS = [
  'admin', 't', 'select-tenant',
  'api', 'auth', 'login', 'register',
  'signup', 'signin', 'settings',
];

export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,29}$/;
```

- [ ] **Step 2: Write Edge Function**

Follow spec §C1 pseudocode. Structure:
1. Parse Authorization header → verify caller platform_admin_role via `sb.rpc('_is_platform_admin_from_jwt')` (uses anon client with caller's JWT)
2. Validate input schema
3. Validate slug format + blocklist
4. Pre-check `sb.from('tenants').select('id').eq('slug', slug).maybeSingle()` → 409 if exists
5. `sbAdmin.auth.admin.inviteUserByEmail(email, { data: {}, email_confirm: true })`
6. Try `sb.rpc('provision_tenant', {...})` with returned user.id
7. On step 6 failure: `sbAdmin.auth.admin.deleteUser(user.id)` → throw
8. Return success or structured error

Comment `sb` vs `sbAdmin`:
```typescript
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: req.headers.get('Authorization') || '' } }
});
const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
```

- [ ] **Step 3: Deno tests**

Test cases:
- Slug format invalid → 400 E3
- Reserved slug → 400 E4
- Slug taken (mock DB response) → 409 E5
- inviteUserByEmail returns email-taken error → 422 E7
- provision_tenant fails → rollback deleteUser called → 500 E9
- Happy path → 201 with tenant_id

- [ ] **Step 4: Deploy Edge Function via Supabase MCP**

```bash
supabase functions deploy create-tenant-owner
```

- [ ] **Step 5: Chrome MCP smoke — call via curl from wizard**

Not integrated into wizard yet (Task 10) — smoke via direct fetch from browser console with super_admin JWT.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(edge): create-tenant-owner Edge Function

- Wraps auth.admin.inviteUserByEmail + provision_tenant RPC
- Compensating rollback on RPC failure (deletes auth.users)
- Slug validation: regex + reserved blocklist
- Structured error responses mapped to Bahasa (E1-E11)
- Auth: verifies platform_admin_role via JWT

Wave 6 Task 9."
```

---

## Task 10: Wizard integrate Edge Function + PaymentInstructionBlock

**Files:**
- Modify: `src/components/admin/TenantWizard.tsx` — replace `provision_tenant` direct call with fetch to Edge Function; extend ResultStep to render PaymentInstructionBlock
- Create: `src/components/admin/PaymentInstructionBlock.tsx` (+ `.test.tsx`)

**Interfaces:**
- Consumes: Edge Function `create-tenant-owner` (Task 9); platform_settings (Task 8); plans.price_annual (Wave 5)
- Produces:
  - Wizard submit → Edge Function POST
  - PaymentInstructionBlock renders copy-pasteable message with bank info + tenant slug reference + WhatsApp share button

- [ ] **Step 1: Extend WizardForm state** — no schema change, just replace submit logic

Replace `submit()` in TenantWizard.tsx:

```typescript
const submit = async () => {
  setSubmitting(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-tenant-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ slug, name, plan_code, expires_in_months, owner_email, owner_name }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      setError(mapEdgeErrorToBahasa(data.code, data.message));
      return;
    }
    setResult(data);
    setStep('result');
    adminToast.success(`Tenant ${data.name} berhasil di-onboard.`);
  } finally { setSubmitting(false); }
};
```

- [ ] **Step 2: PaymentInstructionBlock component**

Fetches `platform_settings` + `plans[plan_code].price_annual` on mount. Renders block per spec §C8. Copy button + WhatsApp share link.

```typescript
const message = `Selamat! Toko Anda "${tenant.name}" sudah aktif di VOSI.

Untuk aktivasi paket ${tenant.plan_code} (Rp ${formatIDR(plan.price_annual)}/tahun):
🏦 Transfer ke: ${settings.bank_name} ${settings.bank_account_no}
   a/n: ${settings.bank_account_name}
💬 Berita transfer: ${tenant.slug}
📱 Kirim bukti transfer ke: ${settings.admin_wa_number}

Terima kasih! 🙏`;

const copyToClipboard = () => {
  navigator.clipboard.writeText(message);
  adminToast.success('Instruksi tersalin. Paste ke WhatsApp customer.');
};

const waLink = `https://wa.me/?text=${encodeURIComponent(message)}`;
```

- [ ] **Step 3: ResultStep update**

Include `<PaymentInstructionBlock tenant={result} plan={plans[result.plan_code]} />` after existing success card.

- [ ] **Step 4: Chrome MCP full flow smoke**

sales_rep → wizard → fill → submit → Edge Function processes → success screen → payment instruction visible with real bank info → Copy button works → WhatsApp link opens correctly.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(admin): wizard uses Edge Function + PaymentInstructionBlock

- TenantWizard submit calls create-tenant-owner Edge Function (not direct RPC)
- Error mapping E1-E11 → Bahasa inline messages
- ResultStep renders PaymentInstructionBlock with copy/WhatsApp buttons
- PaymentInstructionBlock fetches platform_settings + plan pricing

Wave 6 Task 10."
```

---

## Task 11: update_tenant_feature_override RPC + Module Toggle UI

**Files:**
- Create: `supabase/migrations/20261115000038_update_tenant_feature_override_rpc.sql`
- Create: `supabase/tests/wave6/update_tenant_feature_override.sql`
- Create: `src/components/admin/TenantDetail/ModuleTogglePanel.tsx` (+ `.test.tsx`)
- Modify: `src/components/admin/TenantDetail/TenantDetailShell.tsx` — add "Modul" tab

**Interfaces:**
- Consumes: existing `tenant_feature_overrides` table; existing `v_tenant_effective_features` view; `_is_platform_admin_from_jwt()`
- Produces:
  - `update_tenant_feature_override(p_tenant_id UUID, p_module_key TEXT, p_enabled BOOLEAN, p_reason TEXT) → JSONB` — both roles callable, emits TOGGLE_MODULE audit
  - UI: Modul tab with switch toggles per module

- [ ] **Step 1: Write pgTAP test + migration**

Verbatim per spec §C9.

- [ ] **Step 2: Frontend ModuleTogglePanel**

Fetch `v_tenant_effective_features` for tenant → render one row per module_key with toggle. Toggle click → RPC call → optimistic UI update.

- [ ] **Step 3: Chrome MCP smoke**

sales_rep opens tenant detail → Modul tab → toggles module → success toast → audit_log entry `TOGGLE_MODULE` with actor_user_id + old/new values.

- [ ] **Step 4: Commit**

---

## Task 12: Payment verification schema

**Files:**
- Create: `supabase/migrations/20261115000039_payment_verification_workflow.sql` (schema portion only — RPC updates in Task 13-14)

**Interfaces:**
- Consumes: existing `tenant_payments` table (Wave 5); `v_tenant_payment_coverage` view (Wave 5)
- Produces:
  - `tenant_payments.status` TEXT NOT NULL DEFAULT 'VERIFIED' CHECK IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')
  - `tenant_payments.verified_by` UUID nullable
  - `tenant_payments.verified_at` TIMESTAMPTZ nullable
  - `tenant_payments.rejection_reason` TEXT nullable
  - Rewritten `v_tenant_payment_coverage` — filter status='VERIFIED' for LUNAS; include `total_pending` metric

- [ ] **Step 1: Write migration schema part only (columns + view rebuild)**

Per spec §C10 schema section.

- [ ] **Step 2: Verify backward compat**

Existing rows default `status='VERIFIED'` — no coverage regression for Garindo (which has Wave 5 payments).

- [ ] **Step 3: pgTAP test**

Verify view returns LUNAS when total VERIFIED >= plan.price_annual; BELUM_BAYAR when 0.

- [ ] **Step 4: Commit**

---

## Task 13: record_payment update (PENDING + proof + anomaly)

**Files:**
- Modify: `supabase/migrations/20261115000039_payment_verification_workflow.sql` — append `CREATE OR REPLACE FUNCTION record_payment` with new logic

**Interfaces:**
- Consumes: schema from Task 12
- Produces: `record_payment` now inserts `status='PENDING_VERIFICATION'`, enforces proof for non-cash, flags amount anomaly (>10% deviation vs plan price), extended audit with `amount_anomaly` flag

- [ ] **Step 1: Update record_payment body**

Fetch existing body via `pg_get_functiondef`. Append validation:

```sql
-- Anti-fraud #1: proof required for non-cash
IF p_method != 'CASH' AND (p_proof_url IS NULL OR p_proof_url = '') THEN
  RAISE EXCEPTION 'record_payment: bukti transfer WAJIB untuk non-cash' USING errcode = '22023';
END IF;

-- Anti-fraud #2: amount anomaly
DECLARE v_plan_price NUMERIC := 0; v_anomaly BOOLEAN := false;
SELECT p.price_annual INTO v_plan_price
FROM plans p JOIN tenant_subscriptions ts ON ts.plan_code = p.code
WHERE ts.tenant_id = p_tenant_id;

IF v_plan_price > 0 AND ABS(p_amount - v_plan_price) > (v_plan_price * 0.1) THEN
  v_anomaly := true;
END IF;

-- INSERT with PENDING status
INSERT INTO tenant_payments (..., status)
VALUES (..., 'PENDING_VERIFICATION');

-- Extend audit event with anomaly flag
INSERT INTO audit_log (event_type, payload)
VALUES ('RECORD_PAYMENT',
  jsonb_build_object('tenant_id', p_tenant_id, 'amount', p_amount, 'method', p_method,
                     'amount_anomaly', v_anomaly, 'actor_user_id', auth.uid()));
```

- [ ] **Step 2: pgTAP test — non-cash without proof rejected**

- [ ] **Step 3: pgTAP test — amount anomaly flagged in audit**

- [ ] **Step 4: Commit**

---

## Task 14: verify_payment + reject_payment RPCs

**Files:**
- Modify: `supabase/migrations/20261115000039_payment_verification_workflow.sql` — append verify_payment + reject_payment RPCs
- Create: `src/lib/paymentVerificationApi.ts` (+ `.test.ts`)

**Interfaces:**
- Produces:
  - `verify_payment(p_payment_id UUID) → JSONB` — super_admin only
  - `reject_payment(p_payment_id UUID, p_reason TEXT) → JSONB` — super_admin only
  - Both emit audit_log events
- API wrappers: `paymentVerificationApi.listPending() → PendingPayment[]`, `verify(id)`, `reject(id, reason)`

- [ ] **Step 1: Write RPCs per spec §C10**

- [ ] **Step 2: API wrapper + tests**

- [ ] **Step 3: pgTAP test — sales_rep blocked, super_admin succeeds**

- [ ] **Step 4: Commit**

---

## Task 15: `/admin/payments/pending` UI + sidebar badge

**Files:**
- Create: `src/components/admin/PendingPaymentsQueue.tsx` (+ `.test.tsx`)
- Create: `src/components/admin/PendingPaymentRow.tsx`
- Modify: `src/components/admin/AdminRoutes.tsx` — add `/admin/payments/pending` route
- Modify: `src/components/admin/AdminLayout.tsx` — add sidebar item "Verifikasi Payment (N)" with pending count badge (super_admin only)

**Interfaces:**
- Consumes: `paymentVerificationApi` (Task 14)
- Produces: Queue UI with per-row Approve/Reject buttons + proof preview + amount anomaly warning

- [ ] **Step 1: PendingPaymentsQueue orchestrator**

Fetch pending list on mount + poll every 60s. Empty state message "Tidak ada payment pending."

- [ ] **Step 2: PendingPaymentRow**

Renders: tenant slug/name, amount, method, reference, proof preview (image thumb or PDF link), Approve button (calls verify_payment), Reject button (opens modal with reason input).

Amount anomaly badge: if audit_log payload.amount_anomaly=true → yellow warning "⚠️ Amount anomaly: expected Rp X".

- [ ] **Step 3: Sidebar badge**

`AdminLayout.tsx` fetches pending count via `paymentVerificationApi.listPending().length` on mount + poll. Render `Verifikasi Payment (3)` with red pill badge if >0.

- [ ] **Step 4: Chrome MCP smoke**

sales_rep records payment (PENDING) → super_admin sees badge count = 1 → opens queue → approves → coverage view now LUNAS.

- [ ] **Step 5: Commit**

---

## Task 16: audit_log event_type CHECK extension

**Files:**
- Create: `supabase/migrations/20261115000040_audit_event_type_extension.sql`
- Create: `supabase/tests/wave6/audit_event_types.sql`

**Interfaces:**
- Consumes: audit_log event emissions from Tasks 4, 6, 9-10, 11, 13-14
- Produces: extended CHECK constraint accepting new event_types

- [ ] **Step 1: Fetch existing constraint**

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname LIKE '%event_type%' AND conrelid='public.audit_log'::regclass;
```

- [ ] **Step 2: Migration extending CHECK**

```sql
BEGIN;
ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_event_type_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_event_type_check
  CHECK (event_type IN (
    -- Existing (preserve verbatim from prior migration)
    'RECORD_PAYMENT', 'UPDATE_PAYMENT', 'DELETE_PAYMENT', 'UPLOAD_PAYMENT_PROOF',
    'SUSPEND_TENANT', 'ACTIVATE_TENANT', 'RENEW_SUBSCRIPTION',
    -- Wave 6 additions
    'PROVISION_TENANT', 'DEPROVISION_TENANT',
    'CREATE_SALES_REP', 'DEACTIVATE_SALES_REP',
    'TOGGLE_MODULE', 'UPDATE_PLAN',
    'VERIFY_PAYMENT', 'REJECT_PAYMENT'
  ));
COMMIT;
```

- [ ] **Step 3: pgTAP test — new events INSERT succeeds**

- [ ] **Step 4: Commit**

---

## Task 17: E2E smoke + Garindo regression

**Files:** None (test session only)

- [ ] **Step 1: Chrome MCP smoke — full sales rep flow**

1. Create test sales_rep via `/admin/sales-reps` (super_admin) → mock JWT
2. Sales rep signs in → sidebar shows only Beranda / Tenant / Log aktivitas / Bantuan / Paket (read-only)
3. Onboard tenant "test-e2e-flow" via `/admin/tenants/new` → Edge Function processes → success screen → payment instructions with bank info
4. Verify tenant appears in `/admin/tenants` list
5. Toggle module Kasir Grosir in tenant detail → success
6. Change paket STARTER → PRO in tenant detail → success (audit UPDATE_PLAN)
7. Record payment (PENDING) via Pembayaran tab → sees status pending badge
8. Sales rep verifies: Delete button NOT visible in TenantDangerZone
9. Sales rep signs out
10. Super_admin signs in → sidebar badge "Verifikasi Payment (1)"
11. Opens /admin/payments/pending → sees the pending row → approves
12. Verify tenant coverage → LUNAS
13. Super_admin opens tenant → Zona Bahaya visible → deletes tenant → confirmed
14. `/admin/tenants` no longer shows test-e2e-flow
15. Audit log query returns all events with correct actor_user_ids

- [ ] **Step 2: Garindo regression**

sign in as tonywei (super_admin) → verify:
- Dashboard renders (Toko Jaya Makmur / Warung Sinar Rezeki / Garindo Jaya Panel visible)
- Kas & Bank shows Garindo accounts only
- Neraca / LabaRugi still shows Garindo Jaya Panel name
- All Wave 5 payment tools still work

- [ ] **Step 3: Final commit + push**

```bash
git commit -m "test(wave6): E2E smoke + Garindo regression complete

- Full sales rep flow: onboard → payment → verify → delete
- All 10 spec items smoke-verified on production
- Garindo tenant regressed clean

Wave 6 shipped. Sales rep can now sell + onboard + validate payment
without founder daily hands-on."
```

---

## Self-Review Coverage

- Spec §1 Edge Function → Task 9
- Spec §2 Sales Rep role → Tasks 1, 2, 4, 5
- Spec §3 deprovision_tenant → Task 6
- Spec §4 Slug blocklist → Task 9 (bundled)
- Spec §5 Broad sales rep operational access → Tasks 2, 11
- Spec §6 Extended audit trail → Tasks 4, 6, 9, 11, 13, 14, 16
- Spec §7 Plans read access → Tasks 2, 7
- Spec §8 Payment instructions → Tasks 8, 10
- Spec §9 Module toggle RPC → Task 11
- Spec §10 Two-step payment verification → Tasks 12, 13, 14, 15

All 10 must-have items covered. Migration slots 000032-000040 correctly used.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-self-service-tenant-onboarding.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
