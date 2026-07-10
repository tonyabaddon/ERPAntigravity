BEGIN;
SELECT plan(3);

-- Simulate JWT with super_admin claim → should return true
SET LOCAL request.jwt.claims = '{"sub":"aaaa","platform_admin_role":"super_admin","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), true, 'super_admin claim -> true');

-- sales_rep claim → false
SET LOCAL request.jwt.claims = '{"sub":"bbbb","platform_admin_role":"sales_rep","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), false, 'sales_rep claim -> false');

-- missing claim → false (backward compat safe: no lockout for non-platform-admins)
SET LOCAL request.jwt.claims = '{"sub":"cccc","is_platform_admin":true}';
SELECT is(public._is_super_admin_from_jwt(), false, 'missing claim -> false');

SELECT * FROM finish();
ROLLBACK;
