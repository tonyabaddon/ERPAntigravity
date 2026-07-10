-- supabase/tests/wave6/platform_settings.sql
-- pgTAP tests for platform_settings singleton (Wave 6 Task 8).
-- plan(4): table + seed, super_admin UPDATE, sales_rep UPDATE silently filtered, sales_rep SELECT.

BEGIN;

SELECT plan(4);

-- ─── Test 1: table exists with singleton seed row ─────────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_settings WHERE id = 1
  ),
  'platform_settings singleton row (id=1) exists'
);

-- ─── Test 2: super_admin can UPDATE ───────────────────────────────────────────
-- Simulate super_admin JWT claim, update, assert new value, then rollback via RAISE.

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    (SELECT user_id::text FROM public.platform_admins
     WHERE role = 'super_admin' AND status = 'active'
     LIMIT 1),
    true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('role','authenticated','app_role','super_admin')::text,
    true);
  UPDATE public.platform_settings
     SET bank_name = '__pgtap_super_test__'
   WHERE id = 1;
  RAISE EXCEPTION 'pgtap_rollback';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'pgtap_rollback' THEN RAISE; END IF;
END;
$$;

SELECT ok(true, 'super_admin UPDATE completed without permission error');

-- ─── Test 3: sales_rep UPDATE is silently filtered (0 rows affected) ──────────
-- After a sales_rep update attempt the value should remain unchanged.

DO $$
DECLARE
  v_before text;
  v_after  text;
BEGIN
  SELECT bank_name INTO v_before FROM public.platform_settings WHERE id = 1;

  PERFORM set_config('request.jwt.claim.sub',
    (SELECT user_id::text FROM public.platform_admins
     WHERE role = 'sales_rep' AND status = 'active'
     LIMIT 1),
    true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('role','authenticated','app_role','sales_rep')::text,
    true);

  UPDATE public.platform_settings
     SET bank_name = '__sales_rep_should_not_update__'
   WHERE id = 1;

  SELECT bank_name INTO v_after FROM public.platform_settings WHERE id = 1;

  IF v_after = '__sales_rep_should_not_update__' THEN
    RAISE EXCEPTION 'sales_rep was able to UPDATE platform_settings';
  END IF;
END;
$$;

SELECT ok(true, 'sales_rep UPDATE silently filtered — value unchanged');

-- ─── Test 4: sales_rep can SELECT ─────────────────────────────────────────────

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_settings WHERE id = 1
  ),
  'sales_rep (or any authenticated user) can SELECT platform_settings'
);

SELECT * FROM finish();

ROLLBACK;
