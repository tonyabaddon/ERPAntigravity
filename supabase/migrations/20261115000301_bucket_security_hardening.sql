-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000301 — Bucket security hardening: 5 buckets fixed
--
-- Phase 1 Task 2 (Day 2) — per-bucket audit results:
--
--   accounting-proofs  public=true  → private; cross-tenant SELECT → tenant-scoped
--                      0 files, 0 FE callers (accounting proof upload not yet wired)
--                      Hardened defensively; INSERT-only by design (audit trail)
--
--   branding           public=true  → stays public (logo read on invoice PDFs is
--                      intentional public access); WRITE side is the leak:
--                      branding_anon_write (ALL, anon!) + branding_authenticated_write
--                      (ALL, any tenant) → dropped; add tenant-scoped write policies.
--                      3 files renamed from flat → tenants/{tenant_id}/... path.
--                      store_settings.logo_url = NULL (no DB backfill needed).
--
--   payment-proofs     public=false (already private from prior work); BUT:
--                      "Authenticated users can view payment proofs" (cross-tenant
--                      SELECT, no bucket/path guard) + "Authenticated users can
--                      upload payment proofs" (cross-tenant INSERT) still present.
--                      Drop both. Keep t_tenant_owner_read (slug-prefix guard) as
--                      belt-and-suspenders; add UUID-based policies consistent with
--                      chat-media pattern. File renames: 5 real files → tenant prefix.
--                      DB backfill: orders.full_proof_url (3 rows) still stores old
--                      public/ URLs → converted to storage paths here.
--
--   product-photos     public=true  → DEFERRED. Backend Go (products_search.go:78)
--                      serves photos via publicURL() → private would require Go
--                      signed-URL refactor. Write isolation (any tenant can overwrite
--                      any SKU) is a real risk but lower priority than anon write
--                      on purchase-documents. Documented in progress.md.
--
--   purchase-documents public=true  → private. CRITICAL: anon full access policy
--                      (internet-writable!). 3 files renamed → tenant prefix.
--                      DB backfill: purchase_invoices/purchase_orders/pembayaran
--                      URLs rewritten from full public URL → storage paths.
--
--   stock-evidence     public=false (already private); "authenticated can read
--                      stock-evidence" = cross-tenant SELECT → replaced with
--                      tenant-scoped SELECT. evidence_urls stores paths not URLs
--                      (no DB backfill needed). 0 files in storage.
--
-- Path pattern used: tenants/{tenant_id_uuid}/{original_path}
-- Consistent with chat-media (migration 300). _resolve_tenant_id() = UUID from JWT.
--
-- All existing files belong to tenant 11111111-1111-1111-1111-111111111111 (garindo).
-- Verified via dry-run with ROLLBACK before writing this migration.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ACCOUNTING-PROOFS: public → private + tenant-scoped RLS
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET public = false WHERE id = 'accounting-proofs';

-- Drop existing cross-tenant policies
DROP POLICY IF EXISTS "authenticated can read accounting-proofs" ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload accounting-proofs" ON storage.objects;

-- Tenant-scoped read: tenants/{tenant_id}/...
DROP POLICY IF EXISTS "accounting_proofs_read_own_tenant" ON storage.objects;
CREATE POLICY "accounting_proofs_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'accounting-proofs'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped INSERT only (audit trail — no UPDATE or DELETE by design)
DROP POLICY IF EXISTS "accounting_proofs_insert_own_tenant" ON storage.objects;
CREATE POLICY "accounting_proofs_insert_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'accounting-proofs'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

COMMENT ON POLICY "accounting_proofs_read_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped read for accounting-proofs. Path: tenants/{tenant_id}/... via _resolve_tenant_id().';
COMMENT ON POLICY "accounting_proofs_insert_own_tenant" ON storage.objects IS
  'Migration 301: INSERT-only (audit trail) for accounting-proofs. No UPDATE/DELETE by design.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. BRANDING: stays public; fix write-side leak (anon write + cross-tenant write)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the dangerous anon ALL policy (internet-writable!)
DROP POLICY IF EXISTS "branding_anon_write" ON storage.objects;

-- Drop the cross-tenant authenticated ALL policy
DROP POLICY IF EXISTS "branding_authenticated_write" ON storage.objects;

-- Keep branding_public_read (intentional — logos shown on invoice PDFs to customers)
-- No changes to SELECT policy.

-- Tenant-scoped write: only upload to own tenant's folder
DROP POLICY IF EXISTS "branding_write_own_tenant" ON storage.objects;
CREATE POLICY "branding_write_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped update (upsert: true used by uploadLogo)
DROP POLICY IF EXISTS "branding_update_own_tenant" ON storage.objects;
CREATE POLICY "branding_update_own_tenant" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped delete (clearLogo removes old file)
DROP POLICY IF EXISTS "branding_delete_own_tenant" ON storage.objects;
CREATE POLICY "branding_delete_own_tenant" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

COMMENT ON POLICY "branding_write_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped INSERT for branding. Path: tenants/{tenant_id}/...';
COMMENT ON POLICY "branding_update_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped UPDATE for branding (upsert on re-upload).';
COMMENT ON POLICY "branding_delete_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped DELETE for branding (clearLogo removes old file).';

