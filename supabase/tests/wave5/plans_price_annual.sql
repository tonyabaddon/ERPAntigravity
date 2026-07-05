BEGIN;
SELECT plan(4);

SELECT has_column('public', 'plans', 'price_annual',
  'plans.price_annual column exists');

SELECT col_type_is('public', 'plans', 'price_annual', 'numeric(15,2)',
  'plans.price_annual is NUMERIC(15,2)');

SELECT is(
  (SELECT price_annual FROM public.plans WHERE code = 'STARTER'),
  1200000::numeric,
  'STARTER seed = 1.2M IDR'
);

SELECT is(
  (SELECT jsonb_object_agg(code, price_annual)
     FROM public.plans WHERE code IN ('STARTER','PRO','PREMIUM')),
  jsonb_build_object('STARTER', 1200000::numeric, 'PRO', 3600000::numeric, 'PREMIUM', 9000000::numeric),
  'All 3 known plans have correct annual price seed'
);

SELECT * FROM finish();
ROLLBACK;
