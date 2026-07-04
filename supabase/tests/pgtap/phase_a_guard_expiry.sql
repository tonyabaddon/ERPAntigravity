-- supabase/tests/pgtap/phase_a_guard_expiry.sql
-- pgTAP tests for _guard_expiry_write() function
-- Tests that the function correctly enforces subscription expiry modes

BEGIN;
SELECT plan(3);

-- Test 1: ACTIVE mode allows write
-- When tenant_expiry_mode is ACTIVE, _guard_expiry_write() should not raise
PERFORM set_config('request.jwt.claims', '{"tenant_expiry_mode":"ACTIVE"}', true);
SELECT lives_ok($$SELECT _guard_expiry_write()$$, 'ACTIVE mode allows write');

-- Test 2: GRACE mode allows write
-- When tenant_expiry_mode is GRACE, _guard_expiry_write() should not raise
PERFORM set_config('request.jwt.claims', '{"tenant_expiry_mode":"GRACE"}', true);
SELECT lives_ok($$SELECT _guard_expiry_write()$$, 'GRACE mode allows write');

-- Test 3: READONLY mode blocks write
-- When tenant_expiry_mode is READONLY, _guard_expiry_write() should raise P0402
PERFORM set_config('request.jwt.claims', '{"tenant_expiry_mode":"READONLY"}', true);
SELECT throws_ok($$SELECT _guard_expiry_write()$$, 'P0402', 'SUBSCRIPTION_EXPIRED_READONLY',
                 'READONLY mode blocks write');

SELECT finish();
ROLLBACK;
