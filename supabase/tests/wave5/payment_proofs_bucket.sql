BEGIN;
SELECT plan(7);

-- ============================================================
-- pgTAP: payment-proofs Storage bucket + RLS policies
-- Platform admin UUID: 227c28f4-09f6-4dc9-af7a-01b0feb2c194
-- Garindo tenant_id:   11111111-1111-1111-1111-111111111111
-- ============================================================

-- ── 1. Bucket exists ─────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'payment-proofs'),
  'payment-proofs bucket exists in storage.buckets'
);

-- ── 2. Bucket is private ─────────────────────────────────────────────────────
SELECT ok(
  (SELECT public = false FROM storage.buckets WHERE id = 'payment-proofs'),
  'payment-proofs bucket is private (public=false)'
);

-- ── 3. file_size_limit = 5MB ─────────────────────────────────────────────────
SELECT ok(
  (SELECT file_size_limit = 5242880 FROM storage.buckets WHERE id = 'payment-proofs'),
  'payment-proofs file_size_limit = 5242880 (5MB)'
);

-- ── 4. allowed_mime_types contains image/jpeg, image/png, application/pdf ────
SELECT ok(
  (SELECT
     ARRAY['image/jpeg', 'image/png', 'application/pdf'] <@ allowed_mime_types
     AND allowed_mime_types <@ ARRAY['image/jpeg', 'image/png', 'application/pdf']
   FROM storage.buckets WHERE id = 'payment-proofs'),
  'payment-proofs allowed_mime_types = {image/jpeg,image/png,application/pdf}'
);

-- ── 5. Policy p_platform_admin_crud exists on storage.objects ────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'p_platform_admin_crud'
  ),
  'policy p_platform_admin_crud exists on storage.objects'
);

-- ── 6. Policy t_tenant_owner_read exists on storage.objects ──────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 't_tenant_owner_read'
  ),
  'policy t_tenant_owner_read exists on storage.objects'
);

-- ── 7. Legacy over-broad policy is gone ──────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'authenticated full access payment-proofs'
  ),
  'legacy "authenticated full access payment-proofs" policy has been dropped'
);

-- ── NOTE: anon / cross-tenant isolation ──────────────────────────────────────
-- Verifying that anon cannot list the bucket and that a tenant cannot read
-- another tenant's objects requires SET ROLE to anon/authenticated with a
-- specific JWT, which is not feasible inside pgTAP running as the postgres
-- superuser (SET ROLE is not allowed after connecting as postgres in
-- Supabase Cloud). These checks must be done manually:
--
--   Manual check A — anon blocked:
--     Using Supabase JS client with NO auth, attempt:
--       supabase.storage.from('payment-proofs').list('')
--     Expect: 403 (policy blocks).
--
--   Manual check B — cross-tenant blocked:
--     Sign in as a user for tenant A (slug='garindo'). Attempt to list:
--       supabase.storage.from('payment-proofs').list('other-tenant-slug/')
--     Expect: empty result (RLS filters out non-matching paths).
--
--   Manual check C — platform admin has full access:
--     Sign in as platform admin user. Attempt list + upload + delete.
--     Expect: all succeed.

SELECT * FROM finish();
ROLLBACK;
