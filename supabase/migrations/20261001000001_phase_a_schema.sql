-- supabase/migrations/20261001000001_phase_a_schema.sql
-- Phase A: multi-tenant foundation schema. Adds tenant registry, membership,
-- plans catalog, subscriptions, audit log, and activity telemetry skeleton.
-- Triggers for backfill-sensitive tables (sync_tenant_settings, seed_company_settings)
-- are ATTACHED in later migrations (000002 / 000003) to avoid firing during backfill.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,29}$'
                         AND slug NOT IN ('admin','api','auth','login','signup','www','t','static','assets','public','app','support','help')),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  custom_domain TEXT UNIQUE,
  suspended_at  TIMESTAMPTZ,
  suspended_reason TEXT,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug_active ON public.tenants(slug) WHERE status = 'ACTIVE';
COMMENT ON TABLE public.tenants IS 'category=P';

CREATE OR REPLACE FUNCTION public._forbid_slug_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug <> OLD.slug THEN
    RAISE EXCEPTION 'Tenant slug is immutable' USING errcode = '55006';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenants_slug_immutable ON public.tenants;
CREATE TRIGGER trg_tenants_slug_immutable
BEFORE UPDATE OF slug ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._forbid_slug_change();

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin','support')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
COMMENT ON TABLE public.platform_admins IS 'category=P';

CREATE TABLE IF NOT EXISTS public.tenant_users (
  id         BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff','kasir')),
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON public.tenant_users(user_id) WHERE status = 'ACTIVE';
COMMENT ON TABLE public.tenant_users IS 'category=A';

CREATE TABLE IF NOT EXISTS public.plans (
  code            TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{2,29}$'),
  name            TEXT NOT NULL,
  feature_bundle  JSONB NOT NULL,
  price_reference NUMERIC,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);
COMMENT ON TABLE public.plans IS 'category=G';

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_code          TEXT NOT NULL REFERENCES public.plans(code),
  feature_overrides  JSONB NOT NULL DEFAULT '{}'::jsonb,
  activated_at       DATE NOT NULL,
  expires_at         DATE NOT NULL,
  grace_expires_at   DATE GENERATED ALWAYS AS (expires_at + INTERVAL '7 day') STORED,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CHECK (expires_at >= activated_at)
);
CREATE INDEX IF NOT EXISTS idx_tenant_sub_expiry ON public.tenant_subscriptions(grace_expires_at);
COMMENT ON TABLE public.tenant_subscriptions IS 'category=P';

CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  admin_email   TEXT NOT NULL,
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id),
  action        TEXT NOT NULL CHECK (action IN ('IMPERSONATE_START','IMPERSONATE_END','CREATE_TENANT','CHANGE_PLAN','CHANGE_FEATURES','SUSPEND','ACTIVATE','ARCHIVE')),
  detail        JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_tenant_time ON public.platform_admin_audit(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_time  ON public.platform_admin_audit(admin_user_id, created_at DESC);
COMMENT ON TABLE public.platform_admin_audit IS 'category=P';

CREATE TABLE IF NOT EXISTS public.tenant_activity_daily (
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  rpc_calls     BIGINT NOT NULL DEFAULT 0,
  writes        BIGINT NOT NULL DEFAULT 0,
  wa_messages   BIGINT NOT NULL DEFAULT 0,
  ai_tokens     BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, activity_date)
);
COMMENT ON TABLE public.tenant_activity_daily IS 'category=P';

CREATE OR REPLACE VIEW public.v_tenant_effective_features AS
SELECT
  s.tenant_id,
  s.plan_code,
  (p.feature_bundle || s.feature_overrides) AS effective_features,
  CASE
    WHEN s.grace_expires_at < CURRENT_DATE THEN 'READONLY'
    WHEN s.expires_at < CURRENT_DATE THEN 'GRACE'
    ELSE 'ACTIVE'
  END AS expiry_state,
  s.expires_at,
  s.grace_expires_at
FROM public.tenant_subscriptions s
JOIN public.plans p ON p.code = s.plan_code;

-- Trigger functions declared here; ATTACHED in later migrations.
CREATE OR REPLACE FUNCTION public._seed_company_settings_for_new_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.company_settings (tenant_id, company_name)
  VALUES (NEW.id, NEW.name)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.sync_tenant_settings_from_subscription()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_effective JSONB;
BEGIN
  SELECT p.feature_bundle || NEW.feature_overrides INTO v_effective
  FROM public.plans p WHERE p.code = NEW.plan_code;

  INSERT INTO public.tenant_settings (tenant_id,
    modul_kasir, modul_tempo, modul_pengiriman, modul_multi_warehouse,
    modul_akuntansi, modul_jasa_layanan, modul_bom_recipe,
    modul_diskon_kasir, modul_diskon_penjualan, modul_diskon_tagihan,
    modul_multi_tier_price)
  VALUES (NEW.tenant_id,
    COALESCE((v_effective->>'modul_kasir')::boolean, false),
    COALESCE((v_effective->>'modul_tempo')::boolean, false),
    COALESCE((v_effective->>'modul_pengiriman')::boolean, false),
    COALESCE((v_effective->>'modul_multi_warehouse')::boolean, false),
    COALESCE((v_effective->>'modul_akuntansi')::boolean, false),
    COALESCE((v_effective->>'modul_jasa_layanan')::boolean, false),
    COALESCE((v_effective->>'modul_bom_recipe')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_kasir')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_penjualan')::boolean, false),
    COALESCE((v_effective->>'modul_diskon_tagihan')::boolean, false),
    COALESCE((v_effective->>'modul_multi_tier_price')::boolean, false))
  ON CONFLICT (tenant_id) DO UPDATE SET
    modul_kasir = EXCLUDED.modul_kasir,
    modul_tempo = EXCLUDED.modul_tempo,
    modul_pengiriman = EXCLUDED.modul_pengiriman,
    modul_multi_warehouse = EXCLUDED.modul_multi_warehouse,
    modul_akuntansi = EXCLUDED.modul_akuntansi,
    modul_jasa_layanan = EXCLUDED.modul_jasa_layanan,
    modul_bom_recipe = EXCLUDED.modul_bom_recipe,
    modul_diskon_kasir = EXCLUDED.modul_diskon_kasir,
    modul_diskon_penjualan = EXCLUDED.modul_diskon_penjualan,
    modul_diskon_tagihan = EXCLUDED.modul_diskon_tagihan,
    modul_multi_tier_price = EXCLUDED.modul_multi_tier_price,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.resync_all_tenants_on_plan_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.tenant_subscriptions
  SET updated_at = now()
  WHERE plan_code = NEW.code;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS public.platform_admin_active_impersonation (
  admin_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_slug   TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admin_active_impersonation IS 'category=P';
GRANT SELECT ON public.platform_admin_active_impersonation TO supabase_auth_admin;

ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE service_role SET statement_timeout = '60s';
