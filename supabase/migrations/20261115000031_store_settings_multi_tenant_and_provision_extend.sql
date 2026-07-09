-- Gap #1 fix: multi-tenant store_settings + provision_tenant seeds it.
--
-- store_settings was a legacy single-row table: id was PK with default 1 and
-- a CHECK (id = 1) that hard-locked exactly one row per database. After the
-- tenant_id column was added it still couldn't hold more than one tenant's
-- row. Result: only Garindo had a row; every provision_tenant tenant was
-- silently invisible to invoice PDFs / PO / kasir modals, which fell back
-- to 'Toko Anda'.
--
-- Structural fix:
--   1. Drop CHECK (id = 1) constraint
--   2. Drop id from PK (was single-column PK)
--   3. Make tenant_id the new PK — one row per tenant
--   4. Convert id to sequence-backed for future inserts
-- Then extend provision_tenant to seed store_settings for new tenants and
-- backfill the two tenants provisioned before this migration.

ALTER TABLE public.store_settings DROP CONSTRAINT IF EXISTS store_settings_id_check;
ALTER TABLE public.store_settings DROP CONSTRAINT IF EXISTS store_settings_pkey;
ALTER TABLE public.store_settings ADD CONSTRAINT store_settings_pkey PRIMARY KEY (tenant_id);

CREATE SEQUENCE IF NOT EXISTS public.store_settings_id_seq;
SELECT setval('public.store_settings_id_seq', COALESCE((SELECT MAX(id) FROM public.store_settings), 1));
ALTER TABLE public.store_settings ALTER COLUMN id SET DEFAULT nextval('public.store_settings_id_seq');
ALTER SEQUENCE public.store_settings_id_seq OWNED BY public.store_settings.id;

-- Backfill tenant #2 and #3 (skip if already present)
INSERT INTO public.store_settings (tenant_id, nama_toko, updated_at)
SELECT t.id, t.name, now()
FROM public.tenants t
WHERE t.id IN (
  '22222222-2222-2222-2222-222222222222',
  '49cbbc94-977c-4bc4-bf9b-0195342f1608'
)
AND NOT EXISTS (SELECT 1 FROM public.store_settings s WHERE s.tenant_id = t.id);

-- Extend provision_tenant to include the store_settings seed
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
  IF NOT public._is_platform_admin_from_jwt() THEN
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
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id % not found in auth.users', p_owner_user_id USING errcode = 'P0002';
  END IF;

  v_expires_at := v_activated_at + (p_expires_in_months || ' months')::interval;

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

  INSERT INTO public.tenants (slug, name, status, created_by)
  VALUES (p_slug, p_name, 'ACTIVE', auth.uid())
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_code, activated_at, expires_at, updated_by
  ) VALUES (
    v_tenant_id, p_plan_code, v_activated_at, v_expires_at, auth.uid()
  );

  INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
  VALUES (v_tenant_id, p_owner_user_id, 'owner', 'ACTIVE');

  INSERT INTO public.admin_users (id, name, email, role, status, tenant_id, permissions)
  VALUES (p_owner_user_id, p_owner_name, p_owner_email, 'Owner', 'Aktif', v_tenant_id, v_owner_permissions);

  -- Seed store_settings so invoice PDFs / PO / kasir modals render this
  -- tenant's name instead of falling back to 'Toko Anda'. PK is now
  -- tenant_id (see this same migration); id auto-fills via sequence.
  INSERT INTO public.store_settings (tenant_id, nama_toko, updated_at)
  VALUES (v_tenant_id, p_name, now());

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
