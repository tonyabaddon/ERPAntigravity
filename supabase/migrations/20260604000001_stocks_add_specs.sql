-- supabase/migrations/20260604000001_stocks_add_specs.sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}';

ALTER TABLE public.stocks
  ALTER COLUMN sku SET DEFAULT gen_random_uuid()::text;
