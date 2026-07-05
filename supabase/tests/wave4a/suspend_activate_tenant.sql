BEGIN;
SELECT plan(13);

-- ============================================================
-- pgTAP: suspend_tenant + activate_tenant RPCs
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- tenants NOT NULL columns: id, slug, name, status
-- ============================================================

-- ── Fixture: create an isolated tenant for ARCHIVED guard test ───────────────
INSERT INTO public.tenants (id, slug, name, status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000000', 'archived-test', 'Archived Test Tenant', 'ARCHIVED');

-- ── Case 1: suspend_tenant — non-admin caller → P0403 ───────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","is_platform_admin":"false"}',
  true
);
SELECT throws_ok(
  $$ SELECT public.suspend_tenant(
       '11111111-1111-1111-1111-111111111111'::uuid,
       'test reason'
     ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 1: suspend_tenant non-admin blocked with P0403'
);

-- ── Case 2: activate_tenant — non-admin caller → P0403 ──────────────────────
SELECT throws_ok(
  $$ SELECT public.activate_tenant(
       '11111111-1111-1111-1111-111111111111'::uuid
     ) $$,
  'P0403',
  'PLATFORM_ADMIN_REQUIRED',
  'Case 2: activate_tenant non-admin blocked with P0403'
);

-- ── Restore admin JWT for remaining cases ───────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
    'is_platform_admin', 'true'
  )::text,
  true
);

-- ── Case 3: suspend_tenant — bad tenant → P0404 ──────────────────────────────
SELECT throws_ok(
  $$ SELECT public.suspend_tenant(
       '00000000-0000-0000-0000-000000000000'::uuid,
       'some reason'
     ) $$,
  'P0404',
  'TENANT_NOT_FOUND',
  'Case 3: suspend_tenant unknown tenant raises P0404'
);

-- ── Case 4: suspend_tenant — empty reason → 22023 ───────────────────────────
SELECT throws_ok(
  $$ SELECT public.suspend_tenant(
       '11111111-1111-1111-1111-111111111111'::uuid,
       '   '
     ) $$,
  '22023',
  'INVALID_REASON',
  'Case 4: suspend_tenant empty/whitespace reason raises 22023 INVALID_REASON'
);

-- ── Case 5: suspend_tenant — NULL reason → 22023 ────────────────────────────
SELECT throws_ok(
  $$ SELECT public.suspend_tenant(
       '11111111-1111-1111-1111-111111111111'::uuid,
       NULL
     ) $$,
  '22023',
  'INVALID_REASON',
  'Case 5: suspend_tenant NULL reason raises 22023 INVALID_REASON'
);

-- ── Case 6: activate_tenant — bad tenant → P0404 ────────────────────────────
SELECT throws_ok(
  $$ SELECT public.activate_tenant(
       '00000000-0000-0000-0000-000000000000'::uuid
     ) $$,
  'P0404',
  'TENANT_NOT_FOUND',
  'Case 6: activate_tenant unknown tenant raises P0404'
);

-- ── Case 7: suspend_tenant — happy path: Garindo → SUSPENDED ────────────────
DO $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
      'is_platform_admin', 'true'
    )::text,
    true
  );
  PERFORM public.suspend_tenant(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'pgTAP smoke: payment overdue'
  );
END $$;

SELECT is(
  (SELECT status FROM public.tenants WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'SUSPENDED',
  'Case 7: suspend_tenant — Garindo status=SUSPENDED after call'
);

-- ── Case 8: audit row for SUSPEND_TENANT exists ──────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND action = 'SUSPEND_TENANT'
  ),
  'Case 8: SUSPEND_TENANT audit row exists for Garindo'
);

-- ── Case 9: suspend_tenant — idempotent: second call returns noop=true ──────
SELECT ok(
  (SELECT (public.suspend_tenant(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'pgTAP idempotent check'
  ) ->> 'noop')::boolean),
  'Case 9: suspend_tenant idempotent — second call returns noop=true'
);

-- ── Case 10: activate_tenant — happy path: Garindo → ACTIVE ─────────────────
DO $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',               '227c28f4-09f6-4dc9-af7a-01b0feb2c194',
      'is_platform_admin', 'true'
    )::text,
    true
  );
  PERFORM public.activate_tenant(
    '11111111-1111-1111-1111-111111111111'::uuid
  );
END $$;

SELECT is(
  (SELECT status FROM public.tenants WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  'ACTIVE',
  'Case 10: activate_tenant — Garindo status=ACTIVE after call'
);

-- ── Case 11: audit row for ACTIVATE_TENANT exists ───────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.platform_admin_audit
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111'::uuid
      AND action = 'ACTIVATE_TENANT'
  ),
  'Case 11: ACTIVATE_TENANT audit row exists for Garindo'
);

-- ── Case 12: activate_tenant — idempotent: second call returns noop=true ────
SELECT ok(
  (SELECT (public.activate_tenant(
    '11111111-1111-1111-1111-111111111111'::uuid
  ) ->> 'noop')::boolean),
  'Case 12: activate_tenant idempotent — second call returns noop=true'
);

-- ── Case 13: activate_tenant — ARCHIVED tenant → 22023 ──────────────────────
SELECT throws_ok(
  $$ SELECT public.activate_tenant(
       'aaaaaaaa-0000-0000-0000-000000000000'::uuid
     ) $$,
  '22023',
  'CANNOT_ACTIVATE_ARCHIVED',
  'Case 13: activate_tenant ARCHIVED tenant raises 22023 CANNOT_ACTIVATE_ARCHIVED'
);

SELECT * FROM finish();
ROLLBACK;
