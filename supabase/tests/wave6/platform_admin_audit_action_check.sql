BEGIN;
SELECT plan(8);

-- Seed a fake auth.users row (rolled back at end of transaction)
INSERT INTO auth.users
  (id, instance_id, email, aud, role,
   confirmation_token, recovery_token, email_change_token_new, email_change,
   email_change_token_current, reauthentication_token, phone_change, phone_change_token)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid,
   '00000000-0000-0000-0000-000000000000'::uuid,
   'auditcheck@test.com', 'authenticated', 'authenticated',
   '','','','','','','','')
ON CONFLICT DO NOTHING;

-- 7 lives_ok: one per Wave 6 new action value

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'PROVISION_TENANT', '{}'::jsonb)$$,
  'PROVISION_TENANT accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'DEPROVISION_TENANT', '{}'::jsonb)$$,
  'DEPROVISION_TENANT accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'CREATE_SALES_REP', '{}'::jsonb)$$,
  'CREATE_SALES_REP accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'DEACTIVATE_SALES_REP', '{}'::jsonb)$$,
  'DEACTIVATE_SALES_REP accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'TOGGLE_MODULE', '{}'::jsonb)$$,
  'TOGGLE_MODULE accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'VERIFY_PAYMENT', '{}'::jsonb)$$,
  'VERIFY_PAYMENT accepted by CHECK');

SELECT lives_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'REJECT_PAYMENT', '{}'::jsonb)$$,
  'REJECT_PAYMENT accepted by CHECK');

-- 1 throws_ok: regression guard — unknown value must still be rejected
SELECT throws_ok(
  $$INSERT INTO public.platform_admin_audit
      (admin_user_id, admin_email, tenant_id, action, detail)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'auditcheck@test.com',
            NULL, 'DEFINITELY_NOT_A_REAL_ACTION_2026', '{}'::jsonb)$$,
  '23514',
  NULL,
  'unknown action still rejected by CHECK');

SELECT finish();
ROLLBACK;
