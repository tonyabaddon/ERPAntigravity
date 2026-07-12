-- Migration: upsert_approval_settings — expose all 7 knobs per gate
-- (Item #4 rev 2, slot 113)
--
-- Enables Pengaturan → Aturan Persetujuan UI to save full config per
-- request_type instead of just the approval_required toggle + threshold_amount.
--
-- Rejects verification_method='WA_BUTTON' per project memory
-- feedback_no_wa_owner_approval (only PIN + APP_INBOX + NONE supported
-- for internal owner approval).

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
  IF v_user_id IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

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
REVOKE ALL ON FUNCTION public.upsert_approval_settings(TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_approval_settings(TEXT, BOOLEAN, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, BOOLEAN, BOOLEAN)
  TO authenticated;
