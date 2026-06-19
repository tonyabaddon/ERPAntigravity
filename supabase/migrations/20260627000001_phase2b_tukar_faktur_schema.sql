-- supabase/migrations/20260627000001_phase2b_tukar_faktur_schema.sql
-- Phase 2b: Tukar Faktur entity + foreign-faktur escape via relaxed pi_type_linkage_check.
-- No DRAFT/TERTANDA state machine — status derived from paid_amount vs total_amount.
-- Pattern aligns with Jurnal Tukar Faktur Pembelian.

BEGIN;

-- ---------- Tukar Faktur table ----------
CREATE TABLE public.tukar_faktur (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_number              text NOT NULL UNIQUE,
  supplier_id            uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  tukar_date             date NOT NULL,
  payment_due_at         date NOT NULL,
  total_amount           numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount            numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  photo_urls             text[] NOT NULL DEFAULT '{}',
  tanda_terima_printed_at timestamptz NULL,
  notes                  text NULL,
  created_by_user_id     uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  voided_at              timestamptz NULL,
  voided_by_user_id      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason            text NULL,
  CHECK (paid_amount <= total_amount)
);

CREATE INDEX tukar_faktur_supplier_id_idx ON public.tukar_faktur(supplier_id);
CREATE INDEX tukar_faktur_due_at_idx ON public.tukar_faktur(payment_due_at)
  WHERE voided_at IS NULL;

-- updated_at trigger (reuses Phase 2a set_updated_at)
CREATE TRIGGER tukar_faktur_set_updated_at
BEFORE UPDATE ON public.tukar_faktur
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS deny-by-default (RPCs are SECURITY DEFINER)
ALTER TABLE public.tukar_faktur ENABLE ROW LEVEL SECURITY;

-- ---------- purchase_invoices: add is_tf_quick_add flag ----------
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS is_tf_quick_add boolean NOT NULL DEFAULT false;

-- ---------- Relax pi_type_linkage_check ----------
-- Phase 2a constraint: STOCK requires pesanan_id, PASSTHROUGH requires order_id.
-- Phase 2b: STOCK can also link via tukar_faktur_id, or be is_tf_quick_add=true
-- (foreign-faktur escape from TF ritual).
ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS pi_type_linkage_check;

ALTER TABLE public.purchase_invoices ADD CONSTRAINT pi_type_linkage_check CHECK (
  (type = 'PASSTHROUGH' AND order_id IS NOT NULL AND pesanan_id IS NULL)
  OR
  (type = 'STOCK' AND order_id IS NULL AND (
    pesanan_id IS NOT NULL                           -- normal path: Tagihan from Pesanan
    OR tukar_faktur_id IS NOT NULL                   -- bundled via TF (with or without Pesanan)
    OR is_tf_quick_add = true                        -- TF quick-add (no Pesanan, no items yet)
  ))
);

COMMIT;
