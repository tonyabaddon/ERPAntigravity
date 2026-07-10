-- Migration: update_tenant_feature_override RPC
-- Wave 6 Task 11
--
-- Creates SECURITY DEFINER RPC that updates tenant_subscriptions.feature_overrides
-- JSONB column (NOT the nonexistent tenant_feature_overrides table).
-- Emits TOGGLE_MODULE audit row to platform_admin_audit.
-- Callable by both super_admin and sales_rep (dual-role) via the
-- _is_platform_admin_from_jwt() guard which covers both roles.

CREATE OR REPLACE FUNCTION public.update_tenant_feature_override(
  p_tenant_id UUID,
  p_module_key TEXT,
  p_enabled BOOLEAN,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_old_value BOOLEAN;
  v_new_overrides JSONB;
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  IF p_module_key IS NULL OR p_module_key = '' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'MODULE_KEY_REQUIRED';
  END IF;

  -- Read current effective value (from view — factors in feature_bundle + overrides)
  SELECT (effective_features ->> p_module_key)::boolean INTO v_old_value
  FROM public.v_tenant_effective_features
  WHERE tenant_id = p_tenant_id;

  IF v_old_value IS NULL THEN
    RAISE EXCEPTION USING errcode = 'P0002',
      message = 'TENANT_OR_MODULE_NOT_FOUND';
  END IF;

  -- Update the override
  UPDATE public.tenant_subscriptions
  SET feature_overrides = COALESCE(feature_overrides, '{}'::jsonb)
                          || jsonb_build_object(p_module_key, p_enabled)
  WHERE tenant_id = p_tenant_id
  RETURNING feature_overrides INTO v_new_overrides;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'TENANT_NOT_FOUND';
  END IF;

  -- Audit — retargeted to platform_admin_audit per Wave 6 pattern
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    (SELECT email FROM public.platform_admins WHERE user_id = auth.uid()),
    p_tenant_id,
    'TOGGLE_MODULE',
    jsonb_build_object(
      'module_key', p_module_key,
      'old_value',  v_old_value,
      'new_value',  p_enabled,
      'reason',     p_reason
    )
  );

  RETURN jsonb_build_object(
    'tenant_id',  p_tenant_id,
    'module_key', p_module_key,
    'enabled',    p_enabled,
    'overrides',  v_new_overrides
  );
END;
$function$;

ALTER FUNCTION public.update_tenant_feature_override(UUID, TEXT, BOOLEAN, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_tenant_feature_override(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_tenant_feature_override(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
