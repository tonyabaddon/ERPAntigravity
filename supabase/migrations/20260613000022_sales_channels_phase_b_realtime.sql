-- Phase B — Enable Supabase realtime for sales_channel_settings so admin
-- toggle in tab A is reflected in tab B's PenjualanBaru/etc within <2s.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sales_channel_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_channel_settings;
  END IF;
END $$;
