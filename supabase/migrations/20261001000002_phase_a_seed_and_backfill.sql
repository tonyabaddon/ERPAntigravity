-- supabase/migrations/20261001000002_phase_a_seed_and_backfill.sql
-- Phase A: seed plans, Garindo tenant, subscriptions, platform_admins,
-- tenant_users. Then bulk backfill tenant_id across business tables and
-- reshape company_settings + admin_users. Idempotent.

INSERT INTO public.plans (code, name, feature_bundle, sort_order) VALUES
  ('STARTER', 'Starter', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', false, 'modul_pengiriman', false,
    'modul_multi_warehouse', false, 'modul_akuntansi', false,
    'modul_jasa_layanan', false, 'modul_bom_recipe', false,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', false,
    'modul_diskon_tagihan', false, 'modul_multi_tier_price', false), 10),
  ('PRO', 'Pro', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', true, 'modul_pengiriman', true,
    'modul_multi_warehouse', false, 'modul_akuntansi', true,
    'modul_jasa_layanan', true, 'modul_bom_recipe', false,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', true,
    'modul_diskon_tagihan', true, 'modul_multi_tier_price', false), 20),
  ('PREMIUM', 'Premium', jsonb_build_object(
    'modul_kasir', true, 'modul_tempo', true, 'modul_pengiriman', true,
    'modul_multi_warehouse', true, 'modul_akuntansi', true,
    'modul_jasa_layanan', true, 'modul_bom_recipe', true,
    'modul_diskon_kasir', true, 'modul_diskon_penjualan', true,
    'modul_diskon_tagihan', true, 'modul_multi_tier_price', true), 30)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tenants (id, slug, name, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'garindo', 'Garindo Jaya', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'PREMIUM', '2026-01-01', '2099-12-31')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.platform_admins (user_id, email, role)
SELECT id, email, 'super_admin' FROM auth.users
WHERE email = 'tonywei.office@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- All existing Garindo auth.users become tenant_users of Garindo with role 'owner'
-- (founder is sole tenant occupant; roles can be adjusted later via /admin Phase B)
INSERT INTO public.tenant_users (tenant_id, user_id, role, status)
SELECT '11111111-1111-1111-1111-111111111111', id, 'owner', 'ACTIVE'
FROM auth.users
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Deferred FK from Task 1: platform_admin_active_impersonation.tenant_slug → tenants(slug).
-- Garindo tenant now exists, so we can add the constraint safely.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_impersonation_tenant_slug') THEN
    ALTER TABLE public.platform_admin_active_impersonation
      ADD CONSTRAINT fk_impersonation_tenant_slug
      FOREIGN KEY (tenant_slug) REFERENCES public.tenants(slug) ON DELETE CASCADE;
  END IF;
END $$;

-- Pre-flight: bail if any table has tenant_id values that are NOT null,
-- NOT sentinel, and NOT Garindo. Manual investigation required.
DO $$
DECLARE
  r RECORD;
  v_bad_uuid UUID;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenants','tenant_users','tenant_settings','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    EXECUTE format($fmt$
      SELECT tenant_id FROM public.%I
      WHERE tenant_id IS NOT NULL
        AND tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
        AND tenant_id <> '11111111-1111-1111-1111-111111111111'::uuid
      LIMIT 1
    $fmt$, r.table_name) INTO v_bad_uuid;
    IF v_bad_uuid IS NOT NULL THEN
      RAISE EXCEPTION 'Table % has unexpected tenant_id=%. Manual investigation required before proceeding.',
        r.table_name, v_bad_uuid;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
  v_garindo UUID := '11111111-1111-1111-1111-111111111111';
  v_count BIGINT;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name NOT IN ('tenants','tenant_users','tenant_settings','tenant_subscriptions','tenant_activity_daily','platform_admin_audit')
  LOOP
    EXECUTE format($fmt$
      UPDATE public.%I SET tenant_id = %L
      WHERE tenant_id IS NULL
         OR tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
    $fmt$, r.table_name, v_garindo);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Backfilled %: % rows', r.table_name, v_count;
  END LOOP;
END $$;

