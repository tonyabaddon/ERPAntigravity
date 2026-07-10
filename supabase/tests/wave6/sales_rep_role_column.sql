BEGIN;
SELECT plan(7);

SELECT has_column('public', 'platform_admins', 'role',
  'platform_admins.role column exists');

SELECT col_type_is('public', 'platform_admins', 'role', 'text',
  'platform_admins.role is TEXT');

SELECT col_not_null('public', 'platform_admins', 'role',
  'platform_admins.role is NOT NULL');

SELECT col_default_is('public', 'platform_admins', 'role', 'super_admin',
  'platform_admins.role defaults to super_admin');

SELECT has_column('public', 'platform_admins', 'status',
  'platform_admins.status column exists');

SELECT col_default_is('public', 'platform_admins', 'status', 'active',
  'platform_admins.status defaults to active');

-- Correction B: verify CHECK enum accepts 'sales_rep'
-- (regression guard: Phase A left CHECK IN ('super_admin','support'))
SELECT matches(
  (SELECT pg_get_constraintdef(oid)
   FROM pg_constraint
   WHERE conrelid = 'public.platform_admins'::regclass
     AND conname = 'platform_admins_role_check'),
  'sales_rep',
  'CHECK enum contains sales_rep (Phase A enum swap applied)'
);

SELECT * FROM finish();
ROLLBACK;
