-- Migration: resolve_supplier_claim RPC (Item #1 rev 3, slot 104)
--
-- Transitions a PENDING supplier_claim to a terminal RESOLVED_* / REJECTED
-- state after supplier responds. 4 outcomes with variance handling.
--
-- Outcomes:
--   REPLACED   — supplier ships replacement goods; stock restored
--   CREDITED   — supplier gives credit note against AP invoice
--   CASHED     — supplier refunds cash to Kas/Bank account
--   REJECTED   — supplier rejects claim; loss recognized
--
-- Variance handling (when p_resolution_amount ≠ book_value):
--   - CREDITED/CASHED partial (< book): Dr partial + Dr 5-3160 (loss) / Cr 1-1460
--   - CREDITED/CASHED overpay (> book): Dr full / Cr 1-1460 + Cr 4-1200 (other income)
--
-- Approval gate deferred to next iteration (approval_settings for
-- RESOLVE_SUPPLIER_CLAIM). For MVP: any authenticated user in tenant.

CREATE OR REPLACE FUNCTION public.resolve_supplier_claim(
  p_claim_id             UUID,
  p_outcome              TEXT,          -- 'REPLACED' | 'CREDITED' | 'CASHED' | 'REJECTED'
  p_resolution_amount    NUMERIC DEFAULT NULL,
  p_resolution_target_id TEXT DEFAULT NULL,  -- AP invoice UUID for CREDITED, account code for CASHED
  p_notes                TEXT DEFAULT NULL,
  p_evidence_urls        TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim          RECORD;
  v_user_id        UUID;
  v_book_value     NUMERIC;
  v_variance       NUMERIC;
  v_lines          JSONB;
  v_journal        JSONB;
  v_journal_id     UUID;
  v_new_status     TEXT;
  v_dmg_qty_before INT;
  v_dmg_movement_id BIGINT;
  v_wh_id          UUID;
  v_acc_claim_susp CONSTANT TEXT := '1-1460';
  v_acc_inventory  CONSTANT TEXT := '1-1510';
  v_acc_ap         CONSTANT TEXT := '2-1100';
  v_acc_damage     CONSTANT TEXT := '5-3160';
  v_acc_prepay     CONSTANT TEXT := '1-1450';
  v_acc_other_inc  CONSTANT TEXT := '4-1200';
BEGIN
  v_user_id := public._current_user_id();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  IF p_outcome NOT IN ('REPLACED','CREDITED','CASHED','REJECTED') THEN
    RAISE EXCEPTION 'invalid outcome: % (REPLACED|CREDITED|CASHED|REJECTED)', p_outcome;
  END IF;

  SELECT * INTO v_claim FROM public.supplier_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim % not found', p_claim_id; END IF;

  IF v_claim.tenant_id <> public._resolve_tenant_id() THEN
    RAISE EXCEPTION 'claim % is not accessible from current tenant', p_claim_id;
  END IF;

  IF v_claim.status <> 'PENDING' THEN
    RAISE EXCEPTION 'claim % is not PENDING (status=%). Can only resolve PENDING claims.',
      p_claim_id, v_claim.status;
  END IF;

  v_book_value := v_claim.qty * v_claim.unit_cost;

  -- Build journal per outcome
  IF p_outcome = 'REPLACED' THEN
    -- Supplier ships replacement; restore inventory
    v_new_status := 'RESOLVED_REPLACED';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_inventory,  'side','DEBIT',  'amount', v_book_value, 'description', 'Persediaan barang pengganti dari supplier'),
      jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (replaced)')
    );

  ELSIF p_outcome = 'CREDITED' THEN
    IF p_resolution_amount IS NULL THEN
      RAISE EXCEPTION 'resolution_amount required for CREDITED';
    END IF;
    v_new_status := 'RESOLVED_CREDITED';
    v_variance := v_book_value - p_resolution_amount;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_ap, 'side','DEBIT', 'amount', p_resolution_amount, 'description', 'Potongan utang dari klaim')
    );
    IF v_variance > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_damage, 'side','DEBIT', 'amount', v_variance, 'description', 'Selisih klaim (partial credit — loss)');
    ELSIF v_variance < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_other_inc, 'side','CREDIT', 'amount', -v_variance, 'description', 'Selisih klaim (overpay — untung)');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (credited)');

  ELSIF p_outcome = 'CASHED' THEN
    IF p_resolution_amount IS NULL THEN
      RAISE EXCEPTION 'resolution_amount required for CASHED';
    END IF;
    IF p_resolution_target_id IS NULL THEN
      RAISE EXCEPTION 'resolution_target_id required for CASHED (Kas/Bank account code)';
    END IF;
    v_new_status := 'RESOLVED_CASHED';
    v_variance := v_book_value - p_resolution_amount;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', p_resolution_target_id, 'side','DEBIT', 'amount', p_resolution_amount, 'description', 'Refund cash dari supplier')
    );
    IF v_variance > 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_damage, 'side','DEBIT', 'amount', v_variance, 'description', 'Selisih refund (partial — loss)');
    ELSIF v_variance < 0 THEN
      v_lines := v_lines || jsonb_build_object('account_code', v_acc_other_inc, 'side','CREDIT', 'amount', -v_variance, 'description', 'Selisih refund (overpay — untung)');
    END IF;
    v_lines := v_lines || jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (cashed)');

  ELSE -- REJECTED
    v_new_status := 'REJECTED';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_damage,     'side','DEBIT',  'amount', v_book_value, 'description', 'Klaim ditolak supplier — jadi Beban Barang Rusak'),
      jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (rejected)')
    );
  END IF;

  -- Post journal
  IF v_book_value > 0 THEN
    v_journal := public._post_journal_entry(
      p_entry_date       => CURRENT_DATE,
      p_source_type      => 'SUPPLIER_CLAIM'::public.journal_entry_source,
      p_description      => format('Resolve claim %s: %s (%s x %s)',
                                   p_claim_id, p_outcome, v_claim.qty, v_claim.sku),
      p_lines            => v_lines,
      p_source_ref_table => 'supplier_claims',
      p_source_ref_id    => p_claim_id,
      p_tenant_id        => v_claim.tenant_id
    );
    v_journal_id := (v_journal->>'entry_id')::UUID;
  END IF;

  -- For REPLACED: restore stock (mirror of opname_damage decrement)
  IF p_outcome = 'REPLACED' THEN
    -- Look up warehouse_id from stock_levels by tenant + sku + warehouse code
    SELECT w.id INTO v_wh_id
      FROM public.warehouses w
     WHERE w.tenant_id = v_claim.tenant_id
       AND LOWER(w.code) = v_claim.warehouse
     LIMIT 1;
    IF v_wh_id IS NULL THEN
      RAISE EXCEPTION 'warehouse code % not found for tenant', v_claim.warehouse;
    END IF;

    SELECT qty INTO v_dmg_qty_before
      FROM public.stock_levels
     WHERE sku = v_claim.sku AND warehouse_id = v_wh_id FOR UPDATE;
    IF v_dmg_qty_before IS NULL THEN
      -- Create stock_levels row if missing (edge case)
      INSERT INTO public.stock_levels (sku, warehouse_id, qty, tenant_id, updated_at)
        VALUES (v_claim.sku, v_wh_id, v_claim.qty, v_claim.tenant_id, now());
      v_dmg_qty_before := 0;
    ELSE
      UPDATE public.stock_levels
         SET qty = qty + v_claim.qty, updated_at = now()
       WHERE sku = v_claim.sku AND warehouse_id = v_wh_id;
    END IF;

    v_dmg_movement_id := public._log_stock_movement(
      p_sku              => v_claim.sku,
      p_warehouse        => NULL,
      p_qty_delta        => v_claim.qty,
      p_qty_before       => v_dmg_qty_before,
      p_source           => 'supplier_claim_return'::public.stock_movement_source,
      p_related_doc_type => 'supplier_claim',
      p_related_doc_id   => p_claim_id::text,
      p_reason_code      => 'replacement',
      p_reason_note      => COALESCE(p_notes, 'replacement from supplier'),
      p_actor_user_id    => v_user_id,
      p_actor_role       => 'claim_resolve',
      p_evidence_urls    => COALESCE(p_evidence_urls, '{}'::text[])
    );
    UPDATE public.stock_movements SET warehouse_id = v_wh_id WHERE id = v_dmg_movement_id;
  END IF;

  -- Update claim state
  UPDATE public.supplier_claims
     SET status                = v_new_status,
         resolution_amount     = COALESCE(p_resolution_amount, v_book_value),
         resolution_target_id  = p_resolution_target_id,
         resolved_at           = now(),
         resolved_by           = v_user_id,
         resolution_journal_id = v_journal_id,
         resolution_notes      = p_notes
   WHERE id = p_claim_id;

  -- Emit event
  INSERT INTO public.supplier_claim_events (
    claim_id, event_type, actor_user_id, payload, journal_entry_id, tenant_id
  ) VALUES (
    p_claim_id, 'RESOLVED', v_user_id,
    jsonb_build_object(
      'outcome', p_outcome,
      'resolution_amount', COALESCE(p_resolution_amount, v_book_value),
      'book_value', v_book_value,
      'variance', v_variance
    ),
    v_journal_id, v_claim.tenant_id
  );

  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'new_status', v_new_status,
    'journal_id', v_journal_id,
    'book_value', v_book_value,
    'variance', v_variance
  );
END $$;

ALTER FUNCTION public.resolve_supplier_claim(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT[]) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.resolve_supplier_claim(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_supplier_claim(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT[]) TO authenticated;
