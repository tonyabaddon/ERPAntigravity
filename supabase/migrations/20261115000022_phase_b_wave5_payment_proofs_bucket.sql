-- ============================================================
-- Wave 5 Task 3: payment-proofs Storage bucket + RLS policies
-- Migration: 20261115000022
-- ============================================================
-- Summary:
--   1. Upsert storage.buckets row for 'payment-proofs' (private,
--      5MB limit, JPG/PNG/PDF only).
--   2. Drop legacy broad policy "authenticated full access payment-proofs"
--      (ALL on authenticated with no path-scoping — insecure, replaced here).
--   3. Create p_platform_admin_crud — platform_admin FULL CRUD.
--   4. Create t_tenant_owner_read — tenant owner SELECT-only on own-slug paths.
--
-- FE enforcement note:
--   Storage API enforces file_size_limit=5MB and allowed_mime_types at the
--   API/SDK layer. Frontend MUST additionally validate before upload:
--     - max 5MB per file
--     - accept only image/jpeg, image/png, application/pdf
--
-- RLS on storage.objects: already enabled by Supabase default (verified).
-- storage.objects owner: supabase_storage_admin
--   postgres role has USAGE on storage schema and SELECT on storage.objects,
--   sufficient to CREATE POLICY (Supabase Cloud allows this).
-- ============================================================

-- ── 1. Upsert bucket ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 2. Drop legacy over-broad policy ────────────────────────────────────────
-- This policy granted ALL (INSERT/SELECT/UPDATE/DELETE) to every authenticated
-- user on the entire payment-proofs bucket with no path scoping. It is
-- incompatible with the multi-tenant isolation model introduced here.
DROP POLICY IF EXISTS "authenticated full access payment-proofs" ON storage.objects;

-- ── 3. Platform-admin FULL CRUD policy ──────────────────────────────────────
-- Allows platform admins (JWT claim is_platform_admin=true) to INSERT, SELECT,
-- UPDATE, DELETE any object in the payment-proofs bucket.
-- Note: Storage upsert requires INSERT + SELECT + UPDATE; all covered by ALL.
CREATE POLICY p_platform_admin_crud ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND public._is_platform_admin_from_jwt()
  )
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND public._is_platform_admin_from_jwt()
  );

-- ── 4. Tenant owner SELECT-only policy ──────────────────────────────────────
-- Allows the owning tenant to read only objects under their own slug prefix.
-- Path convention: <tenant-slug>/<filename>
-- The slug is derived from the tenants table via _resolve_tenant_id() which
-- reads the tenant_id JWT claim.
CREATE POLICY t_tenant_owner_read ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND name LIKE (
      (SELECT slug FROM public.tenants WHERE id = public._resolve_tenant_id())
      || '/%'
    )
  );
