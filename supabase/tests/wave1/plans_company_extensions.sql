BEGIN;
SELECT plan(9);

-- plans columns exist
SELECT has_column('public', 'plans', 'description');
SELECT has_column('public', 'plans', 'target_segment');
SELECT has_column('public', 'plans', 'is_recommended');

-- plans backfilled
SELECT is(
  (SELECT description FROM public.plans WHERE code = 'PRO'),
  'Toko retail dengan tempo + accounting',
  'PRO plan has description'
);
SELECT is(
  (SELECT is_recommended FROM public.plans WHERE code = 'PRO'),
  true,
  'PRO is marked recommended'
);

-- company_settings columns exist
SELECT has_column('public', 'company_settings', 'industry');
SELECT has_column('public', 'company_settings', 'employee_range');

-- employee_range CHECK constraint blocks bad values
SELECT throws_ok(
  $$ INSERT INTO public.company_settings (tenant_id, company_name, address, phone, email, updated_at, opname_require_witness, costing_method, industry, employee_range)
     VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'Test Co', '123 Test St', '555-0000', 'test@test.com', now(), false, 'FIFO', 'x', 'INVALID BUCKET') $$,
  '23514',
  NULL,
  'employee_range CHECK rejects invalid bucket'
);

-- Garindo backfilled
SELECT is(
  (SELECT industry FROM public.company_settings
   WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'garindo')),
  'Retail/Toko umum',
  'Garindo industry backfilled'
);

SELECT finish();
ROLLBACK;
