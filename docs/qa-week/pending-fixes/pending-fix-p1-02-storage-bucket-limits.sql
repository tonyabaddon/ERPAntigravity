-- PENDING FIX P1-02 — Storage bucket file_size_limit + allowed_mime_types
-- Origin: docs/qa-week/2026-07-19-session1-findings.md P1-02
-- Author: QA Session 2 (draft, not applied)
-- Reviewer: founder
-- Apply via: mcp__plugin_supabase_supabase__apply_migration (requires postgres role for storage.buckets updates)
--   Note: MCP execute_sql may fail 42501 on storage.buckets — memory says storage
--   policy DDL requires psql. Same may apply here — try MCP first, fallback psql.
--
-- WHY:
--   5 storage buckets have no file_size_limit today. Tenants can upload arbitrary
--   sized files (multi-GB). Two of them are PUBLIC read (branding, product-photos)
--   → bandwidth cost multiplier. Cost/abuse guardrail missing.
--
-- SCOPE:
--   Set file_size_limit on 5 buckets. Recommended MIME allowlists for buckets that
--   accept known types. chat-media/purchase-documents left MIME-unrestricted for
--   flexibility (accept PDFs, images, etc. — founder decides if needs tightening).
--
-- RECOMMENDED VALUES (founder to confirm):
--   product-photos:      5 MB     — product images, must fit MSME phone camera output
--   branding:            2 MB     — logo/banner, tighter cap OK
--   stock-evidence:      5 MB     — photo of stock damage/proof
--   chat-media:         10 MB     — WA chat attachments (voice notes, small video)
--   purchase-documents: 10 MB     — scanned invoice/PO PDFs
--
--   Existing (unchanged):
--     accounting-proofs:  5 MB
--     payment-proofs:     5 MB
--
-- IDEMPOTENCY:
--   UPDATE is idempotent when the target values are set. Re-run = same result.

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

-- VERIFY (run separately after commit):
-- SELECT id, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;
-- Expected: all 7 buckets have file_size_limit set (5 updated + accounting-proofs/payment-proofs unchanged).

-- ALTERNATIVES / DEFERRED:
-- 1. Rate limit at CDN layer for public buckets — not covered here.
-- 2. Bucket size total quota per tenant — not covered by storage.buckets (needs custom RPC).
-- 3. Virus scanning (uploaded files) — deferred, MSME threat model prioritizes bandwidth cost.

-- ROLLBACK:
-- UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
-- WHERE id IN ('product-photos','branding','stock-evidence','chat-media','purchase-documents');
