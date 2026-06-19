-- 20260626000023_revert_tempo_write_off_rpc.sql
-- Phase 1C task 2 — Owner reverts a previously written-off order back to
-- INVOICE_TEMPO. Single-step (no inbox cycle) because it's restoring a
-- state the Owner already approved as undoable. Owner-only by auth.uid().

CREATE OR REPLACE FUNCTION public.revert_tempo_write_off(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller   UUID;
  v_admin_id UUID;
  v_order    RECORD;
BEGIN
  SELECT * INTO v_caller, v_admin_id FROM public._piutang_write_off_resolve_owner();

  SELECT id, status, written_off_at, written_off_by, write_off_reason
    INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id;
  END IF;
  IF v_order.status <> 'INVOICE_WRITTEN_OFF' THEN
    RAISE EXCEPTION 'NOT_WRITTEN_OFF: status=%', v_order.status;
  END IF;

  -- Capture previous values for audit forensics
  INSERT INTO public.audit_log (event_type, actor_user_id, payload)
  VALUES (
    'tempo_write_off_reverted',
    v_caller,
    jsonb_build_object(
      'order_id', v_order.id,
      'previous_written_off_at', v_order.written_off_at,
      'previous_written_off_by', v_order.written_off_by,
      'previous_reason', v_order.write_off_reason
    )
  );

  UPDATE public.orders
     SET status = 'INVOICE_TEMPO',
         written_off_at = NULL,
         written_off_by = NULL,
         write_off_reason = NULL
   WHERE id = p_order_id;
END $$;

GRANT EXECUTE ON FUNCTION public.revert_tempo_write_off(UUID) TO authenticated;

COMMENT ON FUNCTION public.revert_tempo_write_off IS
  'Owner reverts a written-off order back to INVOICE_TEMPO. Owner-only via auth.uid().';
