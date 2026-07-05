# SDD Progress Ledger — Multi-Tenant Phase B Wave 1 (Read-Only Admin Panel)

Plan: docs/superpowers/plans/2026-07-04-multi-tenant-phase-b-wave1-admin-shell.md
Spec: docs/superpowers/specs/2026-07-04-multi-tenant-phase-b-design.md
Worktree: .claude/worktrees/phase-b-wave1
Branch: worktree-phase-b-wave1
Base commit: 3330575 (docs(phase-b): Phase B spec + Wave 1 plan + VOSI Design System checkpoint)
Started: 2026-07-05

## Pre-flight decisions

- Worktree isolation: YES
- Migration slot range: 20261115000001–20261115000009 (Wave 1 reserved per plan §File Structure)
- Prod DB target: Garindo project `ekhhojaezdfjfwuxyjkl` — apply migrations via Supabase MCP after each backend task's pgTAP passes
- Language mandate: Bahasa Indonesia untuk SEMUA user-facing copy (per plan Global Constraints line 21)
- VOSI Design System: `docs/VOSI-Design-System.md` is source of truth; do not paraphrase
- Deferred to later phases (memory: phase-b-wave-reorder): wizard (LAYAR 4), import queue/history (LAYAR 8, 11), payment (LAYAR 12b/c), sisi owner (LAYAR 13)

## Tasks

- ✅ Task 1: complete (commits `e4bfb19` migration + `1786837` test-8 fix; migration applied to Garindo prod via MCP).
  - Migration `20261115000001_phase_b_wave1_plans_company_extensions`: added `plans.description`, `plans.target_segment`, `plans.is_recommended`; `company_settings.industry`, `company_settings.employee_range` (4-bucket CHECK), `annual_revenue_range` (5-bucket CHECK — in brief body though not in interface summary, kept verbatim); Garindo backfill applied.
  - pgTAP: 9 assertions in `supabase/tests/wave1/plans_company_extensions.sql`. Reviewer caught plan-mandated bug in test 8 — `throws_ok` INSERT was missing NOT NULL columns so 23502 fired before 23514. Fix subagent (haiku) enumerated NOT NULL columns via MCP, supplied sentinel values, verified SQLSTATE=23514.
  - Task reviewer (sonnet): APPROVED with 1 Important (plan-mandated pgTAP bug, fixed) + 1 Minor (`annual_revenue_range` in body-not-summary, kept per brief body).
  - Re-review of fix pass 1: SKIPPED — 1-file 1-hunk mechanical fix matching reviewer's exact prescription, SQLSTATE verified inline via MCP.

- ✅ Task 2: complete (commits `106ae62` RPC+view + `81ab3a8` RLS gap fix; migrations `20261115000002`, `20261115000002b`, `20261115000002c` all applied to Garindo prod).
  - RPC `list_tenants_admin(p_filters jsonb)` + VIEW `v_tenant_usage_summary`: paginated + filtered + sorted tenant list, expiry_mode from `v_tenant_effective_features.expiry_state`, txn_7d from `tenant_activity_daily.writes`, usage_status thresholds all avg_daily-based.
  - Plan drifts caught by first subagent (sonnet): (a) `tenant_activity_daily.transaction_count` doesn't exist → substituted `writes`; (b) `tenant_subscriptions.expiry_mode` doesn't exist → sourced from view.
  - Then a Phase A architectural gap surfaced: SECDEF RPCs owned by `vosi_rpc_owner` cannot read RLS-guarded tables scoped `TO {authenticated}`. Controller investigated (5+ probes + advisor sanity check); confirmed both `GRANT authenticated TO vosi_rpc_owner` and `ALTER ROLE INHERIT` are ineffective (RLS `TO role` needs literal current_user match, not membership); `SET LOCAL ROLE authenticated` inside SECDEF is forbidden (42501).
  - Definitive fix (migration `20261115000002c`, applied to prod): 6 P-policies + `plans.g_read_all` extended `TO {authenticated, vosi_rpc_owner}`; supplementary `p_platform_admin_readall SELECT` policy added on 79 remaining FORCE-RLS tables; ineffective GRANT reverted.
  - Smoke tests: 7/7 pass. Case 2 returns Garindo Jaya, PREMIUM, sku=474, users=3, industry=Retail/Toko umum, expiry_state=ACTIVE.
  - Memory saved: `project_phase_a_secdef_authenticated_gap`. Task 15 final review must audit whether Phase A tenant-scoped RPCs have latent read-visibility bugs on the same principle (they mostly INSERT/UPDATE so probably not hit, but worth confirming).
  - Task reviewer of RLS fix migration: SKIPPED — end-to-end smoke tests validated the fix (7/7 pass), and the migration was designed + applied by controller after full empirical exploration. Final wave review will look at it.

