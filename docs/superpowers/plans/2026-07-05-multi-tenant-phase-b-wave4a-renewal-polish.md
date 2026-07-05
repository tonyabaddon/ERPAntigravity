# Multi-Tenant Phase B — Wave 4a: Renewal + Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the super-admin write actions the founder needs to keep tenants alive — renew subscription, suspend / activate, edit plan metadata — plus wire the Home dashboard's attention queue to real data.

**Architecture:** Additive to Wave 1. Three new SECDEF RPCs (`renew_subscription`, `suspend_tenant` + `activate_tenant`, `update_plan_admin`) with a small `_assert_super_admin_from_jwt()` helper for plan-edit hardening. Frontend adds one modal (`RenewSubscriptionModal`), converts Wave 1's read-only Plans cards into an edit-capable form (super-admin only), extends `TenantsList` rows with Suspend/Activate actions, and populates `AttentionQueue` with real rows via a new `list_attention_tenants` RPC. No new tables — everything writes to existing Phase A structures.

**Tech Stack:** Same as Wave 1 — React 19 + TypeScript + Vite + Tailwind CSS v4 (`@theme` CSS-only) + custom `urlRoute.ts` router + Vitest + React Testing Library + Supabase (Postgres + Auth + RPC) + sonner.

## Global Constraints

Every task inherits these. Reviewers reject work that violates them.

- **Migration slot range:** `20261115000010–20261115000019` (Wave 4a reserved; Wave 1 consumed `000001–000005b`). One migration per task except where the brief explicitly bundles.
- **Every RPC gate:** `IF NOT public._is_platform_admin_from_jwt() THEN RAISE EXCEPTION USING errcode='P0403', message='PLATFORM_ADMIN_REQUIRED'; END IF;` — reviewers reject RPCs missing this. `update_plan_admin` uses `_assert_super_admin_from_jwt()` on top (defense-in-depth for Wave 4b handoff).
- **Every RPC:** `SECURITY DEFINER`, owned by `vosi_rpc_owner`, granted to `authenticated`. Comment `IS 'category=P; ...'`.
- **Unknown filter key** in any RPC payload: raise `errcode='22023'` (invalid_parameter_value) — Wave 1 pattern.
- **RLS gap fix from Wave 1** (`20261115000002c`) is already in place. SECDEF RPCs owned by `vosi_rpc_owner` can read any FORCE-RLS table via the supplementary `p_platform_admin_readall` policy. No further RLS work needed.
- **pgTAP tests:** one `.sql` file per RPC at `supabase/tests/wave4a/<rpc_name>.sql`. Assertions must include non-admin → P0403 and happy path.
- **Language: WAJIB Bahasa Indonesia** for SEMUA user-facing copy (label, button, notice, tooltip, error message, empty-state, confirmation). English HANYA boleh untuk: nama kode (`RENEW_SUBSCRIPTION`), audit action code, URL segment. Reviewers reject English label seperti "Renew", "Confirm", "Cancel".
- **VOSI Design System v1.0** — source of truth `docs/VOSI-Design-System.md`. Tailwind class names: `bg-vosi-navy`, `text-vosi-gold`, `font-vosi`, etc. **Any new inline hex literal is a review failure** — use tokens. (Wave 1 was granted a deferred token sweep; new Wave 4a code must use tokens from day one to keep the debt bounded.)
- **60/30/10** — Navy or Cream dominant 60%, supporting neutral 30%, Gold accent MAX 10% (one focal point per screen or modal).
- **Font size floor:** UI base 13-14px, tables 12-13px, minimum 11px anywhere. Reviewers reject `text-[10px]`.
- **Data fetching:** `useEffect + async` (no react-query — matches Wave 1). Loading state = skeleton or spinner in VOSI palette. Error state = sonner error toast + inline retry button. Cancel in-flight requests when deps change (Wave 1's `TenantDetailShell` pattern).
- **Test naming:** `.test.tsx` co-located with source component.
- **No `any` types** in TS.
- **Custom router:** project uses `src/lib/urlRoute.ts` — NOT react-router-dom. Task 5's modal opens via inline state (not a route). If any task adds new admin routes, extend the inline pathname regex dispatch in `src/components/admin/AdminRoutes.tsx` (same pattern Wave 1 used).
- **Toast wrapper:** import `adminToast` from `src/lib/adminToast.ts` (Wave 1). Never call `sonner.toast` directly. Never use `alert()`.
- **Error mapping:** extend `src/lib/adminApi.ts`'s `normalizeRpcError` — SQLSTATE-specific error classes with Bahasa `.userMessage`.
- **Garindo tenant MUST continue to render normally** — regression test at end of each FE task; full regression pass in Task 8.
- **No writes to prod from tests** — pgTAP files must roll back cleanly. Smoke tests via `DO` block wrap in transaction with a final `RAISE EXCEPTION` to abort (per memory `reference_smoke_test_security_definer_rpcs`).

---

## File Structure

**Backend (SQL migrations):**
- `supabase/migrations/20261115000010_phase_b_wave4a_renew_subscription.sql`
- `supabase/migrations/20261115000011_phase_b_wave4a_suspend_activate_tenant.sql`
- `supabase/migrations/20261115000012_phase_b_wave4a_update_plan_admin.sql` (includes `_assert_super_admin_from_jwt()` helper)
- `supabase/migrations/20261115000013_phase_b_wave4a_list_attention_tenants.sql`

**Backend (pgTAP tests):**
- `supabase/tests/wave4a/renew_subscription.sql`
- `supabase/tests/wave4a/suspend_activate_tenant.sql`
- `supabase/tests/wave4a/update_plan_admin.sql`
- `supabase/tests/wave4a/list_attention_tenants.sql`

**Frontend (new files):**
- `src/components/admin/RenewSubscriptionModal.tsx` — dialog
- `src/components/admin/SuspendTenantModal.tsx` — dialog with reason field
- `src/components/admin/PlansManagementEdit.tsx` — edit-mode form (used by PlansManagement)
- Optionally split PlansManagement helpers if the file grows past ~250 lines

**Frontend (modified):**
- `src/lib/adminApi.ts` — add `renewSubscription`, `suspendTenant`, `activateTenant`, `updatePlan`, `listAttentionTenants` wrappers
- `src/lib/adminTypes.ts` — add `RenewSubscriptionInput`, `AttentionTenantRow`, `UpdatePlanInput` types + new error classes
- `src/components/admin/TenantDetail/OverviewTab.tsx` — add "Perpanjang" CTA in Paket & masa aktif card that opens `RenewSubscriptionModal`
- `src/components/admin/TenantsTable.tsx` — add Suspend / Activate row actions (conditional on `status`)
- `src/components/admin/TenantsList.tsx` — pass suspend/activate handlers into the table
- `src/components/admin/PlansManagement.tsx` — swap disabled "Aktifkan (Wave 4a)" CTA for edit form; gate on super-admin
- `src/components/admin/AttentionQueue.tsx` — fetch real rows via `listAttentionTenants` (Wave 1 rendered empty state)
- `src/components/admin/AdminHome.tsx` — pass `AttentionQueue` its data source (or let AQ own its fetch)

**Test files (co-located):**
- `.test.tsx` per new/modified component. New RPC wrappers get `.test.ts` in `src/lib/`.

---

## Task 1: Migration — `renew_subscription` RPC

**Files:**
- Create: `supabase/migrations/20261115000010_phase_b_wave4a_renew_subscription.sql`
- Create: `supabase/tests/wave4a/renew_subscription.sql`

**Interfaces:**
- Consumes: `tenant_subscriptions` (Phase A), `platform_admin_audit` (Phase A), `_is_platform_admin_from_jwt()`.
- Produces: `public.renew_subscription(p_tenant_id uuid, p_new_expires_at date, p_new_plan_code text default null, p_notes text default null) → jsonb`.

**RPC contract:**
- Requires platform-admin JWT (P0403 otherwise).
- Validates `p_tenant_id` exists in `tenants` (raise `errcode='P0404', message='TENANT_NOT_FOUND'` if not).
- Validates `p_new_expires_at > CURRENT_DATE` (raise `errcode='22023', message='INVALID_EXPIRES_AT'` if past/today).
- If `p_new_plan_code IS NOT NULL`: validates plan exists in `plans` (raise `errcode='22023', message='INVALID_PLAN_CODE'` if not).
- Updates the tenant's row in `tenant_subscriptions`: `expires_at = p_new_expires_at`, `grace_expires_at = p_new_expires_at + interval '14 days'`, `plan_code = COALESCE(p_new_plan_code, plan_code)`, `notes = COALESCE(p_new_notes, notes)`, `updated_at = now()`, `updated_by = auth.uid()`.
- If tenant's `status = 'SUSPENDED'`, DOES NOT auto-reactivate (that's a separate explicit action).
- INSERTs into `platform_admin_audit` with `action_code='RENEW_SUBSCRIPTION'`, `tenant_id=p_tenant_id`, `admin_user_id=auth.uid()`, `admin_email = (SELECT email FROM platform_admins WHERE user_id = auth.uid())`, `detail = jsonb_build_object('new_expires_at', p_new_expires_at, 'new_plan_code', p_new_plan_code, 'notes', p_notes)`.
- Returns `jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'new_expires_at', p_new_expires_at, 'new_grace_expires_at', p_new_expires_at + interval '14 days', 'plan_code', <final plan_code>)`.

