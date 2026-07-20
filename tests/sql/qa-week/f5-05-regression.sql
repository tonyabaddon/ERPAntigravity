-- F5-05 regression: cross-tenant customer create + same-tenant conflict
-- Runs against prod DB. Wrapped in RAISE EXCEPTION rollback = zero side effects.
-- Precondition: migration 20261115000501 applied.

\echo === F5-05 regression: 3 scenarios ===

DO $t$
DECLARE
  v_tenant_a uuid := '11111111-1111-1111-1111-111111111111';  -- Garindo
  v_tenant_b uuid := '22222222-2222-2222-2222-222222222222';  -- Toko Jaya
  v_test_phone text := 'F5-05-TEST-' || extract(epoch from now())::text;
  v_a_id text; v_b_id text; v_a_id2 text;
BEGIN
  -- Scenario 1: tenant A creates customer with phone X → succeeds
  INSERT INTO customers (id, tenant_id, wa_number)
  VALUES (gen_random_uuid()::text, v_tenant_a, v_test_phone)
  RETURNING id INTO v_a_id;
  RAISE NOTICE 'PASS S1: tenant A created id=%', v_a_id;

  -- Scenario 2: tenant B creates customer with SAME phone → succeeds (was blocked pre-fix)
  INSERT INTO customers (id, tenant_id, wa_number)
  VALUES (gen_random_uuid()::text, v_tenant_b, v_test_phone)
  RETURNING id INTO v_b_id;
  RAISE NOTICE 'PASS S2: tenant B created id=% with same phone', v_b_id;

  -- Scenario 3: tenant A same phone again → conflicts (per-tenant uniqueness holds)
  BEGIN
    INSERT INTO customers (id, tenant_id, wa_number)
    VALUES (gen_random_uuid()::text, v_tenant_a, v_test_phone);
    RAISE NOTICE 'FAIL S3: same tenant same phone should have raised unique violation';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS S3: same tenant same phone correctly blocked';
  END;

  RAISE EXCEPTION 'rollback smoke';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'DONE: %', SQLERRM;
END $t$;
