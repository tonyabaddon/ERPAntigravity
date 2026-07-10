# SDD Progress Ledger — Multi-Tenant Phase B Wave 5 (Payment Tracking + Revenue)

Plan: docs/superpowers/plans/2026-07-05-multi-tenant-phase-b-wave5-payment-revenue.md
Spec: docs/superpowers/specs/2026-07-04-multi-tenant-phase-b-design.md (§15 + §10.1)
Worktree: .claude/worktrees/phase-b-wave5
Branch: worktree-phase-b-wave5
Base commit: d69319a (fix(admin): E2E audit polish)
Started: 2026-07-05
Preceded by: Wave 1 (efc7f40) + Wave 4a (54dc434) + audit polish (d69319a). Cloud Run: 00235-cam.

## Pre-flight decisions

- Worktree isolation: YES
- Migration slot range: 20261115000020–20261115000029 (Wave 5 reserved; Wave 4a used 000010–000013 + suffix hotfixes)
- Prod DB: Garindo `ekhhojaezdfjfwuxyjkl`
- Ownership pattern: `postgres` for SECDEF RPCs touching auth.uid / platform_admins / storage.functions; `vosi_rpc_owner` for pure reads
- Language: Bahasa Indonesia (per Wave 4a Global Constraints)
- VOSI Design System: new files use tokens (`bg-vosi-*` etc)
- Custom router: `src/lib/urlRoute.ts` (AdminRoutes.tsx inline regex)
- Deferred per memory `phase-b-wave-reorder`: onboarding wizard step 6 (§15.3a) — wizard is BLOCKED

## Carryover from Wave 1 + 4a

- `platform_admin_audit.action` CHECK whitelist includes 12 codes: IMPERSONATE_START/END, CREATE_TENANT, CHANGE_PLAN, CHANGE_FEATURES, SUSPEND, ACTIVATE, ARCHIVE, RENEW_SUBSCRIPTION, SUSPEND_TENANT, ACTIVATE_TENANT, UPDATE_PLAN. Task 2 (Wave 5) will extend with +RECORD_PAYMENT +UPDATE_PAYMENT +DELETE_PAYMENT +UPLOAD_PAYMENT_PROOF.
- `platform_admin_audit.tenant_id` is nullable (Wave 4a Task 3 relaxation) — payment audit rows tie to a real tenant so this doesn't matter here, but noted.
- `plans.g_read_all` policy TO {authenticated, vosi_rpc_owner} (Wave 1 002c fix). Task 1 extension via ALTER doesn't need policy changes.
- Storage bucket work: NEW territory in this wave. Verify `storage.buckets` + `storage.objects` RLS shape via MCP before writing Task 3.

## Tasks

### Task 1 — plans.price_annual (COMPLETE)
- Migration: `20261115000020_phase_b_wave5_plans_price_annual.sql`
- Test: `supabase/tests/wave5/plans_price_annual.sql`
- Applied to Garindo prod. Verified price_annual column + 3 seed values.

### Task 2 — tenant_payments table + RLS + audit CHECK (COMPLETE)
- Migration: `20261115000021_phase_b_wave5_tenant_payments_table.sql`
- Test: `supabase/tests/wave5/tenant_payments_table.sql`
- Applied to Garindo prod (`ekhhojaezdfjfwuxyjkl`). Verified:
  - Table exists, both indexes present
  - RLS=true, FORCE RLS=true
  - Policy `p_platform_admin_only` on {authenticated, vosi_rpc_owner}
  - Audit CHECK extended to 16 codes (+ RECORD_PAYMENT, UPDATE_PAYMENT, DELETE_PAYMENT, UPLOAD_PAYMENT_PROOF)
  - Smoke INSERT (BANK_TRANSFER + BCA) succeeded + rolled back
- Drift fix: `audit_id BIGINT` (spec said UUID; platform_admin_audit.id is BIGINT per Wave 1 Task 3)
- Added `set_updated_at` trigger (consistent with project convention)

