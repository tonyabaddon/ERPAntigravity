-- supabase/migrations/20260627000021_phase2b_hotfix_tf_trigger_on_pembayaran_void.sql
-- Phase 2b hotfix #2: void_pembayaran was not propagating to tukar_faktur.paid_amount.
-- Smoke 2026-06-20 caught: voided 2 payments on TF-2026-06-001 but tf.paid_amount
-- stayed at 13.7M (LUNAS) because:
--   - void_pembayaran only UPDATEs pembayaran row (status='VOIDED', voided_at)
--   - Phase 2b trigger _tf_recompute_after_pembayaran_items only fires on
--     pembayaran_items I/U/D — never sees the pembayaran void
--   - void_pembayaran calls _recompute_tagihan_status() for tagihan_id items but
--     has no equivalent for tukar_faktur_id items
-- Fix: add separate trigger on pembayaran UPDATE that re-runs the recompute for
-- all TFs referenced by that pembayaran's items. Phase 2a Tagihan recompute is
-- already handled inside void_pembayaran so doesn't need this trigger path.

BEGIN;

CREATE OR REPLACE FUNCTION public._tf_recompute_on_pembayaran_void() RETURNS trigger AS $$
BEGIN
  -- Only react when voided_at changed (newly voided or unvoided) OR status flipped
  IF (NEW.voided_at IS DISTINCT FROM OLD.voided_at)
     OR (NEW.status IS DISTINCT FROM OLD.status) THEN
    -- Recompute all TFs referenced by this pembayaran's items
    UPDATE public.tukar_faktur tf
    SET paid_amount = COALESCE((
      SELECT SUM(pi_item.amount)
      FROM public.pembayaran_items pi_item
      JOIN public.pembayaran p ON p.id = pi_item.pembayaran_id
      WHERE pi_item.tukar_faktur_id = tf.id
        AND p.status = 'LUNAS'
        AND p.voided_at IS NULL
    ), 0)
    WHERE tf.id IN (
      SELECT tukar_faktur_id FROM public.pembayaran_items
      WHERE pembayaran_id = NEW.id AND tukar_faktur_id IS NOT NULL
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS _tf_recompute_after_pembayaran_void ON public.pembayaran;

CREATE TRIGGER _tf_recompute_after_pembayaran_void
AFTER UPDATE ON public.pembayaran
FOR EACH ROW
EXECUTE FUNCTION public._tf_recompute_on_pembayaran_void();

COMMIT;
