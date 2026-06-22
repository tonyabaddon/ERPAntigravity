-- V1.5 hygiene: explicit GRANT EXECUTE TO authenticated for 14 Pembelian wrapper functions
-- to match Task 7 RPC pattern. Functions already inherit EXECUTE TO PUBLIC at creation
-- time (default), so this is parity/clarity-only — no behavioral change.

GRANT EXECUTE ON FUNCTION public.request_purchase_order_create(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_purchase_order_amend(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_tagihan_create(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_supplier_payment(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_bnl_create(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_tukar_faktur(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_purchase_return(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_purchase_order_create(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_purchase_order_amend(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_tagihan_create(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_supplier_payment(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_bnl_create(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_tukar_faktur(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_approved_purchase_return(BIGINT) TO authenticated;
