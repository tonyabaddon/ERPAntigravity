-- supabase/migrations/20260620000003_phase2_pi_extend.sql
-- Phase 2a foundation: extend purchase_invoices to support Tagihan type='STOCK'.
-- Adds pesanan_id (REQUIRED for STOCK), tukar_faktur_id (NULL until Phase 2b), paid_amount (partial payment tracking).
-- Adds DIBAYAR_SEBAGIAN status. Adds CHECK constraint enforcing STOCK requires pesanan_id, PASSTHROUGH requires order_id (mutually exclusive).

BEGIN;

ALTER TABLE public.purchase_invoices ADD COLUMN pesanan_id uuid NULL
  REFERENCES public.pesanan(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_invoices ADD COLUMN tukar_faktur_id uuid NULL;
ALTER TABLE public.purchase_invoices ADD COLUMN paid_amount numeric NOT NULL DEFAULT 0
  CHECK (paid_amount >= 0);

ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS pi_status_check;
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_status_check
  CHECK (status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN','LUNAS'));

ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_type_linkage_check
  CHECK (
    (type = 'PASSTHROUGH' AND pesanan_id IS NULL AND order_id IS NOT NULL)
    OR
    (type = 'STOCK' AND pesanan_id IS NOT NULL AND order_id IS NULL)
  );

ALTER TABLE public.purchase_invoice_items ADD COLUMN pesanan_item_id uuid NULL
  REFERENCES public.pesanan_items(id) ON DELETE SET NULL;

CREATE INDEX pi_pesanan_idx ON public.purchase_invoices (pesanan_id) WHERE pesanan_id IS NOT NULL;
CREATE INDEX pi_tukar_faktur_idx ON public.purchase_invoices (tukar_faktur_id) WHERE tukar_faktur_id IS NOT NULL;
CREATE INDEX pi_items_pesanan_item_idx ON public.purchase_invoice_items (pesanan_item_id) WHERE pesanan_item_id IS NOT NULL;

COMMIT;
