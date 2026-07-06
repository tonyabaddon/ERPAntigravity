-- Phase B Wave 5 polish — extend update_plan_admin whitelist with price_annual.
-- Wave 5 Task 1 seeded plans.price_annual but Wave 4a's update_plan_admin
-- pre-dated the column, so founder couldn't edit prices via /admin/plans UI.
-- Follow-up flagged in Wave 5 Task 1 report.

CREATE OR REPLACE FUNCTION public.update_plan_admin(p_plan_code text, p_updates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email   text;
  v_unknown_keys  text[];
  v_allowed_keys  text[] := ARRAY[
    'name', 'description', 'target_segment', 'price_reference',
    'price_annual',  -- Wave 5 polish addition
    'feature_bundle', 'is_recommended', 'is_active', 'sort_order'
  ];
BEGIN
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'PLATFORM_ADMIN_REQUIRED';
  END IF;

  PERFORM public._assert_super_admin_from_jwt();

  IF p_plan_code NOT IN ('STARTER', 'PRO', 'PREMIUM') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_PLAN_CODE';
  END IF;

  SELECT ARRAY_AGG(k) INTO v_unknown_keys
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k <> ALL(v_allowed_keys);

  IF v_unknown_keys IS NOT NULL AND array_length(v_unknown_keys, 1) > 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'UNKNOWN_FIELD';
  END IF;

  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  UPDATE public.plans
  SET
    name            = CASE WHEN p_updates ? 'name'
                           THEN p_updates ->>'name'
                           ELSE name END,
    description     = CASE WHEN p_updates ? 'description'
                           THEN p_updates ->>'description'
                           ELSE description END,
    target_segment  = CASE WHEN p_updates ? 'target_segment'
                           THEN p_updates ->>'target_segment'
                           ELSE target_segment END,
    price_reference = CASE WHEN p_updates ? 'price_reference'
                           THEN (p_updates ->>'price_reference')::numeric
                           ELSE price_reference END,
    price_annual    = CASE WHEN p_updates ? 'price_annual'
                           THEN (p_updates ->>'price_annual')::numeric
                           ELSE price_annual END,
    feature_bundle  = CASE WHEN p_updates ? 'feature_bundle'
                           THEN p_updates ->'feature_bundle'
                           ELSE feature_bundle END,
    is_recommended  = CASE WHEN p_updates ? 'is_recommended'
                           THEN (p_updates ->>'is_recommended')::boolean
                           ELSE is_recommended END,
    is_active       = CASE WHEN p_updates ? 'is_active'
                           THEN (p_updates ->>'is_active')::boolean
                           ELSE is_active END,
    sort_order      = CASE WHEN p_updates ? 'sort_order'
                           THEN (p_updates ->>'sort_order')::int
                           ELSE sort_order END,
    updated_at      = now(),
    updated_by      = auth.uid()
  WHERE code = p_plan_code;

  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    NULL,
    'UPDATE_PLAN',
    jsonb_build_object('plan_code', p_plan_code, 'updates', p_updates)
  );

  RETURN jsonb_build_object(
    'ok',           true,
    'plan_code',    p_plan_code,
    'updated_keys', ARRAY(SELECT jsonb_object_keys(p_updates))
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.update_plan_admin(text, jsonb) OWNER TO postgres;
