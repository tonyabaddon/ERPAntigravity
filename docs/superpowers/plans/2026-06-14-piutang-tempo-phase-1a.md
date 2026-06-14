# Piutang & Tempo — Phase 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the customer-side foundation of the Piutang & Tempo feature — schema for per-customer tempo whitelist (term_days + credit_limit), 6 owner-PIN-gated RPCs (activate / limit-change / deactivate), `piutang_settings` per-tenant config, customer profile UI section, and Persetujuan inbox extension.

**Architecture:** Mirror the existing approval workflow used for stock adjustments and price changes — admin calls `request_*` RPC → row inserted into `approval_requests` → owner sees in Persetujuan inbox → owner calls `approve_*` RPC with PIN → `_transition_approval` helper moves status pending→approved → SECURITY DEFINER RPC writes the underlying `customers` row inside a row-lock transaction. UI extends existing `ApprovalRequestRow` dispatcher (no new card component types).

**Tech Stack:**

- Postgres / Supabase (migrations append-only at `supabase/migrations/`)
- SECURITY DEFINER RPCs with `_transition_approval` helper from `20260607000007_approval_requests.sql`
- React + Tailwind 4 (existing token system: `primary #1e3d60`, `secondary #2d8a4e`, `channel-grosir #7C3AED`)
- Vitest integration tests at `tests/integration/` (pattern from `warehouses-phase1.test.ts`)
- Spec: `docs/superpowers/specs/2026-06-14-piutang-tempo-design.md`

**Scope (Phase 1A only):** §4.1 + §4.3 + §4.4 + §5.1-5.4 + §6.3 + §6.5 cards 1-3 from spec. Tempo invoice creation, payment recording, Piutang page, sidebar badge, write-off flow, WA send — all DEFERRED to Phase 1B/1C.

---

## File Structure

**New (Phase 1A):**

- `supabase/migrations/20260614000001_customers_tempo_fields.sql` — ALTER customers
- `supabase/migrations/20260614000003_approval_types_tempo.sql` — ALTER enum
- `supabase/migrations/20260614000004_piutang_settings.sql` — CREATE TABLE
- `supabase/migrations/20260614000005_resolve_tenant_helper.sql` — `_resolve_tenant_id()` SQL function
- `supabase/migrations/20260614000006_customer_credit_activate_rpcs.sql` — request_ + approve_
- `supabase/migrations/20260614000007_customer_credit_limit_change_rpcs.sql` — request_ + approve_
- `supabase/migrations/20260614000008_customer_credit_deactivate_rpcs.sql` — request_ + approve_
- `src/components/pelanggan/TempoCreditSection.tsx` — customer profile section component
- `tests/integration/piutang-tempo-phase1a.test.ts` — vitest integration tests

**Modified:**

- `src/types.ts` — extend `DbCustomer`, `ApprovalRequestType`, `PermissionSet`
- `src/lib/supabaseClient.ts` — add `customerCreditService` + extend `customersService.fetchProfile` to include new columns
- `src/components/approval/ApprovalRequestRow.tsx` — add 3 entries to `TYPE_LABEL` / `TYPE_ICON` / `summarisePayload`
- `src/components/PelangganScreen.tsx` — mount `TempoCreditSection` in profile view

**Skipped (handled by Phase 1B/1C or by Layer A):**

- §4.2 orders tempo fields → Phase 1B
- §5.5-5.8 invoice/payment/write-off/WA RPCs → Phase 1B/1C
- §6.1, §6.2, §6.4 → Phase 1B
- RLS tightening for tenant_id → Layer A

---

## Migration numbering convention

Phase 1A reserves `20260614000001`, `000003`, `000004`, `000005`, `000006`, `000007`, `000008`. Phase 1B will use `000002` (orders) and `000009`-`000020`. Phase 1C: `000021`+.

Do NOT renumber if you find conflicts with parallel work — bump to the next free slot and update this plan inline.

---

## Task 1: Migration — `customers` tempo fields

**Files:**