**Notes for implementer:**
- Wrap the whole body in a single `BEGIN … EXCEPTION WHEN OTHERS THEN RAISE; END` for clean audit-log rollback on failure.
- The Phase A `expiry_state` column on `v_tenant_effective_features` is a computed view — no manual reset needed. Once `expires_at` is in the future the view flips back to `ACTIVE` on next read.
- Before writing the RPC, enumerate current columns on `platform_admin_audit` via MCP — Task 3 of Wave 1 established `detail` (not `detail_json`) and `id bigint`. Trust that unless drift is found.

**Steps:**

- [ ] **Step 1: Verify schema against brief via MCP**

Run via Supabase MCP `execute_sql` on project `ekhhojaezdfjfwuxyjkl`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('tenant_subscriptions','platform_admin_audit','tenants','plans')
ORDER BY table_name, ordinal_position;
```

Expected columns per Task 2 report + Task 3 report already committed. If any drift, STOP with NEEDS_CONTEXT.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20261115000010_phase_b_wave4a_renew_subscription.sql` with the RPC per the contract above. Use the shape of Wave 1 migration `20261115000002_phase_b_wave1_list_tenants_admin.sql` as the template (SECDEF header, OWNER TO vosi_rpc_owner, GRANT EXECUTE TO authenticated, COMMENT ON FUNCTION, REVOKE ALL FROM PUBLIC).

- [ ] **Step 3: Write the pgTAP file**

