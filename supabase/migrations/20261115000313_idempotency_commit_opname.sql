-- Migration 313: Add p_idempotency_key to commit_opname.
-- Returns int (count of adjusted rows from _apply_opname_change).
-- New parameter is DEFAULT NULL — fully backward compatible.
-- Existing function body is preserved verbatim from slot 20260622000005.

CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id bigint,
  p_idempotency_key uuid DEFAULT NULL::uuid
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid := public._resolve_tenant_id();
  v_existing  jsonb;
  v_ar        RECORD;
  v_result    int;
BEGIN
  -- ── Idempotency check ──────────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT result_json INTO v_existing
    FROM public.t_rpc_idempotency
    WHERE tenant_id       = v_tenant_id
      AND rpc_name        = 'commit_opname'
      AND idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN
      RETURN (v_existing->>'result')::int;
    END IF;
  END IF;

  -- ── Original body (unchanged from slot 20260622000005) ────────────────────
  SELECT * INTO v_ar FROM public.approval_requests
    WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'approved' THEN
    RAISE EXCEPTION 'approval_request % is not approved (status=%)',
      p_approval_id, v_ar.status;
  END IF;

  v_result := public._apply_opname_change(p_approval_id);

  -- ── Store idempotency result ────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.t_rpc_idempotency (tenant_id, rpc_name, idempotency_key, result_json)
    VALUES (v_tenant_id, 'commit_opname', p_idempotency_key,
            jsonb_build_object('result', v_result))
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_result;
END $function$;

GRANT EXECUTE ON FUNCTION public.commit_opname(bigint, uuid)
  TO authenticated, service_role, vosi_rpc_owner;
