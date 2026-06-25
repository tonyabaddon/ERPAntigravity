-- Multi-tier pricing modul toggle. Default FALSE — existing tenant tidak berubah.
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS modul_multi_tier_price BOOLEAN NOT NULL DEFAULT FALSE;
