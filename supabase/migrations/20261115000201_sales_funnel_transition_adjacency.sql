-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000201 — Add adjacency guard to transition_order_stage so the sales
-- funnel state machine is enforced server-side.
--
-- Before this migration: transition_order_stage RPC took (from, to) params and
-- blindly updated as long as version + current sub_stage matched. Client
-- controlled the target sub_stage with no server-side veto. Consequence:
--   1. Bug 3 (founder QA 2026-07-12): DP-only orders visible in "Dikirim"
--      funnel. Root cause = any code path could jump 3d/3h → 4a/4b without
--      going through the pelunasan-verify step at 3b, so goods could be
--      "shipped" before the customer paid the balance.
--   2. Silent client bugs (e.g. wrong toSubStage in reject handlers) went
--      unnoticed because the DB accepted anything.
--
-- Fix: whitelist legal transitions in a reference table
-- `sales_funnel_transitions`, and reject anything else with
-- {ok: false, code: 'INVALID_TRANSITION'}.
--
-- Non-goals for this migration:
--   - Payment-amount check (requires_lunas / requires_dp columns are here for
--     the follow-up but not enforced yet). That needs a paid-amount source
--     of truth per order (payments/invoices per order) which isn't scoped
--     for this pass.
--   - Role-based transition permissions (some transitions should be
--     Owner-only). Deferred.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1) Adjacency reference table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales_funnel_transitions (
  from_sub_stage      text    NOT NULL,
  to_sub_stage        text    NOT NULL,
  requires_lunas      boolean NOT NULL DEFAULT false,
  requires_dp         boolean NOT NULL DEFAULT false,
  note                text,
  PRIMARY KEY (from_sub_stage, to_sub_stage)
);

COMMENT ON TABLE public.sales_funnel_transitions IS
  'Whitelist of legal (from, to) sub-stage transitions. Consumed by transition_order_stage guard. Any pair not in this table is rejected as INVALID_TRANSITION.';

-- Read-only reference for authenticated + rpc-owner (SECDEF caller).
ALTER TABLE public.sales_funnel_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sft_read_all ON public.sales_funnel_transitions;
CREATE POLICY sft_read_all ON public.sales_funnel_transitions
  FOR SELECT TO authenticated, vosi_rpc_owner USING (true);
GRANT SELECT ON public.sales_funnel_transitions TO authenticated, vosi_rpc_owner;

-- ─── 2) Seed legal transitions ───────────────────────────────────────────────
-- Match SUB_STAGES from src/lib/sales/stageMapping.ts. This encodes the spec
-- funnel: (1) AI intake → (2) confirmasi+bayar → (3) diproses → (4) dikirim →
-- (5) diterima. Stage 6 = dibatalkan. Rejection recovery loops back to the
-- prior stage's verify step.
INSERT INTO public.sales_funnel_transitions (from_sub_stage, to_sub_stage, note) VALUES
  -- Stage 1 (AI intake) → Stage 2
  ('1a', '2a', 'AI handed off to admin, waiting for customer confirm'),
  ('1a', '2b', 'AI collected all info, needs admin approval directly'),
  -- Stage 2 forward path
  ('2a', '2b', 'customer confirmed items, needs admin approval'),
  ('2b', '2c', 'admin approved order, waiting for customer to pay'),
  ('2c', '2d', 'customer uploaded bukti transfer, needs admin verify'),
  -- Stage 2 verify → Stage 3 branches
  ('2d', '3a', 'admin verified full payment (KOMPONEN normal path)'),
  ('2d', '3d', 'admin verified DP only (KOMPONEN, tunggu pelunasan)'),
  ('2d', '3f', 'admin verified DP for CP/RP — fabrication starts'),
  ('2d', '2e', 'admin rejected bukti transfer'),
  -- Reject recovery
  ('2e', '2d', 'customer re-uploaded bukti transfer'),
  ('3e', '3b', 'customer re-uploaded pelunasan bukti'),
  -- Stage 3 to 4 — KOMPONEN full-payment path
  ('3a', '4a', 'barang siap, delivery'),
  ('3a', '4b', 'barang siap, pickup'),
  -- Stage 3 pelunasan verify → 3c → 4
  ('3b', '3c', 'admin verified pelunasan bukti'),
  ('3b', '3e', 'admin rejected pelunasan bukti'),
  ('3c', '4a', 'barang siap post-pelunasan, delivery'),
  ('3c', '4b', 'barang siap post-pelunasan, pickup'),
  -- DP-only path: 3d (KOMPONEN) / 3h (CP/RP) MUST go through 3b for
  -- pelunasan verify BEFORE reaching 4a/4b. This is Bug 3's guard.
  ('3d', '3b', 'customer uploaded pelunasan bukti'),
  ('3h', '3b', 'customer uploaded pelunasan bukti'),
  -- CP/RP fabrication + owner biaya-final loop
  ('3f', '3g', 'admin submitted biaya final to Owner'),
  ('3g', '3h', 'Owner approved biaya final — waiting for pelunasan'),
  ('3g', '3f', 'Owner rejected biaya final — back to work'),
  -- Stage 4 → 5
  ('4a', '5a', 'customer received delivery'),
  ('4b', '5a', 'customer picked up at store'),
  -- Delivery problem loop
  ('4a', '4d', 'delivery problem reported'),
  ('4b', '4d', 'pickup problem reported'),
  ('4d', '4a', 'resolved, resume delivery'),
  ('4d', '5a', 'resolved as received (customer confirmed)')
ON CONFLICT (from_sub_stage, to_sub_stage) DO NOTHING;

-- Cancel is legal from any non-terminal state → 6a (Dibatalkan Customer).
-- 5a is terminal (already received); 6a/6b are terminal (already cancelled).
INSERT INTO public.sales_funnel_transitions (from_sub_stage, to_sub_stage, note)
SELECT s, '6a', 'admin cancelled — customer batal'
FROM (VALUES
  ('1a'),('2a'),('2b'),('2c'),('2d'),('2e'),
  ('3a'),('3b'),('3c'),('3d'),('3e'),('3f'),('3g'),('3h'),
  ('4a'),('4b'),('4d')
) AS t(s)
ON CONFLICT (from_sub_stage, to_sub_stage) DO NOTHING;

-- Final-reject terminal — after re-upload attempts exhaust, admin can
-- terminally reject the payment. Distinct from cancel-by-customer.
INSERT INTO public.sales_funnel_transitions (from_sub_stage, to_sub_stage, note) VALUES
  ('2e', '6b', 'admin final reject after re-upload attempts'),
  ('3e', '6b', 'admin final reject on pelunasan after re-upload attempts')
ON CONFLICT (from_sub_stage, to_sub_stage) DO NOTHING;

-- ─── 3) Patch transition_order_stage RPC to enforce adjacency ────────────────
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
BEGIN
  PERFORM public._guard_expiry_write();

  -- Adjacency guard (Bug 3 fix): reject unknown (from, to) pairs so a buggy
  -- or malicious client can't jump e.g. 3d (DP done, tunggu pelunasan)
  -- straight to 4a (Dikirim), which would ship goods before the customer
  -- paid the balance. Whitelist lives in sales_funnel_transitions.
  --
  -- Return the code + attempted (from, to) so the client can surface a
  -- meaningful message and QA can spot buggy call sites.
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

  SELECT version, funnel_sub_stage
    INTO v_current_version, v_current_sub_stage
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
