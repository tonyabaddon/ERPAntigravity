-- 20261115000052_drop_stale_purchase_invoice_status_check.sql
--
-- Session 3 finding F-13 (P0): partial supplier payment (`record_pembayaran`
-- with `amount < outstanding`) fails at commit with
--     23514: new row for relation "purchase_invoices" violates check
--     constraint "purchase_invoices_status_check"
--
-- Root cause: two CHECK constraints coexist on `purchase_invoices.status`:
--
--   * pi_status_check
--       CHECK (status = ANY (ARRAY['BELUM_LUNAS','DIBAYAR_SEBAGIAN','LUNAS']))
--
--   * purchase_invoices_status_check
--       CHECK (status = ANY (ARRAY['BELUM_LUNAS','LUNAS']))
--
-- The RPC updates status to 'DIBAYAR_SEBAGIAN' on partial payment. The
-- newer `pi_status_check` accepts it; the older
-- `purchase_invoices_status_check` still rejects it. Since Postgres AND's
-- all CHECKs, the row is rejected. This is exactly the
-- `check-constraints-before-rpc-rewrite` memory scenario — an earlier
-- migration added the new CHECK to allow partial but never dropped the
-- old one.
--
-- Fix: drop the stale narrower constraint. `pi_status_check` alone is
-- the source of truth going forward.
--
-- Verified after this migration: partial supplier payment succeeds via UI
-- (Pembelian → Bayar → set amount < outstanding → Catat Pembayaran).

BEGIN;

ALTER TABLE public.purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_status_check;

COMMIT;
