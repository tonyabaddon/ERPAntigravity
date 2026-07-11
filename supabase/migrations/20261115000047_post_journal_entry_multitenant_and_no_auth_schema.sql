-- 20261115000047_post_journal_entry_multitenant_and_no_auth_schema.sql
--
-- QA cycle Session 1 (P0 discovery continuation from 20261115000046):
-- The GL dual-write path had two more blockers after `record_kasir_sale`
-- was patched to look up the correct `accounting_config` row per tenant.
--
-- Fix A — p_tenant_id resolution.
--   Every caller passes NULL for `p_tenant_id` (legacy from single-tenant
--   era). `_post_journal_entry` inserts `accounting_periods (tenant_id,...)
--   VALUES (p_tenant_id,...)`. NULL tenant_id fails the `tenant_id =
--   _resolve_tenant_id()` RLS check → 42501. Fix by resolving from JWT at
--   body start when caller passes NULL.
--
-- Fix B — auth.uid() call.
--   `_post_journal_entry` is SECDEF owned by `vosi_rpc_owner`, which lacks
--   USAGE on schema `auth`. Direct call to `auth.uid()` inside SECDEF body
--   fails with "permission denied for schema auth". Postgres cannot GRANT
--   USAGE on the auth schema (owned by supabase_admin, we lack GRANT OPTION).
--   Fix by replacing `auth.uid()` with JWT-claim reading using
--   `current_setting('request.jwt.claims', true)::jsonb->>'sub'`, which
--   returns the same value without needing auth schema access.
--
-- Both fixes are applied via `pg_get_functiondef` + `regexp_replace` /
-- `replace` + `EXECUTE`. The current live function state (post two ad-hoc
-- migrations from the session) already has both patches; this migration
-- codifies them so a fresh apply reproduces the same state.

BEGIN;

DO $$
DECLARE v_body text;
BEGIN
  v_body := pg_get_functiondef((
    SELECT oid FROM pg_proc
    WHERE proname = '_post_journal_entry'
      AND pronamespace = 'public'::regnamespace
  ));

  -- Fix A: inject p_tenant_id resolution right after first BEGIN\n
  -- (idempotent — if already present, do not add a second line)
  IF position('COALESCE(p_tenant_id, public._resolve_tenant_id())' IN v_body) = 0 THEN
    v_body := regexp_replace(
      v_body,
      E'(AS \\$function\\$[\\s\\S]*?BEGIN\\n)',
      E'\\1  p_tenant_id := COALESCE(p_tenant_id, public._resolve_tenant_id());\n',
      ''
    );
  END IF;

  -- Fix B: replace every auth.uid() with JWT-claim-based extraction
  -- (idempotent — string replace is a no-op if already replaced)
  v_body := replace(
    v_body,
    'auth.uid()',
    E'NULLIF((current_setting(\'request.jwt.claims\', true)::jsonb->>\'sub\'), \'\')::uuid'
  );

  EXECUTE v_body;
END $$;

COMMIT;