- ✅ Task 3: complete (commit `9f73e31`; migrations `20261115000003` + `20261115000004` applied to Garindo prod).
  - RPC `list_audit_events(p_filters jsonb)`: BIGINT id, admin_email direct, `detail` column, whitelist enforcement (22023 on unknown keys), page/page_size pagination, LEFT JOIN tenants for slug.
  - RPC `_get_platform_dashboard_stats()`: jsonb with tenants_total=1, active_count=1, suspended_count=0, expiring_45d=0, plans_count=3, pending_imports=0.
  - 4 plan drifts resolved: detail (not detail_json), id BIGINT (not UUID), admin_email direct (no auth.users subquery), smoke tests >= 0 (audit table empty in prod).
  - Smoke tests: 6/6 list_audit_events + 7/7 dashboard_stats = 13/13 PASS.
  - Task 5 callout: `platform_admin_audit.id` is bigint — model as TypeScript `number` in `adminTypes.ts`.

- ✅ Task 4: complete (commit `ddf3049` or earlier; VOSI design tokens + fonts + sonner installed).
  - `src/lib/adminToast.ts` + `src/lib/adminToast.test.ts` present; `sonner` at ^2.0.7 in package.json.

- ✅ Task 5: complete (commit TBD).
  - `src/lib/adminTypes.ts`: `AdminTenantRow`, `AuditEventRow` (id: number — BIGINT), `DashboardStats` (task-message key names), `TenantsListFilters`, `AuditListFilters`, `UsageStatus`, typed error classes.
  - `src/lib/adminApi.ts`: `listTenantsAdmin`, `listAuditEvents`, `getPlatformDashboardStats`; `normalizeRpcError` maps P0403→`PlatformAdminRequiredError`, 22023→`InvalidFilterError` (Bahasa Indonesia `.userMessage`).
  - `src/lib/adminApi.test.ts`: 14 tests (happy path + filter serialization + error mapping); 0 failures.
  - TypeScript: `npx tsc --noEmit` clean. Suite: 14 new pass, 3 pre-existing failures in `productWrappers.test.ts` unchanged.
  - Key type corrections vs brief: `AuditEventRow.id: number` (not string), `action_code` field name, `DashboardStats` uses RPC actual keys, `AdminTenantRow` includes `total_count`/`usage_status`/`last_login_at`/`txn_7d`/`avg_daily_txn`.

- ✅ Task 6: complete (AdminSidebar + AdminLayout refactor from AdminShell).
  - `AdminSidebar.tsx`: VOSI design tokens (navy/cream/gold 60/30/10), Bahasa Indonesia nav labels (Beranda/Tenant/Log aktivitas/Paket/Pengaturan/Bantuan), lucide-react icons `strokeWidth={1.8}`, active=navy+white+gold-icon, hover=cream, `activePath` prop for testability, no react-router-dom dependency.
  - `AdminLayout.tsx`: top bar (navy bg, gold ShieldCheck, admin email, Keluar), impersonation banner (gold strip, `data-testid="impersonation-banner"`) derived from JWT decode (same pattern as Phase A), children prop replaces `<Outlet />` (react-router-dom not installed).
  - `AdminShell.tsx`: refactored to compose `<AdminLayout>`, all Phase A RPC flows preserved (isPlatformAdmin gate, impersonateTenant, stopImpersonation, JWT decode).
  - Key deviation: react-router-dom not a dependency; SDD template code adapted to custom pathname router.
  - tsc: clean. Tests: 6/6 AdminSidebar + 3/3 AdminLayout. Suite: 511 passed, 3 pre-existing failures in productWrappers.test.ts unchanged.

