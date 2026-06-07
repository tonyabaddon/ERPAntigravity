-- Stock Fraud Prevention Phase 1: Immutable stock_movements ledger.
--
-- Adds an append-only ledger that records every change to stocks.stock_atas /
-- stock_bawah. Phase 1 only creates the table + immutability guards; later
-- tasks wrap the existing stock-mutating RPCs (receive_purchase_order,
-- deduct_stock_fifo, transfer_warehouse, decrement_stock) to write rows here
-- inside the same transaction.
--
-- Foundational Decisions from
-- docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md:
--   #1 (REVOKE + triggers — even service_role cannot UPDATE/DELETE)
--   #2 (corrections are new rows, not edits)
--   #3 (qty_before + qty_delta = qty_after, enforced by CHECK)

-- Enum of every legitimate reason stock can move.
CREATE TYPE public.stock_movement_source AS ENUM (
  'purchase_receive',
  'sale_wa',
  'sale_kasir',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'opname_variance',
  'correction',
  'return_kasir',
  'seed'
);

CREATE TABLE public.stock_movements (
  id                  BIGSERIAL PRIMARY KEY,
  sku                 TEXT NOT NULL REFERENCES public.stocks(sku),
  warehouse           TEXT NOT NULL CHECK (warehouse IN ('atas','bawah')),
  qty_delta           INTEGER NOT NULL,
  qty_before          INTEGER NOT NULL,
  qty_after           INTEGER NOT NULL,
  source              public.stock_movement_source NOT NULL,
  related_doc_type    TEXT,
  related_doc_id      TEXT,
  related_movement_id BIGINT REFERENCES public.stock_movements(id),
  reason_code         TEXT,
  reason_note         TEXT,
  actor_user_id       UUID NOT NULL,
  actor_role          TEXT NOT NULL,
  evidence_urls       TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_qty_math CHECK (qty_before + qty_delta = qty_after)
);

CREATE INDEX idx_sm_sku_created   ON public.stock_movements(sku, created_at DESC);
CREATE INDEX idx_sm_actor_created ON public.stock_movements(actor_user_id, created_at DESC);
CREATE INDEX idx_sm_source        ON public.stock_movements(source, created_at DESC);
CREATE INDEX idx_sm_related       ON public.stock_movements(related_doc_type, related_doc_id);

-- Immutability: belt (REVOKE) + suspenders (triggers).
-- The REVOKE blocks normal client roles. The triggers fire even when
-- service_role bypasses RLS, so a compromised backend key still cannot
-- silently rewrite history.
REVOKE UPDATE, DELETE ON public.stock_movements FROM PUBLIC, anon, authenticated;
GRANT  SELECT          ON public.stock_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.deny_stock_movement_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only — corrections must be a new compensating row';
END $$;

CREATE TRIGGER trg_deny_sm_update BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
CREATE TRIGGER trg_deny_sm_delete BEFORE DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.deny_stock_movement_mutation();
