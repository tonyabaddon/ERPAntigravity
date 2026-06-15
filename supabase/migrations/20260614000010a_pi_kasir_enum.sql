-- supabase/migrations/20260614000010a_pi_kasir_enum.sql
-- Adds 'Pembelian Pass-Through' to kasir_expense_category enum so the BNL
-- Phase 1 RPCs (record_pi, mark_pi_paid, void_pi) can insert Kasir expense
-- entries with the new category. Existing values: Gaji, Utilitas,
-- Transportasi, Pembelian Stok, Marketing, Lain-lain, MDR EDC.
-- Idempotent — IF NOT EXISTS guards re-runs.

BEGIN;

ALTER TYPE kasir_expense_category ADD VALUE IF NOT EXISTS 'Pembelian Pass-Through';

COMMIT;