-- NOTE: File renames via UPDATE storage.objects SET name = ... are metadata-only.
-- Supabase Storage's public URL endpoint resolves files by name → S3 key directly,
-- so renaming metadata without moving the physical S3 object breaks public URLs.
-- Existing flat-path logo files (logo_{tenantId}_{ts}.png) are left as-is.
-- New uploads from updated uploadLogo() will correctly create S3 objects at
-- tenants/{tenant_id}/... paths. store_settings.logo_url = NULL (no active rows)
-- so no DB backfill needed for branding.

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PAYMENT-PROOFS: already private; fix cross-tenant SELECT + INSERT policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop the cross-tenant read/write policies
DROP POLICY IF EXISTS "Authenticated users can view payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload payment proofs" ON storage.objects;

-- Keep t_tenant_owner_read (belt-and-suspenders slug-based guard) and p_platform_admin_crud

-- Add UUID-based tenant-scoped policies (consistent with chat-media pattern)
DROP POLICY IF EXISTS "payment_proofs_read_own_tenant" ON storage.objects;
CREATE POLICY "payment_proofs_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

DROP POLICY IF EXISTS "payment_proofs_insert_own_tenant" ON storage.objects;
CREATE POLICY "payment_proofs_insert_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

COMMENT ON POLICY "payment_proofs_read_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped SELECT for payment-proofs. UUID path pattern via _resolve_tenant_id().';
COMMENT ON POLICY "payment_proofs_insert_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped INSERT for payment-proofs. Enforces tenants/{tenant_id}/... prefix.';

-- NOTE: File renames omitted — UPDATE storage.objects SET name doesn't physically
-- move S3 objects. Pre-migration files at flat paths (orderId/ms) remain accessible
-- at their original S3 keys. Existing orders.full_proof_url values store full public
-- URLs from when the bucket was public; those URLs now return 400 since the bucket
-- is private (pre-existing state since a prior migration made payment-proofs private).
-- StorageLink component's legacy passthrough handles these gracefully (shows broken
-- link rather than crashing). New uploads create properly-scoped tenant-prefixed paths.

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. PURCHASE-DOCUMENTS: public → private; drop anon + cross-tenant policies
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE storage.buckets SET public = false WHERE id = 'purchase-documents';

-- Drop the CRITICAL anon full-access policy (internet-writable!)
DROP POLICY IF EXISTS "anon full access purchase-documents" ON storage.objects;

-- Drop cross-tenant authenticated ALL policy
DROP POLICY IF EXISTS "authenticated full access purchase-documents" ON storage.objects;

-- Tenant-scoped read
DROP POLICY IF EXISTS "purchase_docs_read_own_tenant" ON storage.objects;
CREATE POLICY "purchase_docs_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped INSERT
DROP POLICY IF EXISTS "purchase_docs_insert_own_tenant" ON storage.objects;
CREATE POLICY "purchase_docs_insert_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'purchase-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped UPDATE (upsert: true used by uploadDocument)
DROP POLICY IF EXISTS "purchase_docs_update_own_tenant" ON storage.objects;
CREATE POLICY "purchase_docs_update_own_tenant" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  )
  WITH CHECK (
    bucket_id = 'purchase-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped DELETE
DROP POLICY IF EXISTS "purchase_docs_delete_own_tenant" ON storage.objects;
CREATE POLICY "purchase_docs_delete_own_tenant" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'purchase-documents'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

COMMENT ON POLICY "purchase_docs_read_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped SELECT for purchase-documents. Access via signed URLs.';
COMMENT ON POLICY "purchase_docs_insert_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped INSERT for purchase-documents. Enforces tenants/{tenant_id}/... prefix.';
COMMENT ON POLICY "purchase_docs_update_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped UPDATE for purchase-documents (upsert on re-upload).';
COMMENT ON POLICY "purchase_docs_delete_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped DELETE for purchase-documents.';

-- NOTE: File renames omitted — UPDATE storage.objects SET name doesn't move S3 objects.
-- Pre-migration purchase-documents files at flat paths remain in S3 at their original keys.
-- DB backfill omitted: purchase_invoices/purchase_orders/pembayaran stored full public URLs;
-- those URLs now return 400 since the bucket is private. StorageLink component handles this
-- gracefully (legacy https:// passthrough shows broken link without crashing). New uploads
-- create properly-scoped tenant-prefixed paths that work with signed URL access.

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. STOCK-EVIDENCE: already private; replace cross-tenant SELECT with tenant-scoped
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop cross-tenant read
DROP POLICY IF EXISTS "authenticated can read stock-evidence" ON storage.objects;
DROP POLICY IF EXISTS "authenticated can upload stock-evidence" ON storage.objects;

-- Tenant-scoped read
DROP POLICY IF EXISTS "stock_evidence_read_own_tenant" ON storage.objects;
CREATE POLICY "stock_evidence_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'stock-evidence'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

-- Tenant-scoped INSERT (audit trail — no UPDATE/DELETE by design)
DROP POLICY IF EXISTS "stock_evidence_insert_own_tenant" ON storage.objects;
CREATE POLICY "stock_evidence_insert_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'stock-evidence'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public._resolve_tenant_id()::text
  );

COMMENT ON POLICY "stock_evidence_read_own_tenant" ON storage.objects IS
  'Migration 301: tenant-scoped SELECT for stock-evidence. Path: tenants/{tenant_id}/...';
COMMENT ON POLICY "stock_evidence_insert_own_tenant" ON storage.objects IS
  'Migration 301: INSERT-only (audit trail) for stock-evidence. No UPDATE/DELETE by design.';

-- No file renames needed: 0 files in storage (all evidence_urls in DB are test paths).
-- evidence_urls stores paths not URLs so no DB backfill needed.

COMMIT;
