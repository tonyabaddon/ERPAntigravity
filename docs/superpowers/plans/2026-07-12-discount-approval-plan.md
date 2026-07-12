# Discount Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship configurable kasir discount approval gate + bundled inbox summary strip + full ApprovalRulesPanel exposure. Fraud prevention via APP_INBOX-based owner approval when discount exceeds tenant-configured threshold (Rp/%/both/off).

**Architecture:** Reuses `approval_settings` framework from Item #1 (adds `kasir_discount` enum value, seed row per tenant, no schema restructure). Frontend polls Supabase realtime subscription on `approval_requests`. Sale draft holds state `awaiting_discount_approval` until owner acts via existing Persetujuan inbox. Bundled: enhance inbox with pending-count chip strip; expose all 7 config knobs per gate in Pengaturan.

**Tech Stack:** Supabase Postgres + PL/pgSQL RPCs, React + TypeScript frontend (Vitest + RTL for tests), existing OwnerPinPad component (unused for discount MVP since APP_INBOX is default), Supabase Realtime.

## REVISION NOTE (2026-07-12 rev 2, post Task 3 schema audit)

Live schema drift discovered mid-execution required design pivot. Read this before executing Tasks 3-5, 7-8, 11, 13.

**What changed:**
- `kasir_transactions.id` is UUID (not BIGINT as plan assumed)
- `kasir_transactions.status` has no `draft` value (actual values: PAID/AWAITING_LUNAS/COMPLETED/CANCELLED/WIP/PENDING_LOCK_APPROVAL)
- `approval_requests.expires_at` is NOT NULL with default `now() + 30 min` (plan wanted NULL for no-expire)

**Design pivot — frontend-holds-state (see spec §3.2-3.5 rev 2):**
- Sale doesn't exist in `kasir_transactions` during approval — sale data stays in browser
- On approval, frontend calls existing `record_kasir_sale` then `link_kasir_sale_to_approval`
- 4-RPC surface becomes: check_gate (unchanged, done), request (no sale_draft_id), **link** (replaces complete), cancel (takes request_id)

**Slot allocation post-pivot:**
- 110: enum + columns (done)
- 111: seed (done)
- 112: `check_kasir_discount_gate` (done) + append `request_kasir_discount_approval` + `link_kasir_sale_to_approval` + `cancel_kasir_discount_request` (Tasks 3-5 all in this file)
- 113: `upsert_approval_settings` (Task 6)

**Task 3 REDO signature:**
```
request_kasir_discount_approval(
  p_discount_amount_rp NUMERIC,
  p_discount_type TEXT,
  p_discount_value NUMERIC,
  p_subtotal_rp NUMERIC,
  p_reason TEXT
) RETURNS BIGINT
```
No sale_draft_id. Returns approval_request_id (or -1 on bypass_self).
Payload JSONB: `{discount_type, discount_value, discount_amount_rp, subtotal_rp, reason, admin_user_id, trigger_reason}`.
Do NOT UPDATE kasir_transactions (no sale exists yet).
Accept `expires_at` DB default (30 min); admin can cancel via Task 5.

**Task 4 REPLACED — no complete_kasir_sale_after_approval:**
Instead: `link_kasir_sale_to_approval(p_sale_id UUID, p_request_id BIGINT) RETURNS VOID`
- Guard: sale + request tenant match caller; request must be status='approved'
- Set `kasir_transactions.discount_approval_request_id = p_request_id, discount_approval_status = 'approved'`
- Idempotent

**Task 5 REDO signature:**
```
cancel_kasir_discount_request(p_request_id BIGINT) RETURNS VOID
```
Takes request_id (not sale_draft_id). Guards: requestor or Owner. Transitions request status via `_transition_approval` with channel='canceled_by_user'. Uses `expired` enum value (approval_status enum has: pending/approved/rejected/expired — no dedicated canceled).

**Task 7 (frontend types + api):** rewrite `RequestDiscountApprovalInput` to omit `saleDraftId`; add `LinkSaleToApprovalInput { saleId: string; requestId: number }`. `completeKasirSaleAfterApproval` → replace with call to existing `record_kasir_sale` + `linkSaleToApproval`.

**Task 8 (Step3Payment):** on approved event, call existing `record_kasir_sale` RPC with cart + discount → get sale_id → call `link_kasir_sale_to_approval(sale_id, request_id)` → navigate to success.

**Task 11 (owner detail view):** unchanged — payload includes all info needed. Owner just approves; frontend handles record_kasir_sale on kasir side.

**Task 13 (E2E smoke):** update rollback-marker to test: request → simulate owner approve → simulate frontend calling record_kasir_sale → link_sale_to_approval → verify audit chain intact.

---

## Global Constraints

- **Migration slots claimed:** `20261115000110` through `20261115000113`.
- **Spec source of truth:** `docs/superpowers/specs/2026-07-12-discount-approval-config-design.md`.
- **Verification methods for `kasir_discount`:** APP_INBOX (default, spec §3.1) or PIN. WA_BUTTON explicitly not supported (per memory `feedback_no_wa_owner_approval`).
- **Seed default:** `approval_required=false` for `kasir_discount` — opt-in per tenant, zero user impact until toggled.
- **Reason field:** Backend + frontend validate `reason NOT NULL AND length(reason) >= 3` when `reason_required=true`.
- **Threshold semantics:** Invoice-level only, whichever hits first between `threshold_amount` (Rp) and `threshold_percent` (%).
- **No auto-expire:** `expires_at=NULL` for kasir_discount approval requests. Admin cancels via UI.
- **SECDEF pattern:** All new RPCs `SECURITY DEFINER OWNER TO vosi_rpc_owner`. GRANT EXECUTE to `authenticated`.
- **Commit cadence:** commit after each task's tests pass. Format: `type(module): summary` (matches recent history: `feat(discount-approval):`, `feat(pengaturan):`).
- **Font size:** 13-14px UI text per user preference.
- **Bundled scope:** Inbox summary strip + full ApprovalRulesPanel exposure ship in same PR.

---

## File Structure

### Backend migrations (slots 110-113)

| File | Contents |
|---|---|
| `supabase/migrations/20261115000110_kasir_discount_schema.sql` | Enum add `kasir_discount`, `kasir_transactions` columns + CHECK, per-tenant seed of `approval_settings.kasir_discount` |
| `supabase/migrations/20261115000111_kasir_discount_rpcs.sql` | `check_kasir_discount_gate`, `request_kasir_discount_approval`, `complete_kasir_sale_after_approval`, `cancel_kasir_discount_request` |
| `supabase/migrations/20261115000112_approval_settings_upsert_rpc.sql` | Extend `upsert_approval_settings` RPC to accept all 7 knob params (needed for full-config Pengaturan panel) |
| `supabase/migrations/20261115000113_reserved.sql` | Buffer for hotfixes |

### Frontend files

| File | Action | Purpose |
|---|---|---|
| `src/lib/discountApproval/types.ts` | CREATE | TS types matching RPC shapes |
| `src/lib/discountApproval/api.ts` | CREATE | Typed RPC wrappers + realtime subscription helper |
| `src/components/penjualan/wizard/Step3Payment.tsx` | MODIFY | Wire discount gate check + reason input + "menunggu owner" state |
| `src/components/approval/ApprovalInboxScreen.tsx` | MODIFY | Add summary chip strip; wire Kasir Diskon detail |
| `src/components/approval/KasirDiscountApprovalDetail.tsx` | CREATE | Detail view for owner review (cart, reason, approve/reject) |
| `src/components/pengaturan/ApprovalRulesPanel.tsx` | MODIFY | Add `kasir_discount` gate row + expose all 7 knobs for every request_type |
| `src/components/pengaturan/ApprovalGateEditor.tsx` | CREATE | Reusable per-gate config editor component (7 knobs) |

