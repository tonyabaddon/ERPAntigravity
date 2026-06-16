-- supabase/migrations/20260620000001_phase2_pesanan_schema.sql
-- Phase 2a foundation: new pesanan table (PO refactor). DRAFT/ORDERED/CLOSED lifecycle.
-- Existing purchase_orders untouched (will be split-migrated in 000010_migrate_po_data).

BEGIN;

CREATE TABLE public.pesanan (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pesanan_number      text UNIQUE NOT NULL,
  supplier_id         uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  status              text NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','ORDERED','CLOSED')),
  notes               text,
  ordered_at          timestamptz,
  expected_receive_at date,
  closed_at           timestamptz,
  tax_rate            numeric NOT NULL DEFAULT 0,
  tax_amount          numeric NOT NULL DEFAULT 0,
  subtotal            numeric NOT NULL DEFAULT 0,
  total               numeric NOT NULL DEFAULT 0,
  created_by_user_id  uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  voided_at           timestamptz,
  voided_by_user_id   uuid REFERENCES auth.users(id),
  void_reason         text,
  CONSTRAINT pesanan_void_requires_reason
    CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);

CREATE INDEX pesanan_supplier_status_idx ON public.pesanan (supplier_id, status);
CREATE INDEX pesanan_status_ordered_idx ON public.pesanan (status, ordered_at DESC);
CREATE INDEX pesanan_list_idx ON public.pesanan (created_at DESC) WHERE voided_at IS NULL;

CREATE TABLE public.pesanan_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pesanan_id          uuid NOT NULL REFERENCES public.pesanan(id) ON DELETE CASCADE,
  sku                 varchar NOT NULL REFERENCES public.stocks(sku) ON DELETE RESTRICT,
  product_name        text NOT NULL,
  qty                 int NOT NULL CHECK (qty > 0),
  unit_cost           numeric NOT NULL CHECK (unit_cost >= 0),
  subtotal            numeric NOT NULL CHECK (subtotal >= 0),
  qty_received_total  int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pesanan_items_pesanan_idx ON public.pesanan_items (pesanan_id);
CREATE INDEX pesanan_items_sku_idx ON public.pesanan_items (sku);

CREATE TRIGGER trg_pesanan_updated_at
  BEFORE UPDATE ON public.pesanan
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.pesanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pesanan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pesanan_read ON public.pesanan FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pesanan_items_read ON public.pesanan_items FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pesanan_no_direct_write ON public.pesanan FOR ALL
  USING (false) WITH CHECK (false);
CREATE POLICY pesanan_items_no_direct_write ON public.pesanan_items FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
