-- Migration: _insert_supplier_claim internal helper (Item #1 rev 3, slot 101a)
--
-- Internal helper called by the public create_supplier_claim_from_* RPCs
-- and by _apply_adjustment_change (for ad-hoc rusak KLAIM disposition).
-- Not exposed to authenticated users — only vosi_rpc_owner can EXECUTE.
--
-- Inserts a row into supplier_claims with status='AWAITING_OWNER_DECISION'
-- (default) and emits a CREATED event into supplier_claim_events. Handles
-- idempotency via optional (tenant_id, idempotency_key) unique index —
-- same key returns existing claim_id.
--
-- Spec: docs/superpowers/specs/2026-07-12-opname-damage-supplier-claims-design.md §3.1

CREATE OR REPLACE FUNCTION public._insert_supplier_claim(
  p_tenant_id       UUID,
  p_supplier_id     UUID,          -- NULLABLE (unknown at opname commit; owner sets later)
  p_sku             TEXT,
  p_warehouse       TEXT,          -- 'atas' | 'bawah'
  p_qty             INTEGER,
  p_unit_cost       NUMERIC,
  p_source_type     TEXT,          -- 'PO_RECEIPT' | 'STOCK_OPNAME' | 'STOCK_ADJUSTMENT'
  p_source_ref_id   TEXT,          -- stringified source id (UUID for PO, BIGINT for opname/adj)
  p_notes           TEXT,
  p_evidence_urls   TEXT[],
  p_created_by      UUID,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id UUID;
BEGIN
  -- Idempotency: return existing claim if key matches
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_claim_id
      FROM public.supplier_claims
     WHERE tenant_id = p_tenant_id
       AND idempotency_key = p_idempotency_key;
    IF v_claim_id IS NOT NULL THEN
      RETURN v_claim_id;
    END IF;
  END IF;

  -- Insert claim (status defaults to AWAITING_OWNER_DECISION)
  INSERT INTO public.supplier_claims (
    tenant_id, supplier_id, sku, warehouse, qty, unit_cost,
    source_type, source_ref_id, damage_notes, evidence_urls,
    created_by, idempotency_key
  ) VALUES (
    p_tenant_id, p_supplier_id, p_sku, p_warehouse, p_qty, p_unit_cost,
    p_source_type, p_source_ref_id, p_notes,
    COALESCE(p_evidence_urls, ARRAY[]::TEXT[]),
    p_created_by, p_idempotency_key
  ) RETURNING id INTO v_claim_id;

  -- Emit CREATED event
  INSERT INTO public.supplier_claim_events (
    claim_id, event_type, actor_user_id, payload, tenant_id
  ) VALUES (
    v_claim_id, 'CREATED', p_created_by,
    jsonb_build_object(
      'qty', p_qty,
      'unit_cost', p_unit_cost,
      'source_type', p_source_type,
      'source_ref_id', p_source_ref_id,
      'supplier_id', p_supplier_id
    ),
    p_tenant_id
  );

  RETURN v_claim_id;
END $$;

-- Ownership + grants: internal only (vosi_rpc_owner) — NOT exposed to authenticated
ALTER FUNCTION public._insert_supplier_claim(
  UUID, UUID, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT
) OWNER TO vosi_rpc_owner;

REVOKE ALL ON FUNCTION public._insert_supplier_claim(
  UUID, UUID, TEXT, TEXT, INTEGER, NUMERIC, TEXT, TEXT, TEXT, TEXT[], UUID, TEXT
) FROM PUBLIC, authenticated;
