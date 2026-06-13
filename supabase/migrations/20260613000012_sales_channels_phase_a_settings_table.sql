-- Phase A — Admin visibility config table for sales channels.

CREATE TABLE IF NOT EXISTS public.sales_channel_settings (
  channel_code  TEXT PRIMARY KEY,
  is_visible    BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  tenant_id     UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.admin_users(id),
  CONSTRAINT sales_channel_settings_code_check CHECK (channel_code IN (
    'walkin','grosir','sales','expo',
    'tokopedia','shopee','lazada','blibli','bukalapak','ralali','bhinneka',
    'whatsapp','instagram','website'
  ))
);

CREATE INDEX IF NOT EXISTS idx_sales_channel_settings_tenant
  ON public.sales_channel_settings(tenant_id);

ALTER TABLE public.sales_channel_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_channel_settings' AND policyname = 'all_admins_read'
  ) THEN
    CREATE POLICY "all_admins_read" ON public.sales_channel_settings
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_channel_settings' AND policyname = 'owners_admins_write'
  ) THEN
    CREATE POLICY "owners_admins_write" ON public.sales_channel_settings
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE id = auth.uid()
            AND (
              role = 'owner'
              OR (permissions::jsonb ->> 'canConfigureSalesChannels')::boolean = true
            )
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.sales_channel_settings IS
  'Per-tenant admin visibility config for the 14 canonical sales channels. is_visible=false hides channel from input selectors but does NOT hide historical data in recon/dashboard/laporan.';
