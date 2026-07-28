-- 20261115000542_tier_config_schema_and_rpc.sql
-- Phase 1b Task 1 — Owner-configurable 2-4 pricing tiers per tenant.
-- Adds tier label columns to tenant_settings, price columns to stocks,
-- widens customers.default_pricing_tier CHECK, ships update_tenant_tier_config RPC.
--
-- Idempotent: safe to re-run. Adds columns IF NOT EXISTS, drops CHECK IF EXISTS
-- before re-add, CREATE OR REPLACE for function.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.update_tenant_tier_config(text,text,text,text);
--   ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
--   ALTER TABLE public.customers ADD CONSTRAINT customers_default_pricing_tier_check
--     CHECK (default_pricing_tier IN ('eceran','grosir'));
--   ALTER TABLE public.stocks DROP COLUMN IF EXISTS price_tier_3, DROP COLUMN IF EXISTS price_tier_4;
--   ALTER TABLE public.tenant_settings
--     DROP COLUMN IF EXISTS tier_1_label,
--     DROP COLUMN IF EXISTS tier_2_label,
--     DROP COLUMN IF EXISTS tier_3_label,
--     DROP COLUMN IF EXISTS tier_4_label;

-- ─── Schema: tenant_settings label columns ───────────────────────────────────
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS tier_1_label TEXT NOT NULL DEFAULT 'Eceran',
  ADD COLUMN IF NOT EXISTS tier_2_label TEXT NOT NULL DEFAULT 'Grosir',
  ADD COLUMN IF NOT EXISTS tier_3_label TEXT,
  ADD COLUMN IF NOT EXISTS tier_4_label TEXT;

-- ─── Schema: stocks price columns ────────────────────────────────────────────
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS price_tier_3 NUMERIC,
  ADD COLUMN IF NOT EXISTS price_tier_4 NUMERIC;

-- ─── Schema: widen customers CHECK ───────────────────────────────────────────
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_default_pricing_tier_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_default_pricing_tier_check
    CHECK (default_pricing_tier IN ('eceran','grosir','tier_3','tier_4'));

-- ─── SECDEF RPC: update_tenant_tier_config ───────────────────────────────────
-- Error taxonomy:
--   TCFG_FORBIDDEN         (P0403) — caller is not Owner role
--   TCFG_LABEL_INVALID     (P0400) — label length not 3-30 (with hint = 'tier_N')
--   TCFG_LABEL_DUPLICATE   (P0409) — case-insensitive collision among active labels

CREATE OR REPLACE FUNCTION public.update_tenant_tier_config(
  p_tier_1_label TEXT,
  p_tier_2_label TEXT,
  p_tier_3_label TEXT,
  p_tier_4_label TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_tenant_id   uuid := public._resolve_tenant_id();
  v_t1 TEXT := TRIM(p_tier_1_label);
  v_t2 TEXT := TRIM(p_tier_2_label);
  v_t3 TEXT := NULLIF(TRIM(COALESCE(p_tier_3_label, '')), '');
  v_t4 TEXT := NULLIF(TRIM(COALESCE(p_tier_4_label, '')), '');
  v_labels TEXT[];
BEGIN
  -- Auth: owner role required
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'TCFG_FORBIDDEN' USING errcode = 'P0403';
  END IF;

  -- Length validation: tier_1/2 required 3-30 chars; tier_3/4 NULL or 3-30
  IF LENGTH(v_t1) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_1';
  END IF;
  IF LENGTH(v_t2) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_2';
  END IF;
  IF v_t3 IS NOT NULL AND LENGTH(v_t3) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_3';
  END IF;
  IF v_t4 IS NOT NULL AND LENGTH(v_t4) NOT BETWEEN 3 AND 30 THEN
    RAISE EXCEPTION 'TCFG_LABEL_INVALID' USING errcode = 'P0400', hint = 'tier_4';
  END IF;

  -- Case-insensitive uniqueness among active labels
  v_labels := ARRAY_REMOVE(ARRAY[LOWER(v_t1), LOWER(v_t2),
                                 LOWER(COALESCE(v_t3, '')), LOWER(COALESCE(v_t4, ''))],
                           '');
  IF cardinality(v_labels) <> cardinality(ARRAY(SELECT DISTINCT unnest(v_labels))) THEN
    RAISE EXCEPTION 'TCFG_LABEL_DUPLICATE' USING errcode = 'P0409';
  END IF;

  UPDATE public.tenant_settings
     SET tier_1_label = v_t1,
         tier_2_label = v_t2,
         tier_3_label = v_t3,
         tier_4_label = v_t4,
         updated_at   = now()
   WHERE tenant_id = v_tenant_id;
END $$;

ALTER FUNCTION public.update_tenant_tier_config(text, text, text, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.update_tenant_tier_config(text, text, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_tenant_tier_config(text, text, text, text) FROM anon;
