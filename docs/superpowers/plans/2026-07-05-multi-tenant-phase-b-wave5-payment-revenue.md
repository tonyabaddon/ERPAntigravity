# Multi-Tenant Phase B — Wave 5: Payment Tracking + Revenue Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the founder visibility into per-tenant payments (amount, method, proof) and platform-wide revenue (MRR / ARR estimates, YTD, per-plan breakdown, monthly trend, top tenants), plus derive a payment-coverage status per tenant that surfaces in TenantsList, TenantDetail Overview, and AttentionQueue.

**Architecture:** Additive to Waves 1 + 4a. One new table `tenant_payments`, one new Supabase Storage bucket `payment-proofs`, one plan column extension (`price_annual`), 5 new SECDEF RPCs (`record_payment`, `update_payment`, `delete_payment`, `list_payments`, `get_revenue_stats`, `generate_payment_proof_signed_url`), 1 helper view `v_tenant_payment_coverage`. Frontend adds one new route `/admin/revenue`, one new tab in TenantDetail (`Pembayaran`), extends RenewSubscriptionModal (Wave 4a) with optional payment fields, and extends `list_tenants_admin` output shape with coverage status.

**Tech Stack:** Same as Wave 4a — React 19 + TypeScript + Vite + Tailwind CSS v4 (`@theme` CSS-only) + custom `urlRoute.ts` router + Vitest + React Testing Library + Supabase (Postgres + Auth + RPC + Storage) + sonner. New optional dep for charts (decide during Task 8): either lightweight `recharts` or hand-rolled SVG.

**Not in scope (per memory `phase-b-wave-reorder`):** the "onboarding wizard Step 6 Pembayaran awal" touchpoint from spec §15.3(a) — the wizard is BLOCKED until real UI captured. Wave 5 covers the 2 super-admin touchpoints: renewal-modal payment field and new Pembayaran tab.

## Global Constraints

Every task inherits these. Reviewers reject work that violates them.