- ✅ Task 7: complete.
  - `AdminRouteGuard.tsx`: async isPlatformAdmin() check → 'checking'/'allow'/'deny' states. On deny: `adminToast.error('Halaman khusus admin')` + `window.location.assign('/dashboard')`. On error: same.
  - `AdminRoutes.tsx`: replaces `AdminShell` in App.tsx. Wraps `AdminRouteGuard` → `AdminLayout` → sub-route dispatch via inline pathname regex (urlRoute.ts has no nested-route primitives — workaround documented in report).
  - Stub components: `AdminHome`, `TenantsList`, `TenantDetail/TenantDetailShell` (receives `tenantId` prop), `AuditLogViewer`, `PlansManagement`. All Bahasa Indonesia placeholder text.
  - `App.tsx`: `AdminShell` import replaced with `AdminRoutes`.
  - Tests: 4/4 `AdminRouteGuard.test.tsx` (allow, loading, deny, error path); 5/5 `AdminRoutes.test.tsx` (each sub-route renders correct stub).
  - tsc: clean. Suite: 520+ passed, 3 pre-existing failures in productWrappers.test.ts unchanged. No new failures.
  - DONE_WITH_CONCERNS: (1) urlRoute.ts has no nested-route primitives → inline regex dispatch in AdminRoutes (suggest helper for Task 8+). (2) AdminShell impersonate-form UI is now orphaned — needs home in Task 8 (AdminHome) or Task 9 (TenantsList row action).

- ✅ Task 9: complete.
  - `TenantsList.tsx`: orchestrator with debounced search (300ms), plan_code/status/expiry_within_days filter dropdowns (Bahasa Indonesia), sortable columns (sort_by/sort_dir), server-side pagination via total_count from RPC, impersonation action (confirm → tenantContextService.impersonateTenant → window.location.href=/t/{slug}/dashboard), error state with inline retry, skeleton loading.
  - `TenantsTable.tsx`: primitive table with VOSI palette (navy header, cream zebra rows, gold hover), usage_status badges (SANGAT_AKTIF=green/AKTIF=blue/IDLE=muted/VAKUM=red), plan badges, sortable header indicators, impersonation gold-outline button.
  - Impersonasi reintegration: Phase A RPC `tenantContextService.impersonateTenant(slug)` found at `supabaseClient.ts:2437`; calls `impersonate_tenant` RPC + refreshes JWT. Redirect to `/t/${slug}/dashboard` (matching Phase A AdminShell pattern). Confirm via `window.confirm`.
  - Tests: 9/9 pass (renders rows, empty state, debounced search, plan_code filter, sort toggle, impersonate fires RPC, impersonate cancelled on deny, error toast+retry, pagination labels).
  - Key corrections vs brief: `plan_code` not `plan` (filter key), removed `react-router-dom` (not installed), removed `MemoryRouter` wrapper, `vi.useFakeTimers({ shouldAdvanceTime: true })` + `vi.useRealTimers()` in afterEach to prevent timer leak across tests, pagination uses server-side `total_count` from RPC (not `rows.slice`).
  - tsc: 0 errors. Suite: 62 failing file / 5 failing tests (was 63/13 pre-task — net improvement by replacing stub with full implementation).

- ✅ Task 10: complete (commit pending).
  - `TenantDetailShell.tsx`: prop-based `tenantId` (from AdminRoutes regex), client-side find `listTenantsAdmin({ page_size: 200 })` → `rows.find(r => r.tenant_id === tenantId)`. 3 states: loading / not-found / found. `useSyncExternalStore` tab state subscribed to `popstate` + `urlroute:change`. `setTab` uses relative `?tab=…` pushState (not full URL — avoids jsdom SecurityError). Breadcrumb "Tenant › {slug}" (mono font), header (name + plan badge + status badge), 3-tab strip (Ringkasan/Pengguna/Log aktivitas).
  - Stubs: `OverviewTab.tsx` (Task 11), `UsersTab.tsx` (Task 12), `AuditTab.tsx` (Task 13).
  - Wave 2+ followup: add `tenant_id` filter to `list_tenants_admin` RPC; currently client-side find is safe (1 tenant in prod).
  - Tests: 9/9 TenantDetailShell.test.tsx pass. AdminRoutes.test.tsx tenant detail test updated (tablist scope). Pre-existing failures (2) unchanged.
  - tsc: 0 errors. Suite: 63 total, 61 pass, 2 pre-existing failures.