Create `supabase/tests/wave4a/renew_subscription.sql`. Cover:
- Non-admin caller → `throws_ok` for SQLSTATE `P0403`.
- Bad `p_tenant_id` (nil uuid) → `throws_ok` for `P0404`.
- `p_new_expires_at = current_date` → `throws_ok` for `22023`.
- Invalid `p_new_plan_code = 'BOGUS'` → `throws_ok` for `22023`.
- Happy path: update Garindo `expires_at` to `current_date + interval '1 year'`, assert returned jsonb `ok=true`, assert `tenant_subscriptions.expires_at` updated, assert `platform_admin_audit` has 1 new row with `action_code='RENEW_SUBSCRIPTION'`, wrap in transaction so ROLLBACK reverts.

Per Wave 1 Task 1 lesson: `throws_ok` INSERTs must supply all NOT NULL columns so the CHECK fires before NOT NULL. Enumerate NOT NULL columns first.

- [ ] **Step 4: Apply migration to Garindo prod**

Via MCP `apply_migration` with name `20261115000010_phase_b_wave4a_renew_subscription`. Then verify:
- Function exists, owner=`vosi_rpc_owner`, `prosecdef=true`, EXECUTE granted to `authenticated`.

- [ ] **Step 5: Smoke test (rollback pattern)**

Run via MCP `execute_sql`:

```sql
DO $$
DECLARE r jsonb; garindo uuid; before_expires date; after_expires date;
BEGIN
  SELECT id INTO garindo FROM public.tenants WHERE slug='garindo';
  SELECT expires_at INTO before_expires FROM public.tenant_subscriptions WHERE tenant_id=garindo;
  SET LOCAL role='authenticated';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"227c28f4-09f6-4dc9-af7a-01b0feb2c194","is_platform_admin":true,"role":"authenticated"}', true);
  SELECT public.renew_subscription(garindo, before_expires + interval '1 year', NULL, 'smoke test') INTO r;
  SELECT expires_at INTO after_expires FROM public.tenant_subscriptions WHERE tenant_id=garindo;
  RAISE EXCEPTION 'SMOKE OK: before=% result=% after=%', before_expires, r, after_expires;
END $$;
```

Expected: RAISE fires with `before`, `result` jsonb (`ok=true`, `new_expires_at` = before + 1yr), and `after` equal to the new expiry. The RAISE aborts the transaction — Garindo's `expires_at` is NOT actually changed in prod.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000010_phase_b_wave4a_renew_subscription.sql \
        supabase/tests/wave4a/renew_subscription.sql
git commit -m "feat(phase-b-wave4a): Task 1 — renew_subscription RPC

- SECDEF, P0403 gate, validates tenant + plan + future date
- Cascades: expires_at + grace_expires_at (+14d), optional plan_code
- Writes RENEW_SUBSCRIPTION audit row
- pgTAP: non-admin, bad tenant, bad date, bad plan, happy path

Migration slot 20261115000010. Applied to Garindo prod via MCP.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Migration — `suspend_tenant` + `activate_tenant`

**Files:**
- Create: `supabase/migrations/20261115000011_phase_b_wave4a_suspend_activate_tenant.sql`
- Create: `supabase/tests/wave4a/suspend_activate_tenant.sql`

**Interfaces:**
- Consumes: `tenants` (Phase A), `platform_admin_audit`, `_is_platform_admin_from_jwt()`.
- Produces:
  - `public.suspend_tenant(p_tenant_id uuid, p_reason text) → jsonb`
  - `public.activate_tenant(p_tenant_id uuid) → jsonb`

**Contracts:**

`suspend_tenant`:
- P0403 if not platform admin.
- P0404 if `p_tenant_id` not in `tenants`.
- `22023 INVALID_REASON` if `p_reason IS NULL` or `length(trim(p_reason)) = 0`.
- If tenant already `status='SUSPENDED'` → return `jsonb_build_object('ok', true, 'noop', true, 'reason', existing_reason)` (idempotent; no new audit row).
- Otherwise UPDATE `tenants` SET `status='SUSPENDED'`, `suspended_at = now()`, `suspended_reason = p_reason`. INSERT audit row `action_code='SUSPEND_TENANT'`, detail includes `p_reason`.
- Returns `jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'suspended_at', now(), 'reason', p_reason)`.

`activate_tenant`:
- P0403 if not platform admin.
- P0404 if tenant not found.
- If tenant already `status='ACTIVE'` → return `jsonb_build_object('ok', true, 'noop', true)`.
- If tenant `status='ARCHIVED'` → return `22023 CANNOT_ACTIVATE_ARCHIVED` (archive is a Wave-later action; not reversible via this RPC).
- Otherwise UPDATE `tenants` SET `status='ACTIVE'`, `suspended_at = NULL`, `suspended_reason = NULL`. INSERT audit row `action_code='ACTIVATE_TENANT'`, detail = `jsonb_build_object('previous_status', old_status)`.
- Returns `jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'status', 'ACTIVE')`.

**Steps:**

- [ ] **Step 1: Schema check via MCP**

Enumerate columns on `tenants` (specifically `status`, `suspended_at`, `suspended_reason`, `archived_at`). Check any CHECK constraint on `tenants.status` — the value set is likely `('ACTIVE','SUSPENDED','ARCHIVED')` or similar. Reject if it doesn't include both `SUSPENDED` and `ACTIVE`.

- [ ] **Step 2: Write migration**

Both RPCs in one file (they share the pattern and are small). Both SECDEF, both `vosi_rpc_owner`-owned, both platform-admin gated. Follow Wave 1's slot header + REVOKE/GRANT pattern.

- [ ] **Step 3: Write pgTAP**

