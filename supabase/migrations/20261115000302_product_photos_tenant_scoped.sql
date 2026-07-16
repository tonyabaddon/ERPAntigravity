-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000302 — product-photos: tenant-scoped write policies
--
-- Concern 1 of Caleo Phase 1 hardening Task 2 follow-up.
-- Closes the last cross-tenant write leak: any authenticated user could
-- overwrite any tenant's product photos by knowing the SKU.
--
-- Bucket stays PUBLIC (product images rendered in <img> tags publicly — Shopify
-- pattern). Only the WRITE side is being locked down.
--
-- Old policies (cross-tenant):
--   product_photos_insert  — any authenticated user, no path guard
--   product_photos_update  — any authenticated user, no path guard
--   product_photos_delete  — any authenticated user, no path guard
--   product_photos_select  — public role, kept as-is (intentional public read)
--
-- New path pattern: tenants/{tenant_id}/products/{uuid}.{ext}
--   - tenant_id enforced via _resolve_tenant_id() (same pattern as migrations 300, 301)
--   - UUID per photo prevents cross-tenant enumeration even on a public bucket
--
-- Also drops dead policy t_tenant_owner_read on payment-proofs (slug-based,
-- superseded by UUID-path policies added in migration 301).
--
-- Applied via execute_sql (not apply_migration — postgres role cannot own
-- storage.objects; Task 1 discovery commit 1e7b410).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PRODUCT-PHOTOS: drop cross-tenant write policies, add tenant-scoped ones
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old permissive write policies (no path guard)
DROP POLICY IF EXISTS "product_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "product_photos_delete" ON storage.objects;

-- Keep product_photos_select (public role, intentional public read — no change)

-- Tenant-scoped INSERT: only upload to own tenant's folder
-- Path: tenants/{tenant_id}/products/{uuid}.{ext}
DROP POLICY IF EXISTS "product_photos_insert_own_tenant" ON storage.objects;
CREATE POLICY "product_photos_insert_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'product-photos'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
    AND (storage.foldername(name))[3] = 'products'
  );

-- Tenant-scoped UPDATE (upsert: true path for re-uploads)
DROP POLICY IF EXISTS "product_photos_update_own_tenant" ON storage.objects;
CREATE POLICY "product_photos_update_own_tenant" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'product-photos'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
    AND (storage.foldername(name))[3] = 'products'
  )
  WITH CHECK (
    bucket_id = 'product-photos'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
    AND (storage.foldername(name))[3] = 'products'
  );

-- Tenant-scoped DELETE
DROP POLICY IF EXISTS "product_photos_delete_own_tenant" ON storage.objects;
CREATE POLICY "product_photos_delete_own_tenant" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'product-photos'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
    AND (storage.foldername(name))[3] = 'products'
  );

-- NOTE: COMMENT ON POLICY requires supabase_storage_admin ownership.
-- Applied via psql as postgres (which can CREATE/DROP policies but not COMMENT).
-- Policy docs are in this migration file header instead.

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. PAYMENT-PROOFS: drop dead slug-based policy t_tenant_owner_read
--    Superseded by UUID-path policies (payment_proofs_read_own_tenant) from
--    migration 301. Slug-based guard is dead code since all new files use UUID paths.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "t_tenant_owner_read" ON storage.objects;
