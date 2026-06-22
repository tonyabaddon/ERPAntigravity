-- supabase/migrations/20260622000001_approval_settings_table.sql
-- Phase 1: Pengaturan MSME Configurability — approval_settings table + helper.
-- See docs/superpowers/specs/2026-06-21-pengaturan-msme-configurability-design.md section 3.2.

CREATE TABLE public.approval_settings (
  id                       BIGSERIAL PRIMARY KEY,
  tenant_id                UUID,
  request_type             public.approval_request_type NOT NULL,
  approval_required        BOOLEAN NOT NULL DEFAULT TRUE,
  verification_method      TEXT NOT NULL DEFAULT 'PIN'
                           CHECK (verification_method IN ('NONE', 'PIN', 'WA_BUTTON', 'APP_INBOX')),
  threshold_amount         NUMERIC(18,2),
  threshold_qty            INTEGER,
  threshold_percent        NUMERIC(5,2),
  approver_role            TEXT NOT NULL DEFAULT 'Owner',
  requestor_bypass_self    BOOLEAN NOT NULL DEFAULT FALSE,
  reason_required          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               UUID,
  UNIQUE (tenant_id, request_type)
);

CREATE INDEX idx_approval_settings_type ON public.approval_settings(request_type);

GRANT SELECT ON public.approval_settings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.approval_settings FROM PUBLIC, anon, authenticated;

-- Helper: pre-check returning verification flow decision.
-- Returns 'bypass' = auto-pass (no approval needed)
--        'pin' = trigger Owner PIN modal
--        'wa_button' = create approval_request + send WA (V2 infra)
--        'app_inbox' = create approval_request + show in ApprovalInboxScreen
CREATE OR REPLACE FUNCTION public._check_approval_required(
  p_type public.approval_request_type,
  p_amount NUMERIC DEFAULT NULL,
  p_qty INTEGER DEFAULT NULL,
  p_actor_role TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.approval_settings;
BEGIN
  SELECT * INTO v_settings
    FROM public.approval_settings
    WHERE request_type = p_type
      AND tenant_id IS NULL  -- Phase 1 single-tenant
    LIMIT 1;

  IF NOT FOUND THEN
    -- No setting row = fall back to legacy behavior (require PIN)
    RETURN 'pin';
  END IF;

  -- 1. If approval not required at all → bypass
  IF NOT v_settings.approval_required THEN
    RETURN 'bypass';
  END IF;

  -- 2. Threshold amount bypass
  IF v_settings.threshold_amount IS NOT NULL
     AND p_amount IS NOT NULL
     AND p_amount < v_settings.threshold_amount THEN
    RETURN 'bypass';
  END IF;

  -- 3. Threshold qty bypass
  IF v_settings.threshold_qty IS NOT NULL
     AND p_qty IS NOT NULL
     AND p_qty < v_settings.threshold_qty THEN
    RETURN 'bypass';
  END IF;

  -- 4. Self-bypass (requestor is the approver)
  IF v_settings.requestor_bypass_self
     AND p_actor_role IS NOT NULL
     AND p_actor_role = v_settings.approver_role THEN
    RETURN 'bypass';
  END IF;

  -- 5. Verification method routing
  RETURN LOWER(v_settings.verification_method);
END $$;

REVOKE EXECUTE ON FUNCTION public._check_approval_required(public.approval_request_type, NUMERIC, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
