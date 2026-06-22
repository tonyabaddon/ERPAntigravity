-- =================================================================
-- Phase 3 Task 1: accounting-proofs storage bucket
--
-- Public bucket for storing proof images/PDFs attached to manual
-- journal entries (transfer confirmations, expense receipts, etc).
--
-- Pattern mirrors payment-proofs bucket (20260604000012 + 20260625000002 +
-- 20260625000006): public=true, authenticated full access (SELECT+INSERT).
-- No DELETE policy by design — proofs are audit-trail evidence.
-- =================================================================

-- 1. Bucket: public=true so getPublicUrl works in the app without
-- signed URLs (same pattern as payment-proofs after 20260625000006).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'accounting-proofs',
  'accounting-proofs',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. SELECT policy: authenticated users can read accounting proof files.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated can read accounting-proofs'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated can read accounting-proofs"
        ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'accounting-proofs');
    $p$;
  END IF;
END $$;

-- 3. INSERT policy: authenticated users can upload proof files.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated can upload accounting-proofs'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated can upload accounting-proofs"
        ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'accounting-proofs');
    $p$;
  END IF;
END $$;

-- 4. No UPDATE/DELETE policies by design.
-- Accounting proof files are part of the audit trail and must remain
-- immutable once uploaded. service_role retains full access for admin.
