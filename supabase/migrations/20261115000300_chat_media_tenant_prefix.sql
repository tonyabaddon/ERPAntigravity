-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000300 — Chat-media tenant-prefixed path + private bucket + signed URL
--
-- Fixes cross-tenant read leak documented in migration 20261115000202:
--   chat-media is public=true, path pattern `${Date.now()}_${filename}` has
--   no tenant isolation → any user who guesses a filename can read any
--   tenant's chat media attachments.
--
-- Fix:
--   1. Bucket → private (public = false)
--   2. Drop the overly-permissive `chat_media_authenticated_write` ALL-policy
--      from migration 000202 (which allowed any authenticated user to read/write
--      any file in the bucket)
--   3. Add tenant-scoped RLS policies: tenants/{tenant_id}/{uuid}_{filename}
--      path pattern, enforced via users table lookup
--
-- New path pattern: tenants/{tenant_id}/{uuid}_{sanitized_filename}
-- Storage access: signed URLs with 1-hour TTL (via getSignedChatMediaUrl helper)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Change bucket to private (was public=true in initial setup + migration 000202)
UPDATE storage.buckets
SET public = false
WHERE id = 'chat-media';

-- 2. Drop existing permissive ALL-policy from migration 000202
--    (allowed any authenticated user to read/write any file in the bucket)
DROP POLICY IF EXISTS "chat_media_authenticated_write" ON storage.objects;

-- Also drop any prior named variants in case they were applied
DROP POLICY IF EXISTS "chat_media_read_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_write_authenticated" ON storage.objects;

-- 3. Tenant-scoped read: only tenant members can read their tenant's files
--    Path structure: tenants/{tenant_id}/{uuid}_{filename}
DROP POLICY IF EXISTS "chat_media_read_own_tenant" ON storage.objects;
CREATE POLICY "chat_media_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM public.users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- 4. Tenant-scoped write: only tenant members can upload to their tenant's folder
DROP POLICY IF EXISTS "chat_media_write_own_tenant" ON storage.objects;
CREATE POLICY "chat_media_write_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM public.users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- 5. Tenant-scoped delete: only tenant members can delete their own files
DROP POLICY IF EXISTS "chat_media_delete_own_tenant" ON storage.objects;
CREATE POLICY "chat_media_delete_own_tenant" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM public.users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

COMMENT ON POLICY "chat_media_read_own_tenant" ON storage.objects IS
  'Migration 300: tenant-scoped read for chat-media. Path pattern: tenants/{tenant_id}/{uuid}_{filename}. Access via signed URLs (1-hour TTL).';

COMMENT ON POLICY "chat_media_write_own_tenant" ON storage.objects IS
  'Migration 300: tenant-scoped write for chat-media. Enforces tenants/{tenant_id}/... prefix.';

COMMENT ON POLICY "chat_media_delete_own_tenant" ON storage.objects IS
  'Migration 300: tenant-scoped delete for chat-media. Own-tenant files only.';

COMMIT;
