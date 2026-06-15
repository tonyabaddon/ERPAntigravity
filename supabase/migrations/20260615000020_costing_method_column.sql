-- supabase/migrations/20260615000020_costing_method_column.sql
-- Fix for M4 (costing_and_storage): company_settings is single-row, not key/value.
-- Add costing_method column directly + create the Storage bucket that M4 never reached
-- because its INSERT into company_settings (assuming wrong schema) blocked the rest.
-- Service layer reads/writes the column.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS costing_method TEXT NOT NULL DEFAULT 'FIFO'
    CHECK (costing_method IN ('FIFO', 'Average'));

-- Storage bucket for product photos (was in M4 but never reached after INSERT failure)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT DO NOTHING;

-- NOTE: Storage RLS policies on storage.objects are managed via Supabase Dashboard
-- SQL editor in newer versions. Run the following ONCE there as a setup step:
--
-- CREATE POLICY "product_photos_select" ON storage.objects FOR SELECT
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_insert" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_update" ON storage.objects FOR UPDATE TO authenticated
--   USING (bucket_id = 'product-photos');
-- CREATE POLICY "product_photos_delete" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'product-photos');
