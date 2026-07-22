-- Phase 1 Task 2 (2026-07-22): extend provision_tenant with p_environment param.
--
-- Existing 7-arg signature backward-compat via default value 'production'.
-- INSERT INTO tenants now includes environment column (added by mig 508).
--
-- Body copied verbatim from current definition; only changes:
--   1. Added `p_environment text DEFAULT 'production'` as 8th param
--   2. Added validation: p_environment IN ('production','staging')
--   3. INSERT INTO tenants now includes `environment` column with p_environment value
-- Everything else (RLS check, auth users check, subscriptions, tenant_users,
-- admin_users, store_settings, _seed_tenant_accounting) unchanged.

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_owner_user_id uuid,
  p_slug text,
  p_name text,
  p_owner_name text,
  p_owner_email text,
  p_plan_code text DEFAULT 'STARTER'::text,
  p_expires_in_months integer DEFAULT 12,
  p_environment text DEFAULT 'production'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_activated_at timestamptz := now();
  v_expires_at timestamptz;
  v_owner_permissions jsonb;
BEGIN
  IF NOT public._is_platform_admin_active_from_jwt() THEN
    RAISE EXCEPTION 'provision_tenant: platform admin required' USING errcode = 'P0403';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id required' USING errcode = '22023';
  END IF;
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{2,29}$' THEN
    RAISE EXCEPTION 'provision_tenant: invalid slug format' USING errcode = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'provision_tenant: p_name required' USING errcode = '22023';
  END IF;
  IF p_plan_code NOT IN ('STARTER', 'PRO', 'PREMIUM') THEN
    RAISE EXCEPTION 'provision_tenant: invalid plan_code' USING errcode = '22023';
  END IF;
  IF p_environment NOT IN ('production', 'staging') THEN
    RAISE EXCEPTION 'provision_tenant: invalid p_environment (must be production or staging)' USING errcode = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id % not found in auth.users', p_owner_user_id USING errcode = 'P0002';
  END IF;

  v_expires_at := v_activated_at + (p_expires_in_months || ' months')::interval;
  v_owner_permissions := '{"aiStock":true,"laporan":true,"pipeline":true,"settings":true,"dashboard":true,"pelanggan":true,"salesInbox":true,"whatsappAi":true,"can_edit_po":true,"orderHistory":true,"can_create_po":true,"notifications":true,"userManagement":true,"can_start_opname":true,"can_commit_opname":true,"can_witness_opname":true,"can_view_pengawasan":true,"can_open_kasir_shift":true,"can_receive_transfer":true,"can_initiate_transfer":true,"can_manage_warehouses":true,"can_approve_adjustment":true,"can_approve_kasir_void":true,"can_request_adjustment":true,"can_request_kasir_void":true,"can_witness_po_receipt":true,"can_approve_kasir_refund":true,"can_approve_price_change":true,"can_override_price_floor":true,"can_request_kasir_refund":true,"can_request_price_change":true,"can_approve_kasir_price_override":true,"can_request_kasir_price_override":true}'::jsonb;

  INSERT INTO public.tenants (slug, name, status, created_by, environment)
  VALUES (p_slug, p_name, 'ACTIVE', auth.uid(), p_environment)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at, updated_by)
  VALUES (v_tenant_id, p_plan_code, v_activated_at, v_expires_at, auth.uid());

  INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
  VALUES (v_tenant_id, p_owner_user_id, 'owner', 'ACTIVE');

  INSERT INTO public.admin_users (id, name, email, role, status, tenant_id, permissions)
  VALUES (p_owner_user_id, p_owner_name, p_owner_email, 'Owner', 'Aktif', v_tenant_id, v_owner_permissions);

  INSERT INTO public.store_settings (tenant_id, nama_toko, updated_at)
  VALUES (v_tenant_id, p_name, now());

  -- F-15 fix: seed COA + accounting_config + default cash_account.
  PERFORM public._seed_tenant_accounting(v_tenant_id);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id, 'slug', p_slug, 'name', p_name,
    'plan_code', p_plan_code, 'activated_at', v_activated_at,
    'expires_at', v_expires_at, 'owner_user_id', p_owner_user_id,
    'environment', p_environment
  );
END $function$;

ALTER FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  TO authenticated;
