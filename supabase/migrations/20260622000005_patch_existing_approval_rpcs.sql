-- supabase/migrations/20260622000005_patch_existing_approval_rpcs.sql
-- Phase 1 task 7 — patch 8 existing approval RPCs to honor approval_settings.
--
-- SCOPE (reduced from brief's 12 → 8 after BLOCKED discovery):
--   1. request_adjustment                     + commit_approved_adjustment
--   2. submit_opname_for_owner                + commit_opname
--   3. request_price_change                   + commit_approved_price_change
--   4. request_customer_credit_activate       + approve_customer_credit_activate
--   5. request_customer_credit_limit_change   + approve_customer_credit_limit_change
--   6. request_customer_credit_deactivate     + approve_customer_credit_deactivate
--   7. request_tempo_write_off                + approve_tempo_write_off
--   8. request_rakit_lock                     + commit_approved_rakit_lock
--
-- DEFERRED to V1.5 (no server-side request RPC exists yet):
--   - kasir_price_override, kasir_void, kasir_refund (kasir approval feature
--     anticipated but never wired)
--   - initial_stock (frontend INSERTs approval_request directly via
--     supabaseClient.ts; needs RPC wrap)
--   Their approval_settings rows seeded in task 2 stay ready — the helper
--   pre-check works automatically when those features get built.
--
-- DESIGN (after advisor review):
--
-- Each gate gets THREE functions:
--   (a) _apply_<gate>_change(p_approval_id) SECURITY DEFINER, internal helper.
--       Extracted from the existing commit/approve_<gate> body. Reads
--       satellite + AR payload via p_approval_id, performs mutation, returns
--       whatever the existing commit/approve RPC returned. REVOKEd from
--       PUBLIC/anon/authenticated — only sibling RPCs may call it.
--
--   (b) commit/approve_<gate>(...) — thin wrapper. Keeps the existing AR
--       status='approved' verification (and for customer_credit, the
--       verify_owner_pin call which itself transitions). After verification,
--       PERFORM/RETURN _apply_<gate>_change(p_approval_id). Signature +
--       return type EXACTLY preserved — frontend callers unaffected.
--
--   (c) request_<gate>(...) — extended with bypass branch:
--         1. Existing business validation runs FIRST (evidence_urls check,
--            field whitelist, term_days allowed-list, order status check,
--            etc.) — bypass MUST NOT skip these.
--         2. Existing INSERT INTO approval_requests + satellite INSERTs.
--            This satisfies all the NOT NULL FK constraints on satellite
--            tables that point at approval_requests.id.
--         3. Call _check_approval_required(gate_type, amount, qty, actor_role).
--         4. IF decision = 'bypass':
--              PERFORM _transition_approval(v_approval, 'approved', actor,
--                                           'bypass');
--              PERFORM _apply_<gate>_change(v_approval);
--            ELSE: existing PIN/WA/INBOX flow — return approval_id and let
--              the Owner approve through the existing channel.
--         5. RETURN v_approval (always BIGINT, both paths — frontend can
--            pattern-match on AR status if it cares which path fired).
--
-- ZERO REGRESSION: when approval_required=TRUE + verification_method='PIN'
-- (Garindo's seed for the 8 patched gates), behavior is byte-identical to
-- pre-patch: same satellite INSERTs, same AR row shape, same Owner approves
-- via PIN → existing commit/approve_<gate> fires → same mutation. The new
-- _apply_<gate>_change helpers are just a code-organisation refactor — they
-- contain literal copies of what was inside commit/approve_<gate>.
--
-- DECISION_CHANNEL: bypass writes 'bypass' as the channel. The column has
-- no CHECK constraint (the 4 examples in the column comment are advisory),
-- so 'bypass' joins 'owner_pin' | 'wa_button' | 'app_inbox' | 'auto_expire'
-- | 'owner_app_edit' as a valid channel value.
--
-- NUMBERING: 20260622000005, the next free slot after task 4's 000004b in
-- the pengaturan migration sequence.

-- ===========================================================================
-- Gate 1: ADJUSTMENT
-- ===========================================================================
-- Helper: extracted body of commit_approved_adjustment minus the AR
-- 'approved'-status verification (caller guarantees status='approved').

CREATE OR REPLACE FUNCTION public._apply_adjustment_change(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sa          RECORD;
  v_before      INT;
  v_movement_id BIGINT;
BEGIN
  SELECT * INTO v_sa
    FROM public.stock_adjustments
   WHERE approval_request_id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no stock_adjustment for approval_request %', p_approval_id;
  END IF;
  IF v_sa.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'stock_adjustment % already committed', v_sa.id;
  END IF;

  IF v_sa.warehouse_id IS NULL THEN
    RAISE EXCEPTION
      'stock_adjustment % missing warehouse_id (legacy un-backfilled row — jalankan backfill dulu)',
      v_sa.id;
  END IF;

  SELECT qty INTO v_before
    FROM public.stock_levels
   WHERE sku = v_sa.sku
     AND warehouse_id = v_sa.warehouse_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SKU % belum ada di stock_levels untuk warehouse %',
      v_sa.sku, v_sa.warehouse_id;
  END IF;

  IF v_before + v_sa.qty_delta < 0 THEN
    RAISE EXCEPTION
      'adjustment would drive stock negative (before=%, delta=%)',
      v_before, v_sa.qty_delta;
  END IF;

  UPDATE public.stock_levels
     SET qty        = qty + v_sa.qty_delta,
         updated_at = now()
   WHERE sku          = v_sa.sku
     AND warehouse_id = v_sa.warehouse_id;

  v_movement_id := public._log_stock_movement(
    p_sku              => v_sa.sku,
    p_warehouse        => NULL,
    p_qty_delta        => v_sa.qty_delta,
    p_qty_before       => v_before,
    p_source           => 'adjustment'::public.stock_movement_source,
    p_related_doc_type => 'stock_adjustment',
    p_related_doc_id   => v_sa.id::text,
    p_reason_code      => v_sa.reason_code::text,
    p_reason_note      => v_sa.reason_note,
    p_actor_user_id    => v_sa.requested_by,
    p_actor_role       => 'adjustment_commit',
    p_evidence_urls    => v_sa.evidence_urls
  );
  UPDATE public.stock_movements
     SET warehouse_id = v_sa.warehouse_id
   WHERE id = v_movement_id;

  UPDATE public.stock_adjustments
     SET status                = 'approved',
         committed_at          = now(),
         committed_movement_id = v_movement_id
   WHERE id = v_sa.id;

  RETURN v_movement_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_adjustment_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_adjustment_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_adjustment_change(BIGINT) FROM authenticated;

-- commit_approved_adjustment: thin verify + delegate to helper.
CREATE OR REPLACE FUNCTION public.commit_approved_adjustment(
  p_approval_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar RECORD;
BEGIN
  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  RETURN public._apply_adjustment_change(p_approval_id);
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_adjustment(BIGINT) TO authenticated;

-- request_adjustment: existing validation + INSERTs + bypass branch.
CREATE OR REPLACE FUNCTION public.request_adjustment(
  p_sku           TEXT,
  p_warehouse     TEXT,
  p_qty_delta     INT,
  p_reason_code   public.stock_adjustment_reason,
  p_reason_note   TEXT     DEFAULT NULL,
  p_evidence_urls TEXT[]   DEFAULT '{}',
  p_actor_user_id UUID     DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID;
  v_approval   BIGINT;
  v_payload    JSONB;
  v_decision   TEXT;
  v_actor_role TEXT;
BEGIN
  v_actor := COALESCE(
    p_actor_user_id,
    auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  -- Existing business validation — runs BEFORE bypass branch.
  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'qty_delta must be non-zero';
  END IF;

  IF p_reason_code IN ('rusak','hilang')
     AND cardinality(p_evidence_urls) < 1 THEN
    RAISE EXCEPTION 'evidence_urls required for reason_code %', p_reason_code;
  END IF;

  v_payload := jsonb_build_object(
    'sku',           p_sku,
    'warehouse',     p_warehouse,
    'qty_delta',     p_qty_delta,
    'reason_code',   p_reason_code,
    'reason_note',   p_reason_note,
    'evidence_urls', to_jsonb(p_evidence_urls)
  );

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('adjustment'::public.approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO public.stock_adjustments
    (sku, warehouse, qty_delta, reason_code, reason_note,
     evidence_urls, requested_by, approval_request_id)
  VALUES
    (p_sku, p_warehouse, p_qty_delta, p_reason_code, p_reason_note,
     p_evidence_urls, v_actor, v_approval);

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'adjustment'::public.approval_request_type,
    NULL, ABS(p_qty_delta), v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_approval, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_adjustment_change(v_approval);
  END IF;

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_adjustment(
  TEXT, TEXT, INT, public.stock_adjustment_reason, TEXT, TEXT[], UUID
) TO authenticated;

-- ===========================================================================
-- Gate 2: OPNAME
-- ===========================================================================
-- _apply_opname_change extracts the per-row variance loop from commit_opname.

CREATE OR REPLACE FUNCTION public._apply_opname_change(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT    := 0;
  v_movement_id      BIGINT;
  v_qty_before       INT;
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)',
      v_session.id, v_session.status;
  END IF;

  FOR r IN
    SELECT sku, warehouse_id, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id    = v_session.id
       AND counted_qty   IS NOT NULL
       AND variance      <> 0
  LOOP
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION
        'stock_opname_counts row for sku % in session % missing warehouse_id (legacy un-backfilled row)',
        r.sku, v_session.id;
    END IF;

    SELECT qty INTO v_qty_before
      FROM public.stock_levels
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'SKU % belum ada di stock_levels untuk warehouse %',
        r.sku, r.warehouse_id;
    END IF;

    UPDATE public.stock_levels
       SET qty        = qty + r.variance,
           updated_at = now()
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id;

    v_movement_id := public._log_stock_movement(
      p_sku              => r.sku,
      p_warehouse        => NULL,
      p_qty_delta        => r.variance,
      p_qty_before       => r.system_qty_snapshot,
      p_source           => 'opname_variance'::public.stock_movement_source,
      p_related_doc_type => 'opname_session',
      p_related_doc_id   => v_session.id::text,
      p_reason_code      => 'opname',
      p_reason_note      => NULL,
      p_actor_user_id    => v_session.counted_by_user_id,
      p_actor_role       => 'opname_commit',
      p_evidence_urls    => '{}'::text[]
    );
    UPDATE public.stock_movements
       SET warehouse_id = r.warehouse_id
     WHERE id = v_movement_id;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions
     SET status       = 'committed',
         committed_at = now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_opname_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_opname_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_opname_change(BIGINT) FROM authenticated;

-- commit_opname: thin verify + delegate.
CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar RECORD;
BEGIN
  SELECT * INTO v_ar FROM public.approval_requests
    WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  RETURN public._apply_opname_change(p_approval_id);
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname(BIGINT) TO authenticated;

-- submit_opname_for_owner: existing validation + variance check + bypass branch.
-- NOTE: this RPC already has an auto-commit path for zero-variance sessions
-- (calls commit_opname_internal). The new bypass branch handles the
-- variance-present case when approval_required=FALSE: it inserts the AR,
-- transitions to 'approved', calls _apply_opname_change. Return shape
-- mirrors auto-commit (status='committed', auto=TRUE, approval_id=v_approval)
-- so the frontend can treat both bypass paths identically.
CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS TABLE (status TEXT, auto BOOLEAN, approval_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_variance_total  NUMERIC := 0;
  v_approval_id     BIGINT;
  v_row_count       INT;
  v_has_null        BOOLEAN;
  v_has_variance    BOOLEAN;
  v_require_witness BOOLEAN;
  v_decision        TEXT;
  v_actor_role      TEXT;
BEGIN
  v_require_witness := public._opname_require_witness();

  SELECT * INTO v_session FROM stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'opname session % not found', p_session_id;
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  IF p_actor_user_id <> v_session.counted_by_user_id THEN
    RAISE EXCEPTION 'caller % is not the assigned counter for session %',
      p_actor_user_id, p_session_id;
  END IF;

  IF v_require_witness AND v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;

  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts
   WHERE session_id = p_session_id;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opname session % has no rows to count', p_session_id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND counted_qty IS NULL)
    INTO v_has_null;
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND variance <> 0)
    INTO v_has_variance;

  -- Zero-variance auto-commit (pre-existing path, unchanged).
  IF NOT v_has_null AND NOT v_has_variance THEN
    UPDATE stock_opname_sessions
       SET submitted_at = now()
     WHERE id = p_session_id;
    PERFORM public.commit_opname_internal(p_session_id);
    RETURN QUERY SELECT 'committed'::TEXT, TRUE, NULL::BIGINT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(variance_value), 0) INTO v_variance_total
    FROM stock_opname_counts WHERE session_id = p_session_id;

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES (
    'opname',
    jsonb_build_object(
      'session_id',           p_session_id,
      'variance_total_value', v_variance_total,
      'counted_by_user_id',   v_session.counted_by_user_id,
      'witnessed_by_user_id', v_session.witnessed_by_user_id
    ),
    v_session.counted_by_user_id
  )
  RETURNING id INTO v_approval_id;

  UPDATE stock_opname_sessions
     SET status = 'pending_owner',
         submitted_at = now(),
         variance_total_value = v_variance_total,
         approval_request_id = v_approval_id
   WHERE id = p_session_id;

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = p_actor_user_id;
  v_decision := public._check_approval_required(
    'opname'::public.approval_request_type,
    v_variance_total, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_approval_id, 'approved'::public.approval_status,
      p_actor_user_id, 'bypass'
    );
    PERFORM public._apply_opname_change(v_approval_id);
    RETURN QUERY SELECT 'committed'::TEXT, TRUE, v_approval_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'pending_owner'::TEXT, FALSE, v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_opname_for_owner(BIGINT, UUID) TO authenticated;

-- ===========================================================================
-- Gate 3: PRICE_CHANGE
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_price_change(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pcr   RECORD;
  v_actor UUID;
BEGIN
  -- Caller is whoever just got approved (decided_by in AR). Read it from AR
  -- so audit attribution matches PIN path verbatim.
  SELECT decided_by INTO v_actor
    FROM public.approval_requests
   WHERE id = p_approval_id;

  SELECT * INTO v_pcr
    FROM public.price_change_requests
   WHERE approval_request_id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no price_change_request for approval_request %', p_approval_id;
  END IF;
  IF v_pcr.status <> 'pending' THEN
    RAISE EXCEPTION 'price_change_request % already %', v_pcr.id, v_pcr.status;
  END IF;

  EXECUTE format('UPDATE public.stocks SET %I = $1 WHERE sku = $2', v_pcr.field)
    USING v_pcr.new_value, v_pcr.sku;

  INSERT INTO public.stock_price_history
    (sku, field, old_value, new_value, source,
     related_request_id, actor_user_id, actor_role)
  VALUES
    (v_pcr.sku, v_pcr.field, v_pcr.old_value, v_pcr.new_value, 'approval',
     v_pcr.id, v_actor, 'price_change_commit');

  UPDATE public.price_change_requests
     SET status       = 'approved',
         decided_at   = now(),
         decided_by   = v_actor,
         committed_at = now()
   WHERE id = v_pcr.id;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_price_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_price_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_price_change(BIGINT) FROM authenticated;

CREATE OR REPLACE FUNCTION public.commit_approved_price_change(
  p_approval_id   BIGINT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar RECORD;
BEGIN
  -- p_actor_user_id kept for signature compatibility but no longer used —
  -- the helper reads decided_by from the AR row (single source of truth).
  PERFORM p_actor_user_id;  -- explicit no-op to silence unused-param hints

  SELECT * INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  PERFORM public._apply_price_change(p_approval_id);
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_price_change(BIGINT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_price_change(
  p_sku           TEXT,
  p_field         TEXT,
  p_new_value     NUMERIC,
  p_reason_note   TEXT,
  p_actor_user_id UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID;
  v_old        NUMERIC;
  v_approval   BIGINT;
  v_payload    JSONB;
  v_decision   TEXT;
  v_actor_role TEXT;
BEGIN
  v_actor := COALESCE(
    p_actor_user_id,
    auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  IF p_field NOT IN ('price', 'harga_modal') THEN
    RAISE EXCEPTION 'invalid field %, must be price or harga_modal', p_field;
  END IF;

  IF p_new_value < 0 THEN
    RAISE EXCEPTION 'new_value must be >= 0';
  END IF;

  EXECUTE format('SELECT %I FROM public.stocks WHERE sku = $1', p_field)
    INTO v_old USING p_sku;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'sku % not found in stocks', p_sku;
  END IF;

  v_payload := jsonb_build_object(
    'sku',         p_sku,
    'field',       p_field,
    'old_value',   v_old,
    'new_value',   p_new_value,
    'reason_note', p_reason_note
  );

  INSERT INTO public.approval_requests (request_type, payload, requested_by)
  VALUES ('price_change'::public.approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO public.price_change_requests
    (sku, field, old_value, new_value, reason_note,
     approval_request_id, requested_by)
  VALUES
    (p_sku, p_field, v_old, p_new_value, p_reason_note,
     v_approval, v_actor);

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'price_change'::public.approval_request_type,
    p_new_value, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_approval, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_price_change(v_approval);
  END IF;

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_price_change(
  TEXT, TEXT, NUMERIC, TEXT, UUID
) TO authenticated;

-- ===========================================================================
-- Gate 4: CUSTOMER_CREDIT_ACTIVATE
-- ===========================================================================
-- No satellite table for customer_credit_* gates — payload lives in AR.

CREATE OR REPLACE FUNCTION public._apply_customer_credit_activate_change(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload      jsonb;
  v_customer_id  text;
  v_term_days    int;
  v_credit_limit numeric;
  v_owner_id     uuid;
  v_decided_by   uuid;
BEGIN
  SELECT payload, decided_by INTO v_payload, v_decided_by
    FROM public.approval_requests WHERE id = p_approval_id;

  v_customer_id  := v_payload->>'customer_id';
  v_term_days    := (v_payload->>'term_days')::int;
  v_credit_limit := (v_payload->>'credit_limit')::numeric;

  -- Prefer the actual decided_by (matches who approved); fall back to first
  -- active Owner if bypass path hasn't set decided_by yet (shouldn't happen
  -- since _transition_approval always sets it, but defensive).
  v_owner_id := COALESCE(
    v_decided_by,
    (SELECT id FROM public.admin_users
       WHERE role = 'Owner' AND status = 'Aktif' ORDER BY id LIMIT 1)
  );

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo       = true,
         term_days          = v_term_days,
         credit_limit       = v_credit_limit,
         tempo_activated_at = now(),
         tempo_activated_by = v_owner_id
   WHERE id = v_customer_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_activate_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_activate_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_activate_change(BIGINT) FROM authenticated;

-- approve_customer_credit_activate: verify_owner_pin already transitions to
-- 'approved'. After PIN succeeds, delegate to helper.
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
BEGIN
  SELECT request_type, status, payload INTO v_type, v_status, v_payload
    FROM public.approval_requests
    WHERE id = p_request_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_type <> 'customer_credit_activate' THEN
    RAISE EXCEPTION 'wrong_request_type: % (expected customer_credit_activate)', v_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request_not_pending' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._apply_customer_credit_activate_change(p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_activate(bigint, text)
  TO anon, authenticated;

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
  v_tenant     uuid := public._resolve_tenant_id();
  v_allowed    int[];
  v_request_id bigint;
  v_actor      uuid;
  v_decision   TEXT;
  v_actor_role TEXT;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid);

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT term_days_allowed INTO v_allowed
    FROM public.piutang_settings
    WHERE tenant_id = v_tenant;
  IF v_allowed IS NULL THEN
    v_allowed := ARRAY[7, 14, 30, 60, 90];
  END IF;
  IF NOT (p_term_days = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'term_days_not_allowed: % (allowed: %)', p_term_days, v_allowed
      USING ERRCODE = 'P0001';
  END IF;

  IF p_credit_limit <= 0 THEN
    RAISE EXCEPTION 'credit_limit_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND allows_tempo = true) THEN
    RAISE EXCEPTION 'customer_already_activated' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.approval_requests (
    request_type, payload, requested_by
  ) VALUES (
    'customer_credit_activate',
    jsonb_build_object(
      'customer_id',  p_customer_id,
      'term_days',    p_term_days,
      'credit_limit', p_credit_limit,
      'reason',       p_reason
    ),
    v_actor
  )
  RETURNING id INTO v_request_id;

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'customer_credit_activate'::public.approval_request_type,
    p_credit_limit, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_request_id, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_customer_credit_activate_change(v_request_id);
  END IF;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_activate(text, int, numeric, text, uuid)
  TO anon, authenticated;

-- ===========================================================================
-- Gate 5: CUSTOMER_CREDIT_LIMIT_CHANGE
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_customer_credit_limit_change(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload     jsonb;
  v_customer_id text;
  v_new_limit   numeric;
BEGIN
  SELECT payload INTO v_payload
    FROM public.approval_requests WHERE id = p_approval_id;

  v_customer_id := v_payload->>'customer_id';
  v_new_limit   := (v_payload->>'new_limit')::numeric;

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET credit_limit = v_new_limit
   WHERE id = v_customer_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_limit_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_limit_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_limit_change(BIGINT) FROM authenticated;

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

  IF NOT public.verify_owner_pin(p_request_id, p_owner_pin) THEN
    RAISE EXCEPTION 'pin_invalid' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public._apply_customer_credit_limit_change(p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_limit_change(bigint, text)
  TO anon, authenticated;

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
  v_decision   TEXT;
  v_actor_role TEXT;
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

  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'customer_credit_limit_change'::public.approval_request_type,
    p_new_limit, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_request_id, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_customer_credit_limit_change(v_request_id);
  END IF;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_limit_change(text, numeric, text, uuid)
  TO anon, authenticated;

-- ===========================================================================
-- Gate 6: CUSTOMER_CREDIT_DEACTIVATE
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_customer_credit_deactivate_change(
  p_approval_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload     jsonb;
  v_customer_id text;
BEGIN
  SELECT payload INTO v_payload
    FROM public.approval_requests WHERE id = p_approval_id;

  v_customer_id := v_payload->>'customer_id';

  PERFORM 1 FROM public.customers WHERE id = v_customer_id FOR UPDATE;

  UPDATE public.customers
     SET allows_tempo = false
   WHERE id = v_customer_id;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_deactivate_change(BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_deactivate_change(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_customer_credit_deactivate_change(BIGINT) FROM authenticated;

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

  PERFORM public._apply_customer_credit_deactivate_change(p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_customer_credit_deactivate(bigint, text)
  TO anon, authenticated;

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
  v_decision   TEXT;
  v_actor_role TEXT;
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

  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'customer_credit_deactivate'::public.approval_request_type,
    NULL, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_request_id, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_customer_credit_deactivate_change(v_request_id);
  END IF;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_customer_credit_deactivate(text, text, uuid) TO anon, authenticated;

-- ===========================================================================
-- Gate 7: TEMPO_WRITE_OFF (piutang_write_off)
-- ===========================================================================
-- Special: approve_tempo_write_off returns JSONB with race detection. Helper
-- contains only the order UPDATE + audit_log row. The race check + Owner
-- resolution + _transition_approval stay in approve_tempo_write_off.

CREATE OR REPLACE FUNCTION public._apply_tempo_write_off_change(
  p_approval_id BIGINT,
  p_decided_by  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_satellite RECORD;
  v_order     RECORD;
BEGIN
  SELECT * INTO v_satellite FROM public.piutang_write_off_requests
   WHERE approval_id = p_approval_id;
  IF v_satellite.approval_id IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_NOT_FOUND for approval %', p_approval_id;
  END IF;

  SELECT id, status, customer_id, total INTO v_order
    FROM public.orders WHERE id = v_satellite.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', v_satellite.order_id;
  END IF;
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'ORDER_NOT_TEMPO: cannot write off status=%', v_order.status;
  END IF;

  UPDATE public.orders
     SET status           = 'INVOICE_WRITTEN_OFF',
         written_off_at   = now(),
         written_off_by   = p_decided_by,
         write_off_reason = v_satellite.reason
   WHERE id = v_order.id;

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_approved',
    p_decided_by,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id',    v_order.id,
      'customer_id', v_order.customer_id,
      'amount',      v_order.total,
      'reason',      v_satellite.reason
    )
  );
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_tempo_write_off_change(BIGINT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_tempo_write_off_change(BIGINT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_tempo_write_off_change(BIGINT, UUID) FROM authenticated;

-- approve_tempo_write_off: keep race detection + Owner resolution; delegate
-- the mutation to the helper. Race auto-reject path stays inline because it
-- writes a DIFFERENT audit event (tempo_write_off_rejected) and transitions
-- to rejected, not approved.
CREATE OR REPLACE FUNCTION public.approve_tempo_write_off(p_approval_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller    UUID;
  v_admin_id  UUID;
  v_ar        RECORD;
  v_satellite RECORD;
  v_order     RECORD;
BEGIN
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  SELECT * INTO v_ar FROM public.approval_requests
   WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_ar.request_type <> 'piutang_write_off' THEN
    RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_approval_id, v_ar.request_type;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_approval_id, v_ar.status;
  END IF;

  SELECT * INTO v_satellite FROM public.piutang_write_off_requests
   WHERE approval_id = p_approval_id;
  IF v_satellite.approval_id IS NULL THEN
    RAISE EXCEPTION 'SATELLITE_NOT_FOUND for approval %', p_approval_id;
  END IF;

  SELECT id, status, customer_id, total INTO v_order
    FROM public.orders WHERE id = v_satellite.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', v_satellite.order_id;
  END IF;

  -- Race: customer paid between request and approve.
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    PERFORM public._transition_approval(
      p_approval_id, 'rejected'::public.approval_status, v_admin_id,
      'race: order status changed to ' || v_order.status
    );
    INSERT INTO public.audit_log (event_type, actor_user_id, payload)
    VALUES (
      'tempo_write_off_rejected',
      v_caller,
      jsonb_build_object(
        'approval_id',   p_approval_id,
        'order_id',      v_order.id,
        'reject_reason', 'race: order status changed to ' || v_order.status,
        'auto',          true
      )
    );
    RETURN jsonb_build_object(
      'status',           'auto_rejected_race',
      'new_order_status', v_order.status::text
    );
  END IF;

  -- Happy path: transition AR first (so helper's decided_by source-of-truth
  -- read in the AR row is current), then apply via helper.
  PERFORM public._transition_approval(
    p_approval_id, 'approved'::public.approval_status, v_admin_id,
    'piutang_write_off_approve'
  );
  PERFORM public._apply_tempo_write_off_change(p_approval_id, v_admin_id);

  RETURN jsonb_build_object('status', 'approved');
END $$;

GRANT EXECUTE ON FUNCTION public.approve_tempo_write_off(BIGINT) TO authenticated;

-- request_tempo_write_off: existing validation + INSERTs + bypass branch.
-- Note: request RPC already writes a tempo_write_off_requested audit row.
-- The bypass branch additionally fires tempo_write_off_approved via helper.
CREATE OR REPLACE FUNCTION public.request_tempo_write_off(
  p_order_id UUID,
  p_reason   TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller     UUID;
  v_order      RECORD;
  v_approval   BIGINT;
  v_no_expiry  CONSTANT TIMESTAMPTZ := '9999-12-31 23:59:59+00';
  v_decision   TEXT;
  v_actor_role TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT id, status, customer_id, total
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_TEMPO' THEN
    RAISE EXCEPTION 'ORDER_NOT_TEMPO: cannot write off status=%', v_order.status;
  END IF;

  INSERT INTO public.approval_requests
    (request_type, payload, requested_by, expires_at)
  VALUES
    ('piutang_write_off'::public.approval_request_type,
     jsonb_build_object('order_id', p_order_id::text),
     v_caller,
     v_no_expiry)
  RETURNING id INTO v_approval;

  BEGIN
    INSERT INTO public.piutang_write_off_requests
      (approval_id, order_id, reason)
    VALUES (v_approval, p_order_id, btrim(p_reason));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'WRITE_OFF_ALREADY_PENDING: order=%', p_order_id;
  END;

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_requested',
    v_caller,
    jsonb_build_object(
      'approval_id', v_approval,
      'order_id',    p_order_id,
      'customer_id', v_order.customer_id,
      'amount',      v_order.total,
      'reason',      btrim(p_reason)
    )
  );

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_caller;
  v_decision := public._check_approval_required(
    'piutang_write_off'::public.approval_request_type,
    v_order.total, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_approval, 'approved'::public.approval_status, v_caller, 'bypass'
    );
    PERFORM public._apply_tempo_write_off_change(v_approval, v_caller);
  END IF;

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_tempo_write_off(UUID, TEXT) TO authenticated;

-- ===========================================================================
-- Gate 8: RAKIT_LOCK
-- ===========================================================================

CREATE OR REPLACE FUNCTION public._apply_rakit_lock_change(
  p_approval_id    BIGINT,
  p_hpp_overrides  JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ar          RECORD;
  v_rr          RECORD;
  v_tx_id       UUID;
  v_dp          NUMERIC;
  v_total       NUMERIC;
  v_new_status  TEXT;
  v_line        RECORD;
  v_comp        RECORD;
  v_qty_before  INT;
  v_hpp_final   NUMERIC;
BEGIN
  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id;

  SELECT * INTO v_rr FROM rakit_lock_requests WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF v_rr.committed_at IS NOT NULL THEN
    RAISE EXCEPTION '_apply_rakit_lock_change: rakit_lock_request % already committed', v_rr.id;
  END IF;

  v_tx_id := v_rr.transaction_id;

  SELECT COALESCE(dp_amount, 0), total_amount INTO v_dp, v_total
  FROM kasir_transactions WHERE id = v_tx_id FOR UPDATE;

  v_new_status := CASE WHEN v_total - v_dp > 0 THEN 'AWAITING_LUNAS' ELSE 'PAID' END;

  FOR v_line IN SELECT * FROM rakit_job_lines WHERE transaction_id = v_tx_id LOOP
    IF v_line.tracking_mode = 'detail' THEN
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        (SELECT COALESCE(SUM(fifo_cost_snapshot), 0) FROM rakit_components WHERE rakit_line_id = v_line.id)
          + COALESCE(v_line.labor_cost, 0)
      );

      FOR v_comp IN SELECT * FROM rakit_components WHERE rakit_line_id = v_line.id LOOP
        SELECT CASE WHEN v_comp.warehouse = 'atas' THEN stock_atas ELSE stock_bawah END
          INTO v_qty_before
        FROM stocks WHERE sku = v_comp.sku FOR UPDATE;

        IF v_qty_before IS NULL OR v_qty_before < v_comp.qty THEN
          RAISE EXCEPTION '_apply_rakit_lock_change: insufficient stock for SKU % in % (have %, need %)',
                          v_comp.sku, v_comp.warehouse, COALESCE(v_qty_before, 0), v_comp.qty;
        END IF;

        PERFORM public._log_stock_movement(
          p_sku              => v_comp.sku,
          p_warehouse        => v_comp.warehouse,
          p_qty_delta        => -v_comp.qty::INT,
          p_qty_before       => v_qty_before,
          p_source           => 'rakit_usage'::stock_movement_source,
          p_related_doc_type => 'rakit_lock_request',
          p_related_doc_id   => v_rr.id::TEXT,
          p_reason_code      => NULL,
          p_reason_note      => 'Pemakaian rakit ' || v_line.description,
          p_actor_user_id    => v_ar.decided_by,
          p_actor_role       => 'owner',
          p_evidence_urls    => NULL
        );

        UPDATE stocks
        SET stock_atas  = CASE WHEN v_comp.warehouse = 'atas'  THEN stock_atas  - v_comp.qty ELSE stock_atas  END,
            stock_bawah = CASE WHEN v_comp.warehouse = 'bawah' THEN stock_bawah - v_comp.qty ELSE stock_bawah END
        WHERE sku = v_comp.sku;
      END LOOP;

      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;

    ELSE
      v_hpp_final := COALESCE(
        (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC,
        v_line.lump_sum_hpp
      );
      UPDATE rakit_job_lines
      SET hpp_final          = v_hpp_final,
          hpp_owner_override = (p_hpp_overrides->>v_line.id::TEXT)::NUMERIC
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  UPDATE rakit_lock_requests SET status = 'approved', committed_at = now() WHERE id = v_rr.id;
  UPDATE kasir_transactions  SET status = v_new_status WHERE id = v_tx_id;

  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3h'
   WHERE id = v_tx_id;

  -- Audit (skip when owner_app_edit channel — approve_and_amend already wrote
  -- a rakit_lock_approved_with_edit row).
  IF v_ar.decision_channel IS DISTINCT FROM 'owner_app_edit' THEN
    INSERT INTO public.audit_log(event_type, actor_user_id, payload)
    VALUES (
      'rakit_lock_approved',
      v_ar.decided_by,
      jsonb_build_object(
        'approval_id',      p_approval_id,
        'order_id',         v_tx_id,
        'decision_channel', v_ar.decision_channel
      )
    );
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public._apply_rakit_lock_change(BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._apply_rakit_lock_change(BIGINT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public._apply_rakit_lock_change(BIGINT, JSONB) FROM authenticated;

CREATE OR REPLACE FUNCTION public.commit_approved_rakit_lock(
  p_approval_id    BIGINT,
  p_hpp_overrides  JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_ar RECORD;
BEGIN
  SELECT * INTO v_ar FROM approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF v_ar.status != 'approved' THEN
    RAISE EXCEPTION 'commit_approved_rakit_lock: approval % is in status %, expected approved', p_approval_id, v_ar.status;
  END IF;

  PERFORM public._apply_rakit_lock_change(p_approval_id, p_hpp_overrides);
END $$;

GRANT EXECUTE ON FUNCTION public.commit_approved_rakit_lock(BIGINT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_rakit_lock(
  p_transaction_id  UUID,
  p_lines           JSONB,
  p_actor_user_id   UUID DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor      UUID;
  v_status     TEXT;
  v_approval   BIGINT;
  v_lock_req   BIGINT;
  v_payload    JSONB;
  v_line       JSONB;
  v_line_id    UUID;
  v_comp       JSONB;
  v_decision   TEXT;
  v_actor_role TEXT;
  v_total      NUMERIC;
BEGIN
  v_actor := COALESCE(p_actor_user_id, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  SELECT status INTO v_status FROM kasir_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_status != 'WIP' THEN
    RAISE EXCEPTION 'request_rakit_lock: transaction % is in status %, expected WIP', p_transaction_id, v_status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_line->>'id')::UUID;
    UPDATE rakit_job_lines
    SET final_price   = (v_line->>'final_price')::NUMERIC,
        tracking_mode = v_line->>'tracking_mode',
        labor_cost    = COALESCE((v_line->>'labor_cost')::NUMERIC, 0),
        lump_sum_hpp  = COALESCE((v_line->>'lump_sum_hpp')::NUMERIC, 0),
        updated_at    = now()
    WHERE id = v_line_id AND transaction_id = p_transaction_id;

    DELETE FROM rakit_components WHERE rakit_line_id = v_line_id;
    IF v_line ? 'components' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_line->'components') LOOP
        INSERT INTO rakit_components (rakit_line_id, sku, name, qty, warehouse, fifo_cost_snapshot)
        VALUES (v_line_id, v_comp->>'sku', v_comp->>'name',
                (v_comp->>'qty')::NUMERIC,
                COALESCE(v_comp->>'warehouse', 'atas'),
                COALESCE((v_comp->>'fifo_cost')::NUMERIC, 0));
      END LOOP;
    END IF;
  END LOOP;

  v_payload := jsonb_build_object(
    'transaction_id', p_transaction_id::text,
    'lines_count',    jsonb_array_length(p_lines)
  );

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES ('rakit_lock'::approval_request_type, v_payload, v_actor)
  RETURNING id INTO v_approval;

  INSERT INTO rakit_lock_requests
    (transaction_id, approval_request_id, lines_snapshot, requested_by)
  VALUES (p_transaction_id, v_approval, p_lines, v_actor)
  RETURNING id INTO v_lock_req;

  UPDATE kasir_transactions SET status = 'PENDING_LOCK_APPROVAL' WHERE id = p_transaction_id;

  UPDATE public.kasir_transactions
     SET funnel_sub_stage = '3g'
   WHERE id = p_transaction_id;

  INSERT INTO public.audit_log(event_type, actor_user_id, payload)
  VALUES (
    'rakit_lock_requested',
    v_actor,
    jsonb_build_object(
      'approval_id',     v_approval,
      'order_id',        p_transaction_id,
      'admin_submitted', p_lines
    )
  );

  -- Pre-check approval_settings — bypass routes to helper directly.
  SELECT total_amount INTO v_total FROM kasir_transactions WHERE id = p_transaction_id;
  SELECT role INTO v_actor_role FROM public.admin_users WHERE id = v_actor;
  v_decision := public._check_approval_required(
    'rakit_lock'::public.approval_request_type,
    v_total, NULL, v_actor_role
  );

  IF v_decision = 'bypass' THEN
    PERFORM public._transition_approval(
      v_approval, 'approved'::public.approval_status, v_actor, 'bypass'
    );
    PERFORM public._apply_rakit_lock_change(v_approval, '{}'::jsonb);
  END IF;

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_rakit_lock(UUID, JSONB, UUID) TO authenticated;

-- ===========================================================================
-- Done. 8 gates patched. 24 functions total (3 per gate: helper + commit + request).
-- ===========================================================================
