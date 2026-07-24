-- Migration 20261115000518: extend admin_upsert_user RPC signature with p_gender
--
-- Adds gender param with default 'N' so any legacy FE call without the
-- param still works (backward compat). Body updated to INSERT + UPDATE
-- gender column added in migration 000517.
--
-- Ownership: postgres (same as migration 000514 revert for auth schema).
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.admin_upsert_user(
  p_id           uuid,
  p_name         text,
  p_email        text,
  p_whatsapp     text,
  p_role         text,
  p_permissions  jsonb,
  p_status       text,
  p_gender       text DEFAULT 'N'
)
RETURNS public.admin_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_actor_role   text;
  v_tenant       uuid := public._resolve_tenant_id();
  v_existing_ten uuid;
  v_row          public.admin_users;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_user: requires authenticated caller';
  END IF;
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'admin_upsert_user: tenant context missing from JWT';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.admin_users
  WHERE id = v_actor AND tenant_id = v_tenant;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'admin_upsert_user: caller (%) is not a member of tenant %',
      v_actor, v_tenant;
  END IF;
  IF v_actor_role <> 'Owner' THEN
    RAISE EXCEPTION 'admin_upsert_user: Owner role required (caller role=%)',
      v_actor_role;
  END IF;

  -- Cross-tenant PK guard
  SELECT tenant_id INTO v_existing_ten
  FROM public.admin_users WHERE id = p_id;
  IF v_existing_ten IS NOT NULL AND v_existing_ten <> v_tenant THEN
    RAISE EXCEPTION 'admin_upsert_user: id % belongs to another tenant', p_id;
  END IF;

  -- Sanity: enforce gender enum (redundant with column CHECK but explicit)
  IF p_gender NOT IN ('M', 'F', 'N') THEN
    RAISE EXCEPTION 'admin_upsert_user: invalid gender %, must be M/F/N', p_gender;
  END IF;

  INSERT INTO public.admin_users (
    id, name, email, whatsapp, role, permissions, status, tenant_id, gender
  ) VALUES (
    p_id, p_name, NULLIF(p_email, ''), NULLIF(p_whatsapp, ''),
    p_role, p_permissions, p_status, v_tenant, p_gender
  )
  ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    email       = EXCLUDED.email,
    whatsapp    = EXCLUDED.whatsapp,
    role        = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    status      = EXCLUDED.status,
    gender      = EXCLUDED.gender
    -- tenant_id intentionally NOT updated
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text, text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text, text)
  TO authenticated;
