-- Phase B — Seed 14 canonical channels with default visibility=true.
-- Idempotent: ON CONFLICT DO NOTHING so re-running doesn't disrupt admin edits.

CREATE OR REPLACE FUNCTION public.seed_sales_channel_settings()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.sales_channel_settings (channel_code, sort_order, is_visible) VALUES
    ('walkin', 10, true),
    ('grosir', 20, true),
    ('sales', 30, true),
    ('expo', 40, true),
    ('tokopedia', 50, true),
    ('shopee', 60, true),
    ('lazada', 70, true),
    ('blibli', 80, true),
    ('bukalapak', 90, true),
    ('ralali', 100, true),
    ('bhinneka', 110, true),
    ('whatsapp', 120, true),
    ('instagram', 130, true),
    ('website', 140, true)
  ON CONFLICT (channel_code) DO NOTHING;
END $$;

-- Invoke immediately for current single-tenant deployment (tenant_id IS NULL).
SELECT public.seed_sales_channel_settings();
