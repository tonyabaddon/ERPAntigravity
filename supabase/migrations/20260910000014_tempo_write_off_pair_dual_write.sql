-- 20260910000014 — Slice D: tempo write-off pair (approve + revert) with
-- soft-fail GL dual-write.
--
-- approve_tempo_write_off books:  D 5-3100 Kerugian Piutang
--                                 K 1-1400 Piutang Usaha
--                                 (amount = order.total, the written-off AR)
--
-- revert_tempo_write_off books:   D 1-1400 Piutang Usaha
--                                 K 5-3100 Kerugian Piutang
--                                 (manually composed — _post_journal_entry.p_reverses_entry_id
--                                  only links reversed_by_entry_id and does NOT auto-swap D/C)
--
-- source_ref_table = 'orders', source_ref_id = order UUID (NOT approval_requests.id, which is
-- BIGINT and cannot be stored in journal_entries.source_ref_id UUID column).
-- Idempotency for D1: uq_je_source_unique partial index on
--   (source_type, source_ref_table, source_ref_id) WHERE reverses_entry_id IS NULL
-- prevents double-post if approve is called twice.
--
-- Design spec: docs/superpowers/specs/2026-07-02-sales-side-dual-write-close-design.md §3.6, §3.7
-- Rollback: DELETE FROM journal_entries WHERE source_type IN
--   ('TEMPO_WRITEOFF','TEMPO_WRITEOFF_REVERT') — safe (first-writer, no legacy).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (approve_tempo_write_off from 20260626000022):
--
-- CREATE OR REPLACE FUNCTION public.approve_tempo_write_off(p_approval_id BIGINT)
-- RETURNS JSONB
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path = public AS $$
-- DECLARE
--   v_caller   UUID;
--   v_admin_id UUID;
--   v_ar       RECORD;
--   v_satellite RECORD;
--   v_order    RECORD;
-- BEGIN
--   SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();
--
--   SELECT * INTO v_ar FROM public.approval_requests
--    WHERE id = p_approval_id FOR UPDATE;
--   IF v_ar.id IS NULL THEN
--     RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
--   END IF;
--   IF v_ar.request_type <> 'piutang_write_off' THEN
--     RAISE EXCEPTION 'WRONG_TYPE: id=% type=%', p_approval_id, v_ar.request_type;
--   END IF;
--   IF v_ar.status <> 'pending' THEN
--     RAISE EXCEPTION 'APPROVAL_NOT_PENDING: id=% status=%', p_approval_id, v_ar.status;
--   END IF;
--
--   SELECT * INTO v_satellite FROM public.piutang_write_off_requests
--    WHERE approval_id = p_approval_id;
--   IF v_satellite.approval_id IS NULL THEN
--     RAISE EXCEPTION 'SATELLITE_NOT_FOUND for approval %', p_approval_id;
--   END IF;
--
--   SELECT id, status, customer_id, total INTO v_order
--     FROM public.orders WHERE id = v_satellite.order_id FOR UPDATE;
--   IF v_order.id IS NULL THEN
--     RAISE EXCEPTION 'ORDER_NOT_FOUND: %', v_satellite.order_id;
--   END IF;
--
--   IF v_order.status <> 'INVOICE_TEMPO' THEN
--     PERFORM public._transition_approval(
--       p_approval_id, 'rejected'::public.approval_status, v_admin_id,
--       'race: order status changed to ' || v_order.status
--     );
--     INSERT INTO public.audit_log (event_type, actor_user_id, payload)
--     VALUES (
--       'tempo_write_off_rejected', v_caller,
--       jsonb_build_object('approval_id', p_approval_id, 'order_id', v_order.id,
--         'reject_reason', 'race: order status changed to ' || v_order.status, 'auto', true)
--     );
--     RETURN jsonb_build_object('status', 'auto_rejected_race', 'new_order_status', v_order.status::text);
--   END IF;
--
--   UPDATE public.orders
--      SET status = 'INVOICE_WRITTEN_OFF', written_off_at = now(),
--          written_off_by = v_admin_id, write_off_reason = v_satellite.reason
--    WHERE id = v_order.id;
--
--   PERFORM public._transition_approval(
--     p_approval_id, 'approved'::public.approval_status, v_admin_id, 'piutang_write_off_approve'
--   );
--
--   INSERT INTO public.audit_log (event_type, actor_user_id, payload)
--   VALUES (
--     'tempo_write_off_approved', v_caller,
--     jsonb_build_object('approval_id', p_approval_id, 'order_id', v_order.id,
--       'customer_id', v_order.customer_id, 'amount', v_order.total, 'reason', v_satellite.reason)
--   );
--
--   RETURN jsonb_build_object('status', 'approved');
-- END $$;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED ORIGINAL BODY (revert_tempo_write_off from 20260626000023):
--
-- CREATE OR REPLACE FUNCTION public.revert_tempo_write_off(p_order_id UUID)
-- RETURNS VOID
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path = public AS $$
-- DECLARE
--   v_caller   UUID;
--   v_admin_id UUID;
--   v_order    RECORD;
-- BEGIN
--   SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();
--
--   SELECT id, status, written_off_at, written_off_by, write_off_reason
--     INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
--   IF v_order.id IS NULL THEN
--     RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
--   END IF;
--   IF v_order.status <> 'INVOICE_WRITTEN_OFF' THEN
--     RAISE EXCEPTION 'NOT_WRITTEN_OFF: status=%', v_order.status;
--   END IF;
--
--   INSERT INTO public.audit_log (event_type, actor_user_id, payload)
--   VALUES (
--     'tempo_write_off_reverted', v_caller,
--     jsonb_build_object('order_id', v_order.id, 'previous_written_off_at', v_order.written_off_at,
--       'previous_written_off_by', v_order.written_off_by, 'previous_reason', v_order.write_off_reason)
--   );
--
--   UPDATE public.orders
--      SET status = 'INVOICE_TEMPO', written_off_at = NULL,
--          written_off_by = NULL, write_off_reason = NULL
--    WHERE id = p_order_id;
-- END $$;
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── D1: approve_tempo_write_off with dual-write ──────────────────────────────
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
  -- dual-write locals
  v_dual_write_enabled boolean;
  v_je_lines           jsonb;
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

  -- Race: customer paid between request and approve. Atomically auto-reject
  -- + return a status code; DO NOT raise — raising would roll back the
  -- auto-reject (PL/pgSQL subtransaction semantics).
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
        'approval_id', p_approval_id,
        'order_id', v_order.id,
        'reject_reason', 'race: order status changed to ' || v_order.status,
        'auto', true
      )
    );
    RETURN jsonb_build_object(
      'status', 'auto_rejected_race',
      'new_order_status', v_order.status::text
    );
  END IF;

  UPDATE public.orders
     SET status = 'INVOICE_WRITTEN_OFF',
         written_off_at = now(),
         written_off_by = v_admin_id,
         write_off_reason = v_satellite.reason
   WHERE id = v_order.id;

  PERFORM public._transition_approval(
    p_approval_id, 'approved'::public.approval_status, v_admin_id,
    'piutang_write_off_approve'
  );

  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_approved',
    v_caller,
    jsonb_build_object(
      'approval_id', p_approval_id,
      'order_id', v_order.id,
      'customer_id', v_order.customer_id,
      'amount', v_order.total,
      'reason', v_satellite.reason
    )
  );

  -- ── GL dual-write (soft-fail) ────────────────────────────────────────────
  -- Only write JE when order.total > 0 (zero-value orders: no GL impact).
  -- source_ref_id = order UUID (NOT approval_requests.id which is BIGINT;
  -- journal_entries.source_ref_id is UUID — BIGINT cannot be cast).
  -- Idempotency: uq_je_source_unique prevents double-post if called twice.
  IF v_order.total > 0 THEN
    SELECT COALESCE(enable_dual_write_to_gl, false)
      INTO v_dual_write_enabled
    FROM public.accounting_config LIMIT 1;

    IF v_dual_write_enabled THEN
      BEGIN
        v_je_lines := jsonb_build_array(
          jsonb_build_object(
            'account_code', '5-3100',
            'side',         'DEBIT',
            'amount',       v_order.total,
            'description',  'Kerugian Piutang tak tertagih (write-off)'
          ),
          jsonb_build_object(
            'account_code', '1-1400',
            'side',         'CREDIT',
            'amount',       v_order.total,
            'description',  'Hapus Piutang Usaha order ' || v_order.id::text
          )
        );
        PERFORM public._post_journal_entry(
          p_entry_date       := CURRENT_DATE,
          p_source_type      := 'TEMPO_WRITEOFF'::public.journal_entry_source,
          p_description      := 'Tempo Write-Off approved (approval ' || p_approval_id::text || ')',
          p_lines            := v_je_lines,
          p_source_ref_table := 'orders',
          p_source_ref_id    := v_order.id
        );
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'approve_tempo_write_off', 'orders', v_order.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'GL dual-write failed for approve_tempo_write_off order=%: [%] %',
          v_order.id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;
  -- ── end GL dual-write ────────────────────────────────────────────────────

  RETURN jsonb_build_object('status', 'approved');
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_tempo_write_off(BIGINT) TO authenticated;

