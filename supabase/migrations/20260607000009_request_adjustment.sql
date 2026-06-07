-- Stock Fraud Prevention Phase 2 Task 3: request_adjustment RPC.
--
-- The user-facing entry point for the adjustment approval flow. The frontend
-- (or any client with the `authenticated` role) calls this single function to
-- file an adjustment request; the function atomically creates the
-- approval_requests row (the source of truth) and the satellite
-- stock_adjustments row (the workflow-specific payload). Stock is NOT touched
-- yet — that happens in Task 4's commit_approved_adjustment once an Owner
-- approves the request through WhatsApp or the inbox.
--
-- ACTOR RESOLUTION: p_actor_user_id is honored if supplied (lets the Go
-- backend impersonate during automated flows / tests). Otherwise we fall back
-- to auth.uid() for ordinary SDK calls, and finally to a sentinel system UUID
-- so the NOT NULL requested_by column always has a value rather than the
-- function 500-ing on a missing claim. Subsequent RPCs in this phase use the
-- same COALESCE pattern.
--
-- EVIDENCE VALIDATION: we mirror the chk_evidence_for_loss CHECK constraint
-- defined on stock_adjustments (Task 2 …008) so the RPC produces a friendly
-- RAISE EXCEPTION rather than a raw constraint violation. CRITICAL: use
-- cardinality(arr) not array_length(arr, 1). The latter returns NULL on an
-- empty array, which makes `array_length(...) >= 1` evaluate to NULL and the
-- IF-guard fail OPEN (NULL is not TRUE — the THEN branch is skipped, no error
-- raised, evidence-less rusak/hilang slips through). cardinality returns 0 on
-- an empty array, making the comparison an explicit FALSE.
--
-- NUMBERING: This file is …009, a SEPARATE migration from Task 2's …008,
-- because …008 is already applied to the live DB. Appending DDL to an
-- already-applied migration would not re-run; new objects need their own file.

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
  v_actor    UUID;
  v_approval BIGINT;
  v_payload  JSONB;
BEGIN
  -- Resolve actor: explicit arg → auth.uid() → system sentinel UUID.
  v_actor := COALESCE(
    p_actor_user_id,
    auth.uid(),
    '00000000-0000-0000-0000-000000000000'::uuid
  );

  IF p_qty_delta = 0 THEN
    RAISE EXCEPTION 'qty_delta must be non-zero';
  END IF;

  -- Evidence required for rusak/hilang. cardinality (not array_length) so the
  -- check on an empty array returns 0, an explicit FALSE — not NULL.
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

  RETURN v_approval;
END $$;

GRANT EXECUTE ON FUNCTION public.request_adjustment(
  TEXT, TEXT, INT, public.stock_adjustment_reason, TEXT, TEXT[], UUID
) TO authenticated;
