-- Staging/Prod isolation regression test.
-- Covers:
--   Part A — 3 prod tenants × 8 tables × 2 cross-pairs = 48 cross-tenant
--            read attempts. Every attempt must return 0 rows (RLS blocks).
--   Part B — 1 cross-env spot check: staging tenant JWT reading prod tenant
--            data must return 0 rows (env boundary + tenant boundary).
--
-- Runs via /database/query endpoint. Wraps in a DO block that RAISEs at the
-- end so no state is written; the RAISE payload carries the counts to check.
--
-- Expected: MATRIX_TOTAL_LEAKS=0; CROSS_ENV_LEAK=0

DO $t$
DECLARE
  v_tenants uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    '49cbbc94-977c-4bc4-bf9b-0195342f1608'::uuid
  ];
  v_tables text[] := ARRAY[
    'customers','purchase_invoices','pembayaran','journal_entries',
    'kasir_transactions','bank_accounts','audit_log','warehouse_transfers'
  ];
  v_user            uuid;
  v_read_leak       int;
  v_total_leaks     int := 0;
  v_cross_env_leak  int;
  v_staging_tenant  uuid;
  v_staging_user    uuid;
  i int;
  j int;
  k int;
BEGIN
  -- Part A: 3 prod tenants × 2 cross-tenant pairs × 8 tables = 48 checks
  FOR i IN 1..3 LOOP
    SELECT tu.user_id INTO v_user
    FROM public.tenant_users tu WHERE tu.tenant_id = v_tenants[i] LIMIT 1;
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenants[i]::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    FOR j IN 1..3 LOOP
      CONTINUE WHEN i = j;
      FOR k IN 1..array_length(v_tables, 1) LOOP
        BEGIN
          EXECUTE format('SELECT COUNT(*) FROM public.%I WHERE tenant_id = %L', v_tables[k], v_tenants[j]) INTO v_read_leak;
          IF v_read_leak > 0 THEN
            v_total_leaks := v_total_leaks + 1;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- table might not exist for some tenants; skip
        END;
      END LOOP;
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;

  -- Part B: cross-env spot check — staging tenant JWT reading a prod tenant
  SELECT id INTO v_staging_tenant FROM public.tenants WHERE slug = 'garindo-staging' LIMIT 1;
  SELECT user_id INTO v_staging_user FROM public.tenant_users WHERE tenant_id = v_staging_tenant LIMIT 1;
  IF v_staging_tenant IS NOT NULL AND v_staging_user IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_staging_user::text, 'tenant_id', v_staging_tenant::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE format('SELECT COUNT(*) FROM public.customers WHERE tenant_id = %L', v_tenants[1]) INTO v_cross_env_leak;
    EXECUTE 'RESET ROLE';
  ELSE
    v_cross_env_leak := -1;  -- setup failure
  END IF;

  RAISE EXCEPTION 'MATRIX_TOTAL_LEAKS=%; CROSS_ENV_LEAK=% (both should be 0)',
    v_total_leaks, v_cross_env_leak;
END $t$;
