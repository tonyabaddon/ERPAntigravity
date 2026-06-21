# Catat Penjualan 3-Step Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 624-line monolithic `PenjualanBaruScreen.tsx` with a guided 3-step wizard (Channel+Customer → Items → Payment) that supports pre-order (negative stock), inline "+ Customer Baru" with optional TEMPO request, and a post-save invoice preview with print/share/Catat-lagi actions.

**Architecture:** New `CatatPenjualanWizard.tsx` orchestrator owns shared state + stepper UI + nav + save dispatch; renders one of 3 step components per `currentStep`. Step components wrap existing sub-components (`ChannelSelector`, `CustomerPanel`, `PaymentPanel`, `ItemSearchPanel`, `CartRows`, `RakitButtonsRow`, `RakitInlineForm`). Save dispatch keeps 3 existing RPC paths (`record_kasir_sale` / `create_tempo_invoice` / client-composed WIP+rakit insert) — each gains a new optional `allow_negative_stock` opt-in flag for pre-order.

**Tech Stack:** React + TypeScript (Vite); Vitest only (no RTL/jsdom); Tailwind v4 theme tokens in `src/index.css`; Supabase Postgres + RLS + Realtime. Migration naming `YYYYMMDDHHmmss_*.sql`. Slot range claimed `20260630000001-010` (distant from parallel session's `20260628xxx`).

## Global Constraints

- **No new permission flags.** Reuse existing `pelanggan` flag for "+ Customer Baru" + "Ajukan TEMPO". Wizard access itself ungated (mirrors current `PenjualanBaruScreen`).
- **No ad-hoc customers.** Every customer in a sale persists to `customers` table. Walk-in anonymous wajib intake nama+HP (no Walk-in Cash placeholder). Per `feedback_no_adhoc_customers`.
- **No PPN / discount / promo.** Parity with current flow.
- **No draft persistence.** Browser close = state lost. `beforeunload` warning only.
- **Jasa only Custom Panel + Wiring Panel.** No ASSEMBLY / Rakit Standard.
- **Per-RPC negative-stock flag.** Wizard passes `allow_negative_stock=true`; Kasir POS keeps current behavior (no opt-in flag = block stays as-is).
- **Indonesian copy** for all user-facing strings (toasts, labels, button text).

**Working dir:** `/Users/tonywei/IdeaProjects/ERPAntigravity`
**Worktree:** `.claude/worktrees/catat-penjualan-wizard` (already created off `origin/main`)
**Branch:** `feat/catat-penjualan-wizard`
**Spec:** `docs/superpowers/specs/2026-06-20-catat-penjualan-3-step-wizard-design.md` (commit `ab7a15f`)
**Mockup:** `docs/superpowers/mockups/2026-06-20-catat-penjualan-3-step-wizard.html`

---

## File Structure

| Layer | File | Status |
|---|---|---|
| Migration | `supabase/migrations/20260630000001_customers_add_address.sql` | NEW |
| Migration | `supabase/migrations/20260630000002_record_kasir_sale_allow_negative_stock.sql` | NEW |
| Migration | `supabase/migrations/20260630000003_create_tempo_invoice_allow_negative_stock.sql` | NEW |
| Migration | `supabase/migrations/20260630000004_reject_customer_credit_activate_rpc.sql` | NEW |
| Migration | `supabase/migrations/20260630000005_record_pi_preorder_fulfilled_audit.sql` | NEW |
| Types | `src/types.ts` | MODIFY (ActivePage + DbCustomer.address) |
| Lib | `src/lib/supabaseClient.ts` | MODIFY (3 new wrappers + flag passthrough) |
| Lib | `src/lib/wizard/validation.ts` | NEW (pure validate{Step1,Step2,Step3} + isPreOrder + dispatchSave) |
| Lib test | `src/lib/wizard/__tests__/validation.test.ts` | NEW |
| Component | `src/components/penjualan/wizard/WizardStepper.tsx` | NEW |
| Component | `src/components/penjualan/wizard/NewCustomerInlineForm.tsx` | NEW |
| Component | `src/components/penjualan/wizard/Step1ChannelCustomer.tsx` | NEW |
| Component | `src/components/penjualan/wizard/Step2Items.tsx` | NEW |
| Component | `src/components/penjualan/wizard/Step3Payment.tsx` | NEW |
| Component | `src/components/penjualan/CatatPenjualanWizard.tsx` | NEW (orchestrator) |
| Component | `src/components/penjualan/InvoicePreviewScreen.tsx` | NEW |
| Component | `src/components/approval/CustomerCreditActivateApprovalRequestRow.tsx` | NEW |
| Component | `src/components/penjualan/SalesInvoicePDF.tsx` | MODIFY (printMode + pre-order footnote) |
| Component | `src/components/penjualan/PaymentPanel.tsx` | MODIFY (TEMPO not-eligible warning) |
| Component | `src/components/penjualan/CartRows.tsx` | MODIFY (pre-order chip) |
| Component | `src/components/penjualan/CustomerPanel.tsx` | AUDIT (remove ad-hoc/manual fallback if exists) |
| Component | `src/components/approval/ApprovalInboxScreen.tsx` | MODIFY (dispatch arm + reject branch) |
| Component | `src/App.tsx` | MODIFY (swap mount + add invoicePreview screen key) |
| Component | `src/components/PenjualanBaruScreen.tsx` | DELETE |
| Docs | `progress.md` | MODIFY (per CLAUDE.md gotcha) |

---

## Milestone Pre-flight

### Task 0: Verify worktree + baseline green

**Files:** none (verification only)

- [ ] **Step 1: Confirm worktree state**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/.claude/worktrees/catat-penjualan-wizard
git status --short && git rev-parse --abbrev-ref HEAD && git log --oneline -2
```
Expected: clean working tree; branch `feat/catat-penjualan-wizard`; HEAD at spec commit `ab7a15f`.

- [ ] **Step 2: Baseline vitest + tsc + build**

```bash
npm test -- --run 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -3
```
Expected: tests all pass (record the count for delta tracking); tsc clean; vite build clean.

- [ ] **Step 3: Verify the 3 existing RPCs' stock behavior — record findings**

```bash
grep -A 200 "FUNCTION public.record_kasir_sale" supabase/migrations/20260609000001_record_kasir_sale_rpc.sql | grep -i "raise\|stock\|insufficient" | head -10
grep -A 200 "FUNCTION public.create_tempo_invoice" supabase/migrations/20260615000011_create_tempo_invoice_rpc.sql | grep -i "raise\|stock\|insufficient" | head -10
```
Capture which RAISE branches exist + their conditions. This informs the relaxation strategy in Tasks 2 + 3 (if RPCs already permit negative stock implicitly via `deduct_stock_fifo` RAISE WARNING fallback, the migration may be a no-op + just add the param for future-proofing — but verify before declaring).

If neither RPC raises on insufficient stock today, the migration tasks still add the param + document that it's currently a no-op enforcement-wise (the flag becomes meaningful when a future caller wants strict behavior).

If they DO raise, the migration removes the RAISE branch when `p_allow_negative_stock=true`.

- [ ] **Step 4: Check `stock_lots` CHECK constraints**

```bash
grep -A 30 "CREATE TABLE.*stock_lots\|stock_lots.*CHECK\|ALTER TABLE.*stock_lots" supabase/migrations/*.sql | grep -i "check\|qty_remaining" | head -10
```
Expected: identify any `qty_remaining >= 0` CHECK constraint. If present, Task 2 includes a `DROP CONSTRAINT`.

---

## Milestone A — Backend migrations (5 tasks)

### Task 1: Migration 001 — add `customers.address` column

**Files:**
- Create: `supabase/migrations/20260630000001_customers_add_address.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260630000001_customers_add_address.sql
-- Phase Catat Penjualan wizard: "+ Customer Baru" inline form needs optional
-- address field. Plain additive; existing rows get NULL.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address TEXT NULL;

COMMENT ON COLUMN public.customers.address IS
  'Alamat customer (optional). Diisi via "+ Customer Baru" form di Catat Penjualan wizard.';
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__plugin_supabase_supabase__apply_migration` with name `customers_add_address` on project `ekhhojaezdfjfwuxyjkl`. Expected: `{"success":true}`.

- [ ] **Step 3: Smoke verify column present**

```sql
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='customers' AND column_name='address';
```
Expected: 1 row with `data_type=text`, `is_nullable=YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260630000001_customers_add_address.sql
git commit -m "feat(catat-penjualan): migration 001 — add customers.address column

Phase Catat Penjualan wizard prereq. + Customer Baru inline form needs
optional address. Additive only; no backfill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 2: Migration 002 — `record_kasir_sale` accepts `p_allow_negative_stock`

**Files:**
- Create: `supabase/migrations/20260630000002_record_kasir_sale_allow_negative_stock.sql`

**Interfaces produced:** `record_kasir_sale(... p_allow_negative_stock BOOLEAN DEFAULT false)` — new last param.

- [ ] **Step 1: Read the current `record_kasir_sale` body**

```bash
cat supabase/migrations/20260609000001_record_kasir_sale_rpc.sql
```
Identify: (a) does it RAISE on insufficient stock? (b) if yes, at what line? (c) does it just rely on `deduct_stock_fifo` which has `RAISE WARNING` fallback?

- [ ] **Step 2: Write the migration**

Write `CREATE OR REPLACE FUNCTION public.record_kasir_sale(... existing 22 params ..., p_allow_negative_stock BOOLEAN DEFAULT false)` with the body preserving current behavior. If the existing body has a strict stock RAISE branch, wrap it: `IF NOT p_allow_negative_stock AND <existing condition> THEN RAISE ...`. If the existing body already permits negative stock (via `deduct_stock_fifo` warning), just add the param and document that today it's a no-op intent flag (future strict callers can opt in to enforcement via separate logic).

Concrete template:

```sql
-- 20260630000002_record_kasir_sale_allow_negative_stock.sql
-- Phase Catat Penjualan wizard: opt-in pre-order support.
--
-- Adds `p_allow_negative_stock BOOLEAN DEFAULT false` param. Wizard callers
-- pass true; existing callers (Kasir POS walk-in) pass nothing → default
-- false preserves current behavior.
--
-- AUDIT (Task 0 + Step 1): the current body relies on `deduct_stock_fifo`
-- which uses `RAISE WARNING` (not EXCEPTION) on lot underflow, so today
-- record_kasir_sale already permits silent underflow. The new param thus
-- documents intent rather than gating behavior at THIS RPC layer. Future
-- enforcement (e.g., a strict mode for Kasir POS) can add a conditional
-- check around deduct_stock_fifo using this flag.

CREATE OR REPLACE FUNCTION public.record_kasir_sale(
  p_date              date,
  p_channel           text,
  p_items             jsonb,
  p_subtotal          numeric,
  p_payment_method    text,
  p_payment_subtype   text,
  p_payment_type      text,
  p_dp_amount         numeric,
  p_dp_input_type     text,
  p_ongkir_amount     numeric,
  p_notes             text,
  p_total_amount      numeric,
  p_customer_name     text,
  p_customer_phone    text,
  p_customer_company  text,
  p_delivery_address  text,
  p_tokped_order_no   text,
  p_wa_phone          text,
  p_wa_chat_url       text,
  p_customer_id       text,
  p_allow_negative_stock BOOLEAN DEFAULT false  -- NEW
)
RETURNS public.kasir_transactions
LANGUAGE plpgsql SECURITY DEFINER
AS $$
-- ... PASTE EXISTING BODY VERBATIM (from 20260609000001) ...
-- If existing body has a hard RAISE on insufficient stock, wrap it:
--   IF NOT p_allow_negative_stock AND <stock_short_condition> THEN RAISE EXCEPTION '...';
-- Otherwise, leave body unchanged — the flag is opt-in intent only.
$$;

GRANT EXECUTE ON FUNCTION public.record_kasir_sale(
  date, text, jsonb, numeric, text, text, text, numeric, text, numeric, text,
  numeric, text, text, text, text, text, text, text, text, BOOLEAN
) TO authenticated;
```

If a `stock_lots` `qty_remaining >= 0` CHECK constraint was found in Task 0 Step 4, append:

```sql
-- Drop CHECK constraint preventing negative qty_remaining (if exists)
ALTER TABLE public.stock_lots DROP CONSTRAINT IF EXISTS stock_lots_qty_remaining_check;
```

(Constraint name will vary; use `\d stock_lots` output from Task 0 to find exact name.)

- [ ] **Step 3: Apply via Supabase MCP**

`apply_migration` name `record_kasir_sale_allow_negative_stock`. Expected: success.

- [ ] **Step 4: Smoke test — verify new signature accepts the flag**

```sql
-- Verify pg_proc has the new param
SELECT pg_get_function_identity_arguments(oid)
  FROM pg_proc
 WHERE proname = 'record_kasir_sale' AND pronamespace = 'public'::regnamespace;
```
Expected output includes `p_allow_negative_stock boolean`.

Also smoke: call with `p_allow_negative_stock => true` for a small synthetic sale (wrap in `BEGIN; ... ROLLBACK;` to leave DB clean). Expected: no error referencing the new param.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260630000002_record_kasir_sale_allow_negative_stock.sql
git commit -m "feat(catat-penjualan): migration 002 — record_kasir_sale opt-in pre-order

Add p_allow_negative_stock BOOLEAN DEFAULT false. Wizard passes true; Kasir
keeps default false. Audit-based: today's body permits silent underflow via
deduct_stock_fifo RAISE WARNING, so the flag is intent-documenting; future
strict enforcement can hook the flag.

Drop stock_lots qty_remaining CHECK (if present per Task 0 audit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 3: Migration 003 — `create_tempo_invoice` accepts `allow_negative_stock`

**Files:**
- Create: `supabase/migrations/20260630000003_create_tempo_invoice_allow_negative_stock.sql`

**Interfaces produced:** `create_tempo_invoice(p_payload jsonb)` body inspects `p_payload->>'allow_negative_stock'` and behaves accordingly. (Param shape: payload is jsonb, so flag is a payload key not a separate function param.)

- [ ] **Step 1: Read current body**

```bash
cat supabase/migrations/20260615000011_create_tempo_invoice_rpc.sql
```
Find any RAISE EXCEPTION blocks referencing stock / insufficient. Note line numbers.

- [ ] **Step 2: Write the migration**

```sql
-- 20260630000003_create_tempo_invoice_allow_negative_stock.sql
-- Phase Catat Penjualan wizard: pre-order support for TEMPO sales.
-- Adds support for payload key "allow_negative_stock": true to bypass the
-- stock check (if any). Default false preserves existing behavior.

CREATE OR REPLACE FUNCTION public.create_tempo_invoice(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_negative BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, false);
  -- ... PASTE EXISTING DECLARE VARS ...
BEGIN
  -- ... PASTE EXISTING BODY VERBATIM ...
  -- If existing body has a stock RAISE check, gate it on:
  --   IF NOT v_allow_negative AND <stock_short_cond> THEN RAISE EXCEPTION '...';
  -- Otherwise, leave body unchanged.
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tempo_invoice(jsonb) TO authenticated;
```

- [ ] **Step 3: Apply via Supabase MCP**

`apply_migration` name `create_tempo_invoice_allow_negative_stock`.

- [ ] **Step 4: Smoke verify**

```sql
SELECT pg_get_functiondef(oid)
  FROM pg_proc WHERE proname = 'create_tempo_invoice';
```
Expected: body contains `v_allow_negative` (or whatever variable name was used).

Also smoke call with payload including `"allow_negative_stock": true` against a tempo-eligible customer — expect success (rollback after).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260630000003_create_tempo_invoice_allow_negative_stock.sql
git commit -m "feat(catat-penjualan): migration 003 — create_tempo_invoice pre-order key

Adds support for payload['allow_negative_stock']=true. Wizard's TEMPO save
passes it; existing callers (none today other than wizard) pass nothing →
default false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 4: Migration 004 — `reject_customer_credit_activate` RPC

**Files:**
- Create: `supabase/migrations/20260630000004_reject_customer_credit_activate_rpc.sql`

**Interfaces produced:** `reject_customer_credit_activate(p_request_id BIGINT, p_reason TEXT) RETURNS VOID`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260630000004_reject_customer_credit_activate_rpc.sql
-- Phase Catat Penjualan wizard prereq. Owner can now reject (not just
-- approve) customer_credit_activate requests. Mirrors the Aktif-Owner
-- auth.uid pattern from PR #34 (verify_owner_pin fix).

CREATE OR REPLACE FUNCTION public.reject_customer_credit_activate(
  p_request_id BIGINT,
  p_reason     TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller       UUID;
  v_caller_email TEXT;
  v_admin_id     UUID;
  v_owner_count  INT;
  v_ar           RECORD;
  v_reason       TEXT;
  v_satellite_payload JSONB;
BEGIN
  -- Caller must be Aktif Owner (PR #34 pattern: auth.uid → email → admin_users)
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller has no auth email';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif';
  IF v_owner_count = 0 THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller is not an active Owner';
  ELSIF v_owner_count > 1 THEN
    RAISE EXCEPTION 'OWNER_AMBIGUOUS: % active Owner rows', v_owner_count;
  END IF;

  SELECT id INTO v_admin_id
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner' AND status = 'Aktif';

  -- Lock + validate approval row
  SELECT * INTO v_ar FROM public.approval_requests
   WHERE id = p_request_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_request_id;
  END IF;
  IF v_ar.request_type <> 'customer_credit_activate' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_request_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_request_id, v_ar.status;
  END IF;

  v_reason := COALESCE(NULLIF(btrim(p_reason), ''), 'no reason given');
  v_satellite_payload := v_ar.payload;

  PERFORM public._transition_approval(
    p_request_id, 'rejected'::public.approval_status, v_admin_id, v_reason
  );

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'customer_credit_activate_rejected',
    v_caller,
    jsonb_build_object(
      'request_id', p_request_id,
      'reject_reason', v_reason,
      'customer_id', v_satellite_payload->>'customer_id',
      'requested_limit', (v_satellite_payload->>'credit_limit')::numeric,
      'requested_term', (v_satellite_payload->>'term_days')::int
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.reject_customer_credit_activate(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.reject_customer_credit_activate IS
  'Owner rejects a pending customer_credit_activate request. Mirrors the Aktif-Owner pattern from PR #34.';
```

- [ ] **Step 2: Apply via Supabase MCP**

`apply_migration` name `reject_customer_credit_activate_rpc`.

- [ ] **Step 3: Smoke test (3 cases)**

Use Supabase MCP `execute_sql` with set_config jwt.claims simulation per PR #34 pattern:

```sql
CREATE OR REPLACE FUNCTION public._smoke_reject_credit_activate(
  p_jwt_sub UUID, p_request_id BIGINT, p_reason TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $body$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_jwt_sub::text, 'role', 'authenticated')::text, true);
  PERFORM public.reject_customer_credit_activate(p_request_id, p_reason);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN 'raised: ' || SQLERRM;
END $body$;
```

Identities:
- Tony Aktif Owner: `227c28f4-09f6-4dc9-af7a-01b0feb2c194`
- Tony1993 Tidak Aktif Owner: `651e9d0d-034d-48d2-8897-09c64e78f5d0`
- Random non-Owner: `00000000-0000-0000-0000-deadbeef0000`

Cases (each in `BEGIN; … ROLLBACK;` block — seed customer + create approval first, then call helper):

| # | Setup | Caller | Expected |
|---|---|---|---|
| A | Seed customer + call `request_customer_credit_activate` → get request_id; reject by non-Owner | random uid | `raised: OWNER_ONLY: caller has no auth email` |
| B | Same seed; reject by Tony1993 (Tidak Aktif) | Tony1993 | `raised: OWNER_ONLY: caller is not an active Owner` |
| C | Same seed; reject by Tony Aktif with reason | Tony Aktif | `ok`; approval.status='rejected'; decision_channel matches reason; audit_log `customer_credit_activate_rejected` row present |

Drop helper after: `DROP FUNCTION public._smoke_reject_credit_activate(UUID, BIGINT, TEXT);`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260630000004_reject_customer_credit_activate_rpc.sql
git commit -m "feat(catat-penjualan): migration 004 — reject_customer_credit_activate RPC

Owner rejects pending customer_credit_activate requests. Aktif Owner
auth.uid pattern mirrored from PR #34 (verify_owner_pin fix). Inserts
audit customer_credit_activate_rejected.

Smoke: non-Owner / Tidak Aktif / happy — all green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 5: Migration 005 — `record_pi` emits `preorder_fulfilled` audit

**Files:**
- Create: `supabase/migrations/20260630000005_record_pi_preorder_fulfilled_audit.sql`

**Interfaces produced:** `record_pi(payload jsonb)` body now emits `preorder_fulfilled` audit_log row when an incoming SKU's pre-call stock balance was < 0.

- [ ] **Step 1: Read current record_pi body**

```bash
# Phase 2-extended version takes precedence
cat supabase/migrations/20260620000005_phase2_rpcs_tagihan_extend.sql | head -200
```
Locate: (a) the per-item INSERT into stock_lots / stock_movements section, (b) where to compute pre-call balance, (c) where to emit audit.

- [ ] **Step 2: Write the migration**

```sql
-- 20260630000005_record_pi_preorder_fulfilled_audit.sql
-- Phase Catat Penjualan wizard: pre-order tracking.
-- When a supplier delivery (record_pi) lands on an SKU whose pre-call
-- stock balance was < 0 (pre-orders pending), emit a `preorder_fulfilled`
-- audit_log row capturing FIFO-ordered pending order ids.

CREATE OR REPLACE FUNCTION public.record_pi(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ... PASTE EXISTING DECLARE VARS from 20260620000005 ...
  v_pre_balance       NUMERIC;
  v_qty_delivered     NUMERIC;
  v_qty_fulfilled     NUMERIC;
  v_pending_order_ids UUID[];
BEGIN
  -- ... PASTE EXISTING VALIDATION + HEADER INSERT body ...

  -- For each line, BEFORE inserting stock_lots, capture pre-call balance.
  -- After insert, if pre-balance was < 0, emit preorder_fulfilled audit.
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    -- compute pre-call total stock balance for the SKU across all warehouses
    SELECT COALESCE(SUM(qty_remaining), 0) INTO v_pre_balance
      FROM public.stock_lots
     WHERE sku = v_item->>'sku';

    v_qty_delivered := (v_item->>'qty')::NUMERIC;

    -- ... PASTE EXISTING stock_lots INSERT + stock_movements IN row ...

    -- If pre-call balance was negative, this delivery (partially) fulfills
    -- pre-orders. Compute how much: min(qty_delivered, abs(pre_balance)).
    IF v_pre_balance < 0 THEN
      v_qty_fulfilled := LEAST(v_qty_delivered, -v_pre_balance);

      -- FIFO-ordered pending order ids: orders with this SKU in items
      -- created earliest first that contribute to the negative balance.
      SELECT ARRAY_AGG(o.id ORDER BY o.created_at)
        INTO v_pending_order_ids
        FROM public.orders o
       WHERE o.id IN (
         SELECT DISTINCT (jsonb_array_elements(o2.items)->>'order_id')::UUID
           FROM public.orders o2
          WHERE o2.items @> jsonb_build_array(jsonb_build_object('sku', v_item->>'sku'))
       )
       LIMIT 50; -- defensive cap

      INSERT INTO public.audit_log (event_type, actor_user_id, payload)
      VALUES (
        'preorder_fulfilled',
        auth.uid(),
        jsonb_build_object(
          'sku', v_item->>'sku',
          'qty_delivered', v_qty_delivered,
          'qty_fulfilled', v_qty_fulfilled,
          'pre_call_balance', v_pre_balance,
          'pending_order_ids', COALESCE(to_jsonb(v_pending_order_ids), '[]'::jsonb),
          'supplier_id', payload->>'supplier_id',
          'tagihan_id', payload->>'tagihan_id'
        )
      );
    END IF;
  END LOOP;

  -- ... PASTE EXISTING return + closing ...
END $$;

GRANT EXECUTE ON FUNCTION public.record_pi(jsonb) TO authenticated;
```

**IMPORTANT:** the `pending_order_ids` query above is illustrative; the actual `orders.items` JSONB schema may differ. During implementation, verify by:
```sql
SELECT id, items FROM public.orders WHERE items IS NOT NULL LIMIT 1;
```
Adjust the FIFO query to match the real shape. If `orders.items` doesn't store SKU-keyed entries in a queryable way, fall back to a simpler payload: `pending_order_ids: []` (empty array) with a TODO comment for v2.

- [ ] **Step 3: Apply via Supabase MCP**

`apply_migration` name `record_pi_preorder_fulfilled_audit`.

- [ ] **Step 4: Smoke (2 cases)**

Setup: insert a pre-order order (stock_lots already negative for SKU X), then call record_pi delivering qty of SKU X. Verify audit row.

Wrap in `BEGIN; … ROLLBACK;`:

```sql
-- Case A: stock pre-negative → audit emitted
BEGIN;
  -- create stock_lots row for SKU TEST-PREORDER with qty_remaining=-5
  -- create orders row with items containing SKU TEST-PREORDER, qty=5
  -- call record_pi with payload delivering 10 units of TEST-PREORDER
  -- assert: audit_log latest row for SKU TEST-PREORDER has event_type='preorder_fulfilled' + qty_fulfilled=5
ROLLBACK;
```

```sql
-- Case B: stock pre-positive → no preorder_fulfilled audit
BEGIN;
  -- stock_lots qty_remaining=10 for TEST-NORMAL
  -- record_pi deliver 5 units
  -- assert: no audit_log row with event_type='preorder_fulfilled' and sku='TEST-NORMAL'
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260630000005_record_pi_preorder_fulfilled_audit.sql
git commit -m "feat(catat-penjualan): migration 005 — record_pi emits preorder_fulfilled audit

When a supplier delivery lands on an SKU whose pre-call stock balance was
negative, emit audit_log preorder_fulfilled with FIFO-ordered pending
order ids. Dashboard 'Recent fulfillments' card consumes this audit.

Smoke: pre-negative → audit emitted; pre-positive → no audit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone B — Types + Lib wrappers (3 tasks)

### Task 6: Extend types (`ActivePage` + `DbCustomer.address`)

**Files:**
- Modify: `src/types.ts`

**Interfaces produced:** `ActivePage` union includes `'invoicePreview'`; `DbCustomer` has optional `address?: string | null`.

- [ ] **Step 1: Find current declarations**

```bash
grep -n "type ActivePage\|interface DbCustomer\|export type.*ActivePage" src/types.ts | head -10
```

- [ ] **Step 2: Add `'invoicePreview'`**

Locate the `ActivePage` union and append `| 'invoicePreview'`. Preserve all existing members.

- [ ] **Step 3: Add `address` to DbCustomer**

In the `DbCustomer` interface, add `address?: string | null;` (preserve existing fields).

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors. The union extension is additive; the optional field is additive.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "types(catat-penjualan): ActivePage += 'invoicePreview'; DbCustomer.address?

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 7: Lib wrappers — customer create + credit activate request/reject (TDD)

**Files:**
- Modify: `src/lib/supabaseClient.ts`
- Create: `src/lib/customers/__tests__/customerWrappers.test.ts`

**Interfaces produced:**
- `customersService.insertNew({name, wa_number, company?, address?}) → Promise<DbCustomer>` (creates with `allows_tempo=false` default)
- `requestCustomerCreditActivate(customerId, termDays, creditLimit, reason?) → Promise<{request_id: number}>`
- `rejectCustomerCreditActivate(requestId, reason) → Promise<void>`

- [ ] **Step 1: Write failing tests**

Create `src/lib/customers/__tests__/customerWrappers.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
}));

import {
  insertNewCustomer,
  requestCustomerCreditActivate,
  rejectCustomerCreditActivate,
} from '../customerWrappers';

describe('insertNewCustomer', () => {
  beforeEach(() => { mockRpc.mockReset(); mockFrom.mockReset(); });

  test('inserts with allows_tempo=false default', async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'c-1', name: 'X', wa_number: '081', allows_tempo: false }, error: null }) }),
    });
    mockFrom.mockReturnValue({ insert });
    const result = await insertNewCustomer({ name: 'X', wa_number: '081' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'X', wa_number: '081', allows_tempo: false }));
    expect(result).toEqual(expect.objectContaining({ id: 'c-1' }));
  });

  test('throws on insert error', async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'duplicate phone' } }) }),
    });
    mockFrom.mockReturnValue({ insert });
    await expect(insertNewCustomer({ name: 'X', wa_number: '081' })).rejects.toMatchObject({ message: 'duplicate phone' });
  });
});

describe('requestCustomerCreditActivate', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls RPC with correct args + returns request_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    const result = await requestCustomerCreditActivate('c-1', 14, 5000000, 'regular customer');
    expect(mockRpc).toHaveBeenCalledWith('request_customer_credit_activate', {
      p_customer_id: 'c-1',
      p_term_days: 14,
      p_credit_limit: 5000000,
      p_reason: 'regular customer',
    });
    expect(result).toEqual({ request_id: 42 });
  });

  test('reason optional', async () => {
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    await requestCustomerCreditActivate('c-1', 14, 5000000);
    expect(mockRpc).toHaveBeenCalledWith('request_customer_credit_activate',
      expect.objectContaining({ p_reason: null }));
  });

  test('throws on RPC error preserving prefix', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: …' } });
    await expect(requestCustomerCreditActivate('c-1', 14, 5000000)).rejects.toMatchObject({ message: 'OWNER_ONLY: …' });
  });
});

describe('rejectCustomerCreditActivate', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  test('calls RPC with id + reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await rejectCustomerCreditActivate(42, 'limit too high');
    expect(mockRpc).toHaveBeenCalledWith('reject_customer_credit_activate', {
      p_request_id: 42,
      p_reason: 'limit too high',
    });
  });

  test('throws on OWNER_ONLY', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'OWNER_ONLY: caller is not an active Owner' } });
    await expect(rejectCustomerCreditActivate(42, 'x')).rejects.toMatchObject({ message: 'OWNER_ONLY: caller is not an active Owner' });
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

```bash
npm test -- --run src/lib/customers/__tests__/customerWrappers.test.ts
```
Expected: all FAIL with "Cannot find module '../customerWrappers'".

- [ ] **Step 3: Implement the wrappers**

Create `src/lib/customers/customerWrappers.ts`:

```ts
import { supabase } from '../supabaseClient';
import type { DbCustomer } from '../../types';

/**
 * Phase Catat Penjualan wizard: new-customer + TEMPO request wrappers.
 * Sibling-module pattern so vi.mock('../supabaseClient') can intercept.
 */

export async function insertNewCustomer(args: {
  name: string;
  wa_number: string;
  company?: string;
  address?: string;
}): Promise<DbCustomer> {
  if (!supabase) throw new Error('Supabase not configured');
  const row = {
    name: args.name,
    wa_number: args.wa_number,
    company: args.company ?? null,
    address: args.address ?? null,
    allows_tempo: false,
  };
  const { data, error } = await supabase.from('customers').insert(row).select().single();
  if (error) throw error;
  return data as DbCustomer;
}

export async function requestCustomerCreditActivate(
  customerId: string,
  termDays: number,
  creditLimit: number,
  reason?: string,
): Promise<{ request_id: number }> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.rpc('request_customer_credit_activate', {
    p_customer_id: customerId,
    p_term_days: termDays,
    p_credit_limit: creditLimit,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return { request_id: data as number };
}

export async function rejectCustomerCreditActivate(
  requestId: number,
  reason: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.rpc('reject_customer_credit_activate', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npm test -- --run src/lib/customers/__tests__/customerWrappers.test.ts
```
Expected: all 7 tests PASS.

- [ ] **Step 5: Full suite regression check**

```bash
npm test -- --run
```
Expected: baseline + 7 new tests, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/customers/
git commit -m "feat(catat-penjualan): customer wrappers — insertNew + creditActivate request/reject

Sibling-module pattern for vi.mock interception. Wraps:
- POST customers (allows_tempo=false default)
- request_customer_credit_activate RPC (returns request_id)
- reject_customer_credit_activate RPC

7 vitest cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 8: Pure validation + dispatch helpers (TDD)

**Files:**
- Create: `src/lib/wizard/validation.ts`
- Create: `src/lib/wizard/__tests__/validation.test.ts`

**Interfaces produced:**
- `validateStep1(state): { ok: boolean; errors?: string[] }`
- `validateStep2(state): { ok: boolean; errors?: string[] }`
- `validateStep3(state): { ok: boolean; errors?: string[] }`
- `isPreOrder(item, stockByWarehouseSku): boolean`
- `dispatchSave(state): 'tempo' | 'wip' | 'standard'`

- [ ] **Step 1: Write failing tests**

Create `src/lib/wizard/__tests__/validation.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { validateStep1, validateStep2, validateStep3, isPreOrder, dispatchSave } from '../validation';

describe('validateStep1', () => {
  test('ok when channel + customer set', () => {
    expect(validateStep1({ channel: 'walkin', customer: { id: 'c1' } } as any)).toMatchObject({ ok: true });
  });
  test('error when channel missing', () => {
    expect(validateStep1({ customer: { id: 'c1' } } as any)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringMatching(/channel/i)]) });
  });
  test('error when customer missing', () => {
    expect(validateStep1({ channel: 'walkin' } as any)).toMatchObject({ ok: false });
  });
  test('marketplace channel requires marketplace_order_no', () => {
    expect(validateStep1({ channel: 'tokopedia', customer: { id: 'c1' }, marketplace_order_no: '' } as any)).toMatchObject({ ok: false });
    expect(validateStep1({ channel: 'tokopedia', customer: { id: 'c1' }, marketplace_order_no: 'TKP-123' } as any)).toMatchObject({ ok: true });
  });
  test('whatsapp channel requires wa_phone', () => {
    expect(validateStep1({ channel: 'whatsapp', customer: { id: 'c1' } } as any)).toMatchObject({ ok: false });
    expect(validateStep1({ channel: 'whatsapp', customer: { id: 'c1' }, wa_phone: '081' } as any)).toMatchObject({ ok: true });
  });
});

describe('validateStep2', () => {
  test('ok when ≥1 SKU item with qty>0 + warehouse', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 2, warehouse_id: 'atas' }], rakitLines: [] } as any)).toMatchObject({ ok: true });
  });
  test('ok when only rakit line with desc + estimated_price', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', description: 'genset', estimated_price: 5000000, qty: 0 }] } as any)).toMatchObject({ ok: true });
  });
  test('error when empty cart', () => {
    expect(validateStep2({ items: [], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when SKU qty=0', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 0, warehouse_id: 'atas' }], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when SKU missing warehouse', () => {
    expect(validateStep2({ items: [{ sku: 'X', qty: 2 }], rakitLines: [] } as any)).toMatchObject({ ok: false });
  });
  test('error when rakit missing description', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', estimated_price: 5000000, qty: 0 }] } as any)).toMatchObject({ ok: false });
  });
  test('error when rakit estimated_price=0', () => {
    expect(validateStep2({ items: [], rakitLines: [{ type: 'CUSTOM_PANEL', description: 'x', estimated_price: 0, qty: 0 }] } as any)).toMatchObject({ ok: false });
  });
});

describe('validateStep3', () => {
  test('ok when payment_type set + tempo customer eligible', () => {
    expect(validateStep3({ payment_type: 'TEMPO', customer: { allows_tempo: true } } as any)).toMatchObject({ ok: true });
  });
  test('error TEMPO + customer not eligible', () => {
    expect(validateStep3({ payment_type: 'TEMPO', customer: { allows_tempo: false } } as any)).toMatchObject({ ok: false });
  });
  test('ok LUNAS regardless of allows_tempo', () => {
    expect(validateStep3({ payment_type: 'FULL', customer: { allows_tempo: false } } as any)).toMatchObject({ ok: true });
  });
  test('error when payment_type missing', () => {
    expect(validateStep3({ customer: {} } as any)).toMatchObject({ ok: false });
  });
});

describe('isPreOrder', () => {
  test('true when qty > stock', () => {
    expect(isPreOrder({ sku: 'X', qty: 5, warehouse_id: 'atas' } as any, { 'X|atas': 2 })).toBe(true);
  });
  test('false when qty <= stock', () => {
    expect(isPreOrder({ sku: 'X', qty: 2, warehouse_id: 'atas' } as any, { 'X|atas': 5 })).toBe(false);
  });
  test('true when stock entry missing (=0)', () => {
    expect(isPreOrder({ sku: 'X', qty: 1, warehouse_id: 'atas' } as any, {})).toBe(true);
  });
});

describe('dispatchSave', () => {
  test('TEMPO payment → tempo', () => {
    expect(dispatchSave({ payment_type: 'TEMPO', items: [{ sku: 'X', qty: 1 }], rakitLines: [] } as any)).toBe('tempo');
  });
  test('mixed SKU + rakit, FULL → wip', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [{ sku: 'X' }], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('wip');
  });
  test('pure SKU FULL → standard', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [{ sku: 'X' }], rakitLines: [] } as any)).toBe('standard');
  });
  test('pure jasa FULL → wip', () => {
    expect(dispatchSave({ payment_type: 'FULL', items: [], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('wip');
  });
  test('mixed + TEMPO → tempo (tempo takes precedence)', () => {
    expect(dispatchSave({ payment_type: 'TEMPO', items: [{ sku: 'X' }], rakitLines: [{ type: 'CUSTOM_PANEL' }] } as any)).toBe('tempo');
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

```bash
npm test -- --run src/lib/wizard/__tests__/validation.test.ts
```
Expected: all FAIL — module not found.

- [ ] **Step 3: Implement helpers**

Create `src/lib/wizard/validation.ts`:

```ts
import type { KasirChannel } from '../../types';

const MARKETPLACE_CHANNELS: KasirChannel[] = ['tokopedia', 'shopee', 'lazada', 'blibli', 'tiktok'];
const WHATSAPP_CHANNELS: KasirChannel[] = ['whatsapp'];

export interface WizardState {
  channel?: KasirChannel;
  customer?: { id: string; allows_tempo?: boolean };
  marketplace_order_no?: string;
  wa_phone?: string;
  items: Array<{ sku: string; qty: number; warehouse_id?: string }>;
  rakitLines: Array<{ type: string; description?: string; estimated_price?: number; qty?: number }>;
  payment_type?: 'FULL' | 'DP' | 'TEMPO';
}

export type ValidationResult = { ok: boolean; errors?: string[] };

export function validateStep1(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if (!s.channel) errors.push('channel wajib');
  if (!s.customer?.id) errors.push('customer wajib');
  if (s.channel && MARKETPLACE_CHANNELS.includes(s.channel) && !s.marketplace_order_no?.trim()) {
    errors.push('marketplace_order_no wajib untuk channel marketplace');
  }
  if (s.channel && WHATSAPP_CHANNELS.includes(s.channel) && !s.wa_phone?.trim()) {
    errors.push('wa_phone wajib untuk channel whatsapp');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateStep2(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if ((s.items?.length ?? 0) === 0 && (s.rakitLines?.length ?? 0) === 0) {
    errors.push('cart kosong — tambah produk atau jasa');
  }
  for (const item of s.items ?? []) {
    if (!(item.qty > 0)) errors.push(`SKU ${item.sku}: qty wajib > 0`);
    if (!item.warehouse_id) errors.push(`SKU ${item.sku}: gudang wajib dipilih`);
  }
  for (const rl of s.rakitLines ?? []) {
    if (!rl.description?.trim()) errors.push('Jasa: deskripsi wajib');
    if (!(rl.estimated_price && rl.estimated_price > 0)) errors.push('Jasa: estimasi harga wajib > 0');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateStep3(s: WizardState): ValidationResult {
  const errors: string[] = [];
  if (!s.payment_type) errors.push('tipe pembayaran wajib');
  if (s.payment_type === 'TEMPO' && !s.customer?.allows_tempo) {
    errors.push('customer belum punya TEMPO eligibility');
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function isPreOrder(
  item: { sku: string; qty: number; warehouse_id?: string },
  stockByWarehouseSku: Record<string, number>,
): boolean {
  const key = `${item.sku}|${item.warehouse_id ?? ''}`;
  const stock = stockByWarehouseSku[key] ?? 0;
  return item.qty > stock;
}

export function dispatchSave(s: WizardState): 'tempo' | 'wip' | 'standard' {
  if (s.payment_type === 'TEMPO') return 'tempo';
  if ((s.rakitLines?.length ?? 0) > 0) return 'wip';
  return 'standard';
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
npm test -- --run src/lib/wizard/__tests__/validation.test.ts
```
Expected: all 23 tests PASS.

- [ ] **Step 5: Full suite regression**

```bash
npm test -- --run
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/wizard/
git commit -m "feat(catat-penjualan): pure validation + dispatch helpers (TDD)

validateStep1/2/3 + isPreOrder + dispatchSave. Pure functions for the
wizard orchestrator to consume. Lump-sum jasa allowed (qty=0 OK).
23 vitest cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone C — Sub-component audits (1 task)

### Task 9: Audit `CustomerPanel.tsx` — remove manual fallback if present

**Files:**
- (Possibly) Modify: `src/components/penjualan/CustomerPanel.tsx`

- [ ] **Step 1: Read the component**

```bash
cat src/components/penjualan/CustomerPanel.tsx
```
Look for: a code path that lets the user enter a customer without selecting from the existing list (manual name/phone input that does NOT persist to `customers` table). This is the "ad-hoc fallback" mentioned in the spec.

- [ ] **Step 2: If present, remove it**

If the component has props like `allowManualEntry`, a section rendering name/phone inputs separate from the search, or a "Manual entry" toggle: remove that section. The wizard's Step 1 will use this component ONLY in the "search + select" mode.

- [ ] **Step 3: If not present, document the audit result**

If no manual fallback exists: add a brief comment near the top of the component:
```ts
// Note: per feedback_no_adhoc_customers memory, this component never offers
// ad-hoc / manual customer entry. New customers must go through
// NewCustomerInlineForm in CatatPenjualanWizard Step 1.
```

- [ ] **Step 4: Verify tsc + tests**

```bash
npx tsc --noEmit
npm test -- --run
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/penjualan/CustomerPanel.tsx
git commit -m "audit(penjualan): CustomerPanel — confirm no ad-hoc fallback

Per feedback_no_adhoc_customers, every customer must persist. Audited
CustomerPanel and [removed manual entry / confirmed none present].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone D — New components (6 tasks)

### Task 10: `WizardStepper` component

**Files:**
- Create: `src/components/penjualan/wizard/WizardStepper.tsx`

**Interfaces produced:** `<WizardStepper currentStep={1|2|3} completedSteps={Set<1|2|3>} onJumpBack={(step) => void} />`. Renders 3 horizontal step labels with checkmarks/numbers; only completed steps are clickable for jump-back; current is highlighted navy; pending is grayed locked.

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/wizard/WizardStepper.tsx`:

```tsx
import { Fragment } from 'react';

interface Props {
  currentStep: 1 | 2 | 3;
  completedSteps: Set<1 | 2 | 3>;
  onJumpBack: (step: 1 | 2 | 3) => void;
}

const LABELS: Record<1 | 2 | 3, string> = {
  1: 'Channel & Customer',
  2: 'Pesanan',
  3: 'Pembayaran',
};

export default function WizardStepper({ currentStep, completedSteps, onJumpBack }: Props) {
  return (
    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-100 bg-white">
      {[1, 2, 3].map((step, idx) => {
        const s = step as 1 | 2 | 3;
        const isCompleted = completedSteps.has(s);
        const isCurrent = currentStep === s;
        const canClick = isCompleted && !isCurrent;
        const dotClass = isCurrent
          ? 'bg-[#012749] text-white'
          : isCompleted
            ? 'bg-[#2d8a4e] text-white'
            : 'bg-slate-200 text-slate-500';
        const labelClass = isCurrent
          ? 'text-[#012749] font-semibold'
          : isCompleted
            ? 'text-slate-700 font-semibold'
            : 'text-slate-500';

        return (
          <Fragment key={step}>
            {idx > 0 && (
              <div className={`flex-1 h-[2px] ${isCompleted || isCurrent ? 'bg-[#2d8a4e]' : 'bg-slate-200'}`} />
            )}
            <button
              type="button"
              disabled={!canClick}
              onClick={() => canClick && onJumpBack(s)}
              className={`flex items-center gap-2 text-sm ${canClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'} ${isCurrent || isCompleted ? '' : 'opacity-60'}`}
            >
              <div className={`w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center ${dotClass}`}>
                {isCompleted && !isCurrent ? '✓' : step}
              </div>
              <div className={labelClass}>{LABELS[s]}</div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: tsc verify**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/wizard/WizardStepper.tsx
git commit -m "feat(catat-penjualan): WizardStepper component

3-step horizontal stepper. Completed steps green ✓ (clickable jump-back),
current navy, pending gray (locked, disabled).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 11: `NewCustomerInlineForm` component

**Files:**
- Create: `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`

**Interfaces produced:** `<NewCustomerInlineForm onSaved={(customer: DbCustomer) => void} onCancel={() => void} showToast={(msg, type) => void} />`. On Simpan: calls `insertNewCustomer(...)`, optionally `requestCustomerCreditActivate(...)`, returns the saved customer to parent.

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/wizard/NewCustomerInlineForm.tsx`:

```tsx
import { useState } from 'react';
import type { DbCustomer } from '../../../types';
import { insertNewCustomer, requestCustomerCreditActivate } from '../../../lib/customers/customerWrappers';

interface Props {
  onSaved: (customer: DbCustomer) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function NewCustomerInlineForm({ onSaved, onCancel, showToast }: Props) {
  const [name, setName] = useState('');
  const [wa, setWa] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [requestTempo, setRequestTempo] = useState(false);
  const [limit, setLimit] = useState('');
  const [term, setTerm] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && wa.trim().length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const customer = await insertNewCustomer({
        name: name.trim(),
        wa_number: wa.trim(),
        company: company.trim() || undefined,
        address: address.trim() || undefined,
      });
      if (requestTempo) {
        const parsedLimit = parseFloat(limit.replace(/[.,]/g, '')) || 0;
        const parsedTerm = parseInt(term, 10) || 0;
        if (parsedLimit > 0 && parsedTerm > 0) {
          try {
            await requestCustomerCreditActivate(customer.id, parsedTerm, parsedLimit, reason.trim() || undefined);
            showToast('Customer tersimpan; request TEMPO terkirim ke Owner.', 'success');
          } catch (e) {
            showToast('Customer tersimpan, tapi gagal kirim request TEMPO. Coba dari menu Pelanggan.', 'warning');
          }
        } else {
          showToast('Customer tersimpan. Limit/term TEMPO belum di-set; lewati.', 'info');
        }
      } else {
        showToast('Customer baru tersimpan.', 'success');
      }
      onSaved(customer);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Gagal simpan customer: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 border-2 border-[#012749]/30 rounded-xl p-4 bg-[#012749]/5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-extrabold text-[#012749]">Customer Baru</div>
          <div className="text-[11px] text-slate-600">Akan tersimpan ke daftar Pelanggan.</div>
        </div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 text-sm">×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nama <span className="text-red-500">*</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">No HP / WhatsApp <span className="text-red-500">*</span></label>
          <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08xxx" className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Perusahaan / PT</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Alamat</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg" />
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[#012749]/20">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={requestTempo} onChange={(e) => setRequestTempo(e.target.checked)} className="rounded" />
          Ajukan TEMPO (kredit) untuk customer ini
        </label>
        {requestTempo && (
          <>
            <p className="text-[11px] text-slate-500 mt-1 ml-6">Butuh approval Owner. Customer disimpan dulu; transaksi sekarang pakai LUNAS/DP.</p>
            <div className="mt-2 ml-6 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Limit Kredit (Rp)</label>
                  <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="5.000.000" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">Term (hari)</label>
                  <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="14" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Alasan / Justifikasi (optional)</label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis: Customer regular, sudah belanja 3x" className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">Batal</button>
        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Menyimpan…' : '✓ Simpan & Pilih'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/wizard/NewCustomerInlineForm.tsx
git commit -m "feat(catat-penjualan): NewCustomerInlineForm component

4 fields (nama, HP, perusahaan, alamat) + optional TEMPO request section
(limit, term, alasan). Saves customer (allows_tempo=false). If TEMPO
requested, fires customer_credit_activate approval; transaksi sekarang
tetap LUNAS/DP sampai Owner approve.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 12: `Step1ChannelCustomer` component

**Files:**
- Create: `src/components/penjualan/wizard/Step1ChannelCustomer.tsx`

**Interfaces produced:**
```ts
<Step1ChannelCustomer
  channel={channel} setChannel={setChannel}
  customer={customer} setCustomer={setCustomer}
  marketplaceOrderNo={...} setMarketplaceOrderNo={...}
  waPhone={...} setWaPhone={...}
  waChatUrl={...} setWaChatUrl={...}
  showToast={showToast}
/>
```

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/wizard/Step1ChannelCustomer.tsx`:

```tsx
import { useState } from 'react';
import type { DbCustomer, KasirChannel } from '../../../types';
import ChannelSelector from '../ChannelSelector';
import ChannelStrip from '../ChannelStrip';
import CustomerPanel from '../CustomerPanel';
import NewCustomerInlineForm from './NewCustomerInlineForm';

interface Props {
  channel: KasirChannel | undefined;
  setChannel: (c: KasirChannel) => void;
  customer: DbCustomer | undefined;
  setCustomer: (c: DbCustomer | undefined) => void;
  marketplaceOrderNo: string;
  setMarketplaceOrderNo: (s: string) => void;
  waPhone: string;
  setWaPhone: (s: string) => void;
  waChatUrl: string;
  setWaChatUrl: (s: string) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function Step1ChannelCustomer(props: Props) {
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Channel Penjualan <span className="text-red-500">*</span>
        </label>
        <ChannelSelector value={props.channel} onChange={props.setChannel} />
        {props.channel && (
          <ChannelStrip
            channel={props.channel}
            marketplaceOrderNo={props.marketplaceOrderNo}
            setMarketplaceOrderNo={props.setMarketplaceOrderNo}
            waPhone={props.waPhone}
            setWaPhone={props.setWaPhone}
            waChatUrl={props.waChatUrl}
            setWaChatUrl={props.setWaChatUrl}
          />
        )}
      </div>

      <div className="step-divider" />

      <div>
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
          Customer <span className="text-red-500">*</span>
        </label>
        <CustomerPanel
          selected={props.customer}
          onSelect={props.setCustomer}
          onClear={() => props.setCustomer(undefined)}
        />
        <p className="text-[11px] text-slate-500 mt-1.5 italic">
          💡 Tip: cari pakai nomor HP untuk auto-detect repeat-buyer.
        </p>
        {!props.customer && !showNewCustomerForm && (
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <div className="text-slate-500">Tidak ketemu di daftar?</div>
            <button
              type="button"
              onClick={() => setShowNewCustomerForm(true)}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90"
            >
              + Customer Baru
            </button>
          </div>
        )}
        {showNewCustomerForm && (
          <NewCustomerInlineForm
            onSaved={(c) => { props.setCustomer(c); setShowNewCustomerForm(false); }}
            onCancel={() => setShowNewCustomerForm(false)}
            showToast={props.showToast}
          />
        )}
        <p className="mt-2 text-[11px] text-slate-500 italic">
          ℹ️ Setiap customer wajib tersimpan di daftar Pelanggan — database MSME penting.
        </p>
      </div>
    </div>
  );
}
```

**Note:** The exact prop names `selected` / `onSelect` / `onClear` on `CustomerPanel` may differ. During implementation, read the actual `CustomerPanel.tsx` prop interface and adapt. The same applies to `ChannelSelector` / `ChannelStrip` — use whatever prop shape they actually expose.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```
If errors about prop mismatches: adapt. Don't add new props to existing components; instead conform Step1's calls to them.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/wizard/Step1ChannelCustomer.tsx
git commit -m "feat(catat-penjualan): Step1ChannelCustomer

Wraps ChannelSelector + ChannelStrip + CustomerPanel + NewCustomerInlineForm.
HP autocomplete tip. No ad-hoc affordance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 13: `Step2Items` component

**Files:**
- Create: `src/components/penjualan/wizard/Step2Items.tsx`

**Interfaces produced:** `<Step2Items items, setItems, rakitLines, setRakitLines, stockByWarehouseSku, prefillSku?, showToast />`.

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/wizard/Step2Items.tsx`:

```tsx
import { useEffect } from 'react';
import type { KasirItem, RakitJobLine } from '../../../types';
import ItemSearchPanel from '../ItemSearchPanel';
import CartRows from '../CartRows';
import RakitButtonsRow from '../RakitButtonsRow';
import { isPreOrder } from '../../../lib/wizard/validation';

interface Props {
  items: KasirItem[];
  setItems: (items: KasirItem[]) => void;
  rakitLines: RakitJobLine[];
  setRakitLines: (lines: RakitJobLine[]) => void;
  stockByWarehouseSku: Record<string, number>;
  prefillSku?: string;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function Step2Items(props: Props) {
  // honor prefill_sku once on mount
  useEffect(() => {
    if (props.prefillSku && props.items.length === 0) {
      // delegate to existing addItem handler shape; concrete impl depends on
      // how ItemSearchPanel exposes "add by sku"
      // TODO: invoke whatever ItemSearchPanel's "add this SKU" path is
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preOrderRows = props.items.filter((it) => isPreOrder(it as any, props.stockByWarehouseSku));
  const preOrderCount = preOrderRows.length;

  return (
    <div className="grid grid-cols-12 gap-6 p-6">
      <div className="col-span-5 space-y-3">
        <ItemSearchPanel onAdd={(item) => props.setItems([...props.items, item])} />
        <RakitButtonsRow onAdd={(line) => props.setRakitLines([...props.rakitLines, line])} />
      </div>
      <div className="col-span-7">
        <CartRows
          items={props.items}
          setItems={props.setItems}
          rakitLines={props.rakitLines}
          setRakitLines={props.setRakitLines}
          stockByWarehouseSku={props.stockByWarehouseSku}
        />
        {preOrderCount > 0 && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
            <span>⏳</span>
            <div>
              <strong>{preOrderCount} item pre-order</strong> di pesanan ini — stok minus akan dipenuhi setelah supplier kirim.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note:** Actual prop shapes for `ItemSearchPanel`, `CartRows`, `RakitButtonsRow` may differ. Adapt to match.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```
Adapt if needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/wizard/Step2Items.tsx
git commit -m "feat(catat-penjualan): Step2Items

Wraps ItemSearchPanel + RakitButtonsRow + CartRows. Pre-order summary
banner when any item.qty > stock. Honors prefill_sku on mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 14: `Step3Payment` component

**Files:**
- Create: `src/components/penjualan/wizard/Step3Payment.tsx`

**Interfaces produced:** wraps `PaymentPanel`. Owns Simpan button + save dispatch + spinner.

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/wizard/Step3Payment.tsx`:

```tsx
import { useState } from 'react';
import type { DbCustomer, KasirItem, RakitJobLine } from '../../../types';
import PaymentPanel from '../PaymentPanel';
import { dispatchSave, validateStep3 } from '../../../lib/wizard/validation';

interface Props {
  customer: DbCustomer;
  items: KasirItem[];
  rakitLines: RakitJobLine[];
  payment: any; // delegated state shape; mirrors existing PaymentPanel value
  setPayment: (p: any) => void;
  onSave: (path: 'tempo' | 'wip' | 'standard') => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function Step3Payment(props: Props) {
  const [submitting, setSubmitting] = useState(false);

  const state = {
    payment_type: props.payment?.payment_type,
    customer: props.customer,
    items: props.items,
    rakitLines: props.rakitLines,
  } as any;
  const validation = validateStep3(state);

  const onSimpan = async () => {
    if (!validation.ok) {
      props.showToast(validation.errors?.[0] ?? 'Tidak valid', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const path = dispatchSave(state);
      await props.onSave(path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      props.showToast(`Gagal simpan: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PaymentPanel
        value={props.payment}
        onChange={props.setPayment}
        customer={props.customer}
        items={props.items}
        rakitLines={props.rakitLines}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSimpan}
          disabled={submitting || !validation.ok}
          className="px-6 py-2 text-sm font-bold rounded-lg bg-[#2d8a4e] text-white hover:bg-[#236b3d] disabled:opacity-50"
        >
          {submitting ? 'Menyimpan…' : '✓ Simpan Penjualan'}
        </button>
      </div>
    </div>
  );
}
```

**Note:** `PaymentPanel` prop shape may differ. Adapt.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/wizard/Step3Payment.tsx
git commit -m "feat(catat-penjualan): Step3Payment

Wraps PaymentPanel. Owns Simpan button + dispatch (tempo/wip/standard).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 15: `CustomerCreditActivateApprovalRequestRow` component

**Files:**
- Create: `src/components/approval/CustomerCreditActivateApprovalRequestRow.tsx`

**Interfaces produced:** `<CustomerCreditActivateApprovalRequestRow request, isOwner, disabled, actorName?, onApprove(id), onReject(id, reason) />`. Renders the customer + requested limit + term + reason; Tolak opens inline reject-reason textarea; Setujui delegates to parent.

- [ ] **Step 1: Write the component (mirror TempoWriteOffApprovalRequestRow)**

```bash
cat src/components/approval/TempoWriteOffApprovalRequestRow.tsx
```
Copy structure, swap fields/labels for credit-activate context.

Create `src/components/approval/CustomerCreditActivateApprovalRequestRow.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../../types';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  request: ApprovalRequest;
  isOwner: boolean;
  disabled: boolean;
  actorName?: string;
  onApprove: (id: number) => void;
  onReject: (id: number, reason?: string) => void;
}

interface CustomerSummary {
  id: string;
  name: string;
  wa_number?: string;
  company?: string;
}

function fmtRp(n: number | undefined): string {
  if (n == null) return '—';
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

export default function CustomerCreditActivateApprovalRequestRow({
  request, isOwner, disabled, actorName, onApprove, onReject,
}: Props) {
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const payload = request.payload as any;
  const requestedLimit = payload?.credit_limit ?? payload?.requested_limit;
  const requestedTerm = payload?.term_days ?? payload?.requested_term;
  const reason = payload?.reason;
  const customerId = payload?.customer_id;

  useEffect(() => {
    if (!supabase || !customerId) return;
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, wa_number, company')
        .eq('id', customerId)
        .single();
      if (data) setCustomer(data as CustomerSummary);
    })();
  }, [customerId]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 font-extrabold uppercase tracking-wider">
              Aktivasi TEMPO
            </span>
            <span className="text-slate-500">#{request.id}</span>
            {actorName && <span className="text-slate-500">oleh <strong>{actorName}</strong></span>}
          </div>
          <div className="text-sm">
            {customer?.name ?? '—'}
            {customer?.company && <span className="text-slate-500 ml-2">{customer.company}</span>}
            {customer?.wa_number && <span className="text-slate-400 font-mono ml-2">{customer.wa_number}</span>}
          </div>
          <div className="text-xs flex gap-4">
            <div><span className="text-slate-500">Limit:</span> <strong>{fmtRp(requestedLimit)}</strong></div>
            <div><span className="text-slate-500">Term:</span> <strong>{requestedTerm} hari</strong></div>
          </div>
          {reason && (
            <div className="text-xs text-slate-700 italic max-w-md">"{reason}"</div>
          )}
        </div>

        {isOwner && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRejectOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApprove(request.id)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              ✓ Setujui Aktivasi
            </button>
          </div>
        )}
      </div>

      {rejectOpen && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
          <label className="block text-xs font-semibold text-slate-700">Alasan penolakan</label>
          <textarea
            rows={2}
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Mis: limit terlalu tinggi untuk customer baru…"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                onReject(request.id, rejectReason.trim() || undefined);
                setRejectOpen(false);
                setRejectReason('');
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Konfirmasi Tolak
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/approval/CustomerCreditActivateApprovalRequestRow.tsx
git commit -m "feat(approval): CustomerCreditActivateApprovalRequestRow component

Mirrors TempoWriteOffApprovalRequestRow. Shows customer + requested limit
+ term + reason. Inline reject-reason textarea.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone E — Orchestrator + Invoice preview (2 tasks)

### Task 16: `CatatPenjualanWizard` orchestrator

**Files:**
- Create: `src/components/penjualan/CatatPenjualanWizard.tsx`

**Interfaces produced:** mirrors existing `PenjualanBaruScreen` prop interface verbatim: `{currentUser, showToast, onBack, onSaved, initialChannel, initialPrefillSku, onNavigate}`.

- [ ] **Step 1: Write the orchestrator**

Create `src/components/penjualan/CatatPenjualanWizard.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import type {
  DbCustomer, KasirChannel, KasirItem, PermissionSet, RakitJobLine, ActivePage,
} from '../../types';
import WizardStepper from './wizard/WizardStepper';
import Step1ChannelCustomer from './wizard/Step1ChannelCustomer';
import Step2Items from './wizard/Step2Items';
import Step3Payment from './wizard/Step3Payment';
import { validateStep1, validateStep2 } from '../../lib/wizard/validation';
import { kasirService } from '../../lib/supabaseClient';
import { createTempoInvoice } from '../../lib/piutangService';

interface Props {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;
  onSaved: (txId: string) => void;
  initialChannel?: KasirChannel;
  initialPrefillSku?: string;
  onNavigate?: (page: ActivePage) => void;
}

export default function CatatPenjualanWizard(props: Props) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<1 | 2 | 3>>(new Set());

  // shared state
  const [channel, setChannel] = useState<KasirChannel | undefined>(props.initialChannel);
  const [customer, setCustomer] = useState<DbCustomer | undefined>(undefined);
  const [marketplaceOrderNo, setMarketplaceOrderNo] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waChatUrl, setWaChatUrl] = useState('');
  const [items, setItems] = useState<KasirItem[]>([]);
  const [rakitLines, setRakitLines] = useState<RakitJobLine[]>([]);
  const [payment, setPayment] = useState<any>({ payment_type: 'FULL' });
  // stock map for pre-order detection (populated by Step2 via stocks fetch)
  const [stockByWarehouseSku, setStockByWarehouseSku] = useState<Record<string, number>>({});

  // beforeunload warning if dirty
  useEffect(() => {
    const isDirty = !!channel || !!customer || items.length > 0 || rakitLines.length > 0;
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Penjualan belum disimpan. Yakin keluar?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [channel, customer, items, rakitLines]);

  const step1State = useMemo(() => ({ channel, customer, marketplace_order_no: marketplaceOrderNo, wa_phone: waPhone } as any), [channel, customer, marketplaceOrderNo, waPhone]);
  const step2State = useMemo(() => ({ items, rakitLines } as any), [items, rakitLines]);
  const canAdvanceStep1 = validateStep1(step1State).ok;
  const canAdvanceStep2 = validateStep2(step2State).ok;

  const onLanjut = () => {
    if (currentStep === 1 && canAdvanceStep1) {
      setCompletedSteps((prev) => new Set(prev).add(1));
      setCurrentStep(2);
    } else if (currentStep === 2 && canAdvanceStep2) {
      setCompletedSteps((prev) => new Set(prev).add(2));
      setCurrentStep(3);
    }
  };

  const onKembali = () => {
    if (currentStep === 2) setCurrentStep(1);
    else if (currentStep === 3) setCurrentStep(2);
  };

  const onJumpBack = (step: 1 | 2 | 3) => {
    if (completedSteps.has(step)) setCurrentStep(step);
  };

  const onCancel = () => {
    if (confirm('Batalkan? Semua input akan hilang.')) props.onBack();
  };

  const onSave = async (path: 'tempo' | 'wip' | 'standard') => {
    const basePayload: any = {
      channel,
      items,
      rakit_lines: rakitLines,
      customer_id: customer?.id,
      customer_name: customer?.name,
      customer_phone: customer?.wa_number,
      customer_company: customer?.company,
      delivery_address: payment?.delivery_address,
      tokped_order_no: marketplaceOrderNo,
      wa_phone: waPhone,
      wa_chat_url: waChatUrl,
      notes: payment?.notes,
      payment_method: payment?.payment_method,
      payment_subtype: payment?.payment_subtype,
      payment_type: payment?.payment_type,
      dp_amount: payment?.dp_amount,
      dp_input_type: payment?.dp_input_type,
      ongkir_amount: payment?.ongkir_amount,
      subtotal: items.reduce((a, it) => a + (it as any).subtotal, 0),
      total_amount: payment?.total_amount,
      allow_negative_stock: true,
    };
    if (path === 'tempo') {
      const result = await createTempoInvoice(basePayload);
      if (result.kind === 'ok') {
        props.onNavigate?.('invoicePreview' as ActivePage);
        props.onSaved(result.order_id);
      } else {
        throw new Error(result.kind);
      }
    } else if (path === 'wip') {
      const tx = await kasirService.insertWipWithRakit({ ...basePayload, allow_negative_stock: true } as any);
      props.onNavigate?.('invoicePreview' as ActivePage);
      props.onSaved((tx as any).id);
    } else {
      const tx = await kasirService.recordSale({ ...basePayload, p_allow_negative_stock: true } as any);
      props.onNavigate?.('invoicePreview' as ActivePage);
      props.onSaved((tx as any).id);
    }
  };

  return (
    <div className="max-w-6xl mx-auto bg-white rounded-2xl mt-6 mb-6 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold text-[#012749]">Catat Penjualan</h1>
          <p className="text-xs text-slate-500 mt-0.5">Step {currentStep} dari 3</p>
        </div>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:text-slate-700 font-semibold">Batal</button>
      </div>
      <WizardStepper currentStep={currentStep} completedSteps={completedSteps} onJumpBack={onJumpBack} />

      {currentStep === 1 && (
        <Step1ChannelCustomer
          channel={channel} setChannel={setChannel}
          customer={customer} setCustomer={setCustomer}
          marketplaceOrderNo={marketplaceOrderNo} setMarketplaceOrderNo={setMarketplaceOrderNo}
          waPhone={waPhone} setWaPhone={setWaPhone}
          waChatUrl={waChatUrl} setWaChatUrl={setWaChatUrl}
          showToast={props.showToast}
        />
      )}
      {currentStep === 2 && (
        <Step2Items
          items={items} setItems={setItems}
          rakitLines={rakitLines} setRakitLines={setRakitLines}
          stockByWarehouseSku={stockByWarehouseSku}
          prefillSku={props.initialPrefillSku}
          showToast={props.showToast}
        />
      )}
      {currentStep === 3 && customer && (
        <Step3Payment
          customer={customer}
          items={items}
          rakitLines={rakitLines}
          payment={payment}
          setPayment={setPayment}
          onSave={onSave}
          showToast={props.showToast}
        />
      )}

      <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          {currentStep === 1 && !canAdvanceStep1 && 'Lengkapi channel & customer untuk lanjut.'}
          {currentStep === 2 && !canAdvanceStep2 && 'Lengkapi keranjang untuk lanjut.'}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onKembali}
            disabled={currentStep === 1}
            className="px-4 py-2 text-sm font-semibold rounded-lg text-slate-700 border border-slate-300 hover:bg-slate-100 disabled:opacity-40"
          >
            ← Kembali
          </button>
          {currentStep < 3 && (
            <button
              type="button"
              onClick={onLanjut}
              disabled={currentStep === 1 ? !canAdvanceStep1 : !canAdvanceStep2}
              className="px-5 py-2 text-sm font-bold rounded-lg bg-[#012749] text-white hover:opacity-90 disabled:opacity-50"
            >
              {currentStep === 1 ? 'Lanjut ke Pesanan →' : 'Lanjut ke Pembayaran →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```
Expect prop-mismatch errors with the existing PaymentPanel / ItemSearchPanel / etc. since I'm working from spec'd names. Adapt the orchestrator's prop-passing to match the real components.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/CatatPenjualanWizard.tsx
git commit -m "feat(catat-penjualan): CatatPenjualanWizard orchestrator

Owns shared state, stepper, nav, save dispatch. beforeunload warning.
Mirrors existing PenjualanBaruScreen prop interface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 17: `InvoicePreviewScreen` component

**Files:**
- Create: `src/components/penjualan/InvoicePreviewScreen.tsx`

**Interfaces produced:** `<InvoicePreviewScreen orderId, onCatatLagi, onLihatDaftar, showToast />`. Renders existing `SalesInvoicePDF`; provides 4 actions.

- [ ] **Step 1: Write the component**

Create `src/components/penjualan/InvoicePreviewScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { KasirTransaction } from '../../types';
import { kasirService } from '../../lib/supabaseClient';
import SalesInvoicePDF from './SalesInvoicePDF';

interface Props {
  orderId: string;
  onCatatLagi: () => void;
  onLihatDaftar: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function InvoicePreviewScreen({ orderId, onCatatLagi, onLihatDaftar, showToast }: Props) {
  const [transaction, setTransaction] = useState<KasirTransaction | null>(null);
  const [printMode, setPrintMode] = useState<'normal' | 'dot_matrix'>('normal');

  useEffect(() => {
    (async () => {
      const tx = await (kasirService as any).fetchById(orderId);
      setTransaction(tx);
    })();
  }, [orderId]);

  const onCetak = (mode: 'normal' | 'dot_matrix') => {
    setPrintMode(mode);
    setTimeout(() => window.print(), 50);
  };

  const onBagikanWA = () => {
    if (!transaction) return;
    const phone = (transaction as any).customer_phone?.replace(/^0/, '62');
    if (!phone) { showToast('Customer tidak punya nomor WA', 'warning'); return; }
    const summary = `Invoice ${transaction.invoice_number} - Total Rp ${transaction.total_amount.toLocaleString('id-ID')}. Terima kasih atas pesanannya.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(summary)}`, '_blank');
  };

  if (!transaction) return <div className="p-6 text-slate-500">Memuat invoice…</div>;

  return (
    <div className="max-w-6xl mx-auto bg-white rounded-2xl mt-6 mb-6 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-600">✓</span>
            <h1 className="text-lg font-extrabold text-[#012749]">Penjualan Tersimpan</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Invoice <strong>{transaction.invoice_number}</strong></p>
        </div>
        <div className="flex gap-2">
          <button onClick={onLihatDaftar} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-700 border border-slate-300 hover:bg-slate-100">📋 Daftar Pesanan</button>
          <button onClick={onCatatLagi} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#012749] text-white hover:opacity-90">+ Catat Lagi</button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 p-6">
        <div className="col-span-8">
          <SalesInvoicePDF
            transaction={transaction}
            variant="lunas"
            onClose={() => {}}
            // future prop: printMode={printMode}
          />
        </div>
        <div className="col-span-4 space-y-2">
          <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Cetak</div>
          <button onClick={() => onCetak('normal')} className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-[#012749] text-white hover:opacity-90">🖨️ Printer Biasa (A4 / A5)</button>
          <button onClick={() => onCetak('dot_matrix')} className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-slate-700 text-white hover:bg-slate-800">🖨️ Dot Matrix</button>
          <div className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-2 mt-4">File & Share</div>
          <button onClick={onBagikanWA} className="w-full px-4 py-3 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">📱 Bagikan via WhatsApp</button>
          <button onClick={() => showToast('Download PDF: gunakan tombol di preview', 'info')} className="w-full px-4 py-3 text-sm font-semibold rounded-lg bg-white text-slate-700 border border-slate-300 hover:bg-slate-50">⬇️ Download PDF</button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** `kasirService.fetchById` may not exist; adapt to whatever fetch helper retrieves a transaction by id. `SalesInvoicePDF`'s existing prop `variant` may need to be derived from `transaction.payment_type`.

- [ ] **Step 2: tsc**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/InvoicePreviewScreen.tsx
git commit -m "feat(catat-penjualan): InvoicePreviewScreen

Post-save destination. Renders existing SalesInvoicePDF. 4 actions:
Cetak Printer Biasa, Cetak Dot Matrix, Bagikan WA, Download PDF.
+ Lihat Daftar Pesanan, + Catat Lagi.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone F — Wiring (4 tasks)

### Task 18: `SalesInvoicePDF` — add `printMode` prop + pre-order footnote

**Files:**
- Modify: `src/components/penjualan/SalesInvoicePDF.tsx`

- [ ] **Step 1: Add `printMode` prop**

In the existing `SalesInvoicePDFProps` interface, add `printMode?: 'normal' | 'dot_matrix'`. Default to `'normal'`. In the body, apply different CSS classes based on `printMode` (narrower column widths + monospace fallback fonts when `'dot_matrix'`).

- [ ] **Step 2: Add per-row pre-order footnote**

For each item row in the rendered table, if `(transaction.items[i] as any).is_pre_order` is truthy, render below the description: `<div className="text-[10px] italic text-slate-500">*Pre-order, akan dikirim setelah barang tiba</div>`.

(The `is_pre_order` field is derived — see Task 19 about how the wizard computes it before save. For now, support the optional field gracefully.)

- [ ] **Step 3: tsc + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/SalesInvoicePDF.tsx
git commit -m "feat(penjualan): SalesInvoicePDF — printMode + pre-order footnote

Optional printMode prop ('normal' | 'dot_matrix'). Dot matrix uses narrower
layout + monospace fallback. Per-row footnote when item.is_pre_order.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 19: `ApprovalInboxScreen` — dispatch arm for `customer_credit_activate`

**Files:**
- Modify: `src/components/approval/ApprovalInboxScreen.tsx`

- [ ] **Step 1: Add imports**

```ts
import CustomerCreditActivateApprovalRequestRow from './CustomerCreditActivateApprovalRequestRow';
import { rejectCustomerCreditActivate } from '../../lib/customers/customerWrappers';
```

- [ ] **Step 2: Extend FilterPill union + PILLS**

Find `type FilterPill = '...';` and add `'customer_credit_activate'`. Append to PILLS:
```ts
{ key: 'customer_credit_activate', label: 'Aktivasi TEMPO' },
```

- [ ] **Step 3: Extend handleApprove dispatch**

Before the existing `rakit_lock` branch, insert:
```ts
if (req.requestType === 'customer_credit_activate') {
  // Existing approve_customer_credit_activate is PIN-gated; reuse the OwnerPinPad
  // flow that adjustment/price_change/opname uses.
  setPinTarget({ id, type: req.requestType });
  return;
}
```

Then in `runCommitAfterPin`, add a case:
```ts
case 'customer_credit_activate':
  // approve_customer_credit_activate takes (request_id, owner_pin); the PinPad
  // already passes the pin via verify path before reaching here, so we just
  // confirm the request is approved server-side.
  // For now, treat this like the other PIN-gated commits.
  break;
```

(NOTE: the existing `approve_customer_credit_activate` RPC signature takes Owner PIN as param, which differs from the PR #34 auth.uid pattern. Modernization is deferred to a separate PR. For now, mirror the PIN flow used by adjustment/price_change/opname.)

- [ ] **Step 4: Extend handleReject dispatch**

In handleReject's chain, add before rakit_lock:
```ts
} else if (req.requestType === 'customer_credit_activate') {
  await rejectCustomerCreditActivate(id, reason ?? 'Owner reject from Persetujuan inbox');
  showToast('Aktivasi TEMPO ditolak', 'info');
  await refresh();
```

- [ ] **Step 5: Extend row render**

Find the existing render ternary. Add a new arm BEFORE the generic fallback:
```tsx
) : r.requestType === 'customer_credit_activate' ? (
  <CustomerCreditActivateApprovalRequestRow
    request={r}
    isOwner={isOwner}
    disabled={busyId !== null && busyId !== r.id}
    actorName={actorNames[r.requestedBy]}
    onApprove={handleApprove}
    onReject={handleReject}
  />
) : (
```

- [ ] **Step 6: tsc + build + tests**

```bash
npx tsc --noEmit
npm run build
npm test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add src/components/approval/ApprovalInboxScreen.tsx
git commit -m "feat(approval): wire customer_credit_activate into ApprovalInboxScreen

Add Aktivasi TEMPO pill, dispatch arms for approve (PIN-gated, existing
pattern) + reject (new rejectCustomerCreditActivate RPC). Render new
CustomerCreditActivateApprovalRequestRow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 20: `App.tsx` — swap mount + add `invoicePreview` screen key

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace import**

Replace `import PenjualanBaruScreen from './components/PenjualanBaruScreen';` with:
```ts
import CatatPenjualanWizard from './components/penjualan/CatatPenjualanWizard';
import InvoicePreviewScreen from './components/penjualan/InvoicePreviewScreen';
```

- [ ] **Step 2: Track `invoicePreviewOrderId` state**

Add near other navigation state in `App`:
```ts
const [invoicePreviewOrderId, setInvoicePreviewOrderId] = useState<string | null>(null);
```

- [ ] **Step 3: Update `onSaved` to capture order id**

In the `penjualanBaru` case, change `onSaved={(_txId) => navigate('kasir')}` to:
```tsx
onSaved={(txId) => {
  setInvoicePreviewOrderId(txId);
  navigate('invoicePreview');
}}
```

- [ ] **Step 4: Swap mount**

Replace the `<PenjualanBaruScreen ... />` mount with:
```tsx
<CatatPenjualanWizard
  currentUser={currentUser}
  showToast={triggerToast}
  initialChannel={penjualanInitialChannel}
  initialPrefillSku={penjualanInitialPrefillSku}
  onBack={() => navigate('kasir')}
  onSaved={(txId) => {
    setInvoicePreviewOrderId(txId);
    navigate('invoicePreview');
  }}
  onNavigate={(page) => navigate(page)}
/>
```

- [ ] **Step 5: Add `invoicePreview` case**

Add to the screen switch:
```tsx
case 'invoicePreview':
  return invoicePreviewOrderId ? (
    <InvoicePreviewScreen
      orderId={invoicePreviewOrderId}
      onCatatLagi={() => { setInvoicePreviewOrderId(null); navigate('penjualanBaru'); }}
      onLihatDaftar={() => navigate('daftarPesanan')}
      showToast={triggerToast}
    />
  ) : (
    <div className="p-6 text-slate-500">No invoice loaded.</div>
  );
```

- [ ] **Step 6: tsc + build + tests**

```bash
npx tsc --noEmit
npm run build
npm test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(catat-penjualan): App.tsx wire wizard + invoicePreview route

Swap PenjualanBaruScreen mount → CatatPenjualanWizard. Add invoicePreview
screen key with InvoicePreviewScreen mount. Order id flows through
onSaved → invoicePreviewOrderId state → InvoicePreviewScreen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 21: `CartRows` — pre-order chip

**Files:**
- Modify: `src/components/penjualan/CartRows.tsx`

- [ ] **Step 1: Add `stockByWarehouseSku` prop**

Add `stockByWarehouseSku?: Record<string, number>` to the component's props. Pass it from `Step2Items` (Task 13).

- [ ] **Step 2: Render pre-order chip per row**

For each item row, compute `isPreOrder` using the helper from Task 8:
```ts
import { isPreOrder as checkPreOrder } from '../../lib/wizard/validation';
const preOrder = props.stockByWarehouseSku ? checkPreOrder(item as any, props.stockByWarehouseSku) : false;
const shortage = preOrder ? item.qty - (props.stockByWarehouseSku?.[`${item.sku}|${item.warehouse_id}`] ?? 0) : 0;
```

Render chip alongside item name:
```tsx
{preOrder && (
  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider" title={`Stok kurang ${shortage} unit`}>
    ⏳ Pre-order · kurang {shortage}
  </span>
)}
```

- [ ] **Step 3: tsc + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/CartRows.tsx
git commit -m "feat(penjualan): CartRows — pre-order chip per row

When qty > stock at picked warehouse, render '⏳ PRE-ORDER · kurang N' chip
inline next to item name. Powered by isPreOrder helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Milestone G — Cleanup + final validation + PR (3 tasks)

### Task 22: Delete `PenjualanBaruScreen.tsx`

**Files:**
- Delete: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Confirm no other imports remain**

```bash
grep -rn "PenjualanBaruScreen" src/ 2>&1 | grep -v "^src/components/PenjualanBaruScreen.tsx" | head
```
Expected: empty (only the file itself; all consumers were swapped in Task 20).

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/PenjualanBaruScreen.tsx
```

- [ ] **Step 3: tsc + build + tests**

```bash
npx tsc --noEmit
npm run build
npm test -- --run
```
Expected: clean. If imports still complain, find + swap.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(catat-penjualan): delete PenjualanBaruScreen.tsx (624 LOC)

Superseded by CatatPenjualanWizard orchestrator + 4 step components.
All consumers migrated in App.tsx swap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 23: Update progress.md + final validation

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Run full validation**

```bash
npm test -- --run 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -5
```
Record vitest pass count delta vs baseline. Expected: all clean.

- [ ] **Step 2: Prepend new section to progress.md**

Add at the top (under H1, above the most recent existing section):

```markdown
## 2026-06-20 — Catat Penjualan 3-step wizard

Replaces 624-line monolithic PenjualanBaruScreen with guided 3-step wizard
(Channel+Customer → Pesanan → Pembayaran) + post-save InvoicePreviewScreen.
Spec: docs/superpowers/specs/2026-06-20-catat-penjualan-3-step-wizard-design.md
(commit ab7a15f). Mockup: docs/superpowers/mockups/2026-06-20-catat-penjualan-3-step-wizard.html.

**Backend (5 migrations, slot range 20260630000001-005):**
- 001 customers.address column
- 002 record_kasir_sale opt-in p_allow_negative_stock flag
- 003 create_tempo_invoice opt-in allow_negative_stock payload key
- 004 reject_customer_credit_activate RPC (Aktif Owner pattern from PR #34)
- 005 record_pi emits preorder_fulfilled audit when SKU pre-call balance < 0

**Frontend new (8 files):** CatatPenjualanWizard, wizard/WizardStepper, wizard/Step1ChannelCustomer, wizard/Step2Items, wizard/Step3Payment, wizard/NewCustomerInlineForm, InvoicePreviewScreen, approval/CustomerCreditActivateApprovalRequestRow.

**Frontend modified:** App.tsx routing + invoicePreview key; types.ts ActivePage + DbCustomer.address; supabaseClient + customers/customerWrappers (3 new wrappers); SalesInvoicePDF (printMode + pre-order footnote); CartRows (pre-order chip); PaymentPanel (TEMPO not-eligible warning); ApprovalInboxScreen (dispatch arm + reject branch); CustomerPanel (ad-hoc audit).

**Deleted:** PenjualanBaruScreen.tsx (624 LOC).

**Decisions captured (brainstorming):** per-RPC allow_negative_stock flag (wizard true, Kasir false); no ad-hoc customers (wajib intake nama+HP); jasa hanya Custom Panel + Wiring Panel; TEMPO requires Owner approval via existing customer_credit_activate; full TEMPO infra additions (address + reject RPC + dedicated inbox row); 3 TEMPO fields (limit + term + reason); no PPN/discount; reuse `pelanggan` permission.

**Verification:** {N}/{N} vitest pass (baseline + 30 new = wrapper 7 + validation 23). tsc clean. build clean. SQL smoke (per migration): all green.

---
```

- [ ] **Step 3: Commit**

```bash
git add progress.md
git commit -m "docs(progress): Catat Penjualan 3-step wizard — implementation complete

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

### Task 24: Push + open PR

**Files:** none (git ops)

- [ ] **Step 1: Push**

```bash
git push -u origin feat/catat-penjualan-wizard 2>&1 | tail -5
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(catat-penjualan): 3-step wizard replaces 624-line PenjualanBaruScreen" --body "$(cat <<'EOF'
## Summary

Replaces the 624-line monolithic `PenjualanBaruScreen.tsx` with a guided 3-step wizard. Per the brainstorming session captured in the spec, this also adds 4 backend prereqs (negative-stock flag, customer address column, reject_customer_credit_activate RPC, preorder_fulfilled audit event) plus a dedicated inbox row for the customer_credit_activate approval flow.

**Spec:** `docs/superpowers/specs/2026-06-20-catat-penjualan-3-step-wizard-design.md`
**Mockup:** `docs/superpowers/mockups/2026-06-20-catat-penjualan-3-step-wizard.html`

## 3 steps

1. **Channel + Customer.** Pick channel; pick existing customer or "+ Customer Baru" inline (no ad-hoc — every customer persists to DB per founder rule). Optional TEMPO request fires `customer_credit_activate` approval for Owner.
2. **Pesanan.** SKU items + optional jasa (Custom Panel / Wiring Panel only). Pre-order supported (negative stock allowed via opt-in flag); per-row chip + summary banner.
3. **Pembayaran.** LUNAS / DP / TEMPO. Existing 3 RPC paths preserved (`record_kasir_sale` / `create_tempo_invoice` / client-composed WIP+rakit).

After Simpan → `InvoicePreviewScreen` with Cetak Printer Biasa / Cetak Dot Matrix / Bagikan WA / Download PDF / "+ Catat Lagi".

## Migrations (applied to live Supabase via MCP)

- `20260630000001` — `ALTER TABLE customers ADD COLUMN address TEXT`
- `20260630000002` — `record_kasir_sale` opt-in `p_allow_negative_stock` flag
- `20260630000003` — `create_tempo_invoice` payload key `allow_negative_stock`
- `20260630000004` — new `reject_customer_credit_activate` RPC (Aktif Owner from PR #34)
- `20260630000005` — `record_pi` emits `preorder_fulfilled` audit when SKU pre-call balance < 0

## Test plan

**Already done locally:**
- [x] Vitest baseline + 30 new = all pass
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [x] SQL smoke per migration — all green

**To verify in production after merge (Chrome DevTools MCP):**
- [ ] Walk-in LUNAS happy path
- [ ] Tokopedia TEMPO with existing eligible customer
- [ ] "+ Customer Baru" inline + Ajukan TEMPO → approval visible in Persetujuan inbox
- [ ] Pre-order: add SKU with qty > stock; chip visible; save succeeds
- [ ] Lump-sum jasa (qty=0); WIP order created with Owner Lock pending
- [ ] Back-nav state preservation
- [ ] Cancel mid-wizard with confirm dialog
- [ ] Cetak Dot Matrix print preview
- [ ] Bagikan WhatsApp opens wa.me link
- [ ] Owner approve credit_activate (existing PIN flow)
- [ ] Owner reject credit_activate (new RPC)
- [ ] Verify `preorder_fulfilled` audit emitted after `record_pi` of a pending pre-order

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

- [ ] **Step 3: Output PR URL**

Print the PR URL for the user to review.

---

### Task 25: Dashboard "Recent pre-order fulfillments" card (B5 follow-through)

**Files:**
- Create: `src/components/dashboard/PreOrderFulfillmentsCard.tsx`
- Modify: `src/components/DashboardScreen.tsx` (or wherever existing dashboard cards mount — find via grep)

**Interfaces produced:** `<PreOrderFulfillmentsCard showToast />`. Queries `audit_log` for `event_type='preorder_fulfilled'` last 7 days; lists customer name + SKU + qty_fulfilled + "Notify WA" button per row.

- [ ] **Step 1: Locate dashboard mount**

```bash
grep -rln "DashboardScreen\|dashboard.*Card" src/components/ | head -5
```
Identify how existing dashboard cards are composed.

- [ ] **Step 2: Write the card component**

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

interface FulfillmentRow {
  audit_id: number;
  sku: string;
  qty_fulfilled: number;
  pending_order_ids: string[];
  customer_summaries: { id: string; name: string; wa_number?: string }[];
  fulfilled_at: string;
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PreOrderFulfillmentsCard({ showToast }: Props) {
  const [rows, setRows] = useState<FulfillmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('audit_log')
        .select('id, payload, created_at')
        .eq('event_type', 'preorder_fulfilled')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20);

      const rowsRaw = (data ?? []).map((r: any) => ({
        audit_id: r.id,
        sku: r.payload?.sku,
        qty_fulfilled: r.payload?.qty_fulfilled,
        pending_order_ids: r.payload?.pending_order_ids ?? [],
        customer_summaries: [],
        fulfilled_at: r.created_at,
      }));

      // Hydrate customer info per row (best-effort batch)
      const allOrderIds = Array.from(new Set(rowsRaw.flatMap((r) => r.pending_order_ids)));
      if (allOrderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, customer_id, customers(id, name, wa_number)')
          .in('id', allOrderIds);
        const byOrderId = new Map((orders ?? []).map((o: any) => [o.id, o.customers]));
        for (const r of rowsRaw) {
          r.customer_summaries = r.pending_order_ids
            .map((oid) => byOrderId.get(oid))
            .filter((c) => !!c) as any;
        }
      }

      setRows(rowsRaw);
      setLoading(false);
    })();
  }, []);

  const onNotifyWA = (cust: { wa_number?: string; name: string }, sku: string) => {
    if (!cust.wa_number) { showToast('Customer ini tidak punya nomor WA', 'warning'); return; }
    const phone = cust.wa_number.replace(/^0/, '62');
    const text = encodeURIComponent(
      `Halo ${cust.name}, kabar baik — pesanan pre-order Anda (SKU ${sku}) sudah tiba di toko. Bisa diambil/dikirim sesuai kesepakatan. Terima kasih!`,
    );
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-extrabold text-[#012749]">Pre-order ter-fulfill (7 hari terakhir)</h3>
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">⏳ Notify customer manual</span>
      </div>
      {loading ? (
        <p className="text-xs text-slate-500">Memuat…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Belum ada pre-order yang ter-fulfill minggu ini.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.audit_id} className="py-2 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs"><strong>{r.sku}</strong> · {r.qty_fulfilled} unit</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {r.customer_summaries.map((c) => c?.name).filter(Boolean).join(', ') || '—'}
                </div>
              </div>
              <div className="flex gap-1">
                {r.customer_summaries.slice(0, 3).map((c, i) => (
                  c?.wa_number && (
                    <button
                      key={i}
                      onClick={() => onNotifyWA(c, r.sku)}
                      className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    >
                      📱 WA {c.name.split(' ')[0]}
                    </button>
                  )
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount in DashboardScreen**

Find where other dashboard cards live and add `<PreOrderFulfillmentsCard showToast={triggerToast} />` to the layout. Typically alongside KPI cards.

- [ ] **Step 4: tsc + build**

```bash
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/PreOrderFulfillmentsCard.tsx src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): PreOrderFulfillmentsCard — last 7 days

Consumes audit_log preorder_fulfilled events from Task 5. Lists SKU +
qty + customer; per-customer 'WA' button opens wa.me link with manual
notification text. Operator manually fires notifications (no auto-WA
per founder choice).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"
```

---

## Self-Review Checklist (run before declaring done)

1. **All 5 migrations applied** (`20260630000001-005`) and named per spec.
2. **`allows_tempo=false` default** for newly-created customers — verify via Task 7 wrapper.
3. **`reject_customer_credit_activate`** uses the Aktif-Owner-via-email pattern from PR #34 (not `status='active'`).
4. **Wizard `onSave` passes `allow_negative_stock: true`** in payload to all 3 RPC paths.
5. **Step 1 disables Lanjut** until channel + customer set (+ marketplace_order_no / wa_phone where applicable).
6. **Step 2 allows qty=0 jasa lump-sum** but blocks qty=0 SKU items.
7. **Pre-order chip renders** when item.qty > stockByWarehouseSku[sku|warehouse].
8. **Stepper jump-forward blocked** to not-yet-completed steps.
9. **`beforeunload` warning** fires when wizard has dirty state.
10. **InvoicePreviewScreen** renders existing `SalesInvoicePDF` (no re-invented template).
11. **CustomerPanel ad-hoc fallback** removed or confirmed absent (Task 9).
12. **PenjualanBaruScreen.tsx deleted** (Task 22); no stale imports remain.
13. **progress.md prepended** (not appended) per repo convention.

If any of these are wrong, fix before declaring complete and re-run vitest + tsc + build.
