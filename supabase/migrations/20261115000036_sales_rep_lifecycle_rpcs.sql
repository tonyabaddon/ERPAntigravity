-- supabase/migrations/20261115000036_sales_rep_lifecycle_rpcs.sql
-- Wave 6 Task 4: create_sales_rep + deactivate_sales_rep RPCs (super_admin only)
-- Requires: platform_admin_audit action CHECK extension (Task 16, migration 000040)
-- Requires: _is_super_admin_from_jwt() helper (Task 1, migration 000032)
-- Requires: platform_admins.role enum includes 'sales_rep' (Task 1, migration 000032)
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- create_sales_rep(p_user_id UUID, p_email TEXT, p_name TEXT) RETURNS JSONB
-- ─────────────────────────────────────────────────────────────────────────────
-- super_admin only.
-- Inserts into platform_admins with role='sales_rep', status='active'.
-- Assumes auth.users row already exists (Edge Function creates it).
-- Emits CREATE_SALES_REP → platform_admin_audit (tenant_id NULL, rep lifecycle).
-- Guards against demoting an existing super_admin.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_sales_rep(
  p_user_id UUID,
  p_email   TEXT,
  p_name    TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email text;
BEGIN
  -- ── Gate: super_admin only ────────────────────────────────────────────────
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- ── Validate: p_user_id required ─────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'USER_ID_REQUIRED';
  END IF;

  -- ── Validate: email format ────────────────────────────────────────────────
  IF p_email IS NULL OR p_email !~ '^[^ ]+@[^ ]+\.[^ ]+$' THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'INVALID_EMAIL_FORMAT';
  END IF;

  -- ── Guard: auth.users must pre-exist (Edge Function creates it) ───────────
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION USING errcode = 'P0002',
      message = 'USER_NOT_FOUND_IN_AUTH — create via Edge Function first';
  END IF;

  -- ── Guard: do not demote an existing super_admin ──────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = p_user_id AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION USING errcode = '22023',
      message = 'CANNOT_DEMOTE_SUPER_ADMIN — user is already a super_admin';
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── Upsert into platform_admins ───────────────────────────────────────────
  INSERT INTO public.platform_admins (user_id, email, role, status, name)
  VALUES (p_user_id, p_email, 'sales_rep', 'active', p_name)
  ON CONFLICT (user_id) DO UPDATE SET
    email  = EXCLUDED.email,
    role   = 'sales_rep',
    status = 'active',
    name   = EXCLUDED.name;

  -- ── Audit log ─────────────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    NULL,
    'CREATE_SALES_REP',
    jsonb_build_object('user_id', p_user_id, 'email', p_email, 'name', p_name)
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'email',   p_email,
    'name',    p_name
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_rep(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- deactivate_sales_rep(p_user_id UUID, p_reason TEXT) RETURNS JSONB
-- ─────────────────────────────────────────────────────────────────────────────
-- super_admin only.
-- Sets status='disabled' WHERE user_id AND role='sales_rep'.
-- Role guard prevents accidental deactivation of super_admin (founder).
-- Emits DEACTIVATE_SALES_REP → platform_admin_audit (tenant_id NULL).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_sales_rep(
  p_user_id UUID,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_admin_email text;
BEGIN
  -- ── Gate: super_admin only ────────────────────────────────────────────────
  IF NOT public._is_super_admin_from_jwt() THEN
    RAISE EXCEPTION USING errcode = 'P0403', message = 'SUPER_ADMIN_REQUIRED';
  END IF;

  -- ── Resolve admin email for audit row ────────────────────────────────────
  SELECT email INTO v_admin_email
  FROM public.platform_admins
  WHERE user_id = auth.uid();

  -- ── Update: only sales_rep rows — protects super_admin from mistake ───────
  UPDATE public.platform_admins
  SET status = 'disabled'
  WHERE user_id = p_user_id AND role = 'sales_rep';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002',
      message = 'SALES_REP_NOT_FOUND';
  END IF;

  -- ── Audit log ─────────────────────────────────────────────────────────────
  INSERT INTO public.platform_admin_audit
    (admin_user_id, admin_email, tenant_id, action, detail)
  VALUES (
    auth.uid(),
    v_admin_email,
    NULL,
    'DEACTIVATE_SALES_REP',
    jsonb_build_object('user_id', p_user_id, 'reason', p_reason)
  );

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'status',  'disabled'
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

ALTER FUNCTION public.deactivate_sales_rep(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deactivate_sales_rep(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_sales_rep(UUID, TEXT) TO authenticated;

COMMIT;
