-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000203 — CP3 defense-in-depth: reject 2d→3a for DP orders + reject
-- stage-4/5 for DP orders that haven't verified pelunasan.
--
-- Context: 20261115000201 added adjacency validation, closing the *direct*
-- 3d/3h→4a hole. But the client (`quickActionMap`) was still hardcoding
-- 2d→3a on Verify regardless of payment_type, so DP-only orders bypassed the
-- 3d holding state entirely and landed in 3a→4a via a "legal" path. Client
-- fix landed in same PR; this migration is the server-side belt-and-braces:
-- the client can be buggy again and DP funds still won't ship goods before
-- pelunasan is cleared.
--
-- Rules enforced by this migration:
--   1. 2d → 3a rejected when payment_type='DP'  (should be 3d/3f)
--   2. → 4a / 4b rejected when payment_type='DP' and lunas_payment_method IS NULL
--      (DP orders must clear 3b pelunasan verify first, which sets
--      lunas_payment_method)
--
-- Rules NOT enforced here (intentional):
--   - TEMPO orders (piutang) can reach stage 4/5 without full payment because
--     tempo is deferred-payment by design. Piutang module tracks their AR.
--   - CUSTOM_PANEL / RAKIT_PANEL Verify → 3f is a legal DP path.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.transition_order_stage(
  p_order_id uuid,
  p_from_sub_stage text,
  p_to_sub_stage text,
  p_expected_version integer,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_version int;
  v_current_sub_stage text;
  v_new_stage smallint;
  v_actor uuid := public._current_user_id();
  v_valid boolean;
  v_payment_type text;
  v_lunas_method text;
BEGIN
  PERFORM public._guard_expiry_write();

  -- Adjacency guard (from 20261115000201). Whitelist reject.
  SELECT EXISTS(
    SELECT 1 FROM sales_funnel_transitions
    WHERE from_sub_stage = p_from_sub_stage
      AND to_sub_stage   = p_to_sub_stage
  ) INTO v_valid;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_TRANSITION',
      'from_sub_stage', p_from_sub_stage,
      'to_sub_stage',   p_to_sub_stage
    );
  END IF;

  SELECT version, funnel_sub_stage, payment_type, lunas_payment_method::text
    INTO v_current_version, v_current_sub_stage, v_payment_type, v_lunas_method
  FROM kasir_transactions
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_current_version IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF v_current_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'current_version', v_current_version);
  END IF;

  IF v_current_sub_stage != p_from_sub_stage THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAGE_MISMATCH', 'current_sub_stage', v_current_sub_stage);
  END IF;

  -- Payment-type guard #1: DP orders cannot go 2d→3a. Verify should route
  -- them to 3d (KOMPONEN) or 3f (workshop) to sit in "tunggu pelunasan".
  IF v_payment_type = 'DP' AND p_from_sub_stage = '2d' AND p_to_sub_stage = '3a' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PAYMENT_TYPE_MISMATCH',
      'reason', 'DP orders must verify to 3d/3f (tunggu pelunasan), not 3a'
    );
  END IF;

  -- Payment-type guard #2: DP orders cannot reach stage 4 without pelunasan
  -- being cleared. lunas_payment_method is set by mark_pi_paid / equivalent
  -- when the pelunasan bukti is verified at 3b→3c. If it's still NULL when
  -- someone tries to move to 4a/4b, block. TEMPO orders explicitly exempt
  -- (piutang path). 4d is not covered here — resolving a delivery problem
  -- back to 4a assumes shipment already left, no re-guard needed.
  IF v_payment_type = 'DP'
     AND p_to_sub_stage IN ('4a', '4b')
     AND v_lunas_method IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INCOMPLETE_PAYMENT',
      'reason', 'DP pelunasan belum diverifikasi. Selesaikan 3b Verify Pelunasan dulu.',
      'payment_type', v_payment_type
    );
  END IF;

  v_new_stage := CAST(SUBSTRING(p_to_sub_stage FROM '^[0-9]+') AS smallint);

  UPDATE kasir_transactions
  SET
    funnel_sub_stage = p_to_sub_stage,
    funnel_stage     = v_new_stage,
    version          = version + 1,
    wip_started_at   = CASE
      WHEN p_to_sub_stage IN ('3a', '3f') AND wip_started_at IS NULL THEN NOW()
      ELSE wip_started_at
    END
  WHERE id = p_order_id;

  INSERT INTO audit_log(event_type, actor_user_id, payload)
  VALUES (
    'stage_transition',
    v_actor,
    jsonb_build_object(
      'order_id',       p_order_id,
      'from_sub_stage', p_from_sub_stage,
      'to_sub_stage',   p_to_sub_stage,
      'reason',         p_reason
    )
  );

  RETURN jsonb_build_object(
    'ok',            true,
    'new_version',   v_current_version + 1,
    'new_sub_stage', p_to_sub_stage
  );
END;
$function$;

COMMIT;
