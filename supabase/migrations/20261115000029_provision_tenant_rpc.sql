-- provision_tenant: atomic tenant onboarding RPC.
--
-- Motivation: manual multi-tenant onboarding (as done for Garindo + tenant #2
-- via ad-hoc MCP inserts) is fragile — every step easy to skip, hard to
-- audit, and drift between environments accumulates over time. This RPC
-- provides a single call that seeds ALL required rows atomically:
--   tenants + tenant_subscriptions + tenant_users + admin_users
-- so future tenants get a consistent baseline.
--
-- Scope: this RPC does NOT create the auth.users row. That must be done
-- first via Supabase Auth Admin API (Dashboard UI or edge function using
-- service_role). Rationale: SECURITY DEFINER RPCs run as vosi_rpc_owner
-- which cannot insert into auth.users; embedding service_role in an RPC
-- would break the isolation model. The RPC takes an existing user_id and
-- links it into the tenancy tables.
--
-- Auth: platform admin only (checks _is_platform_admin_from_jwt()).
--
-- Idempotency: fails if slug already exists. Callers should validate slug
-- availability first via a separate `check_slug_available(slug)` call
-- (future). Currently returns 23505 (unique_violation) on collision.

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_owner_user_id UUID,
  p_slug TEXT,
  p_name TEXT,
  p_owner_name TEXT,
  p_owner_email TEXT,
  p_plan_code TEXT DEFAULT 'STARTER',
  p_expires_in_months INTEGER DEFAULT 12
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_activated_at TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ;
  v_owner_permissions JSONB;
BEGIN
  -- Auth gate: platform admin only
  IF NOT public._is_platform_admin_from_jwt() THEN
    RAISE EXCEPTION 'provision_tenant: platform admin required'
      USING errcode = 'P0403';
  END IF;

  -- Input validation
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id required'
      USING errcode = '22023';
  END IF;
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{2,29}$' THEN
    RAISE EXCEPTION 'provision_tenant: invalid slug format (must match ^[a-z0-9][a-z0-9-]{2,29}$)'
      USING errcode = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'provision_tenant: p_name required'
      USING errcode = '22023';
  END IF;
  IF p_plan_code NOT IN ('STARTER', 'PRO', 'PREMIUM') THEN
    RAISE EXCEPTION 'provision_tenant: invalid plan_code (must be STARTER/PRO/PREMIUM)'
      USING errcode = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id % not found in auth.users', p_owner_user_id
      USING errcode = 'P0002';
  END IF;

  v_expires_at := v_activated_at + (p_expires_in_months || ' months')::interval;

  -- Owner default permissions — matches Garindo Owner row shape.
  v_owner_permissions := '{
    "aiStock":true,"laporan":true,"pipeline":true,"settings":true,"dashboard":true,
    "pelanggan":true,"salesInbox":true,"whatsappAi":true,"can_edit_po":true,
    "orderHistory":true,"can_create_po":true,"notifications":true,
    "userManagement":true,"can_start_opname":true,"can_commit_opname":true,
    "can_witness_opname":true,"can_view_pengawasan":true,
    "can_open_kasir_shift":true,"can_receive_transfer":true,
    "can_initiate_transfer":true,"can_manage_warehouses":true,
    "can_approve_adjustment":true,"can_approve_kasir_void":true,
    "can_request_adjustment":true,"can_request_kasir_void":true,
    "can_witness_po_receipt":true,"can_approve_kasir_refund":true,
    "can_approve_price_change":true,"can_override_price_floor":true,
    "can_request_kasir_refund":true,"can_request_price_change":true,
    "can_approve_kasir_price_override":true,"can_request_kasir_price_override":true
  }'::jsonb;

  -- Atomic seed of all 4 tables
  INSERT INTO public.tenants (slug, name, status, created_by)
  VALUES (p_slug, p_name, 'ACTIVE', auth.uid())
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_code, activated_at, expires_at, updated_by
  ) VALUES (
    v_tenant_id, p_plan_code, v_activated_at, v_expires_at, auth.uid()
  );

  INSERT INTO public.tenant_users (
    tenant_id, user_id, role, status
  ) VALUES (
    v_tenant_id, p_owner_user_id, 'owner', 'ACTIVE'
  );

  INSERT INTO public.admin_users (
    id, name, email, role, status, tenant_id, permissions
  ) VALUES (
    p_owner_user_id, p_owner_name, p_owner_email, 'Owner', 'Aktif',
    v_tenant_id, v_owner_permissions
  );

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'slug', p_slug,
    'name', p_name,
    'plan_code', p_plan_code,
    'activated_at', v_activated_at,
    'expires_at', v_expires_at,
    'owner_user_id', p_owner_user_id
  );
END;
$function$;

-- Ownership + grants
ALTER FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO authenticated;

COMMENT ON FUNCTION public.provision_tenant IS
  'Atomic tenant onboarding. Platform admin only. auth.users row for owner must exist first (create via Auth Admin API). Seeds tenants + tenant_subscriptions + tenant_users + admin_users. Returns jsonb with new tenant_id + metadata.';
