-- Slot 236 — Security hardening: REVOKE EXECUTE on all public SECDEF RPCs FROM anon
--
-- Advisor `anon_security_definer_function_executable` flagged that anon role
-- (unauthenticated session) can execute ~180 SECDEF RPCs owned by
-- vosi_rpc_owner. Anon should never be able to bypass RLS via SECDEF because
-- SECDEF runs as its owner (superuser-adjacent). Follows slot 126 pattern.
--
-- Idempotent: iterates current SECDEF functions each run; safe to reapply.
-- Preserves authenticated grant by re-GRANTing explicitly.
--
-- No exclusions: our app flow requires the user to authenticate via Supabase
-- Auth before any RPC call. bootstrap_tenant_context and platform-admin
-- checks all run under an authenticated JWT (verified via grep of src/).

DO $revoke_secdef$
DECLARE
  r record;
  revoked_count integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname   = 'public'
       AND p.prosecdef = true
       AND p.prokind   = 'f'
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    -- Remove PUBLIC's default grant (which is where anon inherits from)
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC',
                   r.proname, r.args);
    -- Explicit revoke on anon in case a prior migration granted it directly
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon',
                   r.proname, r.args);
    -- Ensure authenticated retains execute
    EXECUTE format('GRANT  EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
                   r.proname, r.args);
    revoked_count := revoked_count + 1;
  END LOOP;

  RAISE NOTICE 'slot 236: revoked EXECUTE from anon on % SECDEF public functions', revoked_count;
END $revoke_secdef$;

-- Post-condition assertion: anon should have zero SECDEF execute privileges left.
DO $assert$
DECLARE
  leaks integer;
BEGIN
  SELECT COUNT(*) INTO leaks
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname   = 'public'
     AND p.prosecdef = true
     AND p.prokind   = 'f'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leaks > 0 THEN
    RAISE EXCEPTION 'slot 236 assertion failed: % SECDEF functions still executable by anon', leaks;
  END IF;
END $assert$;
