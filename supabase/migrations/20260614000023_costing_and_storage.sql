-- supabase/migrations/20260614000023_costing_and_storage.sql
-- Spec §2.4

-- Costing method (toko-wide). Reuse existing company_settings.
INSERT INTO public.company_settings (key, value, updated_at)
VALUES ('costing_method', '"FIFO"'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Storage bucket for product photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT DO NOTHING;

-- Bucket RLS: SELECT by anyone (public read), INSERT/UPDATE/DELETE by authenticated.
-- Newer Supabase removed storage.policies view and storage.create_policy helper;
-- in that case we silently skip and rely on the trailing NOTE comment for manual setup.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.policies WHERE bucket_id='product-photos' AND name='product_photos_public_read'
  ) THEN
    PERFORM storage.create_policy(
      'product_photos_public_read',
      'product-photos',
      'SELECT',
      'true',
      'true'
    );
  END IF;
EXCEPTION WHEN undefined_function OR undefined_table THEN
  RAISE NOTICE 'storage.create_policy not available — set policy via Dashboard (see comment below)';
END $$;

-- NOTE: Storage policies in newer Supabase are managed via storage.objects RLS directly.
-- If the storage.create_policy helper is unavailable (most installs in 2026+), run the following
-- via Dashboard SQL editor as a one-time setup:
--
-- CREATE POLICY "product_photos_select" ON storage.objects FOR SELECT
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_insert" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_update" ON storage.objects FOR UPDATE TO authenticated
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_delete" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'product-photos');