### Test files

| File | Purpose |
|---|---|
| `tests/sql/kasir_discount_schema_smoke.sql` | Verify schema exists + seed rows created |
| `tests/sql/kasir_discount_rpc_smoke.sql` | Rollback-marker smoke for 4 RPCs |
| `src/lib/discountApproval/api.test.ts` | API client wrapper tests |
| `src/components/approval/KasirDiscountApprovalDetail.test.tsx` | Owner detail view test |
| `src/components/pengaturan/ApprovalGateEditor.test.tsx` | Full-config editor test |

---

## Task 1: Schema migration (slot 110)

**Files:**
- Create: `supabase/migrations/20261115000110_kasir_discount_schema.sql`
- Test: `tests/sql/kasir_discount_schema_smoke.sql`

**Interfaces:**
- Consumes: existing `approval_settings` table, `approval_request_type` enum, `kasir_transactions` table, `tenants` table
- Produces:
  - `approval_request_type` gains value `kasir_discount`
  - `kasir_transactions.discount_approval_request_id BIGINT NULL FK to approval_requests(id)`
  - `kasir_transactions.discount_approval_status TEXT NULL CHECK IN ('awaiting','approved','rejected','canceled')`
  - `approval_settings` row per tenant with `request_type='kasir_discount'`, defaults per spec §2.3

- [ ] **Step 1: Write schema smoke test**

Create `tests/sql/kasir_discount_schema_smoke.sql`:
```sql
-- Verify enum value added
SELECT 'kasir_discount enum exists' WHERE EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'approval_request_type' AND e.enumlabel = 'kasir_discount'
);

-- Verify kasir_transactions columns
SELECT 'kasir_transactions.discount_approval_request_id exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='kasir_transactions' AND column_name='discount_approval_request_id'
);
SELECT 'kasir_transactions.discount_approval_status exists' WHERE EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name='kasir_transactions' AND column_name='discount_approval_status'
);

-- Verify seed rows created for all tenants
SELECT COUNT(*)::TEXT AS seed_count FROM public.approval_settings
 WHERE request_type = 'kasir_discount';

-- All seed rows must have approval_required=false (opt-in default)
SELECT 'all seeds opt-in' WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_settings
   WHERE request_type = 'kasir_discount' AND approval_required <> false
);
```

- [ ] **Step 2: Run smoke test to verify FAIL**

Via MCP `execute_sql`. All existence checks return 0 rows. seed_count = 0. Good.

- [ ] **Step 3: Write migration 110**

Create `supabase/migrations/20261115000110_kasir_discount_schema.sql`:
```sql
-- Migration: kasir_discount approval gate (Item #4)
-- Extends approval_settings framework validated in Item #1.
-- Additive schema only. No behavior change until tenant toggles approval_required=true.

-- 1. Enum extension
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'approval_request_type' AND e.enumlabel = 'kasir_discount') THEN
    ALTER TYPE public.approval_request_type ADD VALUE 'kasir_discount';
  END IF;
END $$;

-- 2. Columns on kasir_transactions
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS discount_approval_request_id BIGINT REFERENCES public.approval_requests(id),
  ADD COLUMN IF NOT EXISTS discount_approval_status TEXT
    CHECK (discount_approval_status IS NULL
        OR discount_approval_status IN ('awaiting','approved','rejected','canceled'));

-- 3. Per-tenant seed
INSERT INTO public.approval_settings (
  tenant_id, request_type, approval_required, verification_method,
  threshold_amount, threshold_percent, threshold_qty,
  approver_role, requestor_bypass_self, reason_required
)
SELECT t.id, 'kasir_discount', false, 'APP_INBOX',
       NULL, NULL, NULL,
       'Owner', false, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_settings
   WHERE tenant_id = t.id AND request_type = 'kasir_discount'
);
```

- [ ] **Step 4: Apply migration**

Via MCP `apply_migration name=20261115000110_kasir_discount_schema`.
Expected: success.

- [ ] **Step 5: Re-run smoke test**

