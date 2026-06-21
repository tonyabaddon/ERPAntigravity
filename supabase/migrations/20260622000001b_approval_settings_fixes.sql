-- supabase/migrations/20260622000001b_approval_settings_fixes.sql
-- Phase 1 task 1 fixes: bypass when verification_method='NONE' + partial unique index for NULL tenant_id.
-- See task-1-report.md for full review findings.

-- Fix 1: verification_method='NONE' now returns 'bypass' instead of leaking 'none' outside the contract.
-- Changed: IF NOT v_settings.approval_required THEN ... END IF;
--   To: IF NOT v_settings.approval_required OR v_settings.verification_method = 'NONE' THEN ... END IF;
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

  -- 1. If approval not required at all, OR verification method is explicitly NONE → bypass
  IF NOT v_settings.approval_required OR v_settings.verification_method = 'NONE' THEN
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

-- Fix 2: Add partial unique index to enforce singleton for NULL tenant_id.
-- Postgres NULL ≠ NULL in default unique constraints, so without this Phase 1
-- could have multiple rows with tenant_id IS NULL and same request_type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_settings_null_tenant
  ON public.approval_settings (request_type)
  WHERE tenant_id IS NULL;
