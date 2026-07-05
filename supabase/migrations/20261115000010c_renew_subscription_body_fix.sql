-- 20261115000010c_renew_subscription_body_fix.sql
--
-- Hotfix for the initial 20261115000010 body on Garindo prod (2026-07-05).
-- The original UPDATE assigned to grace_expires_at, which is a GENERATED
-- column (expires_at + interval '7 days'). PostgreSQL rejects assignment to
-- generated columns with SQLSTATE 428C9. Also the return jsonb had 14-day
-- grace math that didn't match the column definition.
--
-- Fix: drop the grace_expires_at assignment (the generated column
-- auto-recomputes), and return the correct +7-day grace in the response
-- jsonb. Function ownership is postgres (from 000010b hotfix).
--
-- On fresh setup: 000010 (corrected inline) applies with the right body.
--   000010b re-establishes postgres ownership (no-op if already postgres).
--   000010c replays this correct body as a no-op via CREATE OR REPLACE.
-- On prod: 000010c is the first version whose body actually runs to
--   completion; before this fix the function raised 428C9 on any happy path.

CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_tenant_id      uuid,
  p_new_expires_at date,
  p_new_plan_code  text DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_admin_email text;
  v_final_plan  text;
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION USING errcode = 'P0404', message = 'TENANT_NOT_FOUND';
  END IF;

  IF p_new_expires_at <= CURRENT_DATE THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_EXPIRES_AT';
  END IF;

  IF p_new_plan_code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.plans WHERE code = p_new_plan_code) THEN
      RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PLAN_CODE';
    END IF;
  END IF;

  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  UPDATE public.tenant_subscriptions
  SET
    expires_at = p_new_expires_at,
    plan_code  = COALESCE(p_new_plan_code, plan_code),
    notes      = COALESCE(p_notes, notes),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE tenant_id = p_tenant_id
  RETURNING plan_code INTO v_final_plan;

  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    p_tenant_id,
    'RENEW_SUBSCRIPTION',
    jsonb_build_object(
      'new_expires_at', p_new_expires_at,
      'new_plan_code',  p_new_plan_code,
      'notes',          p_notes
    )
  );

  RETURN jsonb_build_object(
    'ok',                   true,
    'tenant_id',            p_tenant_id,
    'new_expires_at',       p_new_expires_at,
    'new_grace_expires_at', p_new_expires_at + interval '7 days',
    'plan_code',            v_final_plan
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Re-affirm ownership + grants (idempotent after 000010b).
REVOKE ALL ON FUNCTION public.renew_subscription(uuid, date, text, text) FROM PUBLIC;
ALTER FUNCTION  public.renew_subscription(uuid, date, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid, date, text, text) TO authenticated;
