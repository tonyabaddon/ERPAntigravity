-- Migration 20261115000525: revert kasir_expense_category SECDEF ownership
-- from vosi_rpc_owner to postgres.
--
-- Symptom: after applying migration 20261115000523 to prod, calling any of
-- the 5 CRUD RPCs via PostgREST returned HTTP 500 with:
--   {"code":"42501","message":"permission denied for schema auth"}
--
-- Root cause: same class as migrations 000514 and 000519 (Entry #4 in
-- docs/superpowers/miss-log.md — "P3-05 SECDEF ownership on auth-schema RPCs").
-- Functions in migration 523 are SECURITY DEFINER + OWNER TO vosi_rpc_owner.
-- Their bodies call auth.uid() to derive the caller identity. In Supabase-
-- managed Postgres, vosi_rpc_owner lacks USAGE on schema auth (owned by
-- supabase_auth_admin, grants are blocked). Therefore auth.uid() fails at
-- runtime for ALL callers — not a smoke-only issue.
--
-- Fix: ALTER FUNCTION ... OWNER TO postgres (superuser bypass, same as the
-- 10 functions reverted in migration 000519 and the 22 reverted in 000514).
--
-- P3-05 least-privilege goal remains — the option is still to rewrite bodies
-- to use current_setting('request.jwt.claims') instead of auth.uid() (see
-- _resolve_tenant_id() as reference implementation). Deferred; tactical
-- revert here to unblock the feature in prod immediately.
--
-- Idempotent: ALTER FUNCTION safe to re-run. Applied inline on 2026-07-28
-- via direct psql before this migration file existed; this migration
-- persists the change for future re-applies of the migration set.

ALTER FUNCTION public._seed_kasir_expense_categories(uuid) OWNER TO postgres;
ALTER FUNCTION public.kasir_expense_category_create(text, uuid) OWNER TO postgres;
ALTER FUNCTION public.kasir_expense_category_update(uuid, text, boolean) OWNER TO postgres;
ALTER FUNCTION public.kasir_expense_category_soft_delete(uuid) OWNER TO postgres;
ALTER FUNCTION public.kasir_expense_category_restore(uuid) OWNER TO postgres;
ALTER FUNCTION public.kasir_expense_categories_reorder(uuid[]) OWNER TO postgres;

-- Verify: all 6 functions now owned by postgres
DO $$
DECLARE
  v_bad_owner_count int;
BEGIN
  SELECT COUNT(*) INTO v_bad_owner_count
  FROM pg_proc
  WHERE proname IN (
    '_seed_kasir_expense_categories',
    'kasir_expense_category_create',
    'kasir_expense_category_update',
    'kasir_expense_category_soft_delete',
    'kasir_expense_category_restore',
    'kasir_expense_categories_reorder'
  )
  AND pg_get_userbyid(proowner) <> 'postgres';

  IF v_bad_owner_count <> 0 THEN
    RAISE EXCEPTION 'migration 525 failed: % kasir_expense_* function(s) not owned by postgres', v_bad_owner_count;
  END IF;
  RAISE NOTICE 'migration 525: all 6 kasir_expense_* functions now OWNER postgres';
END $$;
