-- 20261115000318_tenant_cost_daily.sql
-- P2-A: per-tenant daily cost signals table + backfill RPC.
-- Aggregates storage bytes from storage.objects (path tenants/{tenant_id}/...).
-- Gemini call instrumentation deferred (llm_calls has no tenant_id path yet).
-- See docs/superpowers/specs/2026-07-17-phase-1-2-final-plan.md §P2-A.

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.t_tenant_cost_daily (
  tenant_id    uuid      NOT NULL,
  usage_date   date      NOT NULL,
  gemini_calls int       NOT NULL DEFAULT 0,
  gemini_input_tokens  bigint  NOT NULL DEFAULT 0,
  gemini_output_tokens bigint  NOT NULL DEFAULT 0,
  cloud_run_requests   int     NOT NULL DEFAULT 0,
  storage_bytes        bigint  NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usage_date)
);

COMMENT ON TABLE public.t_tenant_cost_daily IS
  'P2-A: per-tenant daily cost signals (Gemini, Cloud Run, storage). '
  'Aggregated from storage.objects paths and future Gemini instrumentation. '
  'Best-effort — not audit-grade billing. Idempotent upserts only.';

-- ── Index for dashboard "last N days" queries ─────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_tenant_cost_daily_date
  ON public.t_tenant_cost_daily (usage_date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.t_tenant_cost_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.t_tenant_cost_daily FORCE ROW LEVEL SECURITY;

-- Tenants can read only their own rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 't_tenant_cost_daily'
      AND policyname = 't_select_own'
  ) THEN
    CREATE POLICY t_select_own ON public.t_tenant_cost_daily
      FOR SELECT TO authenticated
      USING (tenant_id = public._resolve_tenant_id());
  END IF;
END $$;

-- Platform admins can read all rows (needed for cost dashboard).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 't_tenant_cost_daily'
      AND policyname = 'p_platform_admin_readall'
  ) THEN
    CREATE POLICY p_platform_admin_readall ON public.t_tenant_cost_daily
      FOR SELECT TO authenticated
      USING (public.is_platform_admin());
  END IF;
END $$;

-- vosi_rpc_owner SECDEF ownership — allows INSERT … RETURNING inside RPCs
-- (per memory: secdef_returning_gap). Using true + WITH CHECK true required.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 't_tenant_cost_daily'
      AND policyname = 't_select_own_secdef'
  ) THEN
    CREATE POLICY t_select_own_secdef ON public.t_tenant_cost_daily
      TO vosi_rpc_owner USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Backfill RPC ──────────────────────────────────────────────────────────────
-- Scans storage.objects for tenant-prefixed paths and aggregates storage bytes
-- per tenant into t_tenant_cost_daily for the requested date.
-- Path convention: tenants/{tenant_id}/{any_subpath}
-- Safe to call multiple times — upserts on conflict.

CREATE OR REPLACE FUNCTION public.backfill_tenant_cost_daily(
  p_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_caller_uid  uuid;
  v_rows_upserted int;
  v_result      jsonb;
BEGIN
  -- Auth gate: must be an active platform_admin
  v_caller_uid := auth.uid();
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING errcode = 'P0403';
  END IF;

  -- Aggregate storage bytes per tenant from storage.objects.
  -- Path pattern: tenants/{tenant_id_uuid}/{rest...}
  -- (metadata->>'size') is a text field in storage.objects; coerce to bigint.
  WITH tenant_storage AS (
    SELECT
      (regexp_matches(name, '^tenants/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'))[1]::uuid AS tenant_id,
      COALESCE(SUM((metadata->>'size')::bigint), 0) AS storage_bytes
    FROM storage.objects
    WHERE name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    GROUP BY 1
  )
  INSERT INTO public.t_tenant_cost_daily (tenant_id, usage_date, storage_bytes, updated_at)
  SELECT tenant_id, p_date, storage_bytes, now()
  FROM tenant_storage
  WHERE tenant_id IS NOT NULL
  ON CONFLICT (tenant_id, usage_date) DO UPDATE
    SET storage_bytes = EXCLUDED.storage_bytes,
        updated_at    = now();

  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;

  -- Observability log entry
  RAISE LOG 'backfill_tenant_cost_daily: caller=% date=% rows_upserted=% feature=cost_dashboard_backfill',
    v_caller_uid, p_date, v_rows_upserted;

  v_result := jsonb_build_object(
    'ok',           true,
    'date',         p_date,
    'rows_upserted', v_rows_upserted
  );
  RETURN v_result;
END $$;

-- Allow authenticated callers to invoke (internal is_platform_admin() gate enforces authorization).
GRANT EXECUTE ON FUNCTION public.backfill_tenant_cost_daily(date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_tenant_cost_daily(date) FROM anon;

COMMENT ON FUNCTION public.backfill_tenant_cost_daily(date) IS
  'P2-A: aggregate storage bytes per tenant from storage.objects into t_tenant_cost_daily. '
  'Platform admin only. Idempotent — safe to re-run for the same date.';