`supabase/tests/wave4a/suspend_activate_tenant.sql`:
- `suspend_tenant`: non-admin → P0403; bad tenant → P0404; empty reason → 22023; happy path: Garindo → SUSPENDED, audit row exists; idempotent: second call returns `noop=true`.
- `activate_tenant`: non-admin → P0403; bad tenant → P0404; happy path: Garindo (in SUSPENDED state within tx) → ACTIVE, audit row exists; idempotent: second call returns `noop=true`; archived tenant simulation (temporary status='ARCHIVED') → 22023.

- [ ] **Step 4: Apply via MCP**

Migration name `20261115000011_phase_b_wave4a_suspend_activate_tenant`. Verify both functions land.

- [ ] **Step 5: Smoke test both RPCs in a transaction with RAISE**

DO block that suspends Garindo, verifies status = SUSPENDED, activates Garindo, verifies status = ACTIVE, then RAISE to abort. Prints intermediate states.

- [ ] **Step 6: Commit**

```
feat(phase-b-wave4a): Task 2 — suspend_tenant + activate_tenant RPCs

- suspend_tenant(uuid, text): sets status=SUSPENDED + reason, audit row
- activate_tenant(uuid): sets status=ACTIVE, clears suspended_*
- Both SECDEF, P0403 gate, idempotent, ARCHIVED rejected on activate
- pgTAP: 12 assertions across 6 test cases

Migration slot 20261115000011. Applied to Garindo prod via MCP.
```

---

## Task 3: Migration — `_assert_super_admin_from_jwt` + `update_plan_admin`

**Files:**
- Create: `supabase/migrations/20261115000012_phase_b_wave4a_update_plan_admin.sql`
- Create: `supabase/tests/wave4a/update_plan_admin.sql`

**Interfaces:**
- Consumes: `platform_admins` (Phase A — has `role` column defaulting to `super_admin`), `plans`, `platform_admin_audit`.
- Produces:
  - Helper `public._assert_super_admin_from_jwt() RETURNS void` — raises `P0403 SUPER_ADMIN_REQUIRED` if the JWT's `sub` is not a row in `platform_admins` with `role='super_admin'`. Returns void on success.
  - `public.update_plan_admin(p_plan_code text, p_updates jsonb) → jsonb`.

