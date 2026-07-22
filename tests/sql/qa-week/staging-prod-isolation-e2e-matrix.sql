-- End-to-end verify: bootstrap_tenant_context with fake JWTs across
-- prod tenant × staging tenant × 4 hostname surfaces = 8 cases.
--
-- Prod tenant  + prod hostname  → returns tenant
-- Prod tenant  + staging hostname → RAISE ENV_MISMATCH
-- Staging tenant + prod hostname → RAISE ENV_MISMATCH
-- Staging tenant + staging hostname → returns tenant

DO $t$
DECLARE
  v_prod_tid    uuid;
  v_prod_uid    uuid;
  v_stg_tid     uuid;
  v_stg_uid     uuid;
  v_result      jsonb;
  v_pass        int := 0;
  v_fail        int := 0;
  v_msg         text := '';
BEGIN
  SELECT t.id, tu.user_id INTO v_prod_tid, v_prod_uid
  FROM public.tenants t JOIN public.tenant_users tu ON tu.tenant_id = t.id
  WHERE t.slug = 'garindo' LIMIT 1;

  SELECT t.id, tu.user_id INTO v_stg_tid, v_stg_uid
  FROM public.tenants t JOIN public.tenant_users tu ON tu.tenant_id = t.id
  WHERE t.slug = 'garindo-staging' LIMIT 1;

  -- Case 1: prod tenant JWT + app.caleo.id → PASS (returns)
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_prod_uid::text, 'tenant_id', v_prod_tid::text, 'role', 'authenticated')::text, true);
  BEGIN
    v_result := public.bootstrap_tenant_context('app.caleo.id');
    IF v_result->>'environment' = 'production' THEN
      v_pass := v_pass + 1;
    ELSE
      v_fail := v_fail + 1; v_msg := v_msg || 'c1_unexpected;';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c1_throw=%s;', SQLERRM);
  END;

  -- Case 2: prod tenant JWT + admin.caleo.id → PASS (admin surface = prod env)
  BEGIN
    v_result := public.bootstrap_tenant_context('admin.caleo.id');
    IF v_result->>'environment' = 'production' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_msg := v_msg || 'c2_unexpected;'; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c2_throw=%s;', SQLERRM);
  END;

  -- Case 3: prod tenant JWT + staging.app.caleo.id → RAISE ENV_MISMATCH
  BEGIN
    v_result := public.bootstrap_tenant_context('staging.app.caleo.id');
    v_fail := v_fail + 1; v_msg := v_msg || 'c3_no_throw;';
  EXCEPTION WHEN SQLSTATE 'P0401' THEN
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c3_wrong=%s;', SQLERRM);
  END;

  -- Case 4: prod tenant JWT + staging.admin.caleo.id → RAISE
  BEGIN
    v_result := public.bootstrap_tenant_context('staging.admin.caleo.id');
    v_fail := v_fail + 1; v_msg := v_msg || 'c4_no_throw;';
  EXCEPTION WHEN SQLSTATE 'P0401' THEN
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c4_wrong=%s;', SQLERRM);
  END;

  -- Staging tenant JWT
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_stg_uid::text, 'tenant_id', v_stg_tid::text, 'role', 'authenticated')::text, true);

  -- Case 5: staging tenant JWT + staging.app.caleo.id → PASS
  BEGIN
    v_result := public.bootstrap_tenant_context('staging.app.caleo.id');
    IF v_result->>'environment' = 'staging' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_msg := v_msg || 'c5_unexpected;'; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c5_throw=%s;', SQLERRM);
  END;

  -- Case 6: staging tenant JWT + staging.admin.caleo.id → PASS
  BEGIN
    v_result := public.bootstrap_tenant_context('staging.admin.caleo.id');
    IF v_result->>'environment' = 'staging' THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; v_msg := v_msg || 'c6_unexpected;'; END IF;
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c6_throw=%s;', SQLERRM);
  END;

  -- Case 7: staging tenant JWT + app.caleo.id → RAISE
  BEGIN
    v_result := public.bootstrap_tenant_context('app.caleo.id');
    v_fail := v_fail + 1; v_msg := v_msg || 'c7_no_throw;';
  EXCEPTION WHEN SQLSTATE 'P0401' THEN
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c7_wrong=%s;', SQLERRM);
  END;

  -- Case 8: staging tenant JWT + admin.caleo.id → RAISE
  BEGIN
    v_result := public.bootstrap_tenant_context('admin.caleo.id');
    v_fail := v_fail + 1; v_msg := v_msg || 'c8_no_throw;';
  EXCEPTION WHEN SQLSTATE 'P0401' THEN
    v_pass := v_pass + 1;
  WHEN OTHERS THEN
    v_fail := v_fail + 1; v_msg := v_msg || format('c8_wrong=%s;', SQLERRM);
  END;

  RAISE EXCEPTION 'ISOLATION MATRIX: pass=%/8 fail=% | errors=%', v_pass, v_fail, COALESCE(NULLIF(v_msg,''), 'none');
END $t$;
