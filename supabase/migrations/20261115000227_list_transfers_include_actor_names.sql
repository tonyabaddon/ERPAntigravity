-- 20261115000227_list_transfers_include_actor_names.sql
-- Founder feedback: list screen should show WHO requested + WHO received/cancelled
-- at a glance. Extends list_warehouse_transfers with 4 name columns via LEFT JOIN
-- admin_users. Requires DROP + CREATE (returns-type change), not CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.list_warehouse_transfers(text[], uuid, text, timestamptz, int, bigint);

CREATE FUNCTION public.list_warehouse_transfers(
  p_status_filter text[]      DEFAULT NULL,
  p_warehouse_id  uuid        DEFAULT NULL,
  p_search        text        DEFAULT NULL,
  p_since         timestamptz DEFAULT NULL,
  p_limit         int         DEFAULT 50,
  p_cursor        bigint      DEFAULT NULL
) RETURNS TABLE(
  id                   bigint,
  doc_no               text,
  from_warehouse_id    uuid,
  to_warehouse_id      uuid,
  sender_user_id       uuid,
  sender_name          text,
  receiver_user_id     uuid,
  receiver_name        text,
  received_by_user_id  uuid,
  received_by_name     text,
  cancelled_by_user_id uuid,
  cancelled_by_name    text,
  status               text,
  total_qty_sent       int,
  total_qty_received   int,
  total_loss_qty       int,
  initiated_at         timestamptz,
  received_at          timestamptz,
  cancelled_at         timestamptz,
  n_items              int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  WITH base AS (
    SELECT wt.*, (SELECT COUNT(*)::int FROM public.warehouse_transfer_items i
                    WHERE i.tenant_id = wt.tenant_id AND i.transfer_id = wt.id) AS n_items
      FROM public.warehouse_transfers wt
     WHERE wt.tenant_id = public._resolve_tenant_id()
       AND (p_status_filter IS NULL OR wt.status = ANY(p_status_filter))
       AND (p_warehouse_id IS NULL OR wt.from_warehouse_id = p_warehouse_id OR wt.to_warehouse_id = p_warehouse_id)
       AND (p_search IS NULL OR wt.doc_no ILIKE '%' || p_search || '%')
       AND (p_since IS NULL OR wt.initiated_at >= p_since)
       AND (p_cursor IS NULL OR wt.id < p_cursor)
  )
  SELECT b.id, b.doc_no, b.from_warehouse_id, b.to_warehouse_id,
         b.sender_user_id, s.name AS sender_name,
         b.receiver_user_id, r.name AS receiver_name,
         b.received_by_user_id, rb.name AS received_by_name,
         b.cancelled_by_user_id, cb.name AS cancelled_by_name,
         b.status, b.total_qty_sent, b.total_qty_received, b.total_loss_qty,
         b.initiated_at, b.received_at, b.cancelled_at, b.n_items
    FROM base b
    LEFT JOIN public.admin_users s  ON s.id  = b.sender_user_id
    LEFT JOIN public.admin_users r  ON r.id  = b.receiver_user_id
    LEFT JOIN public.admin_users rb ON rb.id = b.received_by_user_id
    LEFT JOIN public.admin_users cb ON cb.id = b.cancelled_by_user_id
   ORDER BY b.initiated_at DESC, b.id DESC
   LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;

GRANT EXECUTE ON FUNCTION public.list_warehouse_transfers(text[], uuid, text, timestamptz, int, bigint) TO authenticated;
