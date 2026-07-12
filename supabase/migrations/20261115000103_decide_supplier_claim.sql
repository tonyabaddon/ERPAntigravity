-- Migration: decide_supplier_claim RPC (Item #1 rev 3, slot 103)
--
-- Owner (or admin per tenant SOP) transitions a supplier_claim from
-- AWAITING_OWNER_DECISION to either DISPOSED (accept loss) or PENDING
-- (klaim to supplier).
--
-- DISPOSE path:
--   - status → DISPOSED
--   - Post reclassification journal: Dr 5-3160 Beban Barang Rusak / Cr 1-1460 Piutang Klaim
--   - No stock movement (goods already left inventory at opname commit)
--
-- KLAIM path:
--   - status → PENDING
--   - supplier_id required (was NULL at opname commit)
--   - No journal (Piutang Klaim stays until supplier responds)
--
-- Auth: any authenticated user in the claim's tenant. Per-tenant SOP can
-- add threshold/PIN gate via approval_settings (deferred).

CREATE OR REPLACE FUNCTION public.decide_supplier_claim(
  p_claim_id       UUID,
  p_decision       TEXT,            -- 'DISPOSE' | 'KLAIM'
  p_supplier_id    UUID DEFAULT NULL,  -- required when decision='KLAIM'
  p_notes          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim          RECORD;
  v_user_id        UUID;
  v_amount         NUMERIC;
  v_journal        JSONB;
  v_journal_id     UUID;
  v_new_status     TEXT;
  v_event_type     TEXT;
  v_acc_claim_susp CONSTANT TEXT := '1-1460';
  v_acc_damage     CONSTANT TEXT := '5-3160';
BEGIN
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_decision NOT IN ('DISPOSE','KLAIM') THEN
    RAISE EXCEPTION 'invalid decision: % (expected DISPOSE or KLAIM)', p_decision;
  END IF;

  -- Lock claim
  SELECT * INTO v_claim FROM public.supplier_claims
    WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim % not found', p_claim_id;
  END IF;

  -- Verify caller belongs to the claim's tenant (RLS defense-in-depth)
  IF v_claim.tenant_id <> public._resolve_tenant_id() THEN
    RAISE EXCEPTION 'claim % is not accessible from current tenant', p_claim_id;
  END IF;

  IF v_claim.status <> 'AWAITING_OWNER_DECISION' THEN
    RAISE EXCEPTION 'claim % is not AWAITING_OWNER_DECISION (status=%)',
      p_claim_id, v_claim.status;
  END IF;

  IF p_decision = 'KLAIM' THEN
    IF p_supplier_id IS NULL THEN
      RAISE EXCEPTION 'supplier_id required for KLAIM decision';
    END IF;
    -- Verify supplier belongs to same tenant
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers
       WHERE id = p_supplier_id AND tenant_id = v_claim.tenant_id
    ) THEN
      RAISE EXCEPTION 'supplier % not found in tenant', p_supplier_id;
    END IF;

    v_new_status := 'PENDING';
    v_event_type := 'OWNER_DECIDED_KLAIM';

    UPDATE public.supplier_claims
       SET status               = v_new_status,
           supplier_id          = p_supplier_id,
           owner_decision_at    = now(),
           owner_decided_by     = v_user_id,
           owner_decision_notes = p_notes
     WHERE id = p_claim_id;

  ELSE
    -- DISPOSE path: reclassify Piutang Klaim → Beban Barang Rusak
    v_amount := v_claim.qty * v_claim.unit_cost;

    v_new_status := 'DISPOSED';
    v_event_type := 'OWNER_DECIDED_DISPOSE';

    UPDATE public.supplier_claims
       SET status               = v_new_status,
           owner_decision_at    = now(),
           owner_decided_by     = v_user_id,
           owner_decision_notes = p_notes
     WHERE id = p_claim_id;

    -- Post reclassification journal if there's monetary value
    IF v_amount > 0 THEN
      v_journal := public._post_journal_entry(
        p_entry_date       => CURRENT_DATE,
        p_source_type      => 'SUPPLIER_CLAIM'::public.journal_entry_source,
        p_description      => format('Dispose barang rusak: %s x %s (claim %s)',
                                     v_claim.qty, v_claim.sku, p_claim_id),
        p_lines            => jsonb_build_array(
          jsonb_build_object(
            'account_code', v_acc_damage,
            'side', 'DEBIT',
            'amount', v_amount,
            'description', 'Beban barang rusak (dispose oleh owner)'
          ),
          jsonb_build_object(
            'account_code', v_acc_claim_susp,
            'side', 'CREDIT',
            'amount', v_amount,
            'description', 'Reklas Piutang Klaim ke Beban (dispose)'
          )
        ),
        p_source_ref_table => 'supplier_claims',
        p_source_ref_id    => p_claim_id,
        p_tenant_id        => v_claim.tenant_id
      );

      v_journal_id := (v_journal->>'entry_id')::UUID;
    END IF;
  END IF;

  -- Emit event
  INSERT INTO public.supplier_claim_events (
    claim_id, event_type, actor_user_id, payload, journal_entry_id, tenant_id
  ) VALUES (
    p_claim_id, v_event_type, v_user_id,
    jsonb_build_object(
      'decision', p_decision,
      'supplier_id', p_supplier_id,
      'notes', p_notes,
      'amount', v_amount
    ),
    v_journal_id,
    v_claim.tenant_id
  );

  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'new_status', v_new_status,
    'journal_id', v_journal_id
  );
END $$;

ALTER FUNCTION public.decide_supplier_claim(UUID, TEXT, UUID, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.decide_supplier_claim(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_supplier_claim(UUID, TEXT, UUID, TEXT) TO authenticated;
