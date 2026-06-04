-- Add authenticated access to storage buckets used by pembelian module.
-- The anon policies remain for backward compatibility.

CREATE POLICY "authenticated full access purchase-documents"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'purchase-documents')
  WITH CHECK (bucket_id = 'purchase-documents');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'authenticated full access payment-proofs'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated full access payment-proofs"
        ON storage.objects FOR ALL TO authenticated
        USING (bucket_id = 'payment-proofs')
        WITH CHECK (bucket_id = 'payment-proofs');
    $p$;
  END IF;
END $$;
