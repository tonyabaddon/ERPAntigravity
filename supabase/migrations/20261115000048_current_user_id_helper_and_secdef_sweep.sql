-- 20261115000048_current_user_id_helper_and_secdef_sweep.sql
--
-- QA cycle Session 1, permanent fix for F-4 / F-5.
--
-- Problem
-- =======
-- After the Phase-A hardening we moved every write-path RPC to be SECURITY
-- DEFINER owned by `vosi_rpc_owner` (NOINHERIT NOLOGIN). Those RPCs still
-- call `auth.uid()` internally. But `auth` schema is owned by
-- `supabase_admin`; `vosi_rpc_owner` has no USAGE on `auth`, and we cannot
-- grant it (we lack GRANT OPTION on schemas we didn't create). Result:
-- every one of the 64 SECDEF RPCs owned by `vosi_rpc_owner` that references
-- `auth.uid()` will fail at runtime with
--     "permission denied for schema auth"
-- the first time it's exercised. Kasir sale posting was hit first because
-- it's the highest-frequency path.
--
-- Superficial fix (20261115000047) inlined the JWT-claims read into a
-- single RPC. That's not durable — the same pattern repeats in 63 other
-- RPCs and any new RPC we write.
--
-- Permanent fix
-- =============
-- 1. Create a shared `public._current_user_id()` helper: STABLE SQL, no
--    SECDEF, reads `current_setting('request.jwt.claims', true)::jsonb->>'sub'`
--    and casts to uuid. Semantically equivalent to `auth.uid()` for API
--    requests but requires no auth-schema access. Owned by postgres,
--    executable by authenticated + vosi_rpc_owner + service_role.
--
-- 2. Sweep every SECDEF function in schema public owned by `vosi_rpc_owner`
--    that references `auth.uid()`, replace with `public._current_user_id()`
--    via `pg_get_functiondef` + `replace` + `EXECUTE`.
--
-- 3. Unwind the inline JWT read added by 20261115000047 in
--    `_post_journal_entry`, replacing it with the same helper for
--    consistency.
--
-- After this migration, any new RPC we write can call
-- `public._current_user_id()` and never touch the auth schema — so the
-- vosi_rpc_owner ownership model stays sustainable.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
    (current_setting('request.jwt.claims', true)::jsonb->>'sub'),
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public._current_user_id() IS
  'Returns the authenticated user''s id from the JWT sub claim. '
  'Use inside SECURITY DEFINER functions owned by vosi_rpc_owner in place of '
  'auth.uid(), because vosi_rpc_owner lacks USAGE on schema auth.';

REVOKE ALL ON FUNCTION public._current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._current_user_id()
  TO authenticated, service_role, vosi_rpc_owner;

-- ---------------------------------------------------------------------------
-- 2) Sweep SECDEFs owned by vosi_rpc_owner that still call auth.uid()
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_body text;
  v_patched int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef = true
      AND p.proowner = 'vosi_rpc_owner'::regrole
      AND pg_get_functiondef(p.oid) ~ 'auth\.uid\(\)'
  LOOP
    v_body := pg_get_functiondef(r.oid);
    v_body := replace(v_body, 'auth.uid()', 'public._current_user_id()');
    EXECUTE v_body;
    v_patched := v_patched + 1;
  END LOOP;
  RAISE NOTICE 'patched % SECDEF functions', v_patched;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Unwind the inline JWT read in _post_journal_entry (added by 000047)
--    so it uses the helper too — single source of truth.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_body text;
BEGIN
  v_body := pg_get_functiondef((
    SELECT oid FROM pg_proc
    WHERE proname = '_post_journal_entry'
      AND pronamespace = 'public'::regnamespace
  ));

  v_body := replace(
    v_body,
    E'NULLIF((current_setting(\'request.jwt.claims\', true)::jsonb->>\'sub\'), \'\')::uuid',
    'public._current_user_id()'
  );

  EXECUTE v_body;
END $$;

COMMIT;
