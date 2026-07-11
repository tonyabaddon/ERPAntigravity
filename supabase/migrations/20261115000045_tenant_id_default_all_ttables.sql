-- 20261115000045_tenant_id_default_all_ttables.sql
--
-- Session-1 QA cycle finding (P0 blocker discovered while smoke-testing
-- customer create in Sales wizard): frontend `supabase.from('customers')
-- .insert({...})` sends NO `tenant_id` in the payload. `customers.tenant_id`
-- is `NOT NULL` with **no column default**, so the row's tenant_id becomes
-- NULL. RLS check `tenant_id = _resolve_tenant_id()` evaluates `NULL = uuid`
-- which is NULL/false → 42501 "new row violates row-level security policy".
--
-- Same issue affects ALL 78 T-tables (verified: none have a tenant_id default).
-- This has been broken since Phase A hardening — pre-Phase-A worked only
-- because postgres-owned RPCs bypassed RLS.
--
-- Fix: add column default `_resolve_tenant_id()` to `tenant_id` on every
-- T-table. Frontend continues its "omit tenant_id, DB fills from JWT" pattern
-- with no code changes.
--
-- Safety: RLS `WITH CHECK (tenant_id = _resolve_tenant_id())` still fires,
-- so a payload with explicit tenant_id ≠ JWT-tenant is still rejected. The
-- default only kicks in when the client omits the column.
--
-- Combined with 20261115000044 (write-path unblock: role + guard predicate)
-- and 20261115000042 (anti-sentinel CHECK on tenants.id), this completes
-- the Phase A write-path hardening story.

BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 't_insert_own'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public._resolve_tenant_id()',
      r.relname
    );
  END LOOP;
END $$;

COMMIT;
