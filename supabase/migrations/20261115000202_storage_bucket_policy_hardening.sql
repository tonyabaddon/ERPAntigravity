-- ─────────────────────────────────────────────────────────────────────────────
-- 20261115000202 — Storage bucket policy hardening (CP2 class fix).
--
-- Audit finding on 2026-07-12:
--   Bucket           public  auth-INSERT  auth-UPDATE  auth-DELETE  notes
--   ----------------------------------------------------------------------
--   accounting-proofs  y     ✓            ✗            ✗            INSERT-only by design (audit trail)
--   branding           y     ✓            ✓            ✓            fixed by 20261115000200
--   chat-media         y     ✗ MISSING    ✗ MISSING    ✗ MISSING    ← BUG: uploadChatMedia() broken across all tenants
--   payment-proofs     n     ✓            ✗            ✗            INSERT-only by design (audit trail)
--   product-photos     y     ✓            ✓            ✓            fine
--   purchase-documents y     ✓            ✓            ✓            fine
--   stock-evidence     n     ✓            ✗            ✗            INSERT-only by design (opname audit trail)
--
-- Only actionable gap: chat-media has ZERO write policies, so `uploadChatMedia`
-- in src/lib/supabaseClient.ts (used by admin sending media in WhatsApp inbox)
-- silently fails 42501 for every tenant. Add authenticated ALL policy matching
-- the `branding_authenticated_write` pattern.
--
-- INSERT-only buckets (accounting-proofs, payment-proofs, stock-evidence) are
-- intentional — proofs must be preserved for audit; users cannot delete or
-- overwrite once uploaded. Left as-is.
--
-- Cross-tenant read leakage flag (not fixed here): chat-media is public=true,
-- and `uploadChatMedia` prefixes filenames with `${Date.now()}_${filename}` —
-- no tenant slug in the path. Public URLs let anyone read any tenant's chat
-- media if the filename is known. Acceptable today because filenames are
-- unpredictable, but log for a follow-up: tenant-prefixed path + narrower
-- public-read policy or signed URLs.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP POLICY IF EXISTS chat_media_authenticated_write ON storage.objects;
CREATE POLICY chat_media_authenticated_write
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'chat-media')
  WITH CHECK (bucket_id = 'chat-media');

COMMIT;
