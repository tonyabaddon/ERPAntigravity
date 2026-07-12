-- 20261115000212_recreate_transfer_aging_view.sql
-- Recreate v_pengawasan_transfer_aging against the new warehouse_transfers
-- schema. Status filter changes from 'initiated' → 'IN_TRANSIT'.
-- Original view: 20260607000053_transfer_aging_view.sql (dropped in slot 210).

BEGIN;

CREATE OR REPLACE VIEW public.v_pengawasan_transfer_aging AS
SELECT
  wt.tenant_id,
  wt.id,
  wt.doc_no,
  wt.from_warehouse_id,
  wt.to_warehouse_id,
  wt.sender_user_id,
  wt.receiver_user_id,
  wt.total_qty_sent,
  wt.initiated_at,
  EXTRACT(EPOCH FROM (now() - wt.initiated_at)) / 3600.0 AS hours_pending
FROM public.warehouse_transfers wt
WHERE wt.status = 'IN_TRANSIT'
  AND wt.initiated_at < now() - INTERVAL '24 hours';

GRANT SELECT ON public.v_pengawasan_transfer_aging TO authenticated;

COMMIT;
