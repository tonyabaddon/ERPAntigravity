-- 20261115000126_revoke_anon_from_promo_rpcs.sql
-- Item #4b: harden Promo Produk RPCs by explicitly revoking anon EXECUTE.
-- `REVOKE ALL FROM PUBLIC` alone doesn't remove anon's inherited grant on
-- Supabase; supabase's REST layer defaults expose SECDEF funcs to anon
-- unless we revoke explicitly.

REVOKE EXECUTE ON FUNCTION public.upsert_stock_promo(TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bulk_upsert_stock_promo(TEXT[], TEXT, NUMERIC, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_active_promos(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_promo_summary() FROM anon;
