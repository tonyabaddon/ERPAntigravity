-- 2026-07-24 post-registry-refactor follow-up (task-40):
--
-- provision_tenant hardcoded 32-key JSONB (from migration 000509) was missing
-- 11 registry keys AND carried the legacy `pipeline` key. After the permission
-- registry refactor (000515), every existing admin_users row was backfilled to
-- 43 keys — but new tenants would still be provisioned with the stale 32-key
-- JSONB, recreating the NENG SEKAR class-bug at the next real-tenant onboard
-- (Sidebar/Pembelian gates hide menus for the new Owner because action-perm
-- keys absent from the JSONB evaluate to `undefined`, and the isActionPerm
-- gate requires `=== true`).
--
-- Fix: replace the hardcoded JSONB with an array-driven build that mirrors the
-- 43-key PERMISSION_REGISTRY in src/lib/permissions.ts. Any future registry
-- extension only needs to touch the frontend + backfill migration; this
-- migration's ARRAY will be the new base for new tenants.
--
-- Keys added vs 000509:
--   + kasir, pembelian, piutang, reconciliation, canConfigureSalesChannels
--   + can_request_credit_activate, can_approve_credit_activate
--   + can_request_limit_change, can_approve_limit_change
--   + can_request_deactivate, can_approve_deactivate
-- Keys removed vs 000509:
--   - pipeline (legacy key retired by registry refactor)
--
-- Signature and all other body logic (RLS check, validation, INSERTs,
-- _seed_tenant_accounting, OWNER/GRANT) preserved verbatim from 000509.

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

  -- Build Owner permissions from 43-key registry array.
  -- This mirrors PERMISSION_REGISTRY in src/lib/permissions.ts and must be
  -- kept in sync whenever new permission keys are added to the registry.
  -- Do NOT use a hardcoded JSONB literal here — the array makes the key list
  -- auditable and prevents silent drift.
  v_owner_permissions := (
    SELECT jsonb_object_agg(k, true) FROM unnest(ARRAY[
      -- Modul Utama (10)
      'dashboard','salesInbox','laporan','aiStock','pelanggan','orderHistory',
      'userManagement','whatsappAi','notifications','settings',
      -- Pembelian (4)
      'pembelian','can_create_po','can_edit_po','can_witness_po_receipt',
      -- Stok Opname & Adjustment (7)
      'can_start_opname','can_witness_opname','can_commit_opname',
      'can_request_adjustment','can_approve_adjustment',
      'can_request_price_change','can_approve_price_change',
      -- Gudang (3)
      'can_manage_warehouses','can_initiate_transfer','can_receive_transfer',
      -- Kasir (9)
      'kasir','can_open_kasir_shift',
      'can_request_kasir_price_override','can_approve_kasir_price_override',
      'can_request_kasir_void','can_approve_kasir_void',
      'can_request_kasir_refund','can_approve_kasir_refund',
      'can_override_price_floor',
      -- Penjualan (1)
      'canConfigureSalesChannels',
      -- Piutang & Kredit (7)
      'piutang',
      'can_request_credit_activate','can_approve_credit_activate',
      'can_request_limit_change','can_approve_limit_change',
      'can_request_deactivate','can_approve_deactivate',
      -- Kontrol (2)
      'reconciliation','can_view_pengawasan'
    ]) AS k
  );

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
