-- supabase/migrations/20260622000006_new_pembelian_approval_rpcs.sql
-- Phase 1 task 8 — 7 NEW Pembelian approval RPC trios.
--
-- SCOPE: One trio per gate (request_<gate> + _apply_<gate>_change +
-- commit_approved_<gate>):
--   1. purchase_order_create
--   2. purchase_order_amend
--   3. tagihan_create        (target table: purchase_invoices)
--   4. supplier_payment      (target table: pembayaran)
--   5. bnl_create            (no target table yet)
--   6. tukar_faktur          (target table: tukar_faktur)
--   7. purchase_return       (no target table yet)
--
-- ====== DISCOVERY (2026-06-22) ======
-- Target tables that EXIST:
--   purchase_orders, purchase_invoices, pembayaran (supplier payment),
--   tukar_faktur
-- Target tables that DO NOT EXIST yet:
--   bnls, purchase_returns
--
-- ====== DESIGN DECISION: ALL 7 HELPERS ARE STUBS IN V1 ======
-- Even for tables that exist, ALL `_apply_<gate>_change` helpers are
-- stubs (RAISE NOTICE + RETURN -1) in this V1 migration.
--
-- Rationale (per task brief escalation clause):
--   * Every existing target table has multiple NOT NULL columns without
--     defaults (po_number, supplier_id, payment_method, pi_number, type,
--     tf_number, tukar_date, payment_due_at, ...). A minimal `{}` payload
--     INSERT would fail with NOT NULL violations.
--   * No Phase 1 frontend caller will invoke these new request_<gate>
--     RPCs — Pembelian flows currently use their own create_* RPCs
--     (kasirService / phase2b record_* etc) that bypass approval entirely
--     (Garindo memory: no approval workflow on Pembelian).
--   * V1.5 will redesign the apply helpers against actual column lists
--     when the new Pembelian approval entry points get wired into the
--     ApprovalRulesPanel UI (Task 14) and an Owner toggles
--     approval_required=TRUE for any of these 7 gates.
--   * Keeping ALL 7 helpers as stubs gives a consistent shape (no mix of
--     real INSERT + stub) and consistent return type (BIGINT -1 sentinel).
--
-- ====== ZERO-REGRESSION GUARANTEE ======
-- Garindo seed (task 2): all 7 gates have approval_required=FALSE.
-- Bypass path is taken → calls stub _apply → RAISE NOTICE + RETURN -1.
-- NO existing flow is affected — these RPCs are NEW entry points with no
-- current callers. Frontend continues to use the legacy direct-INSERT
-- create_purchase_order / record_tagihan / pay_supplier / record_tf paths
-- exactly as before.
--
-- ====== SIGNATURE NOTE (vs Task 7) ======
-- Task 7 helpers take `p_approval_id BIGINT` because they extract from
-- existing commit_* bodies that already read satellite-table rows.
-- Task 8 helpers take `p_payload JSONB` because these are NEW entry
-- points with no pre-existing satellites — the payload IS the source of
-- truth. Both patterns coexist intentionally.
--
-- ====== RETURN TYPE NOTE ======
-- Real target tables use UUID PKs (purchase_orders.id, purchase_invoices.id,
-- pembayaran.id, tukar_faktur.id), but the BIGINT signature is preserved
-- here for symmetry with Task 7 trios and the brief's spec. The -1
-- sentinel from stubs encodes "not implemented". V1.5 will revisit the
-- return type when wiring real INSERTs (likely shifting to UUID or a
-- composite return).

