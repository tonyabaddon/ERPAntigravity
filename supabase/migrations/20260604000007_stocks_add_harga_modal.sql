-- supabase/migrations/20260604000007_stocks_add_harga_modal.sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS harga_modal NUMERIC(15,2);
