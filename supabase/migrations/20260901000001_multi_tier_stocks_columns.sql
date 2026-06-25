-- Multi-tier pricing — add price_grosir column to stocks (product master).
-- price (existing) tetap = harga eceran (backward-compat).
-- Default tenant_settings.modul_multi_tier_price=FALSE → no UI impact until tenant opts in.
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS price_grosir NUMERIC(14,2) NULL;

COMMENT ON COLUMN public.stocks.price_grosir IS
  'Harga jual tier grosir. NULL = fallback ke price (eceran) saat transaksi tier=grosir, dengan warning UI.';