- Create: `supabase/migrations/20260614000001_customers_tempo_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000001_customers_tempo_fields.sql
-- Phase 1A: per-customer tempo whitelist columns. Owner-PIN-gated writes
-- enforced via SECURITY DEFINER RPCs in 20260614000006-000008; no anon/auth
-- UPDATE policy is added for these columns. Pre-Layer-A, all customer rows
-- share an implicit tenant (sentinel UUID). Layer A will retrofit tenant_id
-- onto customers itself.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS allows_tempo        boolean       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS term_days           int           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit        numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tempo_activated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS tempo_activated_by  uuid;

CREATE INDEX IF NOT EXISTS idx_customers_allows_tempo
  ON public.customers(allows_tempo) WHERE allows_tempo = true;

COMMENT ON COLUMN public.customers.allows_tempo IS
  'Owner-approved tempo eligibility. Set only via approve_customer_credit_activate / _deactivate RPCs.';
COMMENT ON COLUMN public.customers.credit_limit IS
  'Max outstanding INVOICE_TEMPO total per customer. Changes only via approve_customer_credit_limit_change RPC.';
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset --local` (or your project's standard local-apply command — check `package.json` scripts and `progress.md` for the convention; recent migrations like `20260613000005_reactivate_warehouse_rpc.sql` were applied via the same path).
Expected: `Applying migration 20260614000001_customers_tempo_fields.sql` line, no errors.

- [ ] **Step 3: Verify columns exist**

Run: `psql $LOCAL_DB_URL -c "\d customers"` (or `npx supabase db ... --inspect` equivalent)
Expected: rows for `allows_tempo`, `term_days`, `credit_limit`, `tempo_activated_at`, `tempo_activated_by` visible.

- [ ] **Step 4: Verify index exists**

Run: `psql $LOCAL_DB_URL -c "\di customers*"`
Expected: `idx_customers_allows_tempo` listed.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000001_customers_tempo_fields.sql
git commit -m "feat(piutang): customers tempo fields (allows_tempo, term_days, credit_limit)"
```

---

## Task 2: Migration — `approval_request_type` enum extension

**Files:**

- Create: `supabase/migrations/20260614000003_approval_types_tempo.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000003_approval_types_tempo.sql
-- Phase 1A: extend approval_request_type for tempo customer credit flow.
-- Reference: 20260607000007_approval_requests.sql created the enum.
-- ALTER TYPE ADD VALUE cannot run in a transaction block in older PG; use
-- standalone statements without BEGIN.

ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_activate';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_limit_change';
ALTER TYPE public.approval_request_type ADD VALUE IF NOT EXISTS 'customer_credit_deactivate';
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset --local`
Expected: applied; verify enum values:

`psql $LOCAL_DB_URL -c "SELECT unnest(enum_range(NULL::public.approval_request_type));"`
Expected: list includes the 3 new values.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614000003_approval_types_tempo.sql
git commit -m "feat(piutang): approval_request_type enum +3 tempo values"
```

---

## Task 3: Migration — `piutang_settings` per-tenant table

**Files:**

- Create: `supabase/migrations/20260614000004_piutang_settings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000004_piutang_settings.sql
-- Phase 1A: per-tenant Piutang configuration. Pre-Layer-A: one row with
-- sentinel tenant_id. Layer A migration backfills sentinel → Garindo's
-- real tenant_id. New tenants each get their own row at provision time.

CREATE TABLE IF NOT EXISTS public.piutang_settings (
  tenant_id                uuid PRIMARY KEY
                                DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
  reminder_offsets         int[]       NOT NULL DEFAULT '{-3,0,3,7,14}',
  wa_send_rate_per_minute  int         NOT NULL DEFAULT 3,
  wa_template_followup     text        NOT NULL DEFAULT
    'Halo {customer_name}, mohon konfirmasi terkait invoice {invoice_no} senilai {total} yang {tempo_phrase}. Terima kasih.',
  term_days_allowed        int[]       NOT NULL DEFAULT '{7,14,30,60,90}',
  aging_buckets            int[]       NOT NULL DEFAULT '{30,60,90}',
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Seed the sentinel row so SELECT queries from the frontend always return data.
INSERT INTO public.piutang_settings (tenant_id)
  VALUES ('00000000-0000-0000-0000-000000000000'::uuid)
  ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.piutang_settings ENABLE ROW LEVEL SECURITY;

-- Pre-Layer-A policies: anon SELECT, authenticated UPDATE only.
-- Layer A will tighten to filter by current_setting('app.current_tenant_id').
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'piutang_settings' AND policyname = 'anon_select_piutang_settings'
  ) THEN
    CREATE POLICY "anon_select_piutang_settings" ON public.piutang_settings
      FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'piutang_settings' AND policyname = 'authenticated_update_piutang_settings'
  ) THEN
    CREATE POLICY "authenticated_update_piutang_settings" ON public.piutang_settings
      FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase db reset --local`
Then: `psql $LOCAL_DB_URL -c "SELECT tenant_id, term_days_allowed, aging_buckets FROM piutang_settings;"`
Expected: one row with sentinel UUID, default arrays.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614000004_piutang_settings.sql
git commit -m "feat(piutang): per-tenant piutang_settings table (term_days_allowed, aging_buckets, WA defaults)"
```

---

## Task 4: Migration — `_resolve_tenant_id()` helper

**Files:**

- Create: `supabase/migrations/20260614000005_resolve_tenant_helper.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000005_resolve_tenant_helper.sql
-- Phase 1A: shared helper used by every Piutang/Tempo RPC. Pre-Layer-A,
-- the session GUC app.current_tenant_id is unset and we return the sentinel.
-- Post-Layer-A, Supabase auth hook sets the GUC at request time and this
-- function returns the active tenant. Idempotent contract: never raises.

CREATE OR REPLACE FUNCTION public._resolve_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_setting text;
BEGIN
  v_setting := current_setting('app.current_tenant_id', true);
  IF v_setting IS NULL OR v_setting = '' THEN
    RETURN '00000000-0000-0000-0000-000000000000'::uuid;
  END IF;
  RETURN v_setting::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN '00000000-0000-0000-0000-000000000000'::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION public._resolve_tenant_id() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._resolve_tenant_id() IS
  'Returns active tenant_id from session GUC, or sentinel UUID pre-Layer-A. Never raises.';
```

- [ ] **Step 2: Apply and unit-test**

Run: `npx supabase db reset --local`
Then: `psql $LOCAL_DB_URL -c "SELECT public._resolve_tenant_id();"`
Expected: `00000000-0000-0000-0000-000000000000`

Then test the GUC path:
`psql $LOCAL_DB_URL -c "SET app.current_tenant_id = '11111111-1111-1111-1111-111111111111'; SELECT public._resolve_tenant_id();"`
Expected: `11111111-1111-1111-1111-111111111111`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614000005_resolve_tenant_helper.sql
git commit -m "feat(piutang): _resolve_tenant_id() helper with sentinel fallback"
```

---

## Task 5: RPCs — customer_credit_activate (request + approve)

**Files:**

- Create: `supabase/migrations/20260614000006_customer_credit_activate_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000006_customer_credit_activate_rpcs.sql
-- Phase 1A: request + approve RPCs for activating tempo on a customer.
-- Pattern mirrors request_adjustment / approve_adjustment from
-- 20260607000009 / 20260607000010.

-- ── request: admin (or anyone with permission) inserts an approval_requests row.
CREATE OR REPLACE FUNCTION public.request_customer_credit_activate(
  p_customer_id    text,
  p_term_days      int,
  p_credit_limit   numeric,
  p_reason         text DEFAULT NULL,
  p_actor_user_id  uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public._resolve_tenant_id();
  v_allowed int[];
  v_request_id bigint;
  v_actor uuid;
BEGIN
  -- Actor resolution follows the project convention from request_adjustment
  -- (20260607000009): explicit arg → auth.uid() → system sentinel UUID.
  v_actor := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);

  -- Validate customer exists
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Validate term_days against tenant's allowed list
  SELECT term_days_allowed INTO v_allowed
    FROM public.piutang_settings
    WHERE tenant_id = v_tenant;
  IF v_allowed IS NULL THEN
    -- Defensive: sentinel row missing. Fall back to project-wide default.
    v_allowed := ARRAY[7, 14, 30, 60, 90];
  END IF;
  IF NOT (p_term_days = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'term_days_not_allowed: % (allowed: %)', p_term_days, v_allowed
      USING ERRCODE = 'P0001';
  END IF;

  IF p_credit_limit <= 0 THEN
    RAISE EXCEPTION 'credit_limit_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  -- Block if customer is already activated (deactivate first to re-issue).
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_already_activated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_activate',
    jsonb_build_object(
      'customer_id', p_customer_id,
      'term_days',   p_term_days,
      'credit_limit', p_credit_limit,
      'reason',      p_reason
    ),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_activate(text, int, numeric, text, uuid)
  TO anon, authenticated;

-- ── approve: owner enters PIN, RPC transitions approval + applies the customer mutation.
CREATE OR REPLACE FUNCTION public.approve_customer_credit_activate(
  p_request_id bigint,
  p_owner_pin  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_type public.approval_request_type;
  v_status public.approval_status;
  v_owner_id uuid;
  v_customer_id text;
  v_term_days int;
  v_credit_limit numeric;
BEGIN
  -- 1. Read payload + type BEFORE PIN check (we need payload after the
  -- helper flips the row to 'approved'; reading by id is allowed even when
  -- status != pending).
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Type guard: prevent caller from passing an approval_id of a different
  -- request_type (e.g. an adjustment id) to this RPC and tricking it into
  -- applying customer credit changes from a foreign payload.
  IF v_type <> 'customer_credit_activate' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_activate)', v_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- 3. PIN verification. verify_owner_pin both validates the PIN and (on
  -- success) atomically calls _transition_approval(.., 'approved', owner_id,
  -- 'owner_pin'). It RETURNS FALSE on PIN mismatch (does NOT raise) and
  -- RAISES on lockout / missing-owner / row-not-pending. See
  -- 20260607000019_verify_owner_pin.sql.
  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Extract payload fields and apply mutation under a row lock.
  v_customer_id  := v_payload->>'customer_id';
  v_term_days    := (v_payload->>'term_days')::int;
  v_credit_limit := (v_payload->>'credit_limit')::numeric;

  -- Determine the Owner uuid so we can attribute the customer write to them
  -- (matches who actually approved, not the admin who requested).
  SELECT id INTO v_owner_id
    FROM public.admin_users
    WHERE role = 'Owner'
    ORDER BY id
    LIMIT 1;

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo       = true,
         term_days          = v_term_days,
         credit_limit       = v_credit_limit,
         tempo_activated_at = now(),
         tempo_activated_by = v_owner_id
   WHERE id = v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_activate(bigint, text)
  TO anon, authenticated;
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db reset --local`
Expected: clean apply.

- [ ] **Step 3: Smoke test in psql**

```sql
-- Insert a test customer first
INSERT INTO public.customers (id, wa_number, name) VALUES ('GJP-CUST-TEST', '+62800000000', 'Test Customer');

-- Request activation
SELECT public.request_customer_credit_activate('GJP-CUST-TEST', 30, 50000000, 'smoke');
-- Returns: a bigint approval_request id

-- Inspect
SELECT id, request_type, status, payload FROM public.approval_requests ORDER BY id DESC LIMIT 1;
-- Expected: latest row, status=pending, payload has term_days=30 etc.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000006_customer_credit_activate_rpcs.sql
git commit -m "feat(piutang): request + approve customer_credit_activate RPCs (owner-PIN-gated)"
```

---

## Task 6: RPCs — customer_credit_limit_change (request + approve)

**Files:**

- Create: `supabase/migrations/20260614000007_customer_credit_limit_change_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000007_customer_credit_limit_change_rpcs.sql
-- Phase 1A: request + approve for changing credit_limit on an already-activated customer.

CREATE OR REPLACE FUNCTION public.request_customer_credit_limit_change(
  p_customer_id   text,
  p_new_limit     numeric,
  p_reason        text,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_actor uuid := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_not_activated' USING ERRCODE = 'P0001';
  END IF;

  IF p_new_limit <= 0 THEN
    RAISE EXCEPTION 'credit_limit_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(length(p_reason), 0) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_limit_change',
    jsonb_build_object(
      'customer_id', p_customer_id,
      'new_limit',   p_new_limit,
      'reason',      p_reason
    ),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_limit_change(text, numeric, text, uuid)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_credit_limit_change(
  p_request_id bigint,
  p_owner_pin  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_type public.approval_request_type;
  v_status public.approval_status;
  v_customer_id text;
  v_new_limit numeric;
BEGIN
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'customer_credit_limit_change' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_limit_change)', v_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- verify_owner_pin handles both PIN check and _transition_approval call.
  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_customer_id := v_payload->>'customer_id';
  v_new_limit   := (v_payload->>'new_limit')::numeric;

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET credit_limit = v_new_limit
   WHERE id = v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_limit_change(bigint, text)
  TO anon, authenticated;
```

- [ ] **Step 2: Apply + smoke test**

Run: `npx supabase db reset --local`
Then smoke test in psql:

```sql
-- Assuming TEST customer is now activated (from Task 5 smoke test + approval)
-- If not, first run Task 5 smoke + approve manually:
UPDATE public.customers SET allows_tempo = true, term_days = 30, credit_limit = 50000000
  WHERE id = 'GJP-CUST-TEST';

SELECT public.request_customer_credit_limit_change('GJP-CUST-TEST', 100000000, 'pesanan baru besar');
-- Expected: returns bigint
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614000007_customer_credit_limit_change_rpcs.sql
git commit -m "feat(piutang): request + approve customer_credit_limit_change RPCs"
```

---

## Task 7: RPCs — customer_credit_deactivate (request + approve)

**Files:**

- Create: `supabase/migrations/20260614000008_customer_credit_deactivate_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260614000008_customer_credit_deactivate_rpcs.sql
-- Phase 1A: request + approve for deactivating tempo on a customer.
-- Deactivation does NOT touch existing open INVOICE_TEMPO orders — those
-- remain open until paid or written off. Deactivation only blocks NEW
-- tempo invoices going forward.

CREATE OR REPLACE FUNCTION public.request_customer_credit_deactivate(
  p_customer_id   text,
  p_reason        text,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id bigint;
  v_actor uuid := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_not_activated' USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(length(p_reason), 0) < 5 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_deactivate',
    jsonb_build_object('customer_id', p_customer_id, 'reason', p_reason),
    v_actor
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_deactivate(text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_customer_credit_deactivate(
  p_request_id bigint,
  p_owner_pin  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_type public.approval_request_type;
  v_status public.approval_status;
  v_customer_id text;
BEGIN
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_type <> 'customer_credit_deactivate' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_deactivate)', v_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  v_customer_id := v_payload->>'customer_id';

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo = false
   WHERE id = v_customer_id;
  -- intentionally NOT resetting term_days/credit_limit — re-activation
  -- starts from a fresh request so these last-known values stay as audit.
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_deactivate(bigint, text) TO anon, authenticated;
```

- [ ] **Step 2: Apply + smoke test**

Run: `npx supabase db reset --local`
Then in psql, verify the function exists and rejects invalid input:

```sql
SELECT public.request_customer_credit_deactivate('GJP-CUST-TEST', 'short');
-- Expected: ERROR reason_required

SELECT public.request_customer_credit_deactivate('GJP-CUST-TEST', 'duplicate dengan pesanan lain');
-- Expected: bigint returned (assuming activated; else customer_not_activated)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260614000008_customer_credit_deactivate_rpcs.sql
git commit -m "feat(piutang): request + approve customer_credit_deactivate RPCs"
```

---

## Task 8: Integration tests — RPC happy paths + edge cases

**Files:**

- Create: `tests/integration/piutang-tempo-phase1a.test.ts`

- [ ] **Step 1: Write the test file (follow pattern from `tests/integration/warehouses-phase1.test.ts`)**

```ts
// tests/integration/piutang-tempo-phase1a.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE!;
const OWNER_PIN = process.env.OWNER_PIN ?? '0000'; // dev default

let admin: SupabaseClient; // service-role for setup
let user: SupabaseClient;  // anon-key for RPCs

const TEST_CUSTOMER = 'GJP-CUST-PIUTANG-T1';

beforeEach(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  user  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Clean prior test state
  await admin.from('approval_requests')
    .delete()
    .in('request_type', ['customer_credit_activate', 'customer_credit_limit_change', 'customer_credit_deactivate']);
  await admin.from('customers').delete().eq('id', TEST_CUSTOMER);

  // Seed test customer
  await admin.from('customers').insert({
    id: TEST_CUSTOMER,
    wa_number: '+62811000001',
    name: 'Test Customer Piutang',
  });
});

describe('piutang phase 1A — customer credit activate', () => {
  it('happy path: request → approve → customer becomes allows_tempo=true', async () => {
    const { data: reqId, error: reqErr } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 50_000_000,
      p_reason: 'langganan grosir',
    });
    expect(reqErr).toBeNull();
    expect(typeof reqId).toBe('number');

    const { error: appErr } = await user.rpc('approve_customer_credit_activate', {
      p_request_id: reqId,
      p_owner_pin: OWNER_PIN,
    });
    expect(appErr).toBeNull();

    const { data: cust } = await admin.from('customers').select('allows_tempo, term_days, credit_limit, tempo_activated_at').eq('id', TEST_CUSTOMER).single();
    expect(cust?.allows_tempo).toBe(true);
    expect(cust?.term_days).toBe(30);
    expect(Number(cust?.credit_limit)).toBe(50_000_000);
    expect(cust?.tempo_activated_at).not.toBeNull();
  });

  it('rejects term_days not in piutang_settings.term_days_allowed', async () => {
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 45,  // not in default {7,14,30,60,90}
      p_credit_limit: 10_000_000,
      p_reason: 'test',
    });
    expect(error?.message).toMatch(/term_days_not_allowed/);
  });

  it('rejects credit_limit <= 0', async () => {
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 0,
      p_reason: 'test',
    });
    expect(error?.message).toMatch(/credit_limit_must_be_positive/);
  });

  it('rejects wrong PIN at approve', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 10_000_000,
      p_reason: 'test',
    });
    const { error } = await user.rpc('approve_customer_credit_activate', {
      p_request_id: reqId,
      p_owner_pin: '9999',
    });
    expect(error?.message).toMatch(/pin_invalid/);
  });

  it('rejects re-activating an already-active customer', async () => {
    // First activation
    const { data: req1 } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 30,
      p_credit_limit: 10_000_000,
      p_reason: 'first',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: req1, p_owner_pin: OWNER_PIN });

    // Second request should fail
    const { error } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER,
      p_term_days: 60,
      p_credit_limit: 20_000_000,
      p_reason: 'second',
    });
    expect(error?.message).toMatch(/customer_already_activated/);
  });
});

describe('piutang phase 1A — limit change', () => {
  beforeEach(async () => {
    // Pre-activate the customer
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER, p_term_days: 30, p_credit_limit: 50_000_000, p_reason: 'init',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });
  });

  it('happy path: request → approve → credit_limit updated', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_limit_change', {
      p_customer_id: TEST_CUSTOMER, p_new_limit: 100_000_000, p_reason: 'pesanan besar',
    });
    await user.rpc('approve_customer_credit_limit_change', { p_request_id: reqId, p_owner_pin: OWNER_PIN });

    const { data: cust } = await admin.from('customers').select('credit_limit').eq('id', TEST_CUSTOMER).single();
    expect(Number(cust?.credit_limit)).toBe(100_000_000);
  });

  it('rejects too-short reason (<5 chars)', async () => {
    const { error } = await user.rpc('request_customer_credit_limit_change', {
      p_customer_id: TEST_CUSTOMER, p_new_limit: 80_000_000, p_reason: 'xx',
    });
    expect(error?.message).toMatch(/reason_required/);
  });
});

describe('piutang phase 1A — deactivate', () => {
  beforeEach(async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_activate', {
      p_customer_id: TEST_CUSTOMER, p_term_days: 30, p_credit_limit: 50_000_000, p_reason: 'init',
    });
    await user.rpc('approve_customer_credit_activate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });
  });

  it('happy path: deactivate sets allows_tempo=false, retains term_days/credit_limit as history', async () => {
    const { data: reqId } = await user.rpc('request_customer_credit_deactivate', {
      p_customer_id: TEST_CUSTOMER, p_reason: 'customer pindah supplier lain',
    });
    await user.rpc('approve_customer_credit_deactivate', { p_request_id: reqId, p_owner_pin: OWNER_PIN });

    const { data: cust } = await admin.from('customers').select('allows_tempo, term_days, credit_limit').eq('id', TEST_CUSTOMER).single();
    expect(cust?.allows_tempo).toBe(false);
    expect(cust?.term_days).toBe(30);  // retained
    expect(Number(cust?.credit_limit)).toBe(50_000_000);  // retained
  });
});
```

- [ ] **Step 2: Run the test suite**

Run: `npm run test -- piutang-tempo-phase1a` (or the project's vitest invocation — check `package.json` `scripts`)
Expected: all 8 tests PASS. If `verify_owner_pin` rejects `OWNER_PIN`, check `20260607000019_verify_owner_pin.sql` to find the dev-mode default and set `OWNER_PIN` env var accordingly.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/piutang-tempo-phase1a.test.ts
git commit -m "test(piutang): RPC integration tests for activate/limit-change/deactivate flows"
```

---

## Task 9: Frontend types — extend `DbCustomer`, `ApprovalRequestType`, `PermissionSet`

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Extend `DbCustomer`** — find the existing interface (`grep -n "interface DbCustomer" src/types.ts`) and add the new fields:

```ts
export interface DbCustomer {
  id: string;
  wa_number: string;
  name: string;
  company: string;
  created_at: string;
  // Phase 1A — tempo whitelist
  allows_tempo: boolean;
  term_days: number;
  credit_limit: number;
  tempo_activated_at?: string | null;
  tempo_activated_by?: string | null;
}
```

- [ ] **Step 2: Extend `ApprovalRequestType`** — find existing union and add 3 values:

```ts
export type ApprovalRequestType =
  | 'adjustment'
  | 'opname'
  | 'price_change'
  | 'kasir_price_override'
  | 'kasir_void'
  | 'kasir_refund'
  | 'rakit_lock'
  | 'customer_credit_activate'
  | 'customer_credit_limit_change'
  | 'customer_credit_deactivate';
```

- [ ] **Step 3: Extend `PermissionSet`** — add 6 action keys (legacy boolean for menu visibility added in Phase 1B):

```ts
export interface PermissionSet {
  // ... existing keys ...

  // Phase 1A — Piutang/Tempo customer credit
  can_request_credit_activate?: boolean;
  can_approve_credit_activate?: boolean;
  can_request_limit_change?: boolean;
  can_approve_limit_change?: boolean;
  can_request_deactivate?: boolean;
  can_approve_deactivate?: boolean;
}
```

Also add defaults to `ALL_PERMISSIONS` constant:

```ts
export const ALL_PERMISSIONS: PermissionSet = {
  // ... existing ...
  can_request_credit_activate: true,
  can_approve_credit_activate: true,
  can_request_limit_change: true,
  can_approve_limit_change: true,
  can_request_deactivate: true,
  can_approve_deactivate: true,
};
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck` (or `tsc --noEmit`)
Expected: no errors related to these changes. Existing `formatDate`, `formatRupiah`, etc. may already exist — no need to add.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(piutang): extend types — DbCustomer tempo fields, ApprovalRequestType, PermissionSet keys"
```

---

## Task 10: Frontend service — `customerCreditService` in supabaseClient

**Files:**

- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add the service block** — find the existing `customersService` definition (`grep -n "customersService" src/lib/supabaseClient.ts`) and add new service after it:

```ts
export const customerCreditService = {
  async requestActivate(customerId: string, termDays: number, creditLimit: number, reason: string | null) {
    const { data, error } = await supabase.rpc('request_customer_credit_activate', {
      p_customer_id: customerId,
      p_term_days: termDays,
      p_credit_limit: creditLimit,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveActivate(requestId: number, ownerPin: string) {
    const { error } = await supabase.rpc('approve_customer_credit_activate', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
  async requestLimitChange(customerId: string, newLimit: number, reason: string) {
    const { data, error } = await supabase.rpc('request_customer_credit_limit_change', {
      p_customer_id: customerId,
      p_new_limit: newLimit,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveLimitChange(requestId: number, ownerPin: string) {
    const { error } = await supabase.rpc('approve_customer_credit_limit_change', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
  async requestDeactivate(customerId: string, reason: string) {
    const { data, error } = await supabase.rpc('request_customer_credit_deactivate', {
      p_customer_id: customerId,
      p_reason: reason,
    });
    if (error) throw error;
    return data as number;
  },
  async approveDeactivate(requestId: number, ownerPin: string) {
    const { error } = await supabase.rpc('approve_customer_credit_deactivate', {
      p_request_id: requestId,
      p_owner_pin: ownerPin,
    });
    if (error) throw error;
  },
};
```

- [ ] **Step 2: Update `customersService.fetchProfile` to include new columns** — find the `.select(...)` call and ensure new columns are returned. If existing select is `*` it already works; if it's an explicit column list, add `allows_tempo, term_days, credit_limit, tempo_activated_at`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(piutang): customerCreditService (6 RPC wrappers)"
```

---

## Task 11: Frontend — extend `ApprovalRequestRow` for 3 new types

**Files:**

- Modify: `src/components/approval/ApprovalRequestRow.tsx`

- [ ] **Step 1: Extend `TYPE_LABEL`**

```ts
const TYPE_LABEL: Record<ApprovalRequestType, string> = {
  // ... existing entries ...
  customer_credit_activate:     'Aktivasi Tempo Customer',
  customer_credit_limit_change: 'Ubah Limit Tempo',
  customer_credit_deactivate:   'Nonaktifkan Tempo Customer',
};
```

- [ ] **Step 2: Extend `TYPE_ICON`**

```ts
const TYPE_ICON: Record<ApprovalRequestType, { icon: string; bg: string; fg: string }> = {
  // ... existing entries ...
  customer_credit_activate:     { icon: '📋', bg: 'bg-violet-50', fg: 'text-violet-700' },
  customer_credit_limit_change: { icon: '✏️', bg: 'bg-orange-50', fg: 'text-orange-700' },
  customer_credit_deactivate:   { icon: '🚫', bg: 'bg-slate-100', fg: 'text-slate-700'  },
};
```

- [ ] **Step 3: Extend `summarisePayload`** — find the `function summarisePayload` and add cases:

```ts
function summarisePayload(req: ApprovalRequest): string {
  const p = req.payload ?? {};
  const get = (k: string) => (p as Record<string, unknown>)[k];

  switch (req.request_type) {
    // ... existing cases ...

    case 'customer_credit_activate':
      return `Aktifkan tempo untuk ${get('customer_id')} — Net ${get('term_days')} hari, limit ${formatRupiah(Number(get('credit_limit') ?? 0))}`;

    case 'customer_credit_limit_change':
      return `Ubah limit tempo ${get('customer_id')} → ${formatRupiah(Number(get('new_limit') ?? 0))} (alasan: ${get('reason')})`;

    case 'customer_credit_deactivate':
      return `Nonaktifkan tempo ${get('customer_id')} (alasan: ${get('reason')})`;
  }
  return '';
}
```

- [ ] **Step 4: Run typecheck + look at the inbox locally**

Run: `npm run typecheck` then `npm run dev`
Visit `/persetujuan` after seeding a `customer_credit_activate` request via psql. Verify the new card renders with the violet icon and the summary line.

- [ ] **Step 5: Commit**

```bash
git add src/components/approval/ApprovalRequestRow.tsx
git commit -m "feat(piutang): ApprovalRequestRow dispatch for 3 customer_credit_* types"
```

---

## Task 12: Frontend — `TempoCreditSection` component

**Files:**

- Create: `src/components/pelanggan/TempoCreditSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/pelanggan/TempoCreditSection.tsx
import { useState, useEffect } from 'react';
import { DbCustomer } from '../../types';
import { customerCreditService, supabase } from '../../lib/supabaseClient';

interface Props {
  customer: DbCustomer;
  onChanged: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

const DEFAULT_TERM_OPTIONS = [7, 14, 30, 60, 90];

export default function TempoCreditSection({ customer, onChanged, showToast }: Props) {
  const [termOptions, setTermOptions] = useState<number[]>(DEFAULT_TERM_OPTIONS);
  const [selectedTerm, setSelectedTerm] = useState(30);
  const [limitInput, setLimitInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<number | null>(null);

  // Load tenant's allowed term values from piutang_settings
  useEffect(() => {
    supabase
      .from('piutang_settings')
      .select('term_days_allowed')
      .single()
      .then(({ data }) => {
        if (data?.term_days_allowed?.length) setTermOptions(data.term_days_allowed as number[]);
      })
      .catch(() => { /* keep default */ });
  }, []);

  // Check if a pending request already exists for this customer (poll on mount).
  useEffect(() => {
    supabase
      .from('approval_requests')
      .select('id, request_type, status')
      .eq('status', 'pending')
      .in('request_type', ['customer_credit_activate', 'customer_credit_limit_change', 'customer_credit_deactivate'])
      .order('id', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const found = (data ?? []).find((r: any) => {
          const pid = (r as any).payload?.customer_id;
          return pid === customer.id;
        });
        if (found) setPendingRequestId(found.id);
      })
      .catch(() => {});
  }, [customer.id]);

  const handleRequestActivate = async () => {
    const limit = Number(limitInput.replace(/\D/g, ''));
    if (!limit || limit <= 0) {
      showToast('Limit harus diisi & > 0', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestActivate(customer.id, selectedTerm, limit, reasonInput || null);
      setPendingRequestId(id);
      showToast('Permintaan dikirim ke owner', 'success');
      onChanged();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChange = async () => {
    const limit = Number(limitInput.replace(/\D/g, ''));
    if (!limit || limit <= 0) { showToast('Limit baru harus > 0', 'warning'); return; }
    if (reasonInput.trim().length < 5) { showToast('Alasan minimal 5 karakter', 'warning'); return; }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestLimitChange(customer.id, limit, reasonInput);
      setPendingRequestId(id);
      showToast('Permintaan ubah limit dikirim ke owner', 'success');
      onChanged();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestDeactivate = async () => {
    if (reasonInput.trim().length < 5) { showToast('Alasan minimal 5 karakter', 'warning'); return; }
    setSubmitting(true);
    try {
      const id = await customerCreditService.requestDeactivate(customer.id, reasonInput);
      setPendingRequestId(id);
      showToast('Permintaan nonaktifkan dikirim ke owner', 'success');
      onChanged();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengirim permintaan', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render: 3 states ───────────────────────────────────────────────────
  if (pendingRequestId !== null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-amber-800 mb-1">⏳ Menunggu Persetujuan Owner</div>
        <div className="text-xs text-amber-700">Owner akan approve dengan PIN dari halaman Persetujuan.</div>
      </div>
    );
  }

  if (!customer.allows_tempo) {
    // State A: not activated
    return (
      <div className="bg-slate-50 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-on-surface">Tempo & Limit Kredit</div>
          <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full">BELUM AKTIF</span>
        </div>
        <div className="text-xs text-slate-500 mb-3">
          Aktifkan jika ini customer langganan grosir terpercaya. Permintaan akan dikirim ke owner.
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Jangka Waktu (Net)</label>
          <div className="flex gap-2 flex-wrap">
            {termOptions.map(d => (
              <button key={d} type="button"
                className={'px-3 py-2 rounded border text-sm ' + (selectedTerm === d ? 'border-2 border-primary bg-primary/5 text-primary font-semibold' : 'border-slate-300 text-slate-700')}
                onClick={() => setSelectedTerm(d)}>
                {d} hari
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Limit Kredit Maksimum</label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-slate-500">Rp</span>
            <input type="text" value={limitInput} onChange={e => setLimitInput(e.target.value.replace(/\D/g, ''))}
              placeholder="50000000" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded text-sm font-mono" />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Alasan (opsional)</label>
          <input type="text" value={reasonInput} onChange={e => setReasonInput(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
        </div>
        <button onClick={handleRequestActivate} disabled={submitting}
          className="w-full bg-channel-grosir text-white py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">
          🔐 Minta Persetujuan Owner
        </button>
      </div>
    );
  }

  // State C: activated
  const usagePct = 0; // Phase 1A: outstanding tracking lands in Phase 1B; show 0% placeholder.
  return (
    <div className="bg-secondary/5 rounded-lg p-4 border border-secondary/20">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="text-secondary">●</span> Tempo & Limit Kredit
        </div>
        <span className="bg-secondary/15 text-secondary text-[10px] font-bold px-2 py-0.5 rounded-full">AKTIF</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Jangka Waktu</div>
          <div className="text-base font-semibold text-on-surface">Net {customer.term_days} hari</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500 uppercase mb-0.5">Limit Kredit</div>
          <div className="text-base font-semibold text-on-surface">{formatRupiah(customer.credit_limit)}</div>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-[11px] text-slate-600 mb-1">
          <span className="font-semibold">Terpakai</span>
          <span>{formatRupiah(0)} / {formatRupiah(customer.credit_limit)} ({usagePct}%)</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div className="bg-secondary rounded-full h-2" style={{ width: `${usagePct}%` }}></div>
        </div>
        <div className="text-[11px] text-slate-500 mt-1">Outstanding tracking ditambahkan di Phase 1B</div>
      </div>

      <div className="mb-3">
        <label className="text-[11px] font-semibold text-slate-600 uppercase mb-1 block">Limit baru (untuk Ubah) atau Alasan (untuk Nonaktifkan)</label>
        <div className="relative">
          <span className="absolute left-3 top-2 text-sm text-slate-500">Rp</span>
          <input type="text" value={limitInput} onChange={e => setLimitInput(e.target.value.replace(/\D/g, ''))}
            placeholder="limit baru" className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded text-sm font-mono mb-2" />
        </div>
        <input type="text" value={reasonInput} onChange={e => setReasonInput(e.target.value)}
          placeholder="alasan (minimal 5 karakter)"
          className="w-full px-3 py-2 border border-slate-300 rounded text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={handleRequestChange} disabled={submitting}
          className="bg-white border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
          ✏️ Ubah Limit
        </button>
        <button onClick={handleRequestDeactivate} disabled={submitting}
          className="bg-white border border-red-300 text-red-600 py-2 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50">
          🚫 Nonaktifkan
        </button>
      </div>
      <div className="text-[11px] text-slate-400 text-center mt-2">Kedua aksi di atas perlu approval owner</div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `PelangganScreen`** — find where the customer profile is rendered (`grep -n "DbCustomerProfile" src/components/PelangganScreen.tsx`) and add the section inside the profile panel:

```tsx
import TempoCreditSection from './pelanggan/TempoCreditSection';
// ...
<TempoCreditSection
  customer={profile}
  onChanged={() => reloadProfile()}
  showToast={showToast}
/>
```

(`reloadProfile` is whatever function the screen already uses to refresh the open profile — find by `grep` in the file.)

- [ ] **Step 3: Run dev server + manual smoke**

Run: `npm run dev`
Visit a customer in the Pelanggan screen — confirm the new section renders in "BELUM AKTIF" state. Fill in form → click "Minta Persetujuan Owner" → state changes to "Menunggu Persetujuan Owner".

- [ ] **Step 4: Commit**

```bash
git add src/components/pelanggan/TempoCreditSection.tsx src/components/PelangganScreen.tsx
git commit -m "feat(piutang): TempoCreditSection — 3-state customer profile UI"
```

---

## Task 13: Prepare for user MCP-Chrome QA — handoff document

**Files:**

- Modify: `progress.md`

> **IMPORTANT — DO NOT run manual browser QA.** The founder explicitly handles all UI QA via MCP Chrome (chrome-devtools tools) themselves at the end. The implementer's job ends after this task by leaving the system in a clean, runnable state and documenting what the founder needs to test. Do NOT click through scenarios in your local browser.

- [ ] **Step 1: Verify the local stack starts cleanly**

Run: `npm run dev` (frontend) + ensure local Supabase is up (`npx supabase status` should show all services running).
Expected: no startup errors, frontend reachable at the dev URL printed by Vite. **Smoke check only** — verify the Pelanggan screen renders an existing customer profile and the new "Tempo & Limit Kredit — BELUM AKTIF" section appears. Then STOP. Do not proceed through scenarios.

- [ ] **Step 2: Seed predictable test data via Supabase admin SQL**

Run in psql (or Supabase Studio SQL editor) so the founder has known fixtures to MCP-test against:

```sql
-- Ensure a test customer exists (idempotent)
INSERT INTO public.customers (id, wa_number, name, company)
VALUES ('GJP-CUST-QATEST', '+628111000001', 'QA Tempo Customer', 'CV Test Grosir')
ON CONFLICT (id) DO UPDATE
  SET allows_tempo = false,
      term_days    = 0,
      credit_limit = 0,
      tempo_activated_at = NULL,
      tempo_activated_by = NULL;

-- Clear any prior approval requests for this customer
DELETE FROM public.approval_requests
WHERE request_type IN ('customer_credit_activate','customer_credit_limit_change','customer_credit_deactivate')
  AND payload->>'customer_id' = 'GJP-CUST-QATEST';

-- Verify piutang_settings sentinel row exists
SELECT tenant_id, term_days_allowed, aging_buckets FROM public.piutang_settings;
```

Expected: customer reset to inactive, no pending approvals for this customer, piutang_settings returns the sentinel row with default arrays.

- [ ] **Step 3: Document the QA scenarios for the founder in `progress.md`**

Append to today's entry in `progress.md`:

```markdown
## 2026-06-14 — Piutang & Tempo Phase 1A implementation — READY FOR MCP-CHROME QA

**Status:** All 13 tasks committed; integration tests green; local stack runs clean.

**Seed customer:** `GJP-CUST-QATEST` (CV Test Grosir, +628111000001) — set to inactive state for QA start.

**QA scenarios for founder to execute via MCP Chrome (chrome-devtools):**

1. **Scenario A — Happy path activation**
   - Open Pelanggan screen, select GJP-CUST-QATEST
   - In "Tempo & Limit Kredit" section: pick Net 30, limit 50000000, reason "langganan grosir baru" → click Minta Persetujuan Owner
   - Verify: state changes to "Menunggu Persetujuan Owner"
   - Switch to owner login → Persetujuan screen → verify violet "AKTIVASI TEMPO CUSTOMER" card appears with summary
   - Click Setujui → enter PIN → confirm
   - Switch back to admin → reload customer profile → verify state shows "AKTIF" with Net 30 hari + Rp 50.000.000 + usage 0%
2. **Scenario B — term_days outside allowed list**
   - Manually edit piutang_settings.term_days_allowed via Supabase Studio to `{7,14,30,60,90}` (default)
   - From Scenario A's UI, pick Net 60, then change term_days_allowed to `{7,14,30}` mid-flow (simulate tenant tightening)
   - Click Minta Persetujuan Owner → expect inline error toast "term_days_not_allowed" with allowed list shown
3. **Scenario C — Wrong PIN at approve**
   - Repeat Scenario A through "Setujui"; enter wrong PIN twice → expect rejection toast with `pin_invalid`. Verify customer remains inactive after both attempts.
4. **Scenario D — Re-activation blocked**
   - Customer already active (from Scenario A) → admin tries to call activate again from UI → expect `customer_already_activated`.
5. **Scenario E — Limit change happy path**
   - Customer active → in profile, enter new limit `100000000` + reason "pesanan baru besar" → Ubah Limit
   - Owner approves with PIN → customer credit_limit becomes 100jt
6. **Scenario F — Limit change rejected reason too short**
   - Enter reason "xx" (under 5 chars) → expect `reason_required`
7. **Scenario G — Deactivate happy path**
   - Customer active → reason "customer pindah supplier" → Nonaktifkan
   - Owner approves → allows_tempo=false; verify term_days/credit_limit retained as audit history (shown in admin SQL view)

**What's NOT in MVP / Phase 1A:**
- Sidebar "Piutang" menu — Phase 1B
- Outstanding usage meter showing real number — Phase 1B
- "Catat Bayar" button — Phase 1B
- WA send & write-off — Phase 1C
- piutang_settings Pengaturan UI — Phase 1C (use SQL for now)
```

Expected: progress.md update committed; nothing else to verify.

- [ ] **Step 4: Commit progress.md**

```bash
git add progress.md
git commit -m "docs(progress): piutang phase 1A implementation ready for founder MCP-chrome QA"
```

- [ ] **Step 5: Hand off — stop work and report**

Report back to the founder: "Phase 1A code complete, all integration tests green, local stack runs. Seed data prepared. 7 QA scenarios documented in progress.md. Ready for your MCP-Chrome QA pass."

Do NOT proceed to Phase 1B until founder MCP-Chrome QA has signed off.

---

## Phase 1A acceptance gate

After Task 13 commit and handoff, Phase 1A code is DONE. Founder MCP-Chrome QA pass is a separate gate.

- [ ] All 8 integration tests green (`npm run test piutang-tempo-phase1a`)
- [ ] `npm run typecheck` clean
- [ ] Local stack starts without errors
- [ ] Seed data committed (`GJP-CUST-QATEST` exists in inactive state)
- [ ] `progress.md` lists the 7 QA scenarios for founder to execute via MCP Chrome
- [ ] All commits pushed to the working branch
- [ ] PR opened with link to `docs/superpowers/specs/2026-06-14-piutang-tempo-design.md` §14 (Phase 1A scope)
- [ ] **Founder MCP-Chrome QA pass** — gated by founder, not implementer

Then proceed to Phase 1B (separate plan: tempo invoice creation + Piutang page + sidebar badge) only after founder signs off on QA.

---

## Self-Review notes (for the implementer)

Things this plan deliberately does NOT cover (and why):

1. **`piutang_settings` Pengaturan UI** — owner can edit `term_days_allowed` via raw `UPDATE piutang_settings SET term_days_allowed = '{7,14,21,30,45,60,90}'` in Supabase admin for Phase 1A. The dedicated Pengaturan page is Phase 1C deliverable (bundled with the other Piutang settings: reminder offsets, WA template, etc.).
2. **Sidebar menu "Piutang"** — Phase 1B (with badge + page).
3. **Outstanding usage meter (real number)** — Phase 1B once orders table has tempo columns.
4. **Permission key enforcement** — keys are defined in `PermissionSet` (Task 9) so they exist; visibility/gating UI lands when admin role-editor is touched (out of scope for this plan).
5. **RLS tightening** — Layer A project.
6. **Customer history snippet on approval card** — nice-to-have; not in MVP per spec §6.5 description. The current `summarisePayload` line is sufficient.
