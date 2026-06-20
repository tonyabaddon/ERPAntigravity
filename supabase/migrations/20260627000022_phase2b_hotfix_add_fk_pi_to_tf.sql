-- supabase/migrations/20260627000022_phase2b_hotfix_add_fk_pi_to_tf.sql
-- Phase 2b hotfix #3: add FK constraint purchase_invoices.tukar_faktur_id → tukar_faktur.id.
-- Smoke 2026-06-20 caught: TukarFakturList fetchAll embedded-select syntax
-- (PostgREST `tagihans:purchase_invoices(...)`) failed with HTTP 400:
--   "Could not find a relationship between 'tukar_faktur' and 'purchase_invoices'
--    in the schema cache"
-- Root cause: Phase 2a migration 20260620000003 added the tukar_faktur_id column
-- on purchase_invoices BEFORE the tukar_faktur table existed (created in Phase 2b
-- migration 20260627000001), so no FK could be added at column creation. Phase 2b
-- never retrofitted the FK.
-- Fix: add FK with ON DELETE SET NULL (Phase 2b uses soft-delete via voided_at, but
-- SET NULL is the safe default if a hard delete ever happens).

BEGIN;

ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT purchase_invoices_tukar_faktur_id_fkey
  FOREIGN KEY (tukar_faktur_id) REFERENCES public.tukar_faktur(id)
  ON DELETE SET NULL;

-- Reload PostgREST schema cache (triggered by NOTIFY in Supabase)
NOTIFY pgrst, 'reload schema';

COMMIT;