-- ===========================================================================
-- Gate 1: purchase_order_create
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_purchase_order_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'purchase_order_create apply: target table purchase_orders has multiple required columns (po_number, supplier_id, total, ...); real INSERT logic deferred to V1.5 when approval gate is wired into UI. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_purchase_order_create(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_purchase_order_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'purchase_order_create'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_purchase_order_create(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('purchase_order_create', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_purchase_order_create(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'purchase_order_create' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_purchase_order_create(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 2: purchase_order_amend
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_purchase_order_amend(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'purchase_order_amend apply: real UPDATE logic deferred to V1.5 when approval gate is wired into UI. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_purchase_order_amend(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_purchase_order_amend(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'purchase_order_amend'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_purchase_order_amend(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('purchase_order_amend', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_purchase_order_amend(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'purchase_order_amend' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_purchase_order_amend(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 3: tagihan_create  (target table: purchase_invoices)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_tagihan_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'tagihan_create apply: target table purchase_invoices has multiple required columns (pi_number, type, supplier_id, payment_method, ...); real INSERT logic deferred to V1.5 when approval gate is wired into UI. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_tagihan_create(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_tagihan_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'tagihan_create'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_tagihan_create(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('tagihan_create', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_tagihan_create(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'tagihan_create' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_tagihan_create(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 4: supplier_payment  (target table: pembayaran)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_supplier_payment(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'supplier_payment apply: target table pembayaran has multiple required columns (pembayaran_number, supplier_id, payment_method, ...); real INSERT logic deferred to V1.5 when approval gate is wired into UI. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_supplier_payment(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_supplier_payment(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'amount_total', '')::NUMERIC;
  IF v_amount IS NULL THEN
    v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;
  END IF;

  v_decision := public._check_approval_required(
    'supplier_payment'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_supplier_payment(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('supplier_payment', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_supplier_payment(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'supplier_payment' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_supplier_payment(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 5: bnl_create  (no target table yet — pure stub)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_bnl_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'bnl_create apply: BNL feature not yet implemented in V1 — table public.bnls does not exist. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_bnl_create(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_bnl_create(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'bnl_create'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_bnl_create(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('bnl_create', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_bnl_create(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'bnl_create' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_bnl_create(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 6: tukar_faktur  (target table: tukar_faktur)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_tukar_faktur(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'tukar_faktur apply: target table tukar_faktur has multiple required columns (tf_number, supplier_id, tukar_date, payment_due_at, ...); real INSERT logic deferred to V1.5 when approval gate is wired into UI. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_tukar_faktur(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_tukar_faktur(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'tukar_faktur'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_tukar_faktur(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('tukar_faktur', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_tukar_faktur(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'tukar_faktur' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_tukar_faktur(v_ar.payload);
  RETURN v_entity_id;
END $$;

-- ===========================================================================
-- Gate 7: purchase_return  (no target table yet — pure stub)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_purchase_return(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE NOTICE 'purchase_return apply: purchase return feature not yet implemented in V1 — table public.purchase_returns does not exist. Payload received: %', p_payload;
  RETURN -1;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_purchase_return(JSONB)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_purchase_return(
  p_payload JSONB
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_decision    TEXT;
  v_actor_role  TEXT;
  v_amount      NUMERIC;
  v_approval_id BIGINT;
  v_entity_id   BIGINT;
BEGIN
  SELECT role INTO v_actor_role
    FROM public.admin_users
   WHERE id = auth.uid();

  v_amount := NULLIF(p_payload->>'total_amount', '')::NUMERIC;

  v_decision := public._check_approval_required(
    'purchase_return'::approval_request_type,
    v_amount,
    NULL,
    v_actor_role
  );

  IF v_decision = 'bypass' THEN
    v_entity_id := public._apply_purchase_return(p_payload);
    RETURN v_entity_id;
  END IF;

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
       VALUES ('purchase_return', p_payload, auth.uid())
    RETURNING id INTO v_approval_id;

  RETURN v_approval_id;
END $$;

CREATE OR REPLACE FUNCTION public.commit_approved_purchase_return(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar        public.approval_requests;
  v_entity_id BIGINT;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id AND status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval not found or not approved: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'purchase_return' THEN
    RAISE EXCEPTION 'WRONG_TYPE: %', v_ar.request_type;
  END IF;

  v_entity_id := public._apply_purchase_return(v_ar.payload);
  RETURN v_entity_id;
END $$;
