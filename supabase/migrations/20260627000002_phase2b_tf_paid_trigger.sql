-- supabase/migrations/20260627000002_phase2b_tf_paid_trigger.sql
-- Maintain tukar_faktur.paid_amount from pembayaran_items sum.
-- Mirrors Phase 2a _recompute_tagihan_status pattern for Tagihan.
-- Trigger fires on pembayaran_items I/U/D when the row references a tukar_faktur_id.

BEGIN;

CREATE OR REPLACE FUNCTION public._tf_recompute_paid_amount() RETURNS trigger AS $$
DECLARE v_tf_id uuid;
BEGIN
  v_tf_id := COALESCE(NEW.tukar_faktur_id, OLD.tukar_faktur_id);
  IF v_tf_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.tukar_faktur
  SET paid_amount = COALESCE((
    SELECT SUM(pi_item.amount)
    FROM public.pembayaran_items pi_item
    JOIN public.pembayaran p ON p.id = pi_item.pembayaran_id
    WHERE pi_item.tukar_faktur_id = v_tf_id
      AND p.status = 'LUNAS'
      AND p.voided_at IS NULL
  ), 0)
  WHERE id = v_tf_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS _tf_recompute_after_pembayaran_items ON public.pembayaran_items;

CREATE TRIGGER _tf_recompute_after_pembayaran_items
AFTER INSERT OR UPDATE OR DELETE ON public.pembayaran_items
FOR EACH ROW
EXECUTE FUNCTION public._tf_recompute_paid_amount();

COMMIT;