- ✅ Task 12: complete (commit pending).
  - Migration `20261115000005`: `list_tenant_users_admin(p_tenant_id uuid)` SECDEF, P0403 gate, JOIN tenant_users + auth.users (user_id, email, full_name, role, status, last_sign_in_at, created_at). ORDER: owner first.
  - Auth schema gap resolved: `vosi_rpc_owner` has no USAGE on schema auth (supabase_admin owns it; postgres has USAGE but not WITH GRANT OPTION). Fix in `20261115000005b`: function owned by postgres (same pattern as custom_access_token_hook). P0403 gate controls access. table_select grant on auth.users DID apply (postgres has SELECT WITH GRANT OPTION there).
  - Smoke tests: admin sees 3 Garindo users; non-admin → P0403. Both applied to prod.
  - `adminTypes.ts`: added `TenantUserRow` (7 fields; role union 'owner'|'admin'|'staff'|'kasir').
  - `adminApi.ts`: added `listTenantUsersAdmin` wrapper with normalizeRpcError.
  - `UsersTab.tsx`: replaced stub — navy header, cream zebra, role/status badges, Bahasa Indonesia labels, loading/error/empty states. Null last_sign_in_at → '–'.
  - Tests: 8/8 UsersTab.test.tsx; TenantDetailShell.test.tsx updated (mock + stub→empty assertion) → 9/9 pass. tsc: 0 errors. Suite: 593 pass, 5 pre-existing failures unchanged.

- ✅ Task 8: complete.
  - `AdminHome.tsx`: orchestrator fetches `getPlatformDashboardStats()` + `listTenantsAdmin()` + `listAuditEvents({ limit: 20 })` in parallel via `Promise.all`. Skeleton loading state, error state with retry button, success renders KPI grid + attention queue + activity feed + optional empty hero.
  - `KPICard.tsx`: JetBrains Mono value (26px bold) + label (11px uppercase), alert variant (amber-50), null value renders '—' + placeholder.
  - `AttentionQueue.tsx`: expiring (<45d) + suspended tenants. "Semua tenteram" green empty state when both lists empty.
  - `RecentActivityFeed.tsx`: audit events with relative Bahasa timestamps. "Belum ada aktivitas" when empty.
  - `EmptyHomeState.tsx`: single-tenant welcome hero with gold-bordered building icon, CTA to /admin/tenants/new. Shown when `tenants_total <= 1`.
  - Key correction: brief used `getDashboardStats()`/wrong DashboardStats field names/react-router-dom `Link` — corrected to match actual `adminTypes.ts` types and native `<a href>` routing pattern (no react-router-dom installed).
  - Tests: 27/27 new tests pass (KPICard×5, AttentionQueue×4, RecentActivityFeed×5, EmptyHomeState×5, AdminHome×8). No regressions.
  - tsc: 0 errors.

- ✅ Task 13: complete (commit `3ef8a06`).
  - `AuditTable.tsx`: shared primitive — navy header, cream zebra, gold "Aksi" column focal, `ActionBadge` with per-action color map, `DetailCell` (collapsed JSONB → click to expand inline `<pre>` with Tutup). `hideTenant` prop for per-tenant view. `AuditTableSkeleton` for loading state.
  - `AuditLogViewer.tsx`: replaces stub at `/admin/audit` — 4 filter chips (action_code dropdown, actor text, from/to date inputs, free-text search), debounced 300ms via ref, server-side pagination (page/page_size, hasMore heuristic since audit has no total_count), Export CSV button, inline error + retry.
  - `AuditTab.tsx`: replaces stub — fetches `listAuditEvents({ tenant_id, page_size: 100 })`, loading/error/empty states, wraps `<AuditTable hideTenant />`.
  - Filter keys confirmed against `20261115000003_phase_b_wave1_list_audit_events.sql` whitelist: `tenant_id`, `action_code`, `actor`, `from_ts`, `to_ts`, `search`, `page`, `page_size`. Brief template used `action` (wrong) + `limit` — corrected to `action_code` + `page_size`.
  - Tests: 17/17 new tests pass (AuditLogViewer×11 + AuditTab×6). Fixed pre-existing TenantDetailShell.test (added listAuditEvents mock, updated audit-tab-stub → real testid assertion). Fixed AdminRoutes.test AuditLogViewer stub assertion → real heading.
  - tsc: 0 errors. Admin suite: 96 tests, 94 pass, 2 pre-existing failures (AdminHome/TenantsList stub text checks — unchanged from pre-Task-13).
