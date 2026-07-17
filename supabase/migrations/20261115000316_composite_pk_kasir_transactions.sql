-- Migration 316: Composite PK (tenant_id, id) for kasir_transactions
--
-- Rationale: kasir_transactions is the hottest write path (every kasir sale
-- = 1 row). At 10-tenant × 500 sales/day = 5 000/day = 1.8 M/year.
-- Composite PK done NOW while table is 123 rows; at 1.8 M rows it would
-- require hours-long ACCESS EXCLUSIVE lock (multi-tenant outage).
--
-- Pre-flight checks passed (2026-07-17):
--   - kasir_transactions: 123 rows, 0 NULL tenant_id ✓
--   - All 5 child tables: 0 NULL tenant_id, 0 cross-tenant violations ✓
--   - Child row counts: cash_deposit_batch_items=0, rakit_job_lines=5,
--     rakit_lock_requests=1, sales_orders=20, stock_lot_consumption=0
--
-- Child FK plan (exact definitions from pg_constraint):
--   1. cash_deposit_batch_items.kasir_txn_id  → NO ACTION, NOT NULL
--   2. rakit_job_lines.transaction_id          → ON DELETE CASCADE, NOT NULL
--   3. rakit_lock_requests.transaction_id      → ON DELETE CASCADE, NOT NULL
--   4. sales_orders.converted_to_kasir_tx_id   → ON DELETE SET NULL, NULLABLE
--   5. stock_lot_consumption.kasir_txn_id       → NO ACTION, NULLABLE
--
-- rakit_job_lines also has UNIQUE (transaction_id, line_number) — dropped
-- and re-added as (tenant_id, transaction_id, line_number) to keep
-- uniqueness semantics correct after the FK becomes composite.
--
-- Rollback:
--   DROP CONSTRAINT IF EXISTS kasir_transactions_pkey;
--   ADD PRIMARY KEY (id);
--   Then restore each child FK to single-column form per original definitions.
--   (Non-trivial but safe — no data loss, only constraint shape changes.)
--
-- Idempotent: uses DROP CONSTRAINT IF EXISTS / CREATE INDEX IF NOT EXISTS
--             throughout.

BEGIN;

-- ─── Pre-flight guard ──────────────────────────────────────────────────────
DO $$
DECLARE null_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.kasir_transactions
  WHERE tenant_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'kasir_transactions has % NULL tenant_id rows — cannot proceed', null_count;
  END IF;
END $$;

-- ─── Step 1: Drop FK constraints from all 5 child tables ──────────────────
-- Must drop before dropping parent PK.

-- 1a. cash_deposit_batch_items
ALTER TABLE public.cash_deposit_batch_items
  DROP CONSTRAINT IF EXISTS cash_deposit_batch_items_kasir_txn_id_fkey;

-- 1b. rakit_job_lines — also drop the unique constraint that references
--     transaction_id alone (will be re-added as composite below)
ALTER TABLE public.rakit_job_lines
  DROP CONSTRAINT IF EXISTS rakit_job_lines_transaction_id_fkey;

ALTER TABLE public.rakit_job_lines
  DROP CONSTRAINT IF EXISTS rakit_job_lines_transaction_id_line_number_key;

-- 1c. rakit_lock_requests
ALTER TABLE public.rakit_lock_requests
  DROP CONSTRAINT IF EXISTS rakit_lock_requests_transaction_id_fkey;

-- 1d. sales_orders
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_converted_to_kasir_tx_id_fkey;

-- 1e. stock_lot_consumption
ALTER TABLE public.stock_lot_consumption
  DROP CONSTRAINT IF EXISTS stock_lot_consumption_kasir_txn_id_fkey;

-- ─── Step 2: Drop existing single-column PK ───────────────────────────────
ALTER TABLE public.kasir_transactions
  DROP CONSTRAINT IF EXISTS kasir_transactions_pkey;

-- ─── Step 3: Add composite PK (tenant_id, id) ─────────────────────────────
-- id default gen_random_uuid() is unaffected by PK shape change.
ALTER TABLE public.kasir_transactions
  ADD CONSTRAINT kasir_transactions_pkey PRIMARY KEY (tenant_id, id);