**`_assert_super_admin_from_jwt` contract:**
- `LANGUAGE plpgsql STABLE` — same volatility as `_is_platform_admin_from_jwt`.
- NOT SECDEF (helper called from within SECDEF functions; runs in caller's role context).
- Reads `sub` from `request.jwt.claims`; SELECTs `role` from `platform_admins WHERE user_id = sub`; if `NULL` or `role != 'super_admin'`, RAISE `errcode='P0403', message='SUPER_ADMIN_REQUIRED'`.
- Grant EXECUTE to `authenticated`.

**`update_plan_admin` contract:**
- SECDEF, owned by `vosi_rpc_owner`, granted `authenticated`.
- FIRST line inside body: `PERFORM _is_platform_admin_from_jwt();` — actually make that a RAISE-based gate matching other RPCs.
- SECOND line: `PERFORM _assert_super_admin_from_jwt();` — defense-in-depth. Currently every platform admin IS super_admin (founder is the only one), so this is a no-op today; when Wave 4b adds non-super admins, this gate keeps plan editing locked down without RPC rewrites.
- Validates `p_plan_code IN ('STARTER','PRO','PREMIUM')`. If not, raise `22023 INVALID_PLAN_CODE`.
- Whitelisted `p_updates` keys (raise `22023 UNKNOWN_FIELD` if any other key present): `name`, `description`, `target_segment`, `price_reference`, `feature_bundle`, `is_recommended`, `is_active`, `sort_order`.
- If `feature_bundle` is present, must be a valid jsonb object.
- If `is_recommended = true` for one plan, no automatic clearing of other plans' `is_recommended` (founder decides).
- UPDATEs `plans` with only the keys present in `p_updates`. `updated_at = now()`, `updated_by = auth.uid()`.
- INSERTs audit row `action_code='UPDATE_PLAN'`, `tenant_id = NULL` (this is platform-scoped), `detail = jsonb_build_object('plan_code', p_plan_code, 'updates', p_updates)`.
- Returns `jsonb_build_object('ok', true, 'plan_code', p_plan_code, 'updated_keys', array(select jsonb_object_keys(p_updates)))`.

**Steps:**

- [ ] **Step 1: Schema check**

Verify `plans` columns match Wave 1 Task 1 output. Verify `platform_admins.role` exists with default `super_admin` — the founder row should already have `role='super_admin'`.

- [ ] **Step 2: Write migration**

Two objects: helper + RPC, in the same file for atomicity.

- [ ] **Step 3: Write pgTAP**

- Non-admin → P0403 PLATFORM_ADMIN_REQUIRED.
- Platform admin but non-super (simulate via temporary insert in the pgTAP transaction) → P0403 SUPER_ADMIN_REQUIRED.
- Invalid plan_code → 22023 INVALID_PLAN_CODE.
- Unknown update key (e.g. `{"bogus": 1}`) → 22023 UNKNOWN_FIELD.
- Happy path: update PRO description; assert returned updated_keys, assert plan row updated, assert audit row exists with correct detail.

- [ ] **Step 4: Apply + smoke test**

Same pattern as Tasks 1 + 2.

- [ ] **Step 5: Commit**

```
feat(phase-b-wave4a): Task 3 — update_plan_admin + super-admin helper

- _assert_super_admin_from_jwt(): reads platform_admins.role
- update_plan_admin(plan_code, updates jsonb): whitelisted keys,
  double-gated (platform admin + super admin)
- pgTAP: 5 assertions covering role gates + key whitelist + happy path

Migration slot 20261115000012. Applied to Garindo prod via MCP.
```

---

## Task 4: Migration — `list_attention_tenants` RPC

**Files:**
- Create: `supabase/migrations/20261115000013_phase_b_wave4a_list_attention_tenants.sql`
- Create: `supabase/tests/wave4a/list_attention_tenants.sql`

**Interfaces:**
- Consumes: `tenants`, `tenant_subscriptions`, `v_tenant_effective_features` (already in prod).
- Produces: `public.list_attention_tenants(p_expiry_within_days int default 45) → SETOF (tenant_id uuid, slug text, name text, plan_code text, status text, expires_at date, days_until_expiry int, attention_reason text)`.

**Contract:**
- SECDEF, `vosi_rpc_owner`-owned, `authenticated`-executable, P0403 gated.
- Returns tenants matching ANY of:
  - `expires_at <= (CURRENT_DATE + p_expiry_within_days * interval '1 day')` (expiring soon)
  - `status = 'SUSPENDED'`
- `days_until_expiry = (expires_at - CURRENT_DATE)::int` (may be negative for already-expired).
- `attention_reason`: `'EXPIRING'` (if days_until_expiry <= p_expiry_within_days AND status != 'SUSPENDED'), `'SUSPENDED'` (if status=SUSPENDED), or `'EXPIRED_AND_SUSPENDED'` (both). One reason per row — priority: SUSPENDED > EXPIRED > EXPIRING.
- ORDER BY days_until_expiry ASC (most urgent first), then name.
- Validates `p_expiry_within_days BETWEEN 1 AND 365` — raise 22023 otherwise.

**pgTAP:**
- Non-admin → P0403.
- `p_expiry_within_days = 0` → 22023.
- Empty state (no tenant matches): returns 0 rows. Garindo currently has `expires_at` far out + status=ACTIVE, so with `p_expiry_within_days=1` the RPC should return 0.
- Simulated match: temporarily UPDATE Garindo `expires_at = CURRENT_DATE + interval '10 days'` inside the pgTAP tx, call `list_attention_tenants(45)`, assert 1 row with `attention_reason='EXPIRING'`, ROLLBACK.

**Steps mirror Tasks 1-3.**

**Commit:**

```
feat(phase-b-wave4a): Task 4 — list_attention_tenants RPC

- Returns tenants with expiring subscription (<= N days) OR
  status=SUSPENDED, sorted by urgency
- attention_reason enum: EXPIRING / SUSPENDED / EXPIRED_AND_SUSPENDED
- SECDEF, P0403 gate, 1-365 day range validated

Migration slot 20261115000013. Applied to Garindo prod via MCP.
```

---

## Task 5: FE — extend `adminApi.ts` + `adminTypes.ts`

**Files:**
- Modify: `src/lib/adminApi.ts`
- Modify: `src/lib/adminTypes.ts`
- Create: `src/lib/adminApi.wave4a.test.ts` (or extend existing `adminApi.test.ts` if it's still small)

**Interfaces:**
- Consumes: RPCs from Tasks 1-4.
- Produces:
  - `renewSubscription(input: RenewSubscriptionInput): Promise<RenewSubscriptionResult>`
  - `suspendTenant(tenantId: string, reason: string): Promise<{ok: true; suspended_at: string; reason: string}>`
  - `activateTenant(tenantId: string): Promise<{ok: true; status: 'ACTIVE'}>`
  - `updatePlan(planCode: 'STARTER'|'PRO'|'PREMIUM', updates: UpdatePlanInput): Promise<{ok: true; updated_keys: string[]}>`
  - `listAttentionTenants(withinDays?: number): Promise<AttentionTenantRow[]>`
  - Types: `RenewSubscriptionInput`, `RenewSubscriptionResult`, `UpdatePlanInput`, `AttentionTenantRow`, `AttentionReason` (union).

**Type shapes (verbatim):**

```typescript
export interface RenewSubscriptionInput {
  tenant_id: string;
  new_expires_at: string;      // ISO date "YYYY-MM-DD"
  new_plan_code?: 'STARTER' | 'PRO' | 'PREMIUM' | null;
  notes?: string | null;
}

export interface RenewSubscriptionResult {
  ok: true;
  tenant_id: string;
  new_expires_at: string;
  new_grace_expires_at: string;
  plan_code: 'STARTER' | 'PRO' | 'PREMIUM';
}

export type AttentionReason = 'EXPIRING' | 'SUSPENDED' | 'EXPIRED_AND_SUSPENDED';

export interface AttentionTenantRow {
  tenant_id: string;
  slug: string;
  name: string;
  plan_code: 'STARTER' | 'PRO' | 'PREMIUM';
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  expires_at: string;
  days_until_expiry: number;   // may be negative
  attention_reason: AttentionReason;
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  target_segment?: string;
  price_reference?: number | null;
  feature_bundle?: Record<string, unknown>;
  is_recommended?: boolean;
  is_active?: boolean;
  sort_order?: number;
}
```

**New error classes:**

```typescript
export class TenantNotFoundError extends AdminApiError {
  readonly userMessage = 'Tenant tidak ditemukan.';
}
export class InvalidRenewalDateError extends AdminApiError {
  readonly userMessage = 'Tanggal perpanjangan harus lebih dari hari ini.';
}
export class InvalidPlanCodeError extends AdminApiError {
  readonly userMessage = 'Kode paket tidak valid.';
}
export class SuperAdminRequiredError extends AdminApiError {
  readonly userMessage = 'Aksi ini butuh peran super admin.';
}
export class CannotActivateArchivedError extends AdminApiError {
  readonly userMessage = 'Tenant yang sudah diarsipkan tidak bisa diaktifkan lagi.';
}
```

Extend `normalizeRpcError`:
- SQLSTATE `P0404` (any message) → `TenantNotFoundError`
- SQLSTATE `22023` message `INVALID_EXPIRES_AT` → `InvalidRenewalDateError`
- SQLSTATE `22023` message `INVALID_PLAN_CODE` → `InvalidPlanCodeError`
- SQLSTATE `P0403` message `SUPER_ADMIN_REQUIRED` → `SuperAdminRequiredError`
- SQLSTATE `22023` message `CANNOT_ACTIVATE_ARCHIVED` → `CannotActivateArchivedError`
- Other 22023 → existing `InvalidFilterError`
- Other P0403 → existing `PlatformAdminRequiredError`

**Steps:**

- [ ] **Step 1: Write failing tests first (TDD)**

Extend `src/lib/adminApi.test.ts` or create `src/lib/adminApi.wave4a.test.ts`. Test each new wrapper's happy path with mocked Supabase client, plus error mapping for each SQLSTATE-message combo. Run — expect fails.

- [ ] **Step 2: Implement**

Add types to `adminTypes.ts`. Add wrapper functions to `adminApi.ts`. Extend `normalizeRpcError`.

- [ ] **Step 3: Run tests**

`npx vitest run src/lib/adminApi` — all pass.

- [ ] **Step 4: tsc + full suite**

`npx tsc --noEmit` clean. `npx vitest run` — no new failures beyond the pre-existing 5.

- [ ] **Step 5: Commit**

```
feat(phase-b-wave4a): Task 5 — adminApi wrappers + types

- 5 new wrappers: renewSubscription, suspendTenant, activateTenant,
  updatePlan, listAttentionTenants
- 5 new error classes with Bahasa userMessage
- normalizeRpcError extended for SQLSTATE-message matching
- Vitest: happy path + error mapping per wrapper
```

---

## Task 6: FE — `RenewSubscriptionModal` + wire into `OverviewTab`

**Files:**
- Create: `src/components/admin/RenewSubscriptionModal.tsx`
- Create: `src/components/admin/RenewSubscriptionModal.test.tsx`
- Modify: `src/components/admin/TenantDetail/OverviewTab.tsx`

**Interfaces:**
- Consumes: `renewSubscription`, `AdminTenantRow`, `adminToast`.
- Produces: `<RenewSubscriptionModal open={boolean} tenant={AdminTenantRow} onClose={() => void} onSuccess={(result: RenewSubscriptionResult) => void} />`.

**Modal design (VOSI):**
- Backdrop `bg-vosi-navy/40 backdrop-blur-sm`. Card centered, `bg-white rounded-2xl shadow-xl p-6 max-w-md w-full font-vosi`.
- Header: "Perpanjang Masa Aktif" (`text-vosi-navy font-bold text-lg`).
- Subheader: tenant name in JetBrains Mono, current `expires_at` shown as reference.
- Form fields:
  - **Masa aktif baru** — `<input type="date">`, default value = current `expires_at + 1 year` (compute in ISO). Required. Validation: must be > today.
  - **Ganti paket** (optional) — `<select>` with options `— Tidak diganti —` / STARTER / PRO / PREMIUM. Default = current plan_code.
  - **Catatan internal** — `<textarea>` (max 500 chars). Optional. Placeholder: "Contoh: renewal 1 tahun, bayar transfer BCA 5 Jul 2026".
- Footer buttons:
  - **Batal** — ghost style, closes modal without action.
  - **Simpan Perpanjangan** — primary, `bg-vosi-gold text-vosi-navy font-extrabold rounded-full px-5 py-2.5`. Disabled while submitting or validation fails.
- On submit:
  - `setSubmitting(true)`, call `renewSubscription({...})`.
  - Success → `adminToast.success('Masa aktif diperpanjang.')`, call `onSuccess(result)`, `onClose()`.
  - Known error → `adminToast.error(err.userMessage)`, keep modal open, restore form.
  - Unknown error → `adminToast.error('Terjadi kesalahan tak terduga.')`.
- ESC key + backdrop click both close (only if not submitting).
- Focus trap: focus the date input on open.

**Wire into `OverviewTab`:**
- In the "Paket & masa aktif" card, replace/add a **Perpanjang** CTA button (small, `bg-vosi-gold` primary, gold focal for this card).
- Local state `[isRenewOpen, setIsRenewOpen] = useState(false)`.
- `<RenewSubscriptionModal open={isRenewOpen} tenant={row} onClose={() => setIsRenewOpen(false)} onSuccess={handleSuccess} />`.
- `handleSuccess`: call parent's `onRefresh()` if available, or force a `TenantDetailShell` reload via a URL update. Simpler: mutate the local `row` object with the new dates using a controlled prop pattern OR emit an event upward. Prefer: emit upward — `TenantDetailShell` re-fetches the row.
- Need a way to notify `TenantDetailShell` — extend `OverviewTab` props with `onDataChange?: () => void` and pipe from shell.

**Tests (RTL):**
- Renders form with pre-filled defaults.
- Submits on click — calls `renewSubscription` with expected args.
- Success → success toast + `onSuccess` called + `onClose` called.
- Error (mock a `TenantNotFoundError`) → error toast, modal stays open, no `onSuccess`.
- ESC closes modal.
- Backdrop click closes modal.
- Cannot submit with past date (button disabled).

**Steps:**

- [ ] **Step 1: Write failing test suite**
- [ ] **Step 2: Implement modal + wire OverviewTab**
- [ ] **Step 3: `npx tsc --noEmit`**
- [ ] **Step 4: Vitest suite — new tests pass, existing suite stable**
- [ ] **Step 5: Manual smoke via `npm run dev` — log in as founder, open `/admin/tenants/garindo?tab=ringkasan`, click Perpanjang, submit with `expires_at = today + 1 year`. Verify toast + `tenant_subscriptions.expires_at` updated via MCP. Roll back manually via MCP.**
- [ ] **Step 6: Commit**

```
feat(phase-b-wave4a): Task 6 — RenewSubscriptionModal + OverviewTab wire

- Modal with date + plan + notes fields, Bahasa Indonesia labels
- VOSI palette (gold primary CTA, navy backdrop)
- Wires to renewSubscription; success + error toast handling
- OverviewTab gets Perpanjang CTA; TenantDetailShell re-fetches on success
- Vitest coverage for modal states + happy path + errors
```

---

## Task 7: FE — Suspend / Activate row actions in `TenantsList`

**Files:**
- Create: `src/components/admin/SuspendTenantModal.tsx` + `.test.tsx`
- Modify: `src/components/admin/TenantsTable.tsx`
- Modify: `src/components/admin/TenantsList.tsx`

**Interfaces:**
- Consumes: `suspendTenant`, `activateTenant`, `AdminTenantRow`, `adminToast`.
- Produces:
  - `<SuspendTenantModal open tenant onClose onSuccess />` — modal with required reason field.
  - `TenantsTable`: adds a per-row action column with either **Suspend** or **Aktifkan** button depending on `row.status`.

**UX:**
- Row action column header: "Aksi".
- If `row.status === 'ACTIVE'`:
  - **Suspend** button (small, `text-vosi-danger border border-vosi-danger/40 hover:bg-vosi-danger/10 rounded-full px-3 py-1 text-[12px] font-semibold`). Clicking opens `SuspendTenantModal`.
- If `row.status === 'SUSPENDED'`:
  - **Aktifkan** button (small, `bg-vosi-success text-white rounded-full px-3 py-1 text-[12px] font-semibold`). Clicking shows `window.confirm('Aktifkan kembali <tenant name>?')` — on confirm, call `activateTenant(tenant_id)`.
- If `row.status === 'ARCHIVED'`:
  - Show `—` disabled (no action available).
- The Impersonasi button already exists from Wave 1 — keep it. New buttons render alongside it (small icon-only variants if space is tight — but text buttons preferred for clarity).

**SuspendTenantModal:**
- Header: "Suspend Tenant" (or "Tangguhkan Tenant" — pick one Bahasa term consistently across UI + audit).
- Warning callout at top: `bg-vosi-danger/10 border-l-4 border-vosi-danger p-3 rounded` with copy: "Tenant tidak bisa menulis data setelah di-suspend. Login tetap bisa, tapi setiap aksi tulis akan gagal. Pastikan alasan tercatat untuk audit."
- Tenant name (JetBrains Mono).
- **Alasan** — `<textarea required minLength=5 maxLength=500>` — placeholder "Contoh: pembayaran overdue 60 hari, tidak ada respons".
- Footer:
  - **Batal** ghost.
  - **Konfirmasi Suspend** — `bg-vosi-danger text-white rounded-full px-5 py-2.5 font-extrabold`. Disabled if reason < 5 chars or submitting.
- On submit: call `suspendTenant(id, reason)`, success toast "Tenant di-suspend.", `onSuccess()`, `onClose()`. Error → `adminToast.error(err.userMessage)`.

**Activate flow:**
- No modal for activate — a plain `window.confirm` is enough (activation is safer than suspension, low-consequence if misclicked and easily reversible).

**After success (either action):**
- Parent `TenantsList` re-fetches the current page — pass a `onRowActionSuccess` prop from `TenantsList` → `TenantsTable`. Wave 1's `TenantsList` already has a fetch-on-filter-change pattern — trigger it by bumping a `refreshKey` state.

**Tests:**
- `SuspendTenantModal.test.tsx`: renders warning + form; validation blocks submit; happy path; error path.
- `TenantsTable.test.tsx` (extend Wave 1): renders correct button per row status; suspend opens modal; activate confirm + success calls `activateTenant`; disabled row for ARCHIVED.

**Steps mirror Tasks 5-6.**

**Commit:**

```
feat(phase-b-wave4a): Task 7 — suspend/activate row actions

- SuspendTenantModal with reason required + warning callout
- TenantsTable adds Aksi column: Suspend (ACTIVE) / Aktifkan (SUSPENDED)
- Activate: window.confirm then activateTenant RPC
- Row list re-fetches after either action
- Vitest coverage for both flows + status-conditional rendering
```

---

## Task 8: FE — `PlansManagement` edit mode + super-admin gate + `AttentionQueue` live data + Wave 4a regression

This is a bundled task — two related FE changes plus the wave close-out. Split into commits internally if the diff grows.

### 8a. PlansManagement edit mode

**Files:**
- Modify: `src/components/admin/PlansManagement.tsx`
- Create: `src/components/admin/PlansManagementEdit.tsx` (form component)
- Update: `src/components/admin/PlansManagement.test.tsx`

**Behavior:**
- Wave 1 rendered 3 read-only plan cards with a disabled "Aktifkan (Wave 4a)" CTA. Replace that CTA with an **Edit** button.
- Clicking Edit switches THAT card into an inline edit form (or opens a modal — implementer's choice; inline swap is cheaper).
- Form fields:
  - Nama paket (`plans.name`) — text
  - Deskripsi (`plans.description`) — textarea
  - Segmen target (`plans.target_segment`) — text
  - Harga referensi (`plans.price_reference`) — number, nullable
  - Rekomendasi (`plans.is_recommended`) — checkbox
  - Feature bundle — collapsed JSON editor (textarea with `JSON.parse` on save; validation error inline if invalid).
- Buttons: **Batal** ghost / **Simpan** primary (`bg-vosi-gold`).
- On save: call `updatePlan(plan_code, updates)`. Success → toast "Paket diperbarui.", refetch plans, exit edit mode. Error → toast with `err.userMessage`.
- **Gate the Edit button on super-admin**: call `isSuperAdmin()` (extend `tenantContextService` or add `src/lib/adminAuth.ts`). Since Wave 4b hasn't shipped, use a lightweight FE check — either read a JWT claim (none exists yet) or fetch `platform_admins.role` once on mount. Simplest for now: read the founder-only assumption from JWT `is_platform_admin` since ALL current platform admins ARE super_admin. Document this as a Wave 4b-hardened followup: `// TODO(wave-4b): swap to admin_role JWT claim once Auth Hook adds it`. **Reviewers accept this comment** because Wave 4b is planned to add the claim.
- Backend still gates via `_assert_super_admin_from_jwt()` — FE gate is UX polish, not security.

### 8b. AttentionQueue live data

**Files:**
- Modify: `src/components/admin/AttentionQueue.tsx`

**Behavior:**
- Wave 1's `AttentionQueue` renders an empty state "Semua tenteram" hardcoded. Change to fetch via `listAttentionTenants(45)` on mount.
- Loading state: skeleton (3 rows).
- Success:
  - If 0 rows: keep "Semua tenteram" empty state.
  - Else: render rows with tenant name, plan badge, days_until_expiry (colored: red if <=0, amber if <=14, gray otherwise), attention_reason chip (SUSPENDED red, EXPIRING amber, EXPIRED_AND_SUSPENDED red), and a **Detail →** link to `/admin/tenants/{slug}?tab=ringkasan`.
- Error: sonner toast + inline retry (Wave 1 pattern).
- Since Garindo currently has status=ACTIVE + expires_at far out, the empty state will still render in prod — verify manually by temporarily setting Garindo's expires_at close via MCP DO block with RAISE rollback.

### 8c. Wave 4a regression

- `npx tsc --noEmit` clean.
- `npx vitest run` — no new failures beyond pre-existing 5.
- `npm run build` succeeds.
- Manual walkthrough (admin login):
  - `/admin` → AdminHome renders with real attention queue (empty state OK for prod).
  - `/admin/tenants` → row Suspend/Activate buttons render per status; Impersonasi still works.
  - `/admin/tenants/garindo?tab=ringkasan` → Perpanjang CTA visible; modal opens; smoke fires RPC.
  - `/admin/plans` → each plan card has Edit button; edit form submits; toast shown; card returns to view mode with new data.
  - Non-super-admin session (simulate by mocking `isSuperAdmin() = false`): Edit button hidden or disabled with tooltip "Butuh super admin". Confirm backend still rejects with 403 if bypassed.
- Garindo `/dashboard` renders normally (regression).

### Commit sequence within Task 8

Commit 8a first (PlansManagement edit + super-admin gate), then 8b (AttentionQueue live data), then 8c (progress.md close-out).

```
feat(phase-b-wave4a): Task 8a — PlansManagement edit mode + super-admin gate

- Inline edit form per plan card: name, description, target_segment,
  price_reference, is_recommended, feature_bundle JSON
- Super-admin FE gate (TODO: swap to admin_role JWT claim in Wave 4b)
- Backend already gated via _assert_super_admin_from_jwt (Task 3)
- Vitest coverage for edit flow + gate rendering
```

```
feat(phase-b-wave4a): Task 8b — AttentionQueue live data

- Fetch via listAttentionTenants(45) on mount
- Renders rows with plan badge, days_until_expiry color coding,
  attention_reason chip, Detail link to tenant view
- Preserves Wave 1 empty state when 0 rows
- Vitest coverage for loading/success/error/empty states
```

```
docs(progress): Wave 4a complete — renewal + polish

Wave 4a done. 4 RPCs + 5 FE components. Full regression passed.
Ready for Wave 5 (payment tracking).
```

---

## Wave 4a completion checklist

- [ ] All 4 migrations applied to Garindo prod via MCP.
- [ ] All 4 pgTAP files in `supabase/tests/wave4a/` cover non-admin + happy path minimum.
- [ ] `adminApi.ts` typed wrappers for all 5 RPCs (list_attention_tenants + 4 write RPCs).
- [ ] `adminTypes.ts` has no `any`.
- [ ] `RenewSubscriptionModal` + `SuspendTenantModal` render Bahasa copy + VOSI tokens.
- [ ] `TenantsList` row actions + `OverviewTab` Perpanjang CTA + `PlansManagement` edit mode all functional.
- [ ] `AttentionQueue` reads live data.
- [ ] All new user-facing strings are Bahasa Indonesia.
- [ ] All new hex-literal usage is via `bg-vosi-*` / `text-vosi-*` tokens (zero inline hex added by Wave 4a).
- [ ] Vitest suite: no new failures beyond Wave 1's pre-existing 5.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] Garindo `/dashboard` regression clean.
- [ ] Whole-branch final code review dispatched (Task 15-equivalent) via `requesting-code-review` on opus.
- [ ] Any Critical/Important findings fixed via single fix subagent.
- [ ] Ledger + progress.md updated.
- [ ] Frontend deployed via Cloud Run per `docs/cloud-run-promote-runbook.md`.
