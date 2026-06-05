-- supabase/migrations/20260605000006_orders_hpp_total.sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS hpp_total NUMERIC(15,2) NOT NULL DEFAULT 0;
