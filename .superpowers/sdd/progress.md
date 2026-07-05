# SDD Progress Ledger — Multi-Tenant Phase B Wave 4a (Renewal + Polish)

Plan: docs/superpowers/plans/2026-07-05-multi-tenant-phase-b-wave4a-renewal-polish.md
Spec: docs/superpowers/specs/2026-07-04-multi-tenant-phase-b-design.md (§7 + §10.1)
Worktree: .claude/worktrees/phase-b-wave4a
Branch: worktree-phase-b-wave4a
Base commit: bdb4916
Started: 2026-07-05
Preceded by: Wave 1 (merged efc7f40, deployed Cloud Run 00231-tig @ 100%)

## Tasks

- ✅ Task 1 (`4513573`): `renew_subscription` RPC. Postgres-owned (auth-schema gap). Migration 000010 + 000010b (owner→postgres hotfix) + 000010c (body-fix hotfix for generated `grace_expires_at` column). pgTAP 5 cases; smoke 5/5 pass.
- ✅ Task 2 (`f3ed76f`): `suspend_tenant` + `activate_tenant` RPCs. Postgres-owned. Migration 000011. pgTAP 13 cases; smoke 10/10 pass. Extended platform_admin_audit CHECK whitelist +SUSPEND_TENANT +ACTIVATE_TENANT.
- ✅ Task 3 (`4897223` + `b339cc7`): `_assert_super_admin_from_jwt` helper + `update_plan_admin` RPC. Postgres-owned, double-gated. Migration 000012. pgTAP 9 cases + smoke 5/5. Fixed schema drift: `platform_admin_audit.tenant_id` relaxed to nullable for platform-scoped audits.
- ✅ Task 4 (`9756b3b`): `list_attention_tenants` READ RPC. vosi_rpc_owner-owned (no auth schema). Migration 000013. pgTAP 7 cases + smoke 7/7 pass. Task landed inline after socket timeout on subagent dispatch.
- ✅ Task 5 (`ac93185`): adminApi + adminTypes extensions. 5 new wrappers, 5 new typed error classes, normalizeRpcError extended. 42/42 tests pass.
- ✅ Task 6 (`48d571e`): RenewSubscriptionModal + OverviewTab Perpanjang CTA. Modal has date + plan + notes fields, VOSI palette, ESC/backdrop close. TenantDetailShell re-fetches on success via refreshKey. 21/21 tests pass. Plan select defaults to "Tidak diganti" to avoid accidental CHANGE_PLAN audit events.
- ✅ Task 7 (`3bdba2e`): Suspend/Activate row actions in TenantsTable. SuspendTenantModal with reason required + warning callout. Activate via window.confirm. 18 SuspendModal + 12 TenantsTable tests pass. "Suspend" term (not "Tangguhkan") to match Wave 1's existing badge.
- ✅ Task 8a (`0411666`): PlansManagement edit mode. isSuperAdmin gate (proxied through is_platform_admin; Wave 4b TODO). Inline edit form: description, target_segment, is_recommended, feature_bundle JSON. 11/11 tests pass. New Wave 4a code uses VOSI tokens (bg-vosi-*, text-vosi-*).
- ✅ Task 8b (`e7433a3`): AttentionQueue live data. Self-fetches via listAttentionTenants(45). Server-side sort by urgency, attention_reason enum chips. AdminHome derivation removed. 10 new tests + 10 existing AdminHome tests all pass.
- ✅ Task 8c (this commit): Wave 4a regression.
  - tsc: 9 pre-existing errors (tests/isolation/* missing pg/jsonwebtoken types — same as Wave 1 baseline). Zero new errors in Wave 4a code.
  - Vitest src/: 686 pass / 5 fail (same 5 pre-existing failures as Wave 1 close: productWrappers.test.ts × 3 + AdminRoutes stub-text × 2). Zero new failures.
  - Vitest full including tests/isolation + tests/integration: extra failures are all pre-existing (missing pg module in the worktree — Cloud Build installs deps fresh so prod deploy is unaffected).
  - npm run build: FAILS locally in worktree because `sonner` isn't in worktree node_modules (never installed here). Wave 1 shipped fine via Cloud Build (which does fresh install) and this hasn't changed. Not a code issue; Cloud Build will succeed on push.

## Migrations applied to Garindo prod via MCP

- 20261115000010 renew_subscription (bad body, superseded)
- 20261115000010b owner → postgres hotfix
- 20261115000010c body-fix (grace_expires_at generated + correct return)
- 20261115000011 suspend_tenant + activate_tenant
- 20261115000012 _assert_super_admin_from_jwt + update_plan_admin
- 20261115000013 list_attention_tenants

## Prod state after Wave 4a

- 4 new write RPCs + 1 new read RPC + 1 new helper.
- `platform_admin_audit.action` CHECK now includes: (Wave 1 8 codes) + RENEW_SUBSCRIPTION + SUSPEND_TENANT + ACTIVATE_TENANT + UPDATE_PLAN.
- `platform_admin_audit.tenant_id` relaxed to nullable (Task 3 drift fix).
- Garindo tenant unchanged (all smoke tests used DO-block RAISE rollback).

## Next

Task 9: Final whole-branch code review (opus). Then merge + Cloud Run deploy per Wave 1 pattern.