### Task 4 — record_payment + update_payment + delete_payment RPCs (COMPLETE)
- Migration: `20261115000023_phase_b_wave5_payment_write_rpcs.sql`
- Tests: `supabase/tests/wave5/record_payment.sql` (12 assertions) + `supabase/tests/wave5/update_delete_payment.sql` (18 assertions)
- Applied to Garindo prod. All 3 RPCs: owner=postgres, SECDEF, EXECUTE to authenticated ✓
- Smoke test: record (1M→OVERDUE) → update (3M) → delete → audit trail all verified live ✓
- Validation: UNKNOWN_FIELD, INVALID_AMOUNT, INVALID_PERIOD, REASON_REQUIRED, P0403, P0404 all correct ✓
- Coverage formula §15.5 implemented: LUNAS/DP_60/DP_30/OVERDUE/UNPAID/UNKNOWN ✓
- Drift: tenant_subscriptions has no `status` column; price_annual NULL guarded with UNKNOWN status

### Task 5 — list_payments + get_revenue_stats read RPCs (COMPLETE)
- Migration: `20261115000024_phase_b_wave5_payment_read_rpcs.sql`
- Fix patches applied in prod via `20261115000024b` (RAISE syntax) + `20261115000024c` (nested aggregate)
- Tests: `supabase/tests/wave5/list_payments.sql` (11 assertions) + `supabase/tests/wave5/get_revenue_stats.sql` (10 assertions) + `supabase/tests/wave5/generate_payment_proof_signed_url.sql` (1 assertion — documents non-existence)
- Applied + smoke-tested on Garindo prod (`ekhhojaezdfjfwuxyjkl`). All 15 smoke cases PASSED:
  - list_payments: admin no-filter → 0 rows ✓
  - list_payments: admin with tenant_id filter → 0 rows ✓
  - list_payments: unknown key → 22023 UNKNOWN_FIELD ✓
  - list_payments: bad sort_by → 22023 ✓
  - list_payments: non-admin no filter → P0403 ✓
  - list_payments: non-admin foreign tenant_id → P0403 ✓
  - list_payments: tenant-owner own tenant_id → 0 rows ✓
  - get_revenue_stats: non-admin → P0403 ✓
  - get_revenue_stats: unknown key → 22023 ✓
  - get_revenue_stats: bad group_by → 22023 INVALID_GROUP_BY ✓
  - get_revenue_stats: total=0 ✓
  - get_revenue_stats: breakdown=[] ✓
  - get_revenue_stats: monthly_trend=12 rows ✓
  - get_revenue_stats: newest-first ✓
  - get_revenue_stats: all totals=0 ✓
- Supplementary RLS policy `p_tenant_owner_read` added to `tenant_payments` (tenant_id = _resolve_tenant_id()); needed because 002c DO-loop ran before tenant_payments existed
- DONE_WITH_CONCERNS: `generate_payment_proof_signed_url` NOT implemented — storage.*sign* SQL functions absent from project. FE must use `supabase.storage.from('payment-proofs').createSignedUrl(key, 3600)`
- Drift fixes found during smoke-test:
  - `RAISE EXCEPTION 'msg' USING ERRCODE=..., MESSAGE=...` → illegal (positional + USING message conflict); changed to pure `RAISE EXCEPTION USING errcode=..., message=...`
  - `jsonb_agg(...ORDER BY SUM(...) DESC)` → nested aggregate (42803); fixed by pre-aggregating in subquery
  - `_resolve_tenant_id()` reads `tenant_id` from `request.jwt.claims`, NOT `app.current_tenant_id` GUC — test JWT shape corrected

### Task 7 — FE paymentsApi + paymentsTypes + adminApi extension (COMPLETE)

- Files created: `src/lib/paymentsTypes.ts`, `src/lib/paymentsApi.ts`, `src/lib/paymentsApi.test.ts`
- Files modified: `src/lib/adminTypes.ts`, `src/lib/adminApi.ts`
- Types: `PaymentMethod`, `BankName`, `EwalletProvider`, `CoverageStatus` (added to adminTypes), plus full input/output shapes verbatim from brief
- 9 error classes added to `adminTypes.ts`: InvalidAmountError, InvalidPeriodError, MethodMismatchError, PaymentNotFoundError, StorageAccessDeniedError, ReasonRequiredError, InvalidGroupByError, PaymentFileTooLargeError, PaymentFileWrongTypeError
- `normalizeRpcError` in `adminApi.ts` extended with PAYMENT_NOT_FOUND (P0404 sub-branch before TENANT_NOT_FOUND), 23514 (MethodMismatchError), and all 4 new 22023 sub-branches; prior Wave 1/4a mappings intact
- `paymentsApi.ts`: 7 wrappers — recordPayment, updatePayment, deletePayment, listPayments, getRevenueStats, generatePaymentProofSignedUrl (client-side SDK), uploadPaymentProof (5MB+mime validation)
- RPC param names verified from migrations: `p_payload`, `p_payment_id`, `p_updates`, `p_reason`, `p_filters`
- `generate_payment_proof_signed_url` confirmed absent from SQL; FE uses storage SDK `createSignedUrl`
- Vitest: 43 new tests pass; 42 existing adminApi tests still pass; no new failures
- TypeScript: `npx tsc --noEmit` — zero errors in new/modified files (pre-existing 9 errors all from pg/yaml/sonner/jsonwebtoken type stubs)
- CONCERN: `PaymentRow` omits `tenant_slug`, `tenant_name`, `total_count` (per brief verbatim); Task 8 consumer will need those for pagination — extend at that point
- CONCERN: Commit message says 8 error classes but spec body lists 9; shipped 9 as correct

