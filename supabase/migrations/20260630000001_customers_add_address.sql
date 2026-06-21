-- 20260630000001_customers_add_address.sql
-- Phase Catat Penjualan wizard: "+ Customer Baru" inline form needs optional
-- address field. Plain additive; existing rows get NULL.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS address TEXT NULL;

COMMENT ON COLUMN public.customers.address IS
  'Alamat customer (optional). Diisi via "+ Customer Baru" form di Catat Penjualan wizard.';
