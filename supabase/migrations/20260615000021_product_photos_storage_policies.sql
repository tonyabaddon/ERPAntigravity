-- supabase/migrations/20260615000021_product_photos_storage_policies.sql
-- Storage RLS policies on storage.objects for the product-photos bucket.
-- These were documented in M4 (20260614000023) as Dashboard-only, but Postgres
-- via the apply-migration tool has sufficient privilege on Supabase's hosted
-- storage.objects. Idempotent via DO $$ pg_policies lookup.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='product_photos_select') THEN
    CREATE POLICY "product_photos_select" ON storage.objects FOR SELECT
      USING (bucket_id = 'product-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='product_photos_insert') THEN
    CREATE POLICY "product_photos_insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'product-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='product_photos_update') THEN
    CREATE POLICY "product_photos_update" ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'product-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='product_photos_delete') THEN
    CREATE POLICY "product_photos_delete" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'product-photos');
  END IF;
END $$;
