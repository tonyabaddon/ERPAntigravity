-- 20260607000002_company_settings_logo.sql
-- Add logo_url for PDF invoice header.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS npwp TEXT;

-- Ensure 'branding' storage bucket exists (uploaded logos go here)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy for branding (so the logo URL works without auth)
DO $$ BEGIN
  CREATE POLICY "branding_public_read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anon insert/update/delete policy for branding (admin uploads via app)
DO $$ BEGIN
  CREATE POLICY "branding_anon_write" ON storage.objects
    FOR ALL TO anon
    USING (bucket_id = 'branding')
    WITH CHECK (bucket_id = 'branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