- **Migration slot range:** `20261115000020–20261115000029` (Wave 5 reserved; Wave 1 used 000001–000005b, Wave 4a used 000010–000013 + 000010b/000010c hotfixes).
- **Every RPC gate:** `IF NOT public._is_platform_admin_from_jwt() THEN RAISE EXCEPTION USING errcode='P0403', message='PLATFORM_ADMIN_REQUIRED'; END IF;` — reviewers reject RPCs missing this. **Exceptions:** `list_payments` and `get_revenue_stats` also allow tenant owner reads scoped to `own tenant_id` (spec §15.2). `generate_payment_proof_signed_url` follows the same tenant-scoped read pattern.
- **RPC ownership pattern (from Wave 1 Task 12 + Wave 4a Tasks 1-3):** any SECDEF RPC that calls `auth.uid()` or SELECTs from `platform_admins` MUST be owned by `postgres` (vosi_rpc_owner can't USAGE the auth schema). Pure read RPCs like `list_payments` and `get_revenue_stats` can stay `vosi_rpc_owner`.
- **Unknown filter key** in any RPC payload: raise `errcode='22023'` (invalid_parameter_value) — Wave 1 + 4a pattern.
- **Whitelist enforcement** on `update_payment` payload keys and on `list_payments` filters.
- **Bahasa Indonesia** for ALL user-facing copy. Reviewers reject English labels like "Payments", "Amount", "Cancel", "Save".
- **VOSI Design System v1.0** — new files use `bg-vosi-*`, `text-vosi-*`, `font-vosi` tokens from day one. Grandfathered Wave 1 inline hex in modified files remains but do not add more.
- **60/30/10** — Navy or Cream dominant, one gold focal per screen/modal.
- **Font size floor:** 11px minimum. Reviewers reject `text-[10px]` (Wave 4a Task 9 review's I1 finding).
- **Data fetching:** `useEffect + async` (no react-query). Loading = skeleton in VOSI palette. Error = sonner error toast + inline retry. Cancel in-flight requests when deps change.
- **Custom router:** `src/lib/urlRoute.ts` — NOT react-router-dom. Wave 5's `/admin/revenue` route extends the inline regex dispatch in `AdminRoutes.tsx`.
- **Test files:** `.test.tsx` co-located. No `any` types. Full suite: no NEW failures beyond pre-existing 5.
- **Toast wrapper:** `adminToast` from `src/lib/adminToast.ts` (Wave 1). Never call `sonner.toast` directly. Never `alert()`.
- **Error mapping:** extend `src/lib/adminApi.ts`'s `normalizeRpcError` with SQLSTATE-specific error classes carrying Bahasa `.userMessage`.
- **Garindo tenant MUST continue to render normally** — regression test at end of each FE task; full regression pass in Task 10.
- **No writes to prod from tests** — pgTAP files roll back; smoke tests use `DO`-block + RAISE-abort pattern (memory `reference_smoke_test_security_definer_rpcs`).
- **Currency:** All amounts in `NUMERIC(15,2)` IDR. FE formats as `Rp X.XXX.XXX` (Indonesian locale). No cents in display.
- **Storage bucket ACL:** signed URLs only (1-hour TTL). Do NOT make `payment-proofs` public.

## Migration ordering — critical

Wave 5's migrations MUST apply in slot order. Migration numbering:

- `20261115000020` — `plans.price_annual` column + seed values (STARTER 1.2M, PRO 3.6M, PREMIUM 9M IDR).
- `20261115000021` — `tenant_payments` table + indexes + RLS policy (P-scoped) + audit CHECK extension (+ RECORD_PAYMENT / UPDATE_PAYMENT / DELETE_PAYMENT / UPLOAD_PAYMENT_PROOF).
- `20261115000022` — `payment-proofs` Supabase Storage bucket (via SQL wrapper) + Storage RLS (platform admin CRUD; tenant owner READ path prefix `<own-slug>/*`).
- `20261115000023` — `record_payment` RPC + `update_payment` + `delete_payment` (postgres-owned — auth.uid + platform_admins).
- `20261115000024` — `list_payments` + `get_revenue_stats` + `generate_payment_proof_signed_url` (vosi_rpc_owner-owned for reads; sign URL variant is postgres-owned because it needs Storage API access).
- `20261115000025` — `v_tenant_payment_coverage` view (per-tenant total_paid + expected + status derivation LUNAS/DP_60/DP_30/OVERDUE/UNPAID).

---

## File Structure

**Backend (SQL migrations):**
- `supabase/migrations/20261115000020_phase_b_wave5_plans_price_annual.sql`
- `supabase/migrations/20261115000021_phase_b_wave5_tenant_payments_table.sql`
- `supabase/migrations/20261115000022_phase_b_wave5_payment_proofs_bucket.sql`
- `supabase/migrations/20261115000023_phase_b_wave5_payment_write_rpcs.sql`
- `supabase/migrations/20261115000024_phase_b_wave5_payment_read_rpcs.sql`
- `supabase/migrations/20261115000025_phase_b_wave5_tenant_payment_coverage_view.sql`

**Backend (pgTAP tests):**
- `supabase/tests/wave5/tenant_payments_table.sql`
- `supabase/tests/wave5/payment_proofs_bucket.sql`
- `supabase/tests/wave5/record_payment.sql`
- `supabase/tests/wave5/update_delete_payment.sql`
- `supabase/tests/wave5/list_payments.sql`
- `supabase/tests/wave5/get_revenue_stats.sql`
- `supabase/tests/wave5/generate_payment_proof_signed_url.sql`
- `supabase/tests/wave5/v_tenant_payment_coverage.sql`

**Frontend (new files):**
- `src/components/admin/TenantDetail/PembayaranTab.tsx` — riwayat table + coverage summary + Catat CTA
- `src/components/admin/RecordPaymentModal.tsx` — form with proof upload
- `src/components/admin/AdminRevenue.tsx` — `/admin/revenue` orchestrator
- `src/components/admin/RevenueKPIRow.tsx` — 4 KPI cards
- `src/components/admin/RevenuePlanBreakdown.tsx` — bar chart per plan
- `src/components/admin/RevenueMonthlyTrend.tsx` — line chart 12 months
- `src/components/admin/RevenueTopTenants.tsx` — top-10 table
- `src/components/admin/CoverageStatusBadge.tsx` — reusable badge (LUNAS/DP_60/DP_30/OVERDUE/UNPAID) with VOSI color mapping
- `src/lib/paymentsApi.ts` — typed wrappers for the 5+ payment RPCs (kept separate from `adminApi.ts` to avoid file growth)
- `src/lib/paymentsTypes.ts` — payment + revenue + coverage type shapes

**Frontend (modified):**
- `src/lib/adminApi.ts` — extend `normalizeRpcError` with payment SQLSTATE codes
- `src/lib/adminTypes.ts` — add `CoverageStatus` enum union + extend `AdminTenantRow` with coverage fields (from `list_tenants_admin` extension) OR keep separate to avoid breaking Wave 1 consumers — Task 6 decides
- `src/components/admin/TenantDetail/TenantDetailShell.tsx` — add "Pembayaran" 7th tab; tab state remains URL-driven (`?tab=pembayaran`)
- `src/components/admin/TenantsTable.tsx` — new "Pembayaran" column with CoverageStatusBadge
- `src/components/admin/AttentionQueue.tsx` — extend `attention_reason` enum with `OVERDUE` variant (from server); include coverage-based rows
- `src/components/admin/AdminSidebar.tsx` — add "💰 Pendapatan" entry pointing to `/admin/revenue`
- `src/components/admin/AdminRoutes.tsx` — register `/admin/revenue` regex + AdminRevenue mount
- `src/components/admin/RenewSubscriptionModal.tsx` (Wave 4a) — extend with optional payment fields (nominal + method + upload + reference). If checked, call `record_payment` after `renew_subscription` succeeds (chained in the modal's submit handler).
- `supabase/migrations/20261115000013_phase_b_wave4a_list_attention_tenants.sql` — evaluate whether to extend the existing RPC or add a new `list_attention_tenants_v2` that joins coverage status. Prefer additive: new migration `000025b` if needed.

---

## Task 1: Migration — extend `plans` with `price_annual` + seed values

**Files:**
- Create: `supabase/migrations/20261115000020_phase_b_wave5_plans_price_annual.sql`
- Create: `supabase/tests/wave5/plans_price_annual.sql`

**Interfaces:**
- Produces: `plans.price_annual NUMERIC(15,2)` nullable column; STARTER=1200000, PRO=3600000, PREMIUM=9000000. `updated_at` bumped; `updated_by` set to a system UUID or NULL for the seed.

**Steps mirror Wave 4a Task 4's shape:**

- [ ] Enumerate current `plans` columns via MCP; confirm `price_annual` doesn't already exist.
- [ ] Write migration with `ALTER TABLE ADD COLUMN IF NOT EXISTS price_annual NUMERIC(15,2);` + 3 `UPDATE ... WHERE code IN ('STARTER','PRO','PREMIUM')`.
- [ ] Apply via MCP `apply_migration`.
- [ ] Verify: `SELECT code, price_annual FROM plans ORDER BY sort_order;` returns the 3 rows with seeded values.
- [ ] pgTAP: column exists + type; the 3 seed values present.
- [ ] Commit.

Commit message: `feat(phase-b-wave5): Task 1 — plans.price_annual + seed values`.

---

## Task 2: Migration — `tenant_payments` table + indexes + RLS + audit CHECK

**Files:**
- Create: `supabase/migrations/20261115000021_phase_b_wave5_tenant_payments_table.sql`
- Create: `supabase/tests/wave5/tenant_payments_table.sql`

**Interfaces:**
- Produces: `tenant_payments` table per spec §15.1 verbatim (schema block above lines 1930-1966). 2 indexes: `idx_tenant_payments_tenant_date`, `idx_tenant_payments_period`. RLS policy `p_platform_admin_only` on the table (same pattern as `tenant_activity_daily` — category-P). Audit CHECK extended with 4 new codes.

**Notes for implementer:**
- `tenant_payments.recorded_by_admin REFERENCES auth.users(id)` — this is a cross-schema FK. Verify it's permitted (should be — Phase A has similar FKs). If not, drop the FK to just `UUID NOT NULL` with a doc comment.
- `audit_id UUID REFERENCES public.platform_admin_audit(id)` — but `platform_admin_audit.id` is `BIGINT` (Wave 1 Task 3 finding). Fix the spec drift: use `BIGINT` here or add an index-only reference.
- CHECK constraints on `bank_name` and `ewallet_provider` require full enumeration — copy the arrays from spec §15.1 verbatim.
- Method-specific CHECKs (bank_name required IF method IN … / ewallet_provider required IF method IN …) — spec has both.
- Audit CHECK extension: DROP + re-ADD with union of existing + `RECORD_PAYMENT`, `UPDATE_PAYMENT`, `DELETE_PAYMENT`, `UPLOAD_PAYMENT_PROOF` (per Wave 4a Task 1/2/3 pattern).

**pgTAP:** table exists; 2 indexes exist; RLS enabled; policy `p_platform_admin_only` exists; audit CHECK includes new codes; method-specific CHECKs reject invalid combos (INSERT with method=BANK_TRANSFER but bank_name=NULL → 23514).

**Steps mirror Task 1 shape.**

Commit: `feat(phase-b-wave5): Task 2 — tenant_payments table + RLS + audit CHECK`.

---

## Task 3: Migration — `payment-proofs` Supabase Storage bucket + RLS

**Files:**
- Create: `supabase/migrations/20261115000022_phase_b_wave5_payment_proofs_bucket.sql`
- Create: `supabase/tests/wave5/payment_proofs_bucket.sql`

**Interfaces:**
- Produces: Supabase Storage bucket `payment-proofs` (private) via `INSERT INTO storage.buckets`. Two RLS policies on `storage.objects`:
  - `p_platform_admin_crud` — platform_admin FULL CRUD on the bucket.
  - `t_tenant_owner_read` — tenant owner SELECT only on paths matching `<own-slug>/*` (derived from JWT `tenant_id` claim via a helper that reads slug from `tenants` table).

**Notes for implementer:**
- Bucket creation via SQL: `INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs','payment-proofs', false) ON CONFLICT (id) DO NOTHING;`.
- File size limit + mime type filter are enforced at Storage API level (not RLS). Note in the migration comment that FE must enforce 5MB max + JPG/PNG/PDF.
- Storage RLS lives on `storage.objects`. Policy USING clause matches `bucket_id = 'payment-proofs' AND public._is_platform_admin_from_jwt()` for the admin policy. Tenant owner policy: `bucket_id = 'payment-proofs' AND name LIKE (SELECT slug FROM public.tenants WHERE id = public._resolve_tenant_id()) || '/%'`.
- Confirm `storage.objects` has RLS enabled by default in Supabase — verify via MCP before writing policies.

**pgTAP:** bucket row exists in `storage.buckets`; both policies exist; SELECT as platform admin can list bucket; SELECT as non-admin with valid tenant_id claim CAN list only own paths (mocked via `set_config`).

Commit: `feat(phase-b-wave5): Task 3 — payment-proofs bucket + Storage RLS`.

---

## Task 4: Migration — `record_payment` + `update_payment` + `delete_payment` RPCs

**Files:**
- Create: `supabase/migrations/20261115000023_phase_b_wave5_payment_write_rpcs.sql`
- Create: `supabase/tests/wave5/record_payment.sql` + `supabase/tests/wave5/update_delete_payment.sql`

**Interfaces:**
- Produces:
  - `public.record_payment(p_payload jsonb) → jsonb` — inserts a `tenant_payments` row and links an audit row (`RECORD_PAYMENT`). Returns `{payment_id, amount_paid_ytd, coverage_ok, coverage_status}`.
  - `public.update_payment(p_payment_id uuid, p_updates jsonb) → jsonb` — whitelist-guarded field-level update.
  - `public.delete_payment(p_payment_id uuid, p_reason text) → jsonb` — soft-delete NOT allowed (spec says audit-logged DELETE). Verify actual hard-delete + audit row is acceptable — flag as design question if unsure.

**Notes for implementer:**
- All three are SECDEF, **postgres-owned** (call `auth.uid()`, SELECT `platform_admins`, INSERT `platform_admin_audit`).
- Payload whitelist for `record_payment`: `tenant_id`, `amount`, `payment_method`, `payment_date`, `period_from`, `period_to`, `bank_name`, `ewallet_provider`, `proof_object_key`, `bank_reference`, `notes`. Any other key → 22023 UNKNOWN_FIELD.
- Validate: `amount > 0` (`22023 INVALID_AMOUNT`), `period_to >= period_from` (`22023 INVALID_PERIOD`), method-specific bank_name / ewallet_provider (`22023 METHOD_MISMATCH`).
- On INSERT: `recorded_by_admin = auth.uid()`, `audit_id` set post-INSERT to the just-created audit row's id.
- `coverage_ok` = boolean, true if `amount_paid_ytd >= plans.price_annual` for the tenant.
- `coverage_status` = enum derived per spec §15.5 formula.
- `update_payment` whitelist: `amount`, `payment_method`, `payment_date`, `period_from`, `period_to`, `bank_name`, `ewallet_provider`, `bank_reference`, `notes`, `proof_object_key`. Do NOT allow tenant_id change (would need explicit `MOVE_PAYMENT` action). Any other key → 22023.
- `delete_payment` REQUIRES `p_reason` non-empty. Insert audit row with the reason before the DELETE.

**pgTAP:** non-admin P0403; bad amount / period / method combos raise 22023 with the right message; happy path creates payment + audit row; coverage_status returned matches expected for Garindo (currently no payment → UNPAID; after INSERT the smoke test computes DP tier).

**Steps mirror Wave 4a Task 1 shape.**

Commit: `feat(phase-b-wave5): Task 4 — payment write RPCs (record/update/delete)`.

---

## Task 5: Migration — `list_payments` + `get_revenue_stats` + `generate_payment_proof_signed_url` RPCs

**Files:**
- Create: `supabase/migrations/20261115000024_phase_b_wave5_payment_read_rpcs.sql`
- Create: `supabase/tests/wave5/list_payments.sql` + `supabase/tests/wave5/get_revenue_stats.sql` + `supabase/tests/wave5/generate_payment_proof_signed_url.sql`

**Interfaces:**
- Produces:
  - `list_payments(p_filters jsonb) → SETOF (…)` — paginated, filterable. **vosi_rpc_owner-owned** (read only, no auth-schema access).
  - `get_revenue_stats(p_filters jsonb) → jsonb` — aggregate breakdown by plan/month/tenant. **vosi_rpc_owner-owned**.
  - `generate_payment_proof_signed_url(p_object_key text) → text` — **postgres-owned** (needs `storage.functions.sign_url()` which requires postgres/service role).

**Notes:**
- `list_payments` filter whitelist: `tenant_id`, `payment_method`, `from_date`, `to_date`, `min_amount`, `page`, `page_size`, `sort_by`, `sort_dir`. Sort whitelist: `payment_date`, `amount`.
- Also accessible to tenant owner reads if the filter's `tenant_id` matches the JWT's tenant_id claim (spec §15.2). Add a branch: if not platform admin, require `p_filters->>'tenant_id'` equals `_resolve_tenant_id()::text`; otherwise raise P0403.
- `get_revenue_stats` filters: `from_date`, `to_date`, `group_by` (enum `'plan'|'month'|'tenant'` — any other → 22023). Returns `{total, breakdown: [{key, amount, count}], monthly_trend: [{month, total}] }`. Monthly trend always includes 12 months back-to-front (fill zeros for empty months).
- `generate_payment_proof_signed_url`: validate the caller has read access to the object (platform admin OR tenant owner of the path prefix). If path prefix doesn't match, raise `P0403 STORAGE_ACCESS_DENIED`. Return 1-hour signed URL via `storage.functions.sign_url(bucket, path, expires_in := 3600)`.

**pgTAP:** all three RPCs; non-admin listPayments with foreign tenant_id → P0403; tenant owner listing own tenant works; empty results for Garindo (no payments yet); revenue_stats with group_by=plan returns 3 rows (STARTER/PRO/PREMIUM); bad group_by → 22023.

Commit: `feat(phase-b-wave5): Task 5 — payment read RPCs + signed-URL generator`.

---

## Task 6: Migration — `v_tenant_payment_coverage` view + `list_tenants_admin` extension

**Files:**
- Create: `supabase/migrations/20261115000025_phase_b_wave5_tenant_payment_coverage_view.sql`
- Create: `supabase/tests/wave5/v_tenant_payment_coverage.sql`

**Interfaces:**
- Produces: `v_tenant_payment_coverage` view per-tenant with columns: `tenant_id uuid, total_paid_covering_current_subscription numeric, expected numeric, coverage_status text` (enum LUNAS/DP_60/DP_30/OVERDUE/UNPAID per spec §15.5).
- Optional extension of `list_tenants_admin` return shape to include `coverage_status`. If extending: create a new migration slot 000025b that CREATE OR REPLACEs `list_tenants_admin` with the new column. This is a breaking change for Wave 1 consumers — update `AdminTenantRow` type in Task 8.
- **Recommended:** create the view as a separate query in `list_tenants_admin` via LEFT JOIN. Keep the API contract additive.

**Notes:**
- Coverage derivation:
  ```
  total_paid = SUM(tp.amount) WHERE tp.tenant_id = X
                              AND tp.period_from <= current_expires_at
                              AND tp.period_to >= current_activated_at
  expected = plans.price_annual for the tenant's plan (pro-rate if subscription < 1 year)
  status = <derivation logic per §15.5>
  ```
- For Garindo (currently zero payments recorded): `total_paid=0`, `expected=9000000`, `status='UNPAID'`.
- The view MUST be readable by platform admin (via `p_platform_admin_only` policy inheritance OR by making it a SECDEF function-returning-table).
- If view has performance issues at scale, note as followup for later phases.

**pgTAP:** view exists; Garindo returns UNPAID; simulate a partial DP-60 payment via temporary INSERT → status flips to DP_60; ROLLBACK.

Commit: `feat(phase-b-wave5): Task 6 — v_tenant_payment_coverage view`.

---

## Task 7: FE — `paymentsApi.ts` + `paymentsTypes.ts` + adminApi extension

**Files:**
- Create: `src/lib/paymentsApi.ts`
- Create: `src/lib/paymentsTypes.ts`
- Create: `src/lib/paymentsApi.test.ts`
- Modify: `src/lib/adminApi.ts` — extend `normalizeRpcError` with new payment SQLSTATE codes
- Modify: `src/lib/adminTypes.ts` — add error classes: `InvalidAmountError`, `InvalidPeriodError`, `MethodMismatchError`, `PaymentNotFoundError`, `StorageAccessDeniedError`

**Interfaces:**
- `recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult>`
- `updatePayment(id: string, updates: UpdatePaymentInput): Promise<{ok: true}>`
- `deletePayment(id: string, reason: string): Promise<{ok: true}>`
- `listPayments(filters: PaymentsListFilters): Promise<PaymentRow[]>`
- `getRevenueStats(filters: RevenueStatsFilters): Promise<RevenueStats>`
- `generatePaymentProofSignedUrl(objectKey: string): Promise<string>`
- `uploadPaymentProof(tenantSlug: string, file: File): Promise<{objectKey: string}>` — client-side wrapper around `supabase.storage.from('payment-proofs').upload(...)`; enforces 5MB max + JPG/PNG/PDF whitelist; returns the object key for use in `record_payment`.

**Types:**

```typescript
export type PaymentMethod = 'BANK_TRANSFER'|'CASH'|'E_WALLET'|'QRIS'|'VIRTUAL_ACCOUNT'|'OTHER';
export type BankName = 'BCA'|'MANDIRI'|'BRI'|'BNI'|'PERMATA'|'CIMB'|'BSI'|'DANAMON'|'BTN'|'MEGA'|'MAYBANK'|'PANIN'|'OCBC'|'JAGO'|'SEA_BANK'|'OTHER';
export type EwalletProvider = 'OVO'|'GOPAY'|'DANA'|'LINKAJA'|'SHOPEEPAY'|'JENIUS_PAY'|'OTHER';
export type CoverageStatus = 'LUNAS'|'DP_60'|'DP_30'|'OVERDUE'|'UNPAID';

export interface RecordPaymentInput {
  tenant_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;         // ISO YYYY-MM-DD
  period_from: string;
  period_to: string;
  bank_name?: BankName | null;
  ewallet_provider?: EwalletProvider | null;
  proof_object_key?: string | null;
  bank_reference?: string | null;
  notes?: string | null;
}

export interface RecordPaymentResult {
  ok: true;
  payment_id: string;
  amount_paid_ytd: number;
  coverage_ok: boolean;
  coverage_status: CoverageStatus;
}

export interface PaymentRow {
  id: string;
  tenant_id: string;
  amount: number;
  currency: 'IDR';
  payment_method: PaymentMethod;
  bank_name: BankName | null;
  ewallet_provider: EwalletProvider | null;
  payment_date: string;
  period_from: string;
  period_to: string;
  proof_url: string | null;      // storage path, not signed URL
  bank_reference: string | null;
  notes: string | null;
  recorded_by_admin: string;
  created_at: string;
}

export interface PaymentsListFilters {
  tenant_id?: string;
  payment_method?: PaymentMethod;
  from_date?: string;
  to_date?: string;
  min_amount?: number;
  page?: number;
  page_size?: number;
  sort_by?: 'payment_date'|'amount';
  sort_dir?: 'asc'|'desc';
}

export interface RevenueStatsFilters {
  from_date?: string;
  to_date?: string;
  group_by?: 'plan'|'month'|'tenant';
}

export interface RevenueStats {
  total: number;
  breakdown: { key: string; amount: number; count: number }[];
  monthly_trend: { month: string; total: number }[];   // always 12 rows
}
```

**Error class additions** (Bahasa `userMessage`):
- `InvalidAmountError` — "Nominal pembayaran harus lebih dari 0."
- `InvalidPeriodError` — "Periode akhir harus setelah periode mulai."
- `MethodMismatchError` — "Metode pembayaran butuh informasi bank atau e-wallet."
- `PaymentNotFoundError` (P0404) — "Data pembayaran tidak ditemukan."
- `StorageAccessDeniedError` (P0403 STORAGE_ACCESS_DENIED) — "Anda tidak berhak mengakses bukti ini."

**Test coverage:** happy path per wrapper, error mapping per SQLSTATE-message, upload rejects >5MB + wrong mime, upload success returns the object key shape.

Commit: `feat(phase-b-wave5): Task 7 — paymentsApi wrappers + upload helper + types`.

---

## Task 8: FE — `RecordPaymentModal` + wire into `PembayaranTab` + extend `RenewSubscriptionModal`

**Files:**
- Create: `src/components/admin/RecordPaymentModal.tsx` + `.test.tsx`
- Create: `src/components/admin/TenantDetail/PembayaranTab.tsx` + `.test.tsx`
- Modify: `src/components/admin/TenantDetail/TenantDetailShell.tsx` — add "Pembayaran" 7th tab
- Modify: `src/components/admin/RenewSubscriptionModal.tsx` — extend with optional payment fields; if enabled, chain `record_payment` after `renew_subscription` succeeds

**RecordPaymentModal (VOSI):**
- Header: "Catat pembayaran" (or "Catat pembayaran ad-hoc" when opened from Pembayaran tab).
- Fields per spec §15.3(c): Nominal diterima, Metode pembayaran (dropdown), Tanggal terima, Period from/to (default today s/d today+365), Bank name (conditional on method), E-wallet provider (conditional), Referensi bank (optional), Catatan (optional), Upload bukti transfer (drag/drop, preview thumbnail, mime + size validation).
- If method != CASH, upload is mandatory (per spec §15.3(b) rule).
- Submit: (1) `uploadPaymentProof(tenantSlug, file)` if file present → returns `objectKey`; (2) `recordPayment({...})`. Success → toast "Pembayaran tercatat.", close modal, parent re-fetch. Error → toast err.userMessage.
- ESC + backdrop close (unless submitting). Focus trap on nominal input.

**PembayaranTab:**
- Fetch via `listPayments({ tenant_id, page_size: 100 })` on mount.
- Loading skeleton; error state with retry.
- Empty state: "Belum ada pembayaran tercatat" + big "+ Catat pembayaran" CTA (gold).
- Non-empty state:
  - Summary strip: Total dibayar YTD, coverage_status badge (from v_tenant_payment_coverage), current_expires_at.
  - Table columns: Tanggal, Nominal, Metode, Period (from - to), Bukti (icon → click generates signed URL + opens in new tab), Ref bank, Notes, Recorded by.
  - Row actions: Edit (opens `RecordPaymentModal` in edit mode → calls `updatePayment`), Delete (confirms with reason via a small dialog → calls `deletePayment`), Download proof (signed URL).
- Sortable columns; pagination as `TenantsList` pattern.

**RenewSubscriptionModal extension:**
- New optional section "Sekaligus catat pembayaran" (checkbox to expand).
- If checked, show inline: nominal (default `plans.price_annual` for the selected plan), method, upload, reference.
- On submit: (1) `renew_subscription(...)` first; if OK, (2) `uploadPaymentProof` if file; (3) `record_payment` with `period_from = old_expires_at, period_to = new_expires_at`. If step (2) or (3) fails, show partial success toast: "Perpanjangan berhasil tapi pembayaran gagal tersimpan — silakan catat manual di tab Pembayaran." Do NOT auto-rollback the renewal.
- Comprehensive error handling — chain failures partition into (renew-fail, upload-fail, record-fail) branches.

**TenantDetailShell:**
- Add "Pembayaran" as 7th tab (after Log Aktivitas).
- URL: `?tab=pembayaran`.
- Tab renders `<PembayaranTab tenantId={row.tenant_id} tenantSlug={row.slug} />`.

**Tests:** RTL for each component; happy path + error paths + validation blocks; storage upload mocked; signed-URL generation mocked; RenewSubscriptionModal chain: renew-only vs renew+payment paths.

Commit: `feat(phase-b-wave5): Task 8 — RecordPaymentModal + PembayaranTab + Renew chain`.

---

## Task 9: FE — Revenue dashboard `/admin/revenue`

**Files:**
- Create: `src/components/admin/AdminRevenue.tsx` + `.test.tsx`
- Create: `src/components/admin/RevenueKPIRow.tsx` + `.test.tsx`
- Create: `src/components/admin/RevenuePlanBreakdown.tsx` + `.test.tsx`
- Create: `src/components/admin/RevenueMonthlyTrend.tsx` + `.test.tsx`
- Create: `src/components/admin/RevenueTopTenants.tsx` + `.test.tsx`
- Modify: `src/components/admin/AdminSidebar.tsx` — add "💰 Pendapatan" link (Bahasa, use a lucide-react coin icon — NO emoji in production UI per Wave 1 rule)
- Modify: `src/components/admin/AdminRoutes.tsx` — register `/admin/revenue` inline regex + AdminRevenue mount

**AdminRevenue orchestrator:**
- Fetch `getRevenueStats({group_by: 'plan'})` and `getRevenueStats({group_by: 'month'})` and top-tenants (either via `getRevenueStats({group_by: 'tenant', ...limit-to-10})` OR a separate helper). Parallel `Promise.all`.
- Loading skeleton (grid of 4 KPI cards + 2 chart placeholders + table).
- Error state: sonner toast + inline retry.
- Success layout:
  1. `<RevenueKPIRow>` — 4 cards: Bulan ini, YTD, MRR estimasi, ARR estimasi. MRR = ARR / 12. ARR = SUM(active_subscriptions.price_annual). Bulan-ini shows previous-month comparison arrow.
  2. `<RevenuePlanBreakdown>` — horizontal bar chart per plan (STARTER/PRO/PREMIUM) with total revenue + tenant count.
  3. `<RevenueMonthlyTrend>` — line chart 12 months back-to-front.
  4. `<RevenueTopTenants>` — table top 10 by revenue YTD with link to tenant detail.
  5. Coverage gaps callout — list tenants with `coverage_status = 'OVERDUE'` (fetched via existing `list_tenants_admin` with coverage extension from Task 6) — direct "Catat pembayaran" CTA per row.

**Chart implementation choice (Task 9 first step):** either add `recharts` (~40KB gzipped) OR hand-roll SVG bars + polyline. If founder's OK with adding a dep, `recharts` is faster; if strict, hand-roll. **Decide as the first step of Task 9** and note in the report.

**Bahasa labels:** "Pendapatan", "Bulan ini", "YTD", "MRR estimasi", "ARR estimasi", "Rincian per paket", "Tren 12 bulan", "Tenant teratas", "Kesenjangan pembayaran".

**Currency formatter:** `formatIDR(n: number): string` — reusable, format as `Rp X.XXX.XXX` (thousands separator, no cents). Live in `src/lib/formatIDR.ts` if not already existing.

**Tests:** happy path renders 4 KPI + 3 chart sections + top-10 table; empty state (0 payments) shows sensible zeros; error state.

Commit: `feat(phase-b-wave5): Task 9 — AdminRevenue dashboard + charts + sidebar link`.

---

## Task 10: FE — CoverageStatusBadge + TenantsTable column + AttentionQueue extension + Wave 5 regression

Bundled task — three related additions + wave close-out. Commit progressively (10a, 10b, 10c).

### 10a. CoverageStatusBadge + TenantsTable Pembayaran column

**Files:**
- Create: `src/components/admin/CoverageStatusBadge.tsx` + `.test.tsx`
- Modify: `src/components/admin/TenantsTable.tsx` — add "Pembayaran" column with `<CoverageStatusBadge status={row.coverage_status} />`
- Modify: `src/lib/adminTypes.ts` — extend `AdminTenantRow` with `coverage_status?: CoverageStatus | null`
- Modify (if Task 6 extended `list_tenants_admin`): the RPC now includes `coverage_status`; otherwise `TenantsList` needs a parallel `listPayments` join client-side — Task 6's choice determines this.

**CoverageStatusBadge:** reusable; VOSI color mapping:
- LUNAS: `bg-vosi-success/15 text-vosi-success`
- DP_60: `bg-vosi-gold/15 text-vosi-navy`
- DP_30: `bg-vosi-gold/25 text-vosi-navy`
- OVERDUE: `bg-vosi-danger/15 text-vosi-danger`
- UNPAID: `bg-vosi-slate/15 text-vosi-slate`
- null (no coverage data yet): render em-dash

Commit: `feat(phase-b-wave5): Task 10a — CoverageStatusBadge + TenantsTable column`.

### 10b. AttentionQueue OVERDUE integration

**Files:**
- Modify: `supabase/migrations/20261115000013_phase_b_wave4a_list_attention_tenants.sql` OR add a NEW migration `20261115000025b_extend_attention_reason.sql`
- Modify: `src/lib/adminTypes.ts` — extend `AttentionReason` union with `'OVERDUE'`
- Modify: `src/components/admin/AttentionQueue.tsx` — new label + chip color for OVERDUE

**Behavior:** `list_attention_tenants` extended to include tenants where `v_tenant_payment_coverage.coverage_status = 'OVERDUE'` AND `status != 'ARCHIVED'`. Priority remains: SUSPENDED > EXPIRED_AND_SUSPENDED > OVERDUE > EXPIRING.

Commit: `feat(phase-b-wave5): Task 10b — AttentionQueue OVERDUE integration`.

### 10c. Wave 5 regression + progress update

- `npx tsc --noEmit` clean.
- `npx vitest run src/` — no new failures beyond pre-existing 5.
- Manual walkthrough (`npm run dev`, admin login):
  - `/admin` → AdminHome renders with real attention queue (may include OVERDUE if any tenant now has coverage gap).
  - `/admin/tenants` → new "Pembayaran" column shows badge (Garindo probably UNPAID until we record one).
  - `/admin/tenants/garindo?tab=pembayaran` → PembayaranTab empty state; click "+ Catat pembayaran"; upload proof; submit; row appears; coverage status updates.
  - `/admin/tenants/garindo?tab=ringkasan` → Perpanjang with payment section → chain works.
  - `/admin/revenue` → dashboard renders with real data (mostly zeros before we record a payment, then updates after).
- Garindo `/dashboard` regression clean.

Commit progress: `docs(progress): Wave 5 complete — payment tracking + revenue dashboard`.

---

## Task 11: Final whole-branch code review + fix pass

Dispatch `requesting-code-review` on opus with the full Wave 5 branch diff. Fix Critical + Important findings via a single fix subagent. Merge to main + Cloud Run deploy per Wave 4a rhythm.

---

## Wave 5 completion checklist

- [ ] All 6 primary migrations + any suffix hotfixes applied to Garindo prod via MCP.
- [ ] All 8 pgTAP files pass; smoke tests recorded in each Task report.
- [ ] Supabase Storage bucket `payment-proofs` visible in dashboard; RLS policies verified via MCP.
- [ ] `paymentsApi.ts` typed for all 5 payment RPCs + upload/signed-URL helpers.
- [ ] `paymentsTypes.ts` has no `any`; CoverageStatus + PaymentMethod / BankName / EwalletProvider unions match SQL CHECKs.
- [ ] `RecordPaymentModal`, `PembayaranTab`, `AdminRevenue` + 4 sub-components, `CoverageStatusBadge` all use VOSI tokens + Bahasa copy.
- [ ] `RenewSubscriptionModal` chain handles all 3 failure branches with honest partial-success toasts.
- [ ] TenantsTable "Pembayaran" column renders coverage badge.
- [ ] AttentionQueue includes OVERDUE priority.
- [ ] `/admin/revenue` route registered + AdminSidebar link renders.
- [ ] Vitest src/: no new failures beyond pre-existing 5.
- [ ] `npx tsc --noEmit` clean on Wave 5 code.
- [ ] `npm run build` — verify locally OR skip and rely on Cloud Build fresh install (Wave 1/4a pattern).
- [ ] Garindo `/dashboard` regression clean.
- [ ] Whole-branch Opus review dispatched. Critical / Important fixed. Ready to merge.
- [ ] Merge to main + push origin + Cloud Run deploy per `docs/cloud-run-promote-runbook.md`.
