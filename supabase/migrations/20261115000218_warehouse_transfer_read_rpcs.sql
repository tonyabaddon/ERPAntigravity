-- 20261115000218_warehouse_transfer_read_rpcs.sql
-- Read-side RPCs for list screen, detail screen, in-transit chip.

-- ── list_warehouse_transfers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_warehouse_transfers(
  p_status_filter text[]      DEFAULT NULL,   -- ['IN_TRANSIT','RECEIVED',...]
  p_warehouse_id  uuid        DEFAULT NULL,   -- filter to transfers touching this warehouse (either side)
  p_search        text        DEFAULT NULL,   -- substring of doc_no
  p_since         timestamptz DEFAULT NULL,   -- initiated_at cutoff
  p_limit         int         DEFAULT 50,
  p_cursor        bigint      DEFAULT NULL    -- last id from previous page (DESC order)
) RETURNS TABLE(
  id                 bigint,
  doc_no             text,
  from_warehouse_id  uuid,
  to_warehouse_id    uuid,
  sender_user_id     uuid,
  receiver_user_id   uuid,
  status             text,
  total_qty_sent     int,
  total_qty_received int,
  total_loss_qty     int,
  initiated_at       timestamptz,
  received_at        timestamptz,
  cancelled_at       timestamptz,
  n_items            int
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
  SELECT id, doc_no, from_warehouse_id, to_warehouse_id, sender_user_id, receiver_user_id,
         status, total_qty_sent, total_qty_received, total_loss_qty,
         initiated_at, received_at, cancelled_at, n_items
    FROM base
   ORDER BY initiated_at DESC, id DESC
   LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;
GRANT EXECUTE ON FUNCTION public.list_warehouse_transfers(text[], uuid, text, timestamptz, int, bigint) TO authenticated;

-- ── get_warehouse_transfer_detail ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_warehouse_transfer_detail(p_transfer_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE
  v_tenant uuid := public._resolve_tenant_id();
  v_header jsonb;
  v_items  jsonb;
BEGIN
  SELECT to_jsonb(wt.*) INTO v_header FROM public.warehouse_transfers wt
   WHERE wt.tenant_id = v_tenant AND wt.id = p_transfer_id;
  IF v_header IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.line_no) INTO v_items
    FROM public.warehouse_transfer_items i
   WHERE i.tenant_id = v_tenant AND i.transfer_id = p_transfer_id;

  RETURN jsonb_build_object('header', v_header, 'items', COALESCE(v_items, '[]'::jsonb));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_warehouse_transfer_detail(bigint) TO authenticated;

-- ── get_in_transit_by_warehouse ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_in_transit_by_warehouse(p_warehouse_id uuid)
RETURNS TABLE(sku text, in_transit_qty int)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT i.sku,
         SUM(i.qty_sent - COALESCE(i.qty_received, 0))::int AS in_transit_qty
    FROM public.warehouse_transfer_items i
    JOIN public.warehouse_transfers wt
      ON (wt.tenant_id, wt.id) = (i.tenant_id, i.transfer_id)
   WHERE wt.tenant_id = public._resolve_tenant_id()
     AND wt.to_warehouse_id = p_warehouse_id
     AND wt.status = 'IN_TRANSIT'
   GROUP BY i.sku;
$$;
GRANT EXECUTE ON FUNCTION public.get_in_transit_by_warehouse(uuid) TO authenticated;
