-- supabase/migrations/20260615000010_orders_tempo_fields.sql
-- Piutang Phase 1B — extend orders schema for tempo invoices.
-- Per spec §4.2.
--
-- Adds:
-- - 2 new order_status enum values: INVOICE_TEMPO, INVOICE_WRITTEN_OFF
-- - 4 columns on orders: due_date, written_off_at, written_off_by, write_off_reason
-- - Widens chk_payment_type on BOTH orders + kasir_transactions to accept 'TEMPO'
-- - Partial index for fast "open tempo" lookup (used by sidebar badge + Piutang page)
--
-- Note: ALTER TYPE ADD VALUE cannot run in a transaction block — runs standalone first.

-- Enum extensions (must run outside transaction)
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'INVOICE_TEMPO';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'INVOICE_WRITTEN_OFF';

-- Everything else in a transaction
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS due_date         date,
  ADD COLUMN IF NOT EXISTS written_off_at   timestamptz,
  ADD COLUMN IF NOT EXISTS written_off_by   uuid,
  ADD COLUMN IF NOT EXISTS write_off_reason text;

-- Widen chk_payment_type on orders to accept 'TEMPO'
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_payment_type;
ALTER TABLE public.orders
  ADD  CONSTRAINT chk_payment_type CHECK (payment_type IN ('FULL', 'DP', 'TEMPO'));

-- Widen chk_kasir_payment_type on kasir_transactions to accept 'TEMPO'
ALTER TABLE public.kasir_transactions
  DROP CONSTRAINT IF EXISTS chk_kasir_payment_type;
ALTER TABLE public.kasir_transactions
  ADD  CONSTRAINT chk_kasir_payment_type CHECK (payment_type IN ('FULL', 'DP', 'TEMPO'));

-- Partial index for fast "open tempo" lookup
CREATE INDEX IF NOT EXISTS idx_orders_tempo_open
  ON public.orders(due_date)
  WHERE payment_type = 'TEMPO' AND status = 'INVOICE_TEMPO';

COMMENT ON COLUMN public.orders.due_date IS
  'Set ONLY for payment_type=TEMPO; equals created_at::date + customer.term_days at creation time.';
COMMENT ON COLUMN public.orders.written_off_at IS
  'Set when owner approves a write-off via approve_tempo_invoice_write_off RPC.';

COMMIT;
