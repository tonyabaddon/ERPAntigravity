-- Migration: read RPCs for supplier_claims (Item #1 rev 3, slot 105)
--
-- list_supplier_claims(filter)     — paginated list with supplier name lookup
-- get_supplier_claim(id)           — single claim with supplier + book_value
-- list_supplier_claim_events(id)   — audit trail for a claim
--
-- All tenant-scoped via _resolve_tenant_id(). SECDEF for consistent
-- filter behavior + centralized joins.

CREATE OR REPLACE FUNCTION public.list_supplier_claims(
  p_filter_status      TEXT[] DEFAULT NULL,
  p_filter_supplier_id UUID DEFAULT NULL,
  p_filter_source_type TEXT[] DEFAULT NULL,
  p_date_from          DATE DEFAULT NULL,
  p_date_to            DATE DEFAULT NULL,
  p_page_size          INT DEFAULT 50,
  p_offset             INT DEFAULT 0
) RETURNS TABLE (
  id            UUID,
  sku           TEXT,
  warehouse     TEXT,
  qty           INT,
  unit_cost     NUMERIC,
  book_value    NUMERIC,
  status        TEXT,
  source_type   TEXT,
  source_ref_id TEXT,
  supplier_id   UUID,
  supplier_name TEXT,
  damage_notes  TEXT,
  evidence_urls TEXT[],
  created_at    TIMESTAMPTZ,
  owner_decision_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  resolution_amount NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  RETURN QUERY
  SELECT sc.id,
         sc.sku,
         sc.warehouse,
         sc.qty,
         sc.unit_cost,
         (sc.qty * sc.unit_cost)::NUMERIC AS book_value,
         sc.status,
         sc.source_type,
         sc.source_ref_id,
         sc.supplier_id,
         s.name AS supplier_name,
         sc.damage_notes,
         sc.evidence_urls,
         sc.created_at,
         sc.owner_decision_at,
         sc.resolved_at,
         sc.resolution_amount
    FROM public.supplier_claims sc
    LEFT JOIN public.suppliers s ON s.id = sc.supplier_id
   WHERE sc.tenant_id = v_tenant
     AND (p_filter_status IS NULL OR sc.status = ANY(p_filter_status))
     AND (p_filter_supplier_id IS NULL OR sc.supplier_id = p_filter_supplier_id)
     AND (p_filter_source_type IS NULL OR sc.source_type = ANY(p_filter_source_type))
     AND (p_date_from IS NULL OR sc.created_at::DATE >= p_date_from)
     AND (p_date_to IS NULL OR sc.created_at::DATE <= p_date_to)
   ORDER BY sc.created_at DESC
   LIMIT p_page_size OFFSET p_offset;
END $$;

CREATE OR REPLACE FUNCTION public.get_supplier_claim(p_claim_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_claim    RECORD;
  v_supplier RECORD;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_claim FROM public.supplier_claims
    WHERE id = p_claim_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim % not found', p_claim_id;
  END IF;

  IF v_claim.supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_claim.supplier_id;
  END IF;

  RETURN jsonb_build_object(
    'claim', to_jsonb(v_claim),
    'supplier', CASE WHEN v_supplier IS NULL THEN NULL ELSE to_jsonb(v_supplier) END,
    'book_value', v_claim.qty * v_claim.unit_cost
  );
END $$;

CREATE OR REPLACE FUNCTION public.list_supplier_claim_events(p_claim_id UUID)
RETURNS TABLE (
  id               BIGINT,
  event_type       TEXT,
  actor_user_id    UUID,
  payload          JSONB,
  journal_entry_id UUID,
  at               TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_claims
     WHERE id = p_claim_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'claim % not found', p_claim_id;
  END IF;

  RETURN QUERY
  SELECT e.id, e.event_type, e.actor_user_id, e.payload, e.journal_entry_id, e.at
    FROM public.supplier_claim_events e
   WHERE e.claim_id = p_claim_id
   ORDER BY e.at ASC;
END $$;

ALTER FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) OWNER TO vosi_rpc_owner;
ALTER FUNCTION public.get_supplier_claim(UUID) OWNER TO vosi_rpc_owner;
ALTER FUNCTION public.list_supplier_claim_events(UUID) OWNER TO vosi_rpc_owner;

REVOKE ALL ON FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_supplier_claim(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_supplier_claim_events(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_supplier_claims(TEXT[], UUID, TEXT[], DATE, DATE, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_supplier_claim_events(UUID) TO authenticated;
