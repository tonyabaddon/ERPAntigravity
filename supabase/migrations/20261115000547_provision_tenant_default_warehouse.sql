-- Migration 20261115000547: seed default warehouse on tenant provision.
--
-- Bug (2026-07-31): Jenny @ Garindo Jaya Panel could not advance Step 2 of
-- Penawaran wizard — button "Lanjut ke Pembayaran" stayed disabled even when
-- cart was populated. Root cause: `validateStep2` requires warehouse_id per
-- SKU line; wizard defaults warehouse_id from the first available warehouse
-- (`defaultWh?.id ?? null`); Garindo had ZERO warehouses configured. Prod scan:
-- 5 of 7 tenants (including 2 real customers — Garindo + Warung Sinar Rezeki)
-- were in this state. Backfill applied inline on 2026-07-31 via psql:
--   INSERT INTO public.warehouses (tenant_id, code, name, is_active, is_default, sort_order)
--   SELECT t.id, 'MAIN', 'Gudang Utama', true, true, 1 FROM public.tenants t
--   WHERE NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.tenant_id = t.id);
--
-- This migration fixes the ONBOARDING GAP so new tenants auto-get a default
-- warehouse. Extracts the seed logic into `_seed_default_warehouse(uuid)` for
-- reuse, then modifies `provision_tenant` to call it after tenant creation.
--
-- Complements the pattern from `_seed_tenant_accounting` (migration 000053) —
-- same idea, different domain.
--
-- Idempotent: `_seed_default_warehouse` uses `INSERT ... WHERE NOT EXISTS`,
-- safe to call for tenants that already have warehouses (no-op).

-- ── Seed helper ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._seed_default_warehouse(p_tenant_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO public.warehouses (tenant_id, code, name, address, is_active, is_default, sort_order)
  SELECT p_tenant_id, 'MAIN', 'Gudang Utama', NULL, true, true, 1
  WHERE NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE tenant_id = p_tenant_id
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END $$;

ALTER FUNCTION public._seed_default_warehouse(uuid) OWNER TO postgres;

COMMENT ON FUNCTION public._seed_default_warehouse(uuid) IS
  'Seed a default "Gudang Utama" warehouse for a tenant. Idempotent (WHERE NOT '
  'EXISTS guard). Called by provision_tenant + can be re-run for backfill.';

-- ── Update provision_tenant to call the seed helper ──────────────────────────
-- Body copied verbatim from migration 000509; only change: add
-- `PERFORM public._seed_default_warehouse(v_tenant_id);` after the accounting
-- seed. Ownership stays `postgres` per Entry #4 class-fix (auth.uid() needs
-- schema auth USAGE which vosi_rpc_owner lacks).

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

  -- 2026-07-31 fix: seed default warehouse so Penawaran/Kasir wizards can
  -- advance Step 2 (warehouse_id required per SKU line). Prior gap left 5 of 7
  -- prod tenants unable to complete a sales transaction (Jenny @ Garindo).
  PERFORM public._seed_default_warehouse(v_tenant_id);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id, 'slug', p_slug, 'name', p_name,
    'plan_code', p_plan_code, 'activated_at', v_activated_at,
    'expires_at', v_expires_at, 'owner_user_id', p_owner_user_id,
    'environment', p_environment
  );
END $function$;

ALTER FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_tenant(uuid, text, text, text, text, text, integer, text)
  TO authenticated;

-- Verify: every tenant now has ≥1 warehouse (should be TRUE after Bagian A
-- inline backfill + this migration for new tenants).
DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM public.tenants t
  WHERE NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.tenant_id = t.id);
  IF v_missing <> 0 THEN
    RAISE WARNING 'migration 547: % tenant(s) still missing warehouse — inline backfill may need re-run', v_missing;
  ELSE
    RAISE NOTICE 'migration 547: all tenants have ≥1 warehouse; provision_tenant now seeds default';
  END IF;
END $$;
