-- 20261115000053_seed_tenant_accounting_on_provision.sql
--
-- QA cycle Session 4 finding F-15 (P0 launch blocker):
-- `provision_tenant` (invoked by the VOSI Admin Onboard wizard) writes
-- 5 tables: tenants, tenant_subscriptions, tenant_users, admin_users,
-- store_settings, plus creates the owner auth.users invite. But it does
-- NOT seed:
--   • chart_of_accounts        (0 rows → no accounts to reference)
--   • accounting_config        (0 rows → record_kasir_sale et al skip
--                              the entire GL block, same shape as F-2)
--   • cash_accounts            (0 rows → user has nothing to pick when
--                              recording a payment; Piutang → Catat
--                              Bayar picker is empty; supplier
--                              Pembayaran picker is empty)
--
-- Result: every newly-onboarded tenant looks alive in the UI but is DOA
-- for anything money-related. The existing real tenant
-- `warung-sinar-rezeki` is also broken this way — only `garindo` and
-- `toko-jaya-makmur` work because they were seeded via one-shot demo
-- migrations, not through `provision_tenant`.
--
-- Fix
-- ===
-- 1. New helper `public._seed_tenant_accounting(p_tenant_id)`:
--    (a) idempotent early-exit if the target tenant already has any COA row
--    (b) 2-pass copy of the 63-row COA from a template tenant (garindo):
--        pass 1 inserts all rows with parent_id NULL; pass 2 repairs
--        parent_id by matching `account_code` between template and new
--    (c) inserts `accounting_config` mirroring garindo's defaults
--        (NON_PKP, UMKM_FINAL_0_5 pph, dual_write=true, fiscal Jan)
--        with default_kas_account_id pointing at the new tenant's
--        1-1110 (Kas Toko) COA row
--    (d) inserts a default `cash_accounts` row "Kas Toko" of type KAS
--        wired to the same 1-1110 COA row
--
-- 2. Rewrite `provision_tenant` to call `_seed_tenant_accounting` after
--    `store_settings` insert. Preserves the existing 5-table + audit
--    behaviour byte-for-byte; adds the seed call in one place.
--
-- 3. Backfill: run the helper for every existing tenant that currently
--    has no COA rows (excluding the template itself). At present this
--    catches `warung-sinar-rezeki` — a real tenant that was silently DOA.
--
-- Idempotency + safety
-- ====================
-- The helper's early-exit means re-running the migration or the RPC is a
-- no-op for tenants that are already seeded. That covers:
--   • the template garindo (already has 63 COAs → skip)
--   • toko-jaya-makmur (already has 62 COAs from its demo seed → skip)
--   • any tenant onboarded post-migration (helper only runs once)
--
-- Verification
-- ============
-- Post-migration invariant: `SELECT count(*) FROM public.tenants t WHERE
-- NOT EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE tenant_id=t.id)`
-- returns **0**. Manual click-through: onboard a fresh test tenant via
-- the wizard, then record a kasir walk-in cash sale — GL entry posts
-- balanced (Kas 50k D / Pendapatan Walkin 50k C / HPP 30k D / Persediaan
-- 30k C), which was impossible before this migration.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Helper: seed accounting scaffolding for a tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._seed_tenant_accounting(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_id      uuid := '11111111-1111-1111-1111-111111111111'::uuid;  -- garindo
  v_kas_coa_id       uuid;
  v_kas_cash_acct_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id required';
  END IF;

  -- Idempotent early exit.
  IF EXISTS (
    SELECT 1 FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id
  ) THEN
    RETURN;
  END IF;

  -- Pass 1: copy every COA row from the template, parent_id set to NULL.
  INSERT INTO public.chart_of_accounts (
    tenant_id, account_code, account_name, account_type, account_subtype,
    is_control_account, normal_balance, is_active, is_system, description
  )
  SELECT
    p_tenant_id, account_code, account_name, account_type, account_subtype,
    is_control_account, normal_balance, is_active, is_system, description
  FROM public.chart_of_accounts
  WHERE tenant_id = v_template_id;

  -- Pass 2: rebuild parent_id links by matching account_code across the
  -- two tenant scopes. Only touches rows where the template had a non-NULL
  -- parent_id.
  UPDATE public.chart_of_accounts child
  SET parent_id = parent_new.id
  FROM public.chart_of_accounts child_src
  JOIN public.chart_of_accounts parent_src
    ON parent_src.id = child_src.parent_id
    AND parent_src.tenant_id = v_template_id
  JOIN public.chart_of_accounts parent_new
    ON parent_new.account_code = parent_src.account_code
    AND parent_new.tenant_id = p_tenant_id
  WHERE child.tenant_id = p_tenant_id
    AND child_src.tenant_id = v_template_id
    AND child_src.account_code = child.account_code
    AND child_src.parent_id IS NOT NULL;

  -- Kas Toko COA in the new tenant.
  SELECT id INTO v_kas_coa_id
  FROM public.chart_of_accounts
  WHERE tenant_id = p_tenant_id AND account_code = '1-1110';

  IF v_kas_coa_id IS NULL THEN
    RAISE EXCEPTION 'seed_tenant_accounting: COA 1-1110 (Kas Toko) missing after copy';
  END IF;

  -- Default Kas Toko cash_account MUST be inserted before accounting_config
  -- because accounting_config.default_kas_account_id is a FK to
  -- cash_accounts.id (not to chart_of_accounts as the name might suggest).
  -- Reverse the order and you hit 23503.
  INSERT INTO public.cash_accounts (
    tenant_id,
    account_type, internal_label, purpose,
    show_in_invoice, sort_order, is_active,
    coa_account_id
  ) VALUES (
    p_tenant_id,
    'KAS', 'Kas Toko', 'PETTY_CASH',
    true, 0, true,
    v_kas_coa_id
  ) RETURNING id INTO v_kas_cash_acct_id;

  -- accounting_config — mirror garindo defaults (NON_PKP, UMKM_FINAL_0_5
  -- pph, dual-write on, fiscal year starts January).
  INSERT INTO public.accounting_config (
    tenant_id,
    ppn_mode, ppn_rate_pct,
    pph_mode, pph_rate_pct,
    fiscal_year_start_month,
    enable_dual_write_to_gl,
    enable_strict_period_close,
    default_kas_account_id
  ) VALUES (
    p_tenant_id,
    'NON_PKP', 11.00,
    'UMKM_FINAL_0_5', 0.50,
    1,
    true,
    false,
    v_kas_cash_acct_id
  );
END $$;

REVOKE ALL ON FUNCTION public._seed_tenant_accounting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._seed_tenant_accounting(uuid)
  TO authenticated, service_role, vosi_rpc_owner;

COMMENT ON FUNCTION public._seed_tenant_accounting(uuid) IS
  'F-15 helper: seeds chart_of_accounts (copy from garindo template) + '
  'accounting_config (dual-write on) + default Kas Toko cash_account. '
  'Idempotent — early-exits if the tenant already has any COA row. '
  'Called by provision_tenant and by the F-15 backfill DO block below.';

-- ---------------------------------------------------------------------------
-- 2) Rewrite provision_tenant to call the helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_owner_user_id     uuid,
  p_slug              text,
  p_name              text,
  p_owner_name        text,
  p_owner_email       text,
  p_plan_code         text    DEFAULT 'STARTER',
  p_expires_in_months integer DEFAULT 12
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id         uuid;
  v_activated_at      timestamptz := now();
  v_expires_at        timestamptz;
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
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'provision_tenant: p_owner_user_id % not found in auth.users', p_owner_user_id
      USING errcode = 'P0002';
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

  INSERT INTO public.store_settings (tenant_id, nama_toko, updated_at)
  VALUES (v_tenant_id, p_name, now());

  -- F-15 fix: seed COA / accounting_config / default cash_account so the
  -- new tenant can immediately record sales + payments end-to-end with
  -- balanced GL. Was missing before this migration.
  PERFORM public._seed_tenant_accounting(v_tenant_id);

  RETURN jsonb_build_object(
    'tenant_id',     v_tenant_id,
    'slug',          p_slug,
    'name',          p_name,
    'plan_code',     p_plan_code,
    'activated_at',  v_activated_at,
    'expires_at',    v_expires_at,
    'owner_user_id', p_owner_user_id
  );
END $$;

-- ---------------------------------------------------------------------------
-- 3) Backfill existing broken tenants
-- ---------------------------------------------------------------------------

DO $backfill$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts WHERE tenant_id = t.id
    )
    AND id <> '11111111-1111-1111-1111-111111111111'::uuid
  LOOP
    PERFORM public._seed_tenant_accounting(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'F-15 backfill: seeded % previously-broken tenants', n;
END $backfill$;

COMMIT;