-- ── D2: revert_tempo_write_off with manual reversal ─────────────────────────
CREATE OR REPLACE FUNCTION public.revert_tempo_write_off(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_admin_id UUID;
  v_order    RECORD;
  -- dual-write locals
  v_orig_entry_id     uuid;
  v_orig_entry_number text;
  v_dual_write_enabled boolean;
  v_je_lines          jsonb;
BEGIN
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  SELECT id, status, written_off_at, written_off_by, write_off_reason, total
    INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_WRITTEN_OFF' THEN
    RAISE EXCEPTION 'NOT_WRITTEN_OFF: status=%', v_order.status;
  END IF;

  -- Capture previous values for audit forensics
  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_reverted',
    v_caller,
    jsonb_build_object(
      'order_id', v_order.id,
      'previous_written_off_at', v_order.written_off_at,
      'previous_written_off_by', v_order.written_off_by,
      'previous_reason', v_order.write_off_reason
    )
  );

  UPDATE public.orders
     SET status = 'INVOICE_TEMPO',
         written_off_at = NULL,
         written_off_by = NULL,
         write_off_reason = NULL
   WHERE id = p_order_id;

  -- ── GL dual-write reversal (soft-fail) ──────────────────────────────────
  -- Find the original TEMPO_WRITEOFF entry for this order (must not yet be
  -- reversed — reversed_by_entry_id IS NULL guard).
  -- Manual D/C swap: _post_journal_entry.p_reverses_entry_id only links
  -- reversed_by_entry_id; it does NOT auto-swap the lines. We compose the
  -- reversed JE manually with sides flipped.
  SELECT id, entry_number
    INTO v_orig_entry_id, v_orig_entry_number
  FROM public.journal_entries
  WHERE source_ref_table     = 'orders'
    AND source_ref_id        = p_order_id
    AND source_type          = 'TEMPO_WRITEOFF'
    AND reversed_by_entry_id IS NULL
  LIMIT 1;

  IF v_orig_entry_id IS NOT NULL THEN
    SELECT COALESCE(enable_dual_write_to_gl, false)
      INTO v_dual_write_enabled
    FROM public.accounting_config LIMIT 1;

    IF v_dual_write_enabled THEN
      BEGIN
        v_je_lines := jsonb_build_array(
          jsonb_build_object(
            'account_code', '1-1400',
            'side',         'DEBIT',
            'amount',       v_order.total,
            'description',  'Revert write-off — restore AR ' || p_order_id::text
          ),
          jsonb_build_object(
            'account_code', '5-3100',
            'side',         'CREDIT',
            'amount',       v_order.total,
            'description',  'Revert Kerugian Piutang ' || v_orig_entry_number
          )
        );
        PERFORM public._post_journal_entry(
          p_entry_date        := CURRENT_DATE,
          p_source_type       := 'TEMPO_WRITEOFF_REVERT'::public.journal_entry_source,
          p_description       := 'Revert write-off ' || v_orig_entry_number,
          p_lines             := v_je_lines,
          p_source_ref_table  := 'orders',
          p_source_ref_id     := p_order_id,
          p_reverses_entry_id := v_orig_entry_id
        );
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          'revert_tempo_write_off', 'orders', p_order_id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'GL dual-write failed for revert_tempo_write_off order=%: [%] %',
          p_order_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END IF;
  -- ── end GL dual-write ────────────────────────────────────────────────────
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_tempo_write_off(UUID) TO authenticated;

COMMIT;