COMMENT ON CONSTRAINT kasir_transactions_pkey ON public.kasir_transactions IS
  'Migration 316: composite (tenant_id, id) — replaces single-id PK for partition-readiness at scale.';

-- ─── Step 4: Re-add child FKs as composite references ────────────────────

-- 4a. cash_deposit_batch_items: NOT NULL kasir_txn_id
ALTER TABLE public.cash_deposit_batch_items
  ADD CONSTRAINT cash_deposit_batch_items_kasir_txn_id_fkey
    FOREIGN KEY (tenant_id, kasir_txn_id)
    REFERENCES public.kasir_transactions (tenant_id, id);

-- 4b. rakit_job_lines: NOT NULL transaction_id, ON DELETE CASCADE
ALTER TABLE public.rakit_job_lines
  ADD CONSTRAINT rakit_job_lines_transaction_id_fkey
    FOREIGN KEY (tenant_id, transaction_id)
    REFERENCES public.kasir_transactions (tenant_id, id)
    ON DELETE CASCADE;

-- Restore uniqueness constraint: tenant_id + transaction_id + line_number
-- (tenant_id scopes uniqueness correctly for multi-tenant; mirrors composite FK)
ALTER TABLE public.rakit_job_lines
  ADD CONSTRAINT rakit_job_lines_tenant_transaction_line_key
    UNIQUE (tenant_id, transaction_id, line_number);

-- 4c. rakit_lock_requests: NOT NULL transaction_id, ON DELETE CASCADE
ALTER TABLE public.rakit_lock_requests
  ADD CONSTRAINT rakit_lock_requests_transaction_id_fkey
    FOREIGN KEY (tenant_id, transaction_id)
    REFERENCES public.kasir_transactions (tenant_id, id)
    ON DELETE CASCADE;

-- 4d. sales_orders: NULLABLE converted_to_kasir_tx_id, ON DELETE SET NULL
ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_converted_to_kasir_tx_id_fkey
    FOREIGN KEY (tenant_id, converted_to_kasir_tx_id)
    REFERENCES public.kasir_transactions (tenant_id, id)
    ON DELETE SET NULL;

-- 4e. stock_lot_consumption: NULLABLE kasir_txn_id, NO ACTION
ALTER TABLE public.stock_lot_consumption
  ADD CONSTRAINT stock_lot_consumption_kasir_txn_id_fkey
    FOREIGN KEY (tenant_id, kasir_txn_id)
    REFERENCES public.kasir_transactions (tenant_id, id);

-- ─── Step 5: Covering indexes for composite FK columns ────────────────────
-- Avoids "unindexed FK" advisor finding. Pattern from migrations 304-309.
-- Some child tables already have single-col indexes on the FK column;
-- add composite (tenant_id, <fk_col>) index for each.

-- cash_deposit_batch_items: PK is (batch_id, kasir_txn_id), no separate index needed
-- for kasir_txn_id alone — the composite FK lookup uses tenant_id too, so add one:
CREATE INDEX IF NOT EXISTS idx_cdbi_tenant_kasir_txn
  ON public.cash_deposit_batch_items (tenant_id, kasir_txn_id);

-- rakit_job_lines: existing idx_rakit_lines_transaction is (transaction_id) only;
-- add composite covering index for the new composite FK:
CREATE INDEX IF NOT EXISTS idx_rakit_job_lines_tenant_transaction
  ON public.rakit_job_lines (tenant_id, transaction_id);

-- rakit_lock_requests: existing idx_rakit_lock_transaction is (transaction_id) only:
CREATE INDEX IF NOT EXISTS idx_rakit_lock_requests_tenant_transaction
  ON public.rakit_lock_requests (tenant_id, transaction_id);

-- sales_orders: no existing index on converted_to_kasir_tx_id alone; add composite:
CREATE INDEX IF NOT EXISTS idx_sales_orders_tenant_kasir_tx
  ON public.sales_orders (tenant_id, converted_to_kasir_tx_id)
  WHERE converted_to_kasir_tx_id IS NOT NULL;

-- stock_lot_consumption: existing idx_slc_kasir is (kasir_txn_id) only:
CREATE INDEX IF NOT EXISTS idx_slc_tenant_kasir_txn
  ON public.stock_lot_consumption (tenant_id, kasir_txn_id)
  WHERE kasir_txn_id IS NOT NULL;

COMMIT;
