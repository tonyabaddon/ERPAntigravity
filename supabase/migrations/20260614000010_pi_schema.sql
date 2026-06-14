-- supabase/migrations/20260614000010_pi_schema.sql
-- Phase 1 of Belanja Numpang Lewat (spec
-- docs/superpowers/specs/2026-06-14-pembelian-belanja-numpang-lewat-design.md).
-- Creates purchase_invoices + purchase_invoice_items tables with `type` discriminator
-- (PASSTHROUGH for Phase 1, STOCK reserved for Phase 2). Zero touch to existing
-- purchase_orders module.

BEGIN;

CREATE TABLE public.purchase_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_number                   text UNIQUE NOT NULL,
  type                        text NOT NULL DEFAULT 'PASSTHROUGH'
                                CHECK (type IN ('PASSTHROUGH', 'STOCK')),
  supplier_id                 uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  order_id                    uuid NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  purchase_date               date NOT NULL DEFAULT CURRENT_DATE,
  supplier_invoice_number     text NULL,
  supplier_invoice_photo_url  text NULL,
  payment_method              text NOT NULL CHECK (payment_method IN ('CASH','TRANSFER','TEMPO')),
  payment_due_at              date NULL,
  paid_at                     timestamptz NULL,
  payment_proof_url           text NULL,
  subtotal                    numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total                       numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  status                      text NOT NULL DEFAULT 'BELUM_LUNAS'
                                CHECK (status IN ('BELUM_LUNAS','LUNAS')),
  notes                       text NULL,
  created_by_user_id          uuid NULL REFERENCES public.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  voided_at                   timestamptz NULL,
  voided_by_user_id           uuid NULL REFERENCES public.users(id),
  void_reason                 text NULL,
  CONSTRAINT pi_passthrough_requires_order
    CHECK (type != 'PASSTHROUGH' OR order_id IS NOT NULL),
  CONSTRAINT pi_belum_lunas_requires_due
    CHECK (status != 'BELUM_LUNAS' OR payment_due_at IS NOT NULL),
  CONSTRAINT pi_lunas_requires_paid_at
    CHECK (status != 'LUNAS' OR paid_at IS NOT NULL),
  CONSTRAINT pi_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pi_supplier_status_idx ON public.purchase_invoices (supplier_id, status);
CREATE INDEX pi_supplier_invnum_idx ON public.purchase_invoices (supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL;
CREATE INDEX pi_order_idx ON public.purchase_invoices (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX pi_due_idx ON public.purchase_invoices (status, payment_due_at)
  WHERE status = 'BELUM_LUNAS';
CREATE INDEX pi_list_idx ON public.purchase_invoices (type, status, purchase_date DESC);

CREATE TABLE public.purchase_invoice_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_id           uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  sku             varchar NOT NULL REFERENCES public.stocks(sku) ON DELETE RESTRICT,
  product_name    text NOT NULL,
  qty             int NOT NULL CHECK (qty > 0),
  unit_cost       numeric NOT NULL CHECK (unit_cost >= 0),
  sell_price      numeric NOT NULL CHECK (sell_price >= 0),
  subtotal        numeric NOT NULL CHECK (subtotal >= 0),
  order_item_id   uuid NULL REFERENCES public.order_items(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pi_items_pi_idx ON public.purchase_invoice_items (pi_id);
CREATE INDEX pi_items_sku_idx ON public.purchase_invoice_items (sku);

ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pi_read ON public.purchase_invoices FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pi_items_read ON public.purchase_invoice_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY pi_no_direct_write ON public.purchase_invoices FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pi_items_no_direct_write ON public.purchase_invoice_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
