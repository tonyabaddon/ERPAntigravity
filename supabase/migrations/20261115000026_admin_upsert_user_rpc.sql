-- 20261115000026 — admin_users: admin_upsert_user SD RPC
--
-- Fixes the "Tambah Admin Baru" 403 in UserManagementScreen. Direct
-- .upsert() from `authenticated` to `admin_users` returns 42501 because
-- the t_insert_own / t_update_own RLS policies contain the predicate
-- `_guard_expiry_write() IS NULL`, which is always FALSE — the guard
-- function `RETURNS void`, and `void IS NULL` = false in Postgres. The
-- broken predicate blocks every direct client write to ~100 t_* tables.
--
-- This migration only routes admin_users writes through a SECURITY
-- DEFINER RPC (mirrors the admin_upsert_product pattern from
-- 20260910000009). The wider RLS-predicate cleanup is a separate
-- follow-up (audit + rewrite all t_* policies to use a boolean guard).
--
-- Ownership: `postgres` (BYPASSRLS) — not `vosi_rpc_owner` — so the
-- role-gate SELECT on admin_users works for tenant Owners regardless
-- of the SECDEF/authenticated-RLS gap tracked in
-- project_phase_a_secdef_authenticated_gap.
--
-- Not migrated in this PR (separate follow-ups):
--   - adminUsersService.remove()  — DELETE fails via the same broken
--     RLS predicate; needs admin_delete_user RPC.
--   - AuthScreen sign-up upsert   — pre-existing broken swallowed
--     write; tenant bootstrap should create the Owner row, not the
--     client.

CREATE OR REPLACE FUNCTION public.admin_upsert_user(
  p_id           uuid,
  p_name         text,
  p_email        text,
  p_whatsapp     text,
  p_role         text,
  p_permissions  jsonb,
  p_status       text
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

  -- Cross-tenant PK guard: if p_id already exists in another tenant we
  -- must refuse rather than silently overwrite. Owner of tenant A must
  -- not be able to hijack Owner of tenant B by supplying B's user id.
  SELECT tenant_id INTO v_existing_ten
  FROM public.admin_users WHERE id = p_id;
  IF v_existing_ten IS NOT NULL AND v_existing_ten <> v_tenant THEN
    RAISE EXCEPTION 'admin_upsert_user: id % belongs to another tenant', p_id;
  END IF;

  INSERT INTO public.admin_users (
    id, name, email, whatsapp, role, permissions, status, tenant_id
  ) VALUES (
    p_id, p_name, NULLIF(p_email, ''), NULLIF(p_whatsapp, ''),
    p_role, p_permissions, p_status, v_tenant
  )
  ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    email       = EXCLUDED.email,
    whatsapp    = EXCLUDED.whatsapp,
    role        = EXCLUDED.role,
    permissions = EXCLUDED.permissions,
    status      = EXCLUDED.status
    -- tenant_id intentionally NOT updated: admin membership cannot move
    -- between tenants via this RPC.
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

ALTER FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_upsert_user(uuid, text, text, text, text, jsonb, text)
  TO authenticated;
