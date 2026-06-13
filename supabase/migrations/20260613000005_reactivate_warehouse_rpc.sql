-- reactivate_warehouse RPC — undoes a deactivate (or force_deactivate).
-- Owner-only, writes a 'reactivate' audit row. Idempotent: re-activating
-- an already-active warehouse is a no-op but still raises if the caller
-- is not Owner.

BEGIN;

CREATE OR REPLACE FUNCTION public.reactivate_warehouse(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.warehouses;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = v_actor AND role = 'Owner') THEN
    RAISE EXCEPTION 'reactivate_warehouse: Owner role required';
  END IF;
  SELECT * INTO v_row FROM warehouses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % not found', p_id; END IF;
  IF v_row.is_active THEN
    RETURN;  -- already active, no-op
  END IF;
  UPDATE warehouses SET is_active = true, updated_at = now() WHERE id = p_id;
  INSERT INTO warehouse_audit_log (warehouse_id, actor_user_id, action, before)
       VALUES (p_id, v_actor, 'reactivate', to_jsonb(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.reactivate_warehouse(uuid) TO authenticated;

COMMIT;