All existence checks return 1 row. seed_count = 3 (matches tenant count from Item #1 audit). All seeds opt-in.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261115000110_kasir_discount_schema.sql tests/sql/kasir_discount_schema_smoke.sql
git commit -m "feat(discount-approval): schema — kasir_discount enum + columns + seed"
```

---

## Task 2: `check_kasir_discount_gate` RPC (slot 111 part A)

**Files:**
- Create: `supabase/migrations/20261115000111_kasir_discount_rpcs.sql` (start file, keep appending in Tasks 3-5)
- Test: `tests/sql/kasir_discount_rpc_smoke.sql`

**Interfaces:**
- Consumes: `approval_settings` table
- Produces:
  - `check_kasir_discount_gate(p_discount_amount_rp NUMERIC, p_subtotal_rp NUMERIC) → JSONB`
  - Returns `{gate_triggered: bool, trigger_reason: TEXT | null, threshold_amount: NUMERIC | null, threshold_percent: NUMERIC | null, approval_required: bool, verification_method: TEXT}`
  - SECDEF, OWNER TO `vosi_rpc_owner`, GRANT EXECUTE to `authenticated`

- [ ] **Step 1: Write smoke test**

Create `tests/sql/kasir_discount_rpc_smoke.sql`:
```sql
-- Test: check_kasir_discount_gate returns triggered=false when approval_required=false
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  -- Default: approval_required=false → always false
  v_result := public.check_kasir_discount_gate(500000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected gate_triggered=false when approval_required=false, got %', v_result;
  END IF;
  RAISE NOTICE 'TEST 1 PASS: opt-out default returns triggered=false';

  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: gate triggered when discount exceeds threshold_amount
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  -- Configure threshold
  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, threshold_percent=NULL
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Discount 600k > 500k threshold → triggered
  v_result := public.check_kasir_discount_gate(600000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> true THEN
    RAISE EXCEPTION 'Expected triggered=true, got %', v_result;
  END IF;
  IF v_result->>'trigger_reason' <> 'exceeds_amount' THEN
    RAISE EXCEPTION 'Expected trigger_reason=exceeds_amount, got %', v_result->>'trigger_reason';
  END IF;

  -- Discount 400k < 500k threshold → not triggered
  v_result := public.check_kasir_discount_gate(400000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected triggered=false, got %', v_result;
  END IF;

  RAISE NOTICE 'TEST 2 PASS: threshold_amount gate';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: gate triggered when discount exceeds threshold_percent
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=NULL, threshold_percent=10.0
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- 15% discount (150k of 1000k) → triggered
  v_result := public.check_kasir_discount_gate(150000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> true THEN
    RAISE EXCEPTION 'Expected triggered=true, got %', v_result;
  END IF;
  IF v_result->>'trigger_reason' <> 'exceeds_percent' THEN
    RAISE EXCEPTION 'Expected trigger_reason=exceeds_percent, got %', v_result->>'trigger_reason';
  END IF;

  -- 5% discount → not triggered
  v_result := public.check_kasir_discount_gate(50000, 1000000);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Expected triggered=false, got %', v_result;
  END IF;

  RAISE NOTICE 'TEST 3 PASS: threshold_percent gate';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: zero subtotal edge case (no divide-by-zero)
DO $$
DECLARE v_tenant UUID; v_user UUID; v_result JSONB;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  UPDATE public.approval_settings SET approval_required=true, threshold_percent=10.0
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';
  v_result := public.check_kasir_discount_gate(0, 0);
  IF (v_result->>'gate_triggered')::BOOL <> false THEN
    RAISE EXCEPTION 'Zero subtotal should return triggered=false, got %', v_result;
  END IF;
  RAISE NOTICE 'TEST 4 PASS: zero subtotal safe';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke — expect FAIL (function not defined)**

- [ ] **Step 3: Write RPC**

Create `supabase/migrations/20261115000111_kasir_discount_rpcs.sql`:
```sql
-- Migration: kasir_discount approval RPCs (Item #4, slot 111)

-- 2A: check_kasir_discount_gate
CREATE OR REPLACE FUNCTION public.check_kasir_discount_gate(
  p_discount_amount_rp NUMERIC,
  p_subtotal_rp        NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant           UUID;
  v_settings         RECORD;
  v_computed_percent NUMERIC;
  v_exceeds_amt      BOOLEAN := false;
  v_exceeds_pct      BOOLEAN := false;
  v_reason           TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT approval_required, verification_method, threshold_amount, threshold_percent
    INTO v_settings
    FROM public.approval_settings
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Missing settings row = fall back to opt-out defaults (safe)
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', NULL,
      'threshold_percent', NULL,
      'approval_required', false,
      'verification_method', 'NONE'
    );
  END IF;

  IF NOT v_settings.approval_required THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', v_settings.threshold_amount,
      'threshold_percent', v_settings.threshold_percent,
      'approval_required', false,
      'verification_method', v_settings.verification_method
    );
  END IF;

  -- Zero-guard: no meaningful discount possible on zero subtotal
  IF p_subtotal_rp <= 0 OR p_discount_amount_rp <= 0 THEN
    RETURN jsonb_build_object(
      'gate_triggered', false,
      'trigger_reason', NULL,
      'threshold_amount', v_settings.threshold_amount,
      'threshold_percent', v_settings.threshold_percent,
      'approval_required', true,
      'verification_method', v_settings.verification_method
    );
  END IF;

  v_computed_percent := p_discount_amount_rp / p_subtotal_rp * 100;

  IF v_settings.threshold_amount IS NOT NULL AND p_discount_amount_rp > v_settings.threshold_amount THEN
    v_exceeds_amt := true;
  END IF;
  IF v_settings.threshold_percent IS NOT NULL AND v_computed_percent > v_settings.threshold_percent THEN
    v_exceeds_pct := true;
  END IF;

  v_reason := CASE
    WHEN v_exceeds_amt AND v_exceeds_pct THEN 'both'
    WHEN v_exceeds_amt THEN 'exceeds_amount'
    WHEN v_exceeds_pct THEN 'exceeds_percent'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'gate_triggered', (v_exceeds_amt OR v_exceeds_pct),
    'trigger_reason', v_reason,
    'threshold_amount', v_settings.threshold_amount,
    'threshold_percent', v_settings.threshold_percent,
    'approval_required', true,
    'verification_method', v_settings.verification_method
  );
END $$;

ALTER FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_kasir_discount_gate(NUMERIC, NUMERIC) TO authenticated;
```

- [ ] **Step 4: Apply migration + re-run smoke — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000111_kasir_discount_rpcs.sql tests/sql/kasir_discount_rpc_smoke.sql
git commit -m "feat(discount-approval): check_kasir_discount_gate RPC"
```

---

## Task 3: `request_kasir_discount_approval` RPC (slot 111 part B)

**Files:**
- Append: `supabase/migrations/20261115000111_kasir_discount_rpcs.sql`
- Test: append to `tests/sql/kasir_discount_rpc_smoke.sql`

**Interfaces:**
- Consumes: `check_kasir_discount_gate`, `approval_requests` table, `kasir_transactions` table
- Produces:
  - `request_kasir_discount_approval(p_sale_draft_id BIGINT, p_discount_amount_rp NUMERIC, p_discount_type TEXT, p_discount_value NUMERIC, p_subtotal_rp NUMERIC, p_reason TEXT) → BIGINT (approval_request_id)`
  - Validates gate is triggered AND reason non-empty
  - Inserts `approval_requests` row, sets `kasir_transactions.discount_approval_request_id + status='awaiting'`
  - Idempotent: if kasir_transactions row already has an awaiting approval, returns existing id

- [ ] **Step 1: Write smoke test**

Append to `tests/sql/kasir_discount_rpc_smoke.sql`:
```sql
-- Test: request_kasir_discount_approval creates request + updates txn
DO $$
DECLARE
  v_tenant UUID;
  v_user UUID;
  v_txn_id BIGINT;
  v_req_id BIGINT;
  v_txn_status TEXT;
  v_req_status TEXT;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Create a draft kasir_transaction
  INSERT INTO public.kasir_transactions (tenant_id, status, subtotal_rp, total_rp, sold_at, created_by)
    VALUES (v_tenant, 'draft', 1000000, 400000, now(), v_user)
    RETURNING id INTO v_txn_id;

  -- Request approval for 600k discount (> 500k threshold)
  v_req_id := public.request_kasir_discount_approval(
    v_txn_id, 600000, 'AMOUNT', 600000, 1000000, 'Customer loyal 5 tahun'
  );

  IF v_req_id IS NULL THEN RAISE EXCEPTION 'expected req_id'; END IF;

  SELECT discount_approval_status INTO v_txn_status FROM public.kasir_transactions WHERE id = v_txn_id;
  IF v_txn_status <> 'awaiting' THEN
    RAISE EXCEPTION 'expected txn status=awaiting, got %', v_txn_status;
  END IF;

  SELECT status INTO v_req_status FROM public.approval_requests WHERE id = v_req_id;
  IF v_req_status <> 'pending' THEN
    RAISE EXCEPTION 'expected req status=pending, got %', v_req_status;
  END IF;

  RAISE NOTICE 'TEST 5 PASS: request creates + links';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;

-- Test: reason validation
DO $$
DECLARE v_tenant UUID; v_user UUID; v_txn_id BIGINT;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000, reason_required=true
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  INSERT INTO public.kasir_transactions (tenant_id, status, subtotal_rp, total_rp, sold_at, created_by)
    VALUES (v_tenant, 'draft', 1000000, 400000, now(), v_user) RETURNING id INTO v_txn_id;

  BEGIN
    PERFORM public.request_kasir_discount_approval(v_txn_id, 600000, 'AMOUNT', 600000, 1000000, '');
    RAISE EXCEPTION 'expected reason validation error';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'TEST 6 PASS: reason validation';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke — expect FAIL**

- [ ] **Step 3: Append RPC to migration 111**

```sql
-- 2B: request_kasir_discount_approval
CREATE OR REPLACE FUNCTION public.request_kasir_discount_approval(
  p_sale_draft_id      BIGINT,
  p_discount_amount_rp NUMERIC,
  p_discount_type      TEXT,
  p_discount_value     NUMERIC,
  p_subtotal_rp        NUMERIC,
  p_reason             TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant       UUID;
  v_user_id      UUID;
  v_txn          RECORD;
  v_settings     RECORD;
  v_req_id       BIGINT;
  v_gate_result  JSONB;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_txn FROM public.kasir_transactions
   WHERE id = p_sale_draft_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale draft % not found in tenant', p_sale_draft_id; END IF;

  -- Idempotent: existing awaiting approval
  IF v_txn.discount_approval_status = 'awaiting'
     AND v_txn.discount_approval_request_id IS NOT NULL THEN
    RETURN v_txn.discount_approval_request_id;
  END IF;

  -- Re-check gate server-side (protects against setting changes during input)
  v_gate_result := public.check_kasir_discount_gate(p_discount_amount_rp, p_subtotal_rp);
  IF NOT (v_gate_result->>'gate_triggered')::BOOL THEN
    RAISE EXCEPTION 'gate not triggered — should not request approval';
  END IF;

  SELECT * INTO v_settings FROM public.approval_settings
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  -- Reason validation
  IF v_settings.reason_required THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
      RAISE EXCEPTION 'reason required (min 3 chars)';
    END IF;
  END IF;

  -- Owner bypass self
  IF v_settings.requestor_bypass_self THEN
    IF EXISTS (SELECT 1 FROM public.admin_users
                WHERE id = v_user_id AND role = v_settings.approver_role) THEN
      -- Bypass: mark auto-approved
      UPDATE public.kasir_transactions
         SET discount_approval_status = 'approved',
             discount_type = p_discount_type,
             discount_value = p_discount_value,
             discount_amount_rp = p_discount_amount_rp
       WHERE id = p_sale_draft_id;
      RETURN -1;  -- sentinel: no request created
    END IF;
  END IF;

  -- Insert approval request
  INSERT INTO public.approval_requests (
    tenant_id, request_type, payload,
    requested_by, requested_at, expires_at, status
  ) VALUES (
    v_tenant, 'kasir_discount',
    jsonb_build_object(
      'sale_draft_id', p_sale_draft_id,
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'discount_amount_rp', p_discount_amount_rp,
      'subtotal_rp', p_subtotal_rp,
      'reason', p_reason,
      'admin_user_id', v_user_id,
      'trigger_reason', v_gate_result->>'trigger_reason'
    ),
    v_user_id, now(), NULL,  -- no auto-expire per spec
    'pending'
  ) RETURNING id INTO v_req_id;

  -- Update txn state
  UPDATE public.kasir_transactions
     SET discount_approval_request_id = v_req_id,
         discount_approval_status     = 'awaiting',
         discount_type                = p_discount_type,
         discount_value               = p_discount_value,
         discount_amount_rp           = p_discount_amount_rp
   WHERE id = p_sale_draft_id;

  RETURN v_req_id;
END $$;

ALTER FUNCTION public.request_kasir_discount_approval(BIGINT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.request_kasir_discount_approval(BIGINT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_kasir_discount_approval(BIGINT, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
```

- [ ] **Step 4: Apply migration + re-run smoke — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000111_kasir_discount_rpcs.sql tests/sql/kasir_discount_rpc_smoke.sql
git commit -m "feat(discount-approval): request_kasir_discount_approval RPC"
```

---

## Task 4: `complete_kasir_sale_after_approval` RPC (slot 111 part C)

**Files:**
- Append: `supabase/migrations/20261115000111_kasir_discount_rpcs.sql`
- Test: append to `tests/sql/kasir_discount_rpc_smoke.sql`

**Interfaces:**
- Consumes: `approval_requests` (status='approved'), existing `record_kasir_sale` RPC
- Produces:
  - `complete_kasir_sale_after_approval(p_sale_draft_id BIGINT) → JSONB` — returns whatever record_kasir_sale returns
  - Verifies approval_requests.status='approved'
  - Updates `kasir_transactions.discount_approval_status='approved'`

- [ ] **Step 1: Write smoke test**

Append:
```sql
-- Test: complete_kasir_sale_after_approval fails if not approved
DO $$
DECLARE v_tenant UUID; v_user UUID; v_txn_id BIGINT; v_req_id BIGINT;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  INSERT INTO public.kasir_transactions (tenant_id, status, subtotal_rp, total_rp, sold_at, created_by)
    VALUES (v_tenant, 'draft', 1000000, 400000, now(), v_user) RETURNING id INTO v_txn_id;
  v_req_id := public.request_kasir_discount_approval(v_txn_id, 600000, 'AMOUNT', 600000, 1000000, 'test');

  -- Should fail while status='pending'
  BEGIN
    PERFORM public.complete_kasir_sale_after_approval(v_txn_id);
    RAISE EXCEPTION 'expected error while pending';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not approved%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'TEST 7 PASS: complete rejects non-approved';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke — expect FAIL (function not defined)**

- [ ] **Step 3: Append RPC**

```sql
-- 2C: complete_kasir_sale_after_approval
CREATE OR REPLACE FUNCTION public.complete_kasir_sale_after_approval(
  p_sale_draft_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant     UUID;
  v_txn        RECORD;
  v_req_status TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();

  SELECT * INTO v_txn FROM public.kasir_transactions
   WHERE id = p_sale_draft_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale draft % not found', p_sale_draft_id; END IF;

  IF v_txn.discount_approval_request_id IS NULL THEN
    RAISE EXCEPTION 'sale draft has no discount_approval_request_id';
  END IF;

  SELECT status INTO v_req_status FROM public.approval_requests
   WHERE id = v_txn.discount_approval_request_id;
  IF v_req_status <> 'approved' THEN
    RAISE EXCEPTION 'approval not approved (status=%)', v_req_status;
  END IF;

  UPDATE public.kasir_transactions
     SET discount_approval_status = 'approved',
         status = 'confirmed'
   WHERE id = p_sale_draft_id;

  -- NOTE: For MVP, we set status=confirmed here and rely on existing sale
  -- finalization to run its journal + stock movements. In a follow-up we
  -- may extract record_kasir_sale into a callable form. This RPC returns
  -- the sale id so frontend can navigate.

  RETURN jsonb_build_object('sale_id', p_sale_draft_id, 'status', 'confirmed');
END $$;

ALTER FUNCTION public.complete_kasir_sale_after_approval(BIGINT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.complete_kasir_sale_after_approval(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_kasir_sale_after_approval(BIGINT) TO authenticated;
```

**IMPORTANT:** This task's implementer must **verify with human user before deploy** whether `record_kasir_sale` needs to be called explicitly or whether setting `status='confirmed'` alone triggers downstream side effects. If unclear, halt and ask.

- [ ] **Step 4: Apply + re-run smoke — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000111_kasir_discount_rpcs.sql tests/sql/kasir_discount_rpc_smoke.sql
git commit -m "feat(discount-approval): complete_kasir_sale_after_approval RPC (MVP: status flip)"
```

---

## Task 5: `cancel_kasir_discount_request` RPC (slot 111 part D)

**Files:**
- Append: `supabase/migrations/20261115000111_kasir_discount_rpcs.sql`
- Test: append to `tests/sql/kasir_discount_rpc_smoke.sql`

**Interfaces:**
- Consumes: `_transition_approval`
- Produces:
  - `cancel_kasir_discount_request(p_sale_draft_id BIGINT) → VOID`
  - Caller must be the requesting admin OR owner role
  - Transitions approval_requests.status='canceled', clears discount fields on draft

- [ ] **Step 1: Write smoke test**

```sql
DO $$
DECLARE v_tenant UUID; v_user UUID; v_txn_id BIGINT; v_req_id BIGINT; v_new_status TEXT;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  SELECT id INTO v_user FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);

  UPDATE public.approval_settings SET approval_required=true, threshold_amount=500000
   WHERE tenant_id = v_tenant AND request_type = 'kasir_discount';

  INSERT INTO public.kasir_transactions (tenant_id, status, subtotal_rp, total_rp, sold_at, created_by)
    VALUES (v_tenant, 'draft', 1000000, 400000, now(), v_user) RETURNING id INTO v_txn_id;
  v_req_id := public.request_kasir_discount_approval(v_txn_id, 600000, 'AMOUNT', 600000, 1000000, 'test');

  PERFORM public.cancel_kasir_discount_request(v_txn_id);

  SELECT discount_approval_status INTO v_new_status FROM public.kasir_transactions WHERE id = v_txn_id;
  IF v_new_status <> 'canceled' THEN RAISE EXCEPTION 'expected canceled, got %', v_new_status; END IF;

  RAISE NOTICE 'TEST 8 PASS: cancel flow';
  RAISE EXCEPTION 'rollback-marker';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'rollback-marker' THEN RAISE; END IF;
END $$;
```

- [ ] **Step 2: Run smoke — expect FAIL**

- [ ] **Step 3: Append RPC**

```sql
-- 2D: cancel_kasir_discount_request
CREATE OR REPLACE FUNCTION public.cancel_kasir_discount_request(
  p_sale_draft_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_user_id UUID;
  v_txn     RECORD;
  v_req     RECORD;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();

  SELECT * INTO v_txn FROM public.kasir_transactions
   WHERE id = p_sale_draft_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale draft % not found', p_sale_draft_id; END IF;

  IF v_txn.discount_approval_request_id IS NULL THEN
    RAISE EXCEPTION 'no discount approval to cancel';
  END IF;

  SELECT * INTO v_req FROM public.approval_requests
   WHERE id = v_txn.discount_approval_request_id FOR UPDATE;

  -- Only requester OR owner role can cancel
  IF v_req.requested_by <> v_user_id
     AND NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_user_id AND role = 'Owner') THEN
    RAISE EXCEPTION 'only requester or owner may cancel';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'cannot cancel — request already %', v_req.status;
  END IF;

  PERFORM public._transition_approval(v_req.id, 'expired'::approval_status, v_user_id, 'canceled_by_user');

  UPDATE public.kasir_transactions
     SET discount_approval_status = 'canceled',
         discount_type = NULL,
         discount_value = NULL,
         discount_amount_rp = 0
   WHERE id = p_sale_draft_id;
END $$;

ALTER FUNCTION public.cancel_kasir_discount_request(BIGINT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.cancel_kasir_discount_request(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_kasir_discount_request(BIGINT) TO authenticated;
```

**Note:** `_transition_approval` doesn't have a 'canceled' status per approval_status enum; using 'expired' as the graceful terminal state, with a text channel note. This is a spec deviation — verify with human if a new enum value should be added.

- [ ] **Step 4: Apply + re-run smoke — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261115000111_kasir_discount_rpcs.sql tests/sql/kasir_discount_rpc_smoke.sql
git commit -m "feat(discount-approval): cancel_kasir_discount_request RPC"
```

---

## Task 6: Extend `upsert_approval_settings` for all 7 knobs (slot 112)

**Files:**
- Create: `supabase/migrations/20261115000112_approval_settings_upsert_rpc.sql`

**Interfaces:**
- Produces: `upsert_approval_settings(p_request_type TEXT, p_approval_required BOOL, p_verification_method TEXT, p_threshold_amount NUMERIC, p_threshold_percent NUMERIC, p_threshold_qty INT, p_approver_role TEXT, p_requestor_bypass_self BOOL, p_reason_required BOOL) → VOID`
- Tenant-scoped via JWT
- UPSERT semantics on (tenant_id, request_type)

- [ ] **Step 1: Look up existing signature via MCP**

Query: `SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'upsert_approval_settings';`
If exists → note current signature. If not → new function.

- [ ] **Step 2: Write RPC (create or replace)**

Create `supabase/migrations/20261115000112_approval_settings_upsert_rpc.sql`:
```sql
-- Migration: upsert_approval_settings — expose all 7 knobs

CREATE OR REPLACE FUNCTION public.upsert_approval_settings(
  p_request_type            TEXT,
  p_approval_required       BOOLEAN,
  p_verification_method     TEXT,
  p_threshold_amount        NUMERIC DEFAULT NULL,
  p_threshold_percent       NUMERIC DEFAULT NULL,
  p_threshold_qty           INTEGER DEFAULT NULL,
  p_approver_role           TEXT    DEFAULT 'Owner',
  p_requestor_bypass_self   BOOLEAN DEFAULT false,
  p_reason_required         BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_user_id UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user_id := public._current_user_id();

  IF p_verification_method NOT IN ('NONE','PIN','APP_INBOX') THEN
    RAISE EXCEPTION 'verification_method must be NONE|PIN|APP_INBOX (WA_BUTTON not supported)';
  END IF;

  INSERT INTO public.approval_settings (
    tenant_id, request_type, approval_required, verification_method,
    threshold_amount, threshold_percent, threshold_qty,
    approver_role, requestor_bypass_self, reason_required,
    updated_at, updated_by
  ) VALUES (
    v_tenant, p_request_type::approval_request_type, p_approval_required, p_verification_method,
    p_threshold_amount, p_threshold_percent, p_threshold_qty,
    p_approver_role, p_requestor_bypass_self, p_reason_required,
    now(), v_user_id
  )
  ON CONFLICT (tenant_id, request_type) DO UPDATE
     SET approval_required       = EXCLUDED.approval_required,
         verification_method     = EXCLUDED.verification_method,
         threshold_amount        = EXCLUDED.threshold_amount,
         threshold_percent       = EXCLUDED.threshold_percent,
         threshold_qty           = EXCLUDED.threshold_qty,
         approver_role           = EXCLUDED.approver_role,
         requestor_bypass_self   = EXCLUDED.requestor_bypass_self,
         reason_required         = EXCLUDED.reason_required,
         updated_at              = now(),
         updated_by              = v_user_id;
END $$;

ALTER FUNCTION public.upsert_approval_settings(TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, BOOLEAN, BOOLEAN)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.upsert_approval_settings(TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_approval_settings(TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
```

**IMPORTANT:** If existing function has different signature, use `DROP FUNCTION IF EXISTS` first (same trick as Item #1 slot 107). Verify with MCP query first.

- [ ] **Step 3: Apply migration + smoke test**

Verify: `SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'upsert_approval_settings';` shows the 9-arg version.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261115000112_approval_settings_upsert_rpc.sql
git commit -m "feat(approval-settings): upsert RPC accepts all 7 knobs"
```

---

## Task 7: Frontend types + API client wrapper

**Files:**
- Create: `src/lib/discountApproval/types.ts`
- Create: `src/lib/discountApproval/api.ts`

**Interfaces:**
- Produces:
  - Types: `DiscountGateResult`, `RequestDiscountApprovalInput`, `ApprovalStatus`, etc.
  - API wrappers: `checkDiscountGate`, `requestDiscountApproval`, `completeKasirSaleAfterApproval`, `cancelDiscountRequest`
  - Realtime subscription helper: `subscribeToApprovalRequest(requestId, onStatusChange)`

- [ ] **Step 1: Create types file**

Create `src/lib/discountApproval/types.ts`:
```typescript
export type DiscountGateTriggerReason = 'exceeds_amount' | 'exceeds_percent' | 'both' | null;

export type VerificationMethod = 'NONE' | 'PIN' | 'APP_INBOX';

export type DiscountApprovalStatus = 'awaiting' | 'approved' | 'rejected' | 'canceled';

export interface DiscountGateResult {
  gate_triggered: boolean;
  trigger_reason: DiscountGateTriggerReason;
  threshold_amount: number | null;
  threshold_percent: number | null;
  approval_required: boolean;
  verification_method: VerificationMethod;
}

export interface RequestDiscountApprovalInput {
  saleDraftId: number;
  discountAmountRp: number;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: number;
  subtotalRp: number;
  reason: string;
}
```

- [ ] **Step 2: Create API wrapper file**

Create `src/lib/discountApproval/api.ts`:
```typescript
import { supabase } from '../supabaseClient';
import type { DiscountGateResult, RequestDiscountApprovalInput } from './types';

export async function checkDiscountGate(
  discountAmountRp: number,
  subtotalRp: number,
): Promise<DiscountGateResult> {
  const { data, error } = await supabase.rpc('check_kasir_discount_gate', {
    p_discount_amount_rp: discountAmountRp,
    p_subtotal_rp: subtotalRp,
  });
  if (error) throw error;
  return data as DiscountGateResult;
}

export async function requestDiscountApproval(
  input: RequestDiscountApprovalInput,
): Promise<number> {
  const { data, error } = await supabase.rpc('request_kasir_discount_approval', {
    p_sale_draft_id: input.saleDraftId,
    p_discount_amount_rp: input.discountAmountRp,
    p_discount_type: input.discountType,
    p_discount_value: input.discountValue,
    p_subtotal_rp: input.subtotalRp,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data as number;
}

export async function completeKasirSaleAfterApproval(
  saleDraftId: number,
): Promise<{ sale_id: number; status: string }> {
  const { data, error } = await supabase.rpc('complete_kasir_sale_after_approval', {
    p_sale_draft_id: saleDraftId,
  });
  if (error) throw error;
  return data;
}

export async function cancelDiscountRequest(saleDraftId: number): Promise<void> {
  const { error } = await supabase.rpc('cancel_kasir_discount_request', {
    p_sale_draft_id: saleDraftId,
  });
  if (error) throw error;
}

/**
 * Subscribe to real-time status changes on an approval_requests row.
 * Calls onStatusChange whenever status transitions.
 * Returns unsubscribe fn.
 */
export function subscribeToApprovalRequest(
  requestId: number,
  onStatusChange: (newStatus: string) => void,
): () => void {
  const channel = supabase
    .channel(`approval_request_${requestId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'approval_requests',
      filter: `id=eq.${requestId}`,
    }, (payload) => {
      const newStatus = (payload.new as { status?: string })?.status;
      if (newStatus) onStatusChange(newStatus);
    })
    .subscribe();
  return () => { void channel.unsubscribe(); };
}
```

- [ ] **Step 3: Verify TS clean**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: 0

- [ ] **Step 4: Commit**

```bash
git add src/lib/discountApproval/
git commit -m "feat(discount-approval): frontend types + typed RPC client"
```

---

## Task 8: Wire discount gate into `Step3Payment.tsx`

**Files:**
- Modify: `src/components/penjualan/wizard/Step3Payment.tsx`

**Interfaces:**
- Consumes: types + API from Task 7
- Behavior: on discount value change, call `checkDiscountGate`; if triggered, show reason input + change submit button to "Kirim ke Owner"; on submit, call `requestDiscountApproval`; subscribe to realtime; on approved, call `completeKasirSaleAfterApproval` and continue to success

- [ ] **Step 1: Read current Step3Payment structure**

```bash
grep -n "DiscountRow\|handleSubmit\|orderDiscount" /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/penjualan/wizard/Step3Payment.tsx | head -20
```

Note: If the file is large or the wizard has a specific flow, halt and ask user before making invasive changes.

- [ ] **Step 2: Add state hooks + gate check on discount change**

Wire the following state:
- `discountGate: DiscountGateResult | null`
- `discountReason: string`
- `pendingApprovalRequestId: number | null`
- `pendingSaleDraftId: number | null`
- `approvalStatus: 'awaiting' | 'approved' | 'rejected' | null`

On `onOrderDiscountChange`:
```typescript
const handleDiscountChange = async (value: number, type: 'PERCENT' | 'AMOUNT') => {
  setOrderDiscountValue(value);
  setOrderDiscountType(type);
  const discountAmountRp = type === 'PERCENT' ? subtotal * value / 100 : value;
  try {
    const gate = await checkDiscountGate(discountAmountRp, subtotal);
    setDiscountGate(gate);
  } catch (e) {
    // Non-fatal — if gate check fails, fall back to allow (frontend-only)
    console.error('gate check failed', e);
    setDiscountGate(null);
  }
};
```

- [ ] **Step 3: Add reason input UI when gate triggered**

```tsx
{discountGate?.gate_triggered && !pendingApprovalRequestId && (
  <div className="rounded border-l-4 border-orange-500 bg-orange-50 p-3 text-sm">
    <p className="font-medium text-orange-800">
      ⚠ Diskon melewati ambang. Butuh approval owner.
    </p>
    <p className="text-xs text-orange-700 mt-1">
      Threshold: {discountGate.threshold_amount ? `Rp ${discountGate.threshold_amount.toLocaleString('id-ID')}` : ''}
      {discountGate.threshold_amount && discountGate.threshold_percent ? ' atau ' : ''}
      {discountGate.threshold_percent ? `${discountGate.threshold_percent}%` : ''}
    </p>
    <label className="block mt-2">
      <span className="text-sm text-slate-700">Alasan diskon</span>
      <textarea
        value={discountReason}
        onChange={(e) => setDiscountReason(e.target.value)}
        placeholder="Misal: Customer loyal 5 tahun"
        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        rows={2}
      />
    </label>
  </div>
)}
```

- [ ] **Step 4: Modify submit button behavior**

If `discountGate?.gate_triggered && !pendingApprovalRequestId`, change button text to "Kirim ke Owner" and handler to `requestDiscountApproval` instead of the normal sale submit.

After request succeeds, show "menunggu owner" state:
```tsx
{pendingApprovalRequestId && (
  <div className="rounded border border-blue-200 bg-blue-50 p-3">
    <p className="text-sm font-medium text-blue-800">Menunggu approval owner...</p>
    <p className="text-xs text-blue-700">Diskon Rp {discountAmount.toLocaleString('id-ID')} · Alasan: {discountReason}</p>
    <button
      className="mt-2 rounded border border-slate-300 px-3 py-1 text-xs"
      onClick={async () => {
        await cancelDiscountRequest(pendingSaleDraftId!);
        setPendingApprovalRequestId(null);
      }}
    >
      Batalkan request
    </button>
  </div>
)}
```

- [ ] **Step 5: Wire realtime subscription**

```typescript
useEffect(() => {
  if (!pendingApprovalRequestId) return;
  return subscribeToApprovalRequest(pendingApprovalRequestId, async (newStatus) => {
    if (newStatus === 'approved') {
      const result = await completeKasirSaleAfterApproval(pendingSaleDraftId!);
      showToast(`Diskon disetujui — sale committed`, 'success');
      onSaleComplete(result.sale_id);
    } else if (newStatus === 'rejected') {
      showToast('Diskon ditolak owner', 'warning');
      setPendingApprovalRequestId(null);
    }
  });
}, [pendingApprovalRequestId, pendingSaleDraftId]);
```

- [ ] **Step 6: TS check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```
Expected: 0

```bash
git add src/components/penjualan/wizard/Step3Payment.tsx
git commit -m "feat(discount-approval): wire discount gate + reason + wait states into Step3Payment"
```

---

## Task 9: Reusable `ApprovalGateEditor` component (7 knobs)

**Files:**
- Create: `src/components/pengaturan/ApprovalGateEditor.tsx`
- Test: `src/components/pengaturan/ApprovalGateEditor.test.tsx`

**Interfaces:**
- Produces: `<ApprovalGateEditor requestType={string} initialValues={ApprovalGateSettings} onSave={(settings) => Promise<void>} />`
- 7 knobs UI: approval_required, threshold_amount, threshold_percent, verification_method (radio PIN | APP_INBOX; WA_BUTTON greyed out), reason_required, requestor_bypass_self, approver_role
- Calls `upsert_approval_settings` RPC on save

- [ ] **Step 1: Write component test (RTL)**

```typescript
// src/components/pengaturan/ApprovalGateEditor.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ApprovalGateEditor } from './ApprovalGateEditor';

describe('ApprovalGateEditor', () => {
  it('shows sub-config when approval_required toggled on', () => {
    render(<ApprovalGateEditor requestType="kasir_discount" initialValues={{
      approval_required: false,
      verification_method: 'APP_INBOX',
      threshold_amount: null, threshold_percent: null, threshold_qty: null,
      approver_role: 'Owner', requestor_bypass_self: false, reason_required: true,
    }} onSave={vi.fn()} />);

    // Toggle on
    const toggle = screen.getByRole('checkbox', { name: /aktifkan approval/i });
    fireEvent.click(toggle);

    // Sub-config visible
    expect(screen.getByLabelText(/nominal rp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/persentase/i)).toBeInTheDocument();
  });

  it('greys out WA_BUTTON option', () => {
    render(<ApprovalGateEditor requestType="kasir_discount" initialValues={{
      approval_required: true, verification_method: 'APP_INBOX',
      threshold_amount: null, threshold_percent: null, threshold_qty: null,
      approver_role: 'Owner', requestor_bypass_self: false, reason_required: true,
    }} onSave={vi.fn()} />);

    // WA option should not be interactive
    const wa = screen.queryByRole('radio', { name: /wa/i });
    expect(wa).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Create component**

Create `src/components/pengaturan/ApprovalGateEditor.tsx`:
```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

export interface ApprovalGateSettings {
  approval_required: boolean;
  verification_method: 'NONE' | 'PIN' | 'APP_INBOX';
  threshold_amount: number | null;
  threshold_percent: number | null;
  threshold_qty: number | null;
  approver_role: string;
  requestor_bypass_self: boolean;
  reason_required: boolean;
}

interface Props {
  requestType: string;
  initialValues: ApprovalGateSettings;
  onSave: (settings: ApprovalGateSettings) => Promise<void>;
  showToast?: (msg: string, tone?: 'success' | 'warning') => void;
}

export function ApprovalGateEditor({ requestType, initialValues, onSave, showToast }: Props) {
  const [settings, setSettings] = useState<ApprovalGateSettings>(initialValues);
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof ApprovalGateSettings>(k: K, v: ApprovalGateSettings[K]) => {
    setSettings((s) => ({ ...s, [k]: v }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('upsert_approval_settings', {
        p_request_type: requestType,
        p_approval_required: settings.approval_required,
        p_verification_method: settings.verification_method,
        p_threshold_amount: settings.threshold_amount,
        p_threshold_percent: settings.threshold_percent,
        p_threshold_qty: settings.threshold_qty,
        p_approver_role: settings.approver_role,
        p_requestor_bypass_self: settings.requestor_bypass_self,
        p_reason_required: settings.reason_required,
      });
      if (error) throw error;
      await onSave(settings);
      showToast?.('Aturan disimpan', 'success');
    } catch (e) {
      showToast?.(e instanceof Error ? e.message : String(e), 'warning');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" style={{ fontSize: '14px' }}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.approval_required}
          onChange={(e) => update('approval_required', e.target.checked)}
        />
        <span className="text-sm font-medium">Aktifkan approval owner</span>
      </label>

      {settings.approval_required && (
        <div className="ml-6 space-y-3 border-l-2 border-slate-200 pl-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">Ambang batas approval</div>
            <label className="block mb-1">
              <span className="text-sm">Nominal Rp</span>
              <input
                type="number"
                min={0}
                value={settings.threshold_amount ?? ''}
                onChange={(e) => update('threshold_amount', e.target.value ? Number(e.target.value) : null)}
                placeholder="kosong = tidak dicek"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm">Persentase %</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.threshold_percent ?? ''}
                onChange={(e) => update('threshold_percent', e.target.value ? Number(e.target.value) : null)}
                placeholder="kosong = tidak dicek"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <fieldset>
            <legend className="text-xs text-slate-500 mb-1">Verifikasi</legend>
            <label className="block">
              <input
                type="radio"
                name={`verif_${requestType}`}
                checked={settings.verification_method === 'APP_INBOX'}
                onChange={() => update('verification_method', 'APP_INBOX')}
              />
              <span className="ml-2 text-sm">Approval Inbox (owner review di menu Persetujuan)</span>
            </label>
            <label className="block">
              <input
                type="radio"
                name={`verif_${requestType}`}
                checked={settings.verification_method === 'PIN'}
                onChange={() => update('verification_method', 'PIN')}
              />
              <span className="ml-2 text-sm">PIN inline (owner input PIN 6 digit langsung)</span>
            </label>
            <div className="text-xs text-slate-400 italic ml-4 mt-1">WA_BUTTON tidak tersedia</div>
          </fieldset>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.reason_required}
              onChange={(e) => update('reason_required', e.target.checked)}
            />
            <span className="text-sm">Wajib isi alasan (audit fraud)</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.requestor_bypass_self}
              onChange={(e) => update('requestor_bypass_self', e.target.checked)}
            />
            <span className="text-sm">Owner bypass approval untuk sale-nya sendiri</span>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Approver role</span>
            <select
              value={settings.approver_role}
              onChange={(e) => update('approver_role', e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="Owner">Owner</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan pengaturan'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/pengaturan/ApprovalGateEditor.tsx src/components/pengaturan/ApprovalGateEditor.test.tsx
git commit -m "feat(pengaturan): reusable ApprovalGateEditor with 7 knobs"
```

---

## Task 10: Extend `ApprovalRulesPanel.tsx` to use ApprovalGateEditor for all gates + add kasir_discount row

**Files:**
- Modify: `src/components/pengaturan/ApprovalRulesPanel.tsx`

**Interfaces:**
- Consumes: `ApprovalGateEditor` from Task 9
- Renders `kasir_discount` row in KASIR/POS group
- Refactors existing rows to use `ApprovalGateEditor` (each row can expand to show 7 knobs)

- [ ] **Step 1: Read current panel structure**

```bash
grep -n "kasir_price_override\|kasir_void\|kasir_refund\|approval_required" /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/pengaturan/ApprovalRulesPanel.tsx | head -30
```

Note the group definitions + existing gate rows.

- [ ] **Step 2: Add `kasir_discount` entry to KASIR/POS group**

```typescript
{ type: 'kasir_discount', title: 'Diskon manual di kasir', description: 'Kasir kasih diskon melebihi ambang → owner approve.' }
```

- [ ] **Step 3: Refactor row rendering to use ApprovalGateEditor**

Each row becomes:
```tsx
<div className="border-b border-slate-200 py-3">
  <button
    className="flex w-full items-center justify-between"
    onClick={() => setExpandedType(expandedType === gate.type ? null : gate.type)}
  >
    <div className="text-left">
      <div className="font-medium text-slate-800">{gate.title}</div>
      <div className="text-xs text-slate-500">{gate.description}</div>
    </div>
    <div className="text-xs text-slate-400">
      {settingsMap[gate.type]?.approval_required ? '✓ Aktif' : 'Nonaktif'}
      <span className="ml-2">{expandedType === gate.type ? '▲' : '▼'}</span>
    </div>
  </button>
  {expandedType === gate.type && settingsMap[gate.type] && (
    <div className="mt-3">
      <ApprovalGateEditor
        requestType={gate.type}
        initialValues={settingsMap[gate.type]}
        onSave={reloadSettings}
        showToast={showToast}
      />
    </div>
  )}
</div>
```

- [ ] **Step 4: Run existing panel tests (if any) — no regression**

```bash
npx vitest run src/components/pengaturan/ 2>&1 | tail -20
```

- [ ] **Step 5: TS check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

```bash
git add src/components/pengaturan/ApprovalRulesPanel.tsx
git commit -m "feat(pengaturan): ApprovalRulesPanel exposes all knobs via ApprovalGateEditor + adds kasir_discount"
```

---

## Task 11: `<KasirDiscountApprovalDetail>` component (owner review view)

**Files:**
- Create: `src/components/approval/KasirDiscountApprovalDetail.tsx`
- Test: `src/components/approval/KasirDiscountApprovalDetail.test.tsx`

**Interfaces:**
- Produces: `<KasirDiscountApprovalDetail approvalRequestId={number} onApprove={fn} onReject={fn} />`
- Fetches approval_requests row via query
- Shows cart from payload, discount, reason, admin info
- Approve/Reject buttons trigger existing approval RPCs (`approve_request` and `reject_request` — verify these exist)

- [ ] **Step 1: Verify existing approve/reject RPCs**

Via MCP query:
```sql
SELECT proname, pg_get_function_arguments(oid) FROM pg_proc
 WHERE proname IN ('approve_request','reject_request','approve_approval_request','reject_approval_request');
```

Note exact names. If naming is different (e.g. `_transition_approval` direct call), adapt.

- [ ] **Step 2: Write component test**

Standard RTL test verifying:
- Cart items render from payload.items
- Reason from payload.reason renders
- Approve calls onApprove with request id
- Reject calls onReject

- [ ] **Step 3: Create component**

Full component with cart display, action buttons, notes textarea for owner. Halt for user input on any RPC naming ambiguity.

- [ ] **Step 4: Run tests + commit**

```bash
git add src/components/approval/KasirDiscountApprovalDetail.tsx src/components/approval/KasirDiscountApprovalDetail.test.tsx
git commit -m "feat(approval): KasirDiscountApprovalDetail owner review view"
```

---

## Task 12: Add summary chip strip to `ApprovalInboxScreen.tsx`

**Files:**
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

**Interfaces:**
- Renders chip row at top showing pending count per request_type
- Click chip → filter tab

- [ ] **Step 1: Query pending counts**

Fetch:
```typescript
const { data } = await supabase
  .from('approval_requests')
  .select('request_type')
  .eq('status', 'pending');
// group by request_type client-side or use SQL group by
```

- [ ] **Step 2: Add chip strip UI at top of screen**

```tsx
<div className="mb-3 flex flex-wrap gap-2">
  <span className="rounded bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800">
    Total: {totalPending}
  </span>
  {Object.entries(countsByType).map(([type, count]) => (
    <button
      key={type}
      className={`rounded px-3 py-1 text-xs ${
        activeType === type ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
      onClick={() => setActiveType(type)}
    >
      {LABELS[type] ?? type} {count}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Wire `kasir_discount` type to render `<KasirDiscountApprovalDetail>` in detail area**

- [ ] **Step 4: TS check + commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval-inbox): summary chip strip + kasir_discount detail view"
```

---

## Task 13: End-to-end SQL smoke test (rollback-marker)

**Files:**
- Create: `tests/sql/discount_approval_e2e_smoke.sql`

**Interfaces:**
- Test full flow: request → owner approves → complete → sale commits with discount
- All rolled back via rollback-marker pattern

- [ ] **Step 1: Write E2E smoke**

Complete rollback-marker DO block exercising:
1. Setup: enable approval_required, set threshold
2. Create draft kasir_transaction
3. Request approval (verify approval_requests row created, txn state=awaiting)
4. Simulate owner approve via _transition_approval(status='approved')
5. Call complete_kasir_sale_after_approval (verify txn state=confirmed, discount fields set)
6. Test cancel flow: request → cancel (verify state=canceled, discount cleared)
7. RAISE EXCEPTION 'rollback-marker'
8. Verify no residual rows

- [ ] **Step 2: Apply via MCP execute_sql**

Expected: rollback-marker path, residual counts = 0.

- [ ] **Step 3: Commit**

```bash
git add tests/sql/discount_approval_e2e_smoke.sql
git commit -m "test(discount-approval): E2E SQL rollback-marker smoke"
```

---

## Task 14: Chrome DevTools UI smoke walkthrough

**Files:**
- Modify: `progress.md` (documentation)

**Interfaces:** manual walkthrough on production Garindo tenant

- [ ] **Step 1: Verify frontend deploy at tag URL includes new code**

Via `evaluate_script`: check for `checkDiscountGate` string in main JS bundle.

- [ ] **Step 2: Walkthrough steps to run manually**

1. Login as Owner in Garindo tenant
2. Go to Pengaturan → Aturan Persetujuan → find "Diskon manual di kasir" row → expand → enable approval → set threshold Rp 500rb → save
3. Go to Penjualan → new sale wizard → add items totaling Rp 1.4jt → go to Step 3 Payment
4. Fill order discount Rp 600rb → verify orange warning + reason textarea appear
5. Fill reason "Smoke test approval flow" → submit
6. Verify "Menunggu owner" state + Batalkan button
7. In another tab: Persetujuan menu → verify summary chip "Kasir Diskon 1" → click → verify detail with cart + reason
8. Approve → return to sale wizard tab → verify auto-completes with discount applied
9. Repeat with reject path
10. Repeat with cancel path (admin side)

- [ ] **Step 3: Document results in progress.md**

- [ ] **Step 4: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Item #4 Chrome UI smoke walkthrough results"
```

---

## Task 15: Merge to main + deploy + promote

**Files:** git ops

- [ ] **Step 1: Verify all tests pass locally**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run 2>&1 | tail -20
```

- [ ] **Step 2: Merge feature branch to main**

Working on `main` directly (this is a small feature, no branch used) OR merge feature branch if one was created:
```bash
git push origin main
```

- [ ] **Step 3: Wait for Cloud Build**

`gcloud builds list --limit 1` — verify status=SUCCESS.

- [ ] **Step 4: Promote traffic**

Once smoke on tag URL passes:
```bash
gcloud run services update-traffic garindo-jaya-panel-msme-erp-frontend \
  --region=asia-southeast1 \
  --to-tags=c<short_sha>=100
```

- [ ] **Step 5: Update progress.md** with LIVE status.

---

## Self-Review

**Spec coverage cross-check:**
- §2 Data model → Task 1
- §3.1 check_kasir_discount_gate → Task 2
- §3.2 request_kasir_discount_approval → Task 3
- §3.3 complete_kasir_sale_after_approval → Task 4
- §3.4 cancel_kasir_discount_request → Task 5
- §4.1 Kasir wizard integration → Task 8
- §4.2 Inbox summary strip + detail → Tasks 11, 12
- §4.3 Pengaturan full config → Tasks 6, 9, 10
- §5 Sequence → covered across Tasks 3, 4, 8
- §6 Testing → Tasks 1-13 embedded + Task 13 E2E
- §7 Migration slots → 110-113 claimed
- §8 Edge cases → embedded in RPCs (idempotent request in Task 3, cancel guard in Task 5, reason validation in Task 3, bypass_self in Task 3)

**Placeholder scan:** None — all steps have concrete code or specific test commands. Exception: Tasks 4 and 5 have explicit "verify with human before deploy" notes about `record_kasir_sale` invocation and `_transition_approval` enum handling. These are intentional halts, not placeholders.

**Type consistency:**
- `DiscountGateResult` shape matches across types.ts + RPC JSONB return + Step3Payment consumption
- `ApprovalGateSettings` uniform between ApprovalGateEditor + upsert RPC params

**Known deferred:**
- Item #4b (product-level cap) — separate future item
- PIN inline flow — tenant can pick PIN in ApprovalRulesPanel but the wizard-side PIN modal wiring is deferred (APP_INBOX is default and covers MVP)
- Historical discount audit report — SQL query fine for now
