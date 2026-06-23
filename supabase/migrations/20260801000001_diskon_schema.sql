-- 20260801000001 — Diskon schema: 4 tables, triple kolom + triple-CHECK
--
-- Pattern: setiap tabel impacted dapat 3 kolom (discount_type, discount_value, discount_amount_rp)
-- + table-level CHECK menjaga konsistensi. purchase_invoice_items dapat tambahan
-- master_unit_cost snapshot (sales lines snapshot di JSONB, lihat shape di spec §4.3).

BEGIN;

-- ─── orders (order-level) ──────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT orders_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT orders_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT orders_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── kasir_transactions (order-level) ──────────────────────────────────
ALTER TABLE public.kasir_transactions
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.kasir_transactions
  ADD CONSTRAINT kasir_transactions_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT kasir_transactions_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT kasir_transactions_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT kasir_transactions_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── purchase_invoices (order-level) ───────────────────────────────────
ALTER TABLE public.purchase_invoices
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT pi_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT pi_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT pi_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT pi_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    );

-- ─── purchase_invoice_items (line-level + master snapshot) ─────────────
ALTER TABLE public.purchase_invoice_items
  ADD COLUMN discount_type      TEXT    NULL,
  ADD COLUMN discount_value     NUMERIC NULL,
  ADD COLUMN discount_amount_rp NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN master_unit_cost   NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.purchase_invoice_items
  ADD CONSTRAINT pi_items_discount_type_chk
    CHECK (discount_type IS NULL OR discount_type IN ('PERCENT','AMOUNT')),
  ADD CONSTRAINT pi_items_discount_value_chk
    CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD CONSTRAINT pi_items_discount_amount_chk
    CHECK (discount_amount_rp >= 0),
  ADD CONSTRAINT pi_items_discount_triple_chk
    CHECK (
      (discount_type IS NULL AND discount_value IS NULL AND discount_amount_rp = 0)
      OR
      (discount_type IS NOT NULL AND discount_value IS NOT NULL)
    ),
  ADD CONSTRAINT pi_items_master_unit_cost_chk
    CHECK (master_unit_cost >= 0);

-- Backfill master_unit_cost from unit_cost for existing rows
UPDATE public.purchase_invoice_items SET master_unit_cost = unit_cost WHERE master_unit_cost = 0;

COMMIT;
