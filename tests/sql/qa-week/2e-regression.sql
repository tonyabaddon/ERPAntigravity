-- 2E regression (2026-07-21): verify EditOrderModal's direct FE INSERT to
-- audit_log continues to work under RLS.
--
-- Context: Wave 2 Task 6 adversarial gate found that audit_log has RLS
-- (t_insert_own) but the tenant_id column defaults to _resolve_tenant_id()
-- and the policy checks the same value. Direct FE insert should succeed
-- without needing a SECDEF wrapper.
--
-- This test uses set_config('request.jwt.claims', ...) + SET LOCAL ROLE
-- authenticated to simulate a real FE call, then RAISES to rollback so no
-- test pollution.

DO $t$
DECLARE
  v_user uuid;
  v_id bigint;
BEGIN
  -- Toko Jaya tenant + arbitrary user in that tenant
  SELECT tu.user_id INTO v_user
  FROM tenant_users tu
  WHERE tu.tenant_id = '22222222-2222-2222-2222-222222222222'
  LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'FAIL: no tenant_users row for Toko Jaya';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'tenant_id', '22222222-2222-2222-2222-222222222222',
      'role', 'authenticated'
    )::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (
    '2e_regression_test',
    v_user,
    '{"scenario":"direct-fe-insert","source":"tests/sql/qa-week/2e-regression.sql"}'::jsonb
  )
  RETURNING id INTO v_id;

  EXECUTE 'RESET ROLE';

  -- Rollback via RAISE so the smoke row is not persisted
  RAISE EXCEPTION 'PASS: direct authenticated INSERT to audit_log succeeded (id=%). Rolled back cleanly.', v_id;
END $t$;