### Task 8 — FE RecordPaymentModal + PembayaranTab + Renew chain (COMPLETE)

- Commits: 6bdbd99 (8a), 4aa92ad (8b+8c), abe6c6c (8d)
- Files created: `src/components/admin/RecordPaymentModal.tsx` + `.test.tsx`, `src/components/admin/TenantDetail/PembayaranTab.tsx` + `.test.tsx`, `.superpowers/sdd/task-8-report.md`
- Files modified: `src/lib/adminPlansApi.ts` (price_annual), `src/components/admin/TenantDetail/TenantDetailShell.tsx` (4th tab), `src/components/admin/RenewSubscriptionModal.tsx` (payment chain)
- RecordPaymentModal: record+edit modes, 6 payment methods, conditional bank/ewallet dropdowns, file upload (mandatory if !CASH), client-side file validation, period inputs, 26 Vitest tests
- PembayaranTab: coverage summary strip (CoverageStatus computed client-side per §15.5), table with Edit/Delete/Bukti actions, DeleteConfirmDialog, signed-URL preview, 15 Vitest tests
- TenantDetailShell: 'pembayaran' added as 4th tab; existing 9 tests still pass
- RenewSubscriptionModal: optional payment chain (checkbox), partial-success toasts for upload/record failures, 28 Vitest tests (21 original + 7 new)
- TypeScript: zero new errors (same 9 pre-existing stubs); no new test failures beyond pre-existing 5
- CONCERN: CoverageStatus uses hardcoded plan prices (matches Task 1 seeds); Task 10/11 should wire v_tenant_payment_coverage view
- CONCERN: PaymentRow still lacks tenant_slug/tenant_name/total_count; pagination deferred (page_size=100 sufficient)

### Task 9 — FE AdminRevenue dashboard + charts (COMPLETE)

- Commit: 2dc009a
- Files created (12 new):
  - `src/lib/formatIDR.ts` + `.test.ts` — Indonesian Rupiah formatter "Rp X.XXX.XXX"
  - `src/components/admin/AdminRevenue.tsx` + `.test.tsx` — orchestrator (parallel fetch, loading/error/empty/happy states, coverage gap callout)
  - `src/components/admin/RevenueKPIRow.tsx` + `.test.tsx` — 4 KPI cards (Bulan ini/YTD/MRR/ARR)
  - `src/components/admin/RevenuePlanBreakdown.tsx` + `.test.tsx` — horizontal bar chart SVG
  - `src/components/admin/RevenueMonthlyTrend.tsx` + `.test.tsx` — 12-month polyline chart SVG
  - `src/components/admin/RevenueTopTenants.tsx` + `.test.tsx` — top-10 table with plan/coverage badges
- Files modified:
  - `src/components/admin/AdminSidebar.tsx` — "Pendapatan" nav item with Coins icon
  - `src/components/admin/AdminRoutes.tsx` — /admin/revenue route dispatched to AdminRevenue
- Chart decision: hand-rolled SVG (no recharts) — keeps deploy surface small, VOSI palette adherence
- MRR/ARR computed client-side from listTenantsAdmin + plans.price_annual
- Coverage gaps: direct supabase.from('v_tenant_payment_coverage').select(OVERDUE) — admin-readable per Task 6 design
- RecordPaymentModal reused for "Catat pembayaran" CTA in coverage gaps callout
- 43 new Vitest tests pass; 0 new TS errors; 7 pre-existing failures unchanged
- CONCERN: v_tenant_payment_coverage client-side SELECT requires platform admin JWT — works correctly since admin panel always has that; no additional grants needed

