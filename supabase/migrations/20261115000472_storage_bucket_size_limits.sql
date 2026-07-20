-- QA Week fix P1-02: file_size_limit + allowed_mime_types on all storage buckets
-- Applied 2026-07-19 via psql. Saving as numbered migration.
--
-- Idempotent: UPDATE re-write same values = no-op.

BEGIN;

UPDATE storage.buckets SET
    file_size_limit    = 5242880,  -- 5 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'product-photos';

UPDATE storage.buckets SET
    file_size_limit    = 2097152,  -- 2 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']
WHERE id = 'branding';

UPDATE storage.buckets SET
    file_size_limit    = 5242880,  -- 5 MB
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'stock-evidence';

UPDATE storage.buckets SET
    file_size_limit    = 10485760  -- 10 MB, MIME allowlist deferred (voice/video mix)
WHERE id = 'chat-media';

UPDATE storage.buckets SET
    file_size_limit    = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png']
WHERE id = 'purchase-documents';

COMMIT;
