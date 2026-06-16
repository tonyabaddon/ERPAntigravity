-- supabase/migrations/20260620000002_phase2_pembayaran_schema.sql
-- Phase 2a foundation: pembayaran (payment) + junction items.
-- 1 Pembayaran : N pembayaran_items (each points to Tagihan XOR Tukar Faktur).
-- Supports partial payment (amount editable per item) + consolidated payment.

BEGIN;

CREATE TABLE public.pembayaran (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pembayaran_number   text UNIQUE NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  paid_at             timestamptz NOT NULL DEFAULT now(),
  payment_method      text NOT NULL CHECK (payment_method IN ('CASH','TRANSFER','CHEQUE','EDC')),
  account_id          uuid NULL,
  account_label       text,
  amount_total        numeric NOT NULL DEFAULT 0 CHECK (amount_total >= 0),
  discount_amount     numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  proof_url           text,
  status              text NOT NULL DEFAULT 'LUNAS'
                        CHECK (status IN ('LUNAS','VOIDED')),
  notes               text,
  created_by_user_id  uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by_user_id   uuid REFERENCES auth.users(id),
  void_reason         text,
  CONSTRAINT pembayaran_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pembayaran_supplier_paid_idx ON public.pembayaran (supplier_id, paid_at DESC);
CREATE INDEX pembayaran_status_idx ON public.pembayaran (status, paid_at DESC);

CREATE TABLE public.pembayaran_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pembayaran_id       uuid NOT NULL REFERENCES public.pembayaran(id) ON DELETE CASCADE,
  tagihan_id          uuid NULL REFERENCES public.purchase_invoices(id) ON DELETE RESTRICT,
  tukar_faktur_id     uuid NULL,
  amount              numeric NOT NULL CHECK (amount > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pembayaran_items_xor
    CHECK ((tagihan_id IS NOT NULL) <> (tukar_faktur_id IS NOT NULL))
);

CREATE INDEX pembayaran_items_pembayaran_idx ON public.pembayaran_items (pembayaran_id);
CREATE INDEX pembayaran_items_tagihan_idx ON public.pembayaran_items (tagihan_id) WHERE tagihan_id IS NOT NULL;
CREATE INDEX pembayaran_items_tf_idx ON public.pembayaran_items (tukar_faktur_id) WHERE tukar_faktur_id IS NOT NULL;

CREATE TRIGGER trg_pembayaran_updated_at
  BEFORE UPDATE ON public.pembayaran
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.pembayaran ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pembayaran_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pembayaran_read ON public.pembayaran FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pembayaran_items_read ON public.pembayaran_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pembayaran_no_direct_write ON public.pembayaran FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pembayaran_items_no_direct_write ON public.pembayaran_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