### Task 3 — payment-proofs Storage bucket + RLS (COMPLETE)
- Migration: `20261115000022_phase_b_wave5_payment_proofs_bucket.sql`
- Test: `supabase/tests/wave5/payment_proofs_bucket.sql`
- Applied to Garindo prod. Verified:
  - Bucket `payment-proofs` private, 5MB limit, mime={image/jpeg,image/png,application/pdf}
  - `p_platform_admin_crud` (ALL, platform_admin JWT check) created ✓
  - `t_tenant_owner_read` (SELECT, own-slug path scoping) created ✓
  - Legacy "authenticated full access payment-proofs" (ALL, no path scope) dropped ✓
- Drift: bucket pre-existed with public=true, 10MB, wrong mime types — corrected via ON CONFLICT DO UPDATE
- pgTAP: 7 assertions; anon/cross-tenant isolation tests documented as manual only (SET ROLE not available in Supabase Cloud pgTAP)

### Task 10 — CoverageStatusBadge + TenantsTable Pembayaran + AttentionQueue OVERDUE + regression (COMPLETE)

- Commits: 35905a5 (10a), dfcbb8a (10b), 10c = progress commit
- Files created: `src/components/admin/CoverageStatusBadge.tsx` + `.test.tsx` (13 tests)
- Files modified:
  - `src/lib/adminTypes.ts` — `AdminTenantRow.coverage_status?: CoverageStatus | null`, `AttentionReason` extended with `'OVERDUE'`
  - `src/lib/adminApi.ts` — `listTenantsAdmin` now parallel-fetches `v_tenant_payment_coverage`, merges `coverage_status` onto rows
  - `src/lib/adminApi.test.ts` — `mockFrom` added to supabase mock; `listTenantsAdmin` describe setup with empty coverage
  - `src/components/admin/TenantsTable.tsx` — "Pembayaran" column (header + cell) using CoverageStatusBadge
  - `src/components/admin/TenantDetail/PembayaranTab.tsx` — inline CoverageBadge replaced by CoverageStatusBadge
  - `src/components/admin/RevenueTopTenants.tsx` — inline badge replaced by CoverageStatusBadge; COVERAGE_BADGE const removed
  - `src/components/admin/RevenueTopTenants.test.tsx` — OVERDUE label updated "Lewat" → "Terlambat"
  - `src/components/admin/AttentionQueue.tsx` — parallel fetch of OVERDUE rows, merge + dedupe by tenant_id, priority sort
  - `src/components/admin/AttentionQueue.test.tsx` — supabaseClient mock + 6 new OVERDUE tests
- TypeScript: 0 new errors (same 9 pre-existing stubs)
- Vitest: 0 new failures (same 7 pre-existing; 847 total tests, 842 pass)
- CONCERN: `npm run build` likely fails locally in worktree (sonner not in worktree node_modules) — Cloud Build handles fresh install
- CONCERN: `listTenantsAdmin` now issues 1 extra select per page load; acceptable for admin panel scale (max 50 tenants per page)

### Task 16 (Wave 6, dispatched early) — platform_admin_audit action CHECK extension (COMPLETE)
- Migration: `supabase/migrations/20261115000040_platform_admin_audit_action_extension.sql`
- Test: `supabase/tests/wave6/platform_admin_audit_action_check.sql`
- Applied to Garindo prod (`ekhhojaezdfjfwuxyjkl`). Verified:
  - Pre-flight: 16 existing values matched Note B verbatim (no schema drift)
  - Existing rows: RECORD_PAYMENT (3), DELETE_PAYMENT (2), UPDATE_PAYMENT (1) — all in preserve list
  - Post-migration: 23 values confirmed via pg_get_constraintdef
  - DO-block smoke: all 7 new values (PROVISION_TENANT, DEPROVISION_TENANT, CREATE_SALES_REP, DEACTIVATE_SALES_REP, TOGGLE_MODULE, VERIFY_PAYMENT, REJECT_PAYMENT) accepted by CHECK; rolled back cleanly
- pgTAP: plan(8) = 7 lives_ok + 1 throws_ok; Docker unavailable so MCP prod smoke substitutes
- DONE_WITH_CONCERNS: pgTAP not runnable locally (Docker unavailable); MCP smoke covers prod verification per Note H