UPDATE public.tenant_settings
SET tenant_id = '11111111-1111-1111-1111-111111111111', updated_at = now()
WHERE tenant_id IS NULL;

DROP INDEX IF EXISTS public.idx_tenant_settings_singleton;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_tenant_settings_tenant'
  ) THEN
    ALTER TABLE public.tenant_settings ADD CONSTRAINT uk_tenant_settings_tenant UNIQUE (tenant_id);
  END IF;
END $$;

COMMENT ON TABLE public.tenant_settings IS 'category=T';

-- company_settings: id-singleton → tenant-scoped
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.company_settings
SET tenant_id = '11111111-1111-1111-1111-111111111111'
WHERE tenant_id IS NULL;

ALTER TABLE public.company_settings DROP CONSTRAINT IF EXISTS company_settings_pkey;
ALTER TABLE public.company_settings ADD PRIMARY KEY (tenant_id);
ALTER TABLE public.company_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.company_settings DROP COLUMN IF EXISTS id;

DROP POLICY IF EXISTS "anon write company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "public read company_settings" ON public.company_settings;

CREATE POLICY "t_select_company_settings" ON public.company_settings
  FOR SELECT TO authenticated USING (tenant_id = _resolve_tenant_id());
CREATE POLICY "t_update_company_settings" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id())
  WITH CHECK (tenant_id = _resolve_tenant_id());

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_settings FROM anon;
GRANT SELECT, UPDATE ON public.company_settings TO authenticated;

COMMENT ON TABLE public.company_settings IS 'category=T';

-- Attach auto-seed trigger (function was defined in File 1)
DROP TRIGGER IF EXISTS trg_seed_company_settings ON public.tenants;
CREATE TRIGGER trg_seed_company_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public._seed_company_settings_for_new_tenant();

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.admin_users
SET tenant_id = '11111111-1111-1111-1111-111111111111'
WHERE tenant_id IS NULL;

COMMENT ON TABLE public.admin_users IS 'category=T';

-- Task 4.5: Dynamic tenant_id addition for business tables that lacked it.
-- Adds column + backfills Garindo + category=T comment for each discovered table.
-- Skip list = platform tables + Task-4-handled + WhatsApp daemon state + internal workspace.
DO $$
DECLARE
  r RECORD;
  v_garindo UUID := '11111111-1111-1111-1111-111111111111';
  v_count BIGINT;
  v_added INT := 0;
BEGIN
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      -- Only tables that DON'T yet have tenant_id
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name
          AND c.column_name = 'tenant_id'
      )
      -- Skip: platform tables from Task 1
      AND t.table_name NOT IN (
        'tenants','platform_admins','tenant_users','plans','tenant_subscriptions',
        'tenant_activity_daily','platform_admin_audit','platform_admin_active_impersonation',
        'tenant_settings',
        -- Skip: tables Task 4 explicitly restructured
        'company_settings','admin_users'
      )
      -- Skip: WhatsApp daemon session state (whatsmeow-go manages these, not per-tenant data)
      AND t.table_name NOT LIKE 'whatsmeow\_%' ESCAPE '\'
      -- Skip: internal workspace / system-wide
      AND t.table_name NOT IN ('_backfill_preview_je', 'model_cooldowns')
    ORDER BY t.table_name
  LOOP
    -- Add column (NULLable — NOT NULL enforced in Task 5)
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE',
      r.table_name
    );

    -- Backfill Garindo UUID (idempotent — WHERE clause skips already-set rows)
    EXECUTE format(
      $fmt$UPDATE public.%I SET tenant_id = %L WHERE tenant_id IS NULL$fmt$,
      r.table_name, v_garindo
    );
    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Category T comment (idempotent — COMMENT ON TABLE overwrites)
    EXECUTE format(
      $fmt$COMMENT ON TABLE public.%I IS 'category=T'$fmt$,
      r.table_name
    );

    RAISE NOTICE 'Added tenant_id to %: % rows backfilled', r.table_name, v_count;
    v_added := v_added + 1;
  END LOOP;

  RAISE NOTICE 'Task 4.5: added tenant_id to % business tables', v_added;
END $$;
