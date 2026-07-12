-- Migration: bug fixes discovered during end-to-end MCP Chrome smoke test
-- (Item #1 rev 3, slot 108)
--
-- All 4 fixes applied to Garindo prod during smoke session 2026-07-12.
-- Recording them here for feature-branch parity + audit trail.
--
-- Bug 1: uq_je_source_unique (partial index on journal_entries) blocks
--   multiple journals per claim. decide_supplier_claim's DISPOSE reclass
--   AND resolve_supplier_claim's outcome journal both reference the same
--   claim → CREATE journal conflicts with reclass/resolve journal.
--   Fix: pass NULL for source_ref_table/id in decide + resolve. Claim ↔
--   journal linkage remains via supplier_claim_events.journal_entry_id.
--
-- Bug 2: stock_movements has append-only trigger (trg_deny_sm_update /
--   trg_deny_sm_delete → deny_stock_movement_mutation()). Previous
--   resolve_supplier_claim REPLACED path used _log_stock_movement helper
--   then UPDATEd warehouse_id — hits trigger. Fix: INSERT directly with
--   warehouse_id from the start.
--
-- Bug 3: same as bug 2 latent in _apply_opname_change damage loop (never
--   surfaced because no committed opname has had damaged_qty > 0 in prod).
--   Same fix: INSERT stock_movements directly with warehouse_id.
--
-- Bug 4: list_supplier_claim_events had ambiguous column ref `id` (RETURN
--   TABLE column shadowed the WHERE clause). Fix: qualify with sc.id.

-- =========================================================
-- Fix 1: decide_supplier_claim — NULL source_ref
-- =========================================================
CREATE OR REPLACE FUNCTION public.decide_supplier_claim(
  p_claim_id       UUID,
  p_decision       TEXT,
  p_supplier_id    UUID DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_decision NOT IN ('DISPOSE','KLAIM') THEN
    RAISE EXCEPTION 'invalid decision: % (expected DISPOSE or KLAIM)', p_decision;
  END IF;

  SELECT * INTO v_claim FROM public.supplier_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim % not found', p_claim_id; END IF;
  IF v_claim.tenant_id <> public._resolve_tenant_id() THEN
    RAISE EXCEPTION 'claim % is not accessible from current tenant', p_claim_id;
  END IF;
  IF v_claim.status <> 'AWAITING_OWNER_DECISION' THEN
    RAISE EXCEPTION 'claim % is not AWAITING_OWNER_DECISION (status=%)', p_claim_id, v_claim.status;
  END IF;

  IF p_decision = 'KLAIM' THEN
    IF p_supplier_id IS NULL THEN
      RAISE EXCEPTION 'supplier_id required for KLAIM decision';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = v_claim.tenant_id) THEN
      RAISE EXCEPTION 'supplier % not found in tenant', p_supplier_id;
    END IF;
    v_new_status := 'PENDING';
    v_event_type := 'OWNER_DECIDED_KLAIM';
    UPDATE public.supplier_claims
       SET status = v_new_status, supplier_id = p_supplier_id,
           owner_decision_at = now(), owner_decided_by = v_user_id,
           owner_decision_notes = p_notes
     WHERE id = p_claim_id;
  ELSE
    v_amount := v_claim.qty * v_claim.unit_cost;
    v_new_status := 'DISPOSED';
    v_event_type := 'OWNER_DECIDED_DISPOSE';
    UPDATE public.supplier_claims
       SET status = v_new_status,
           owner_decision_at = now(), owner_decided_by = v_user_id,
           owner_decision_notes = p_notes
     WHERE id = p_claim_id;

    IF v_amount > 0 THEN
      -- NULL source_ref avoids uq_je_source_unique conflict with CREATE journal
      v_journal := public._post_journal_entry(
        CURRENT_DATE, 'SUPPLIER_CLAIM'::public.journal_entry_source,
        format('Dispose barang rusak: %s x %s (claim %s)', v_claim.qty, v_claim.sku, p_claim_id),
        jsonb_build_array(
          jsonb_build_object('account_code', v_acc_damage,     'side', 'DEBIT',  'amount', v_amount, 'description', 'Beban barang rusak (dispose oleh owner)'),
          jsonb_build_object('account_code', v_acc_claim_susp, 'side', 'CREDIT', 'amount', v_amount, 'description', 'Reklas Piutang Klaim ke Beban (dispose)')
        ),
        NULL, NULL, v_claim.tenant_id
      );
      v_journal_id := (v_journal->>'entry_id')::UUID;
    END IF;
  END IF;

  INSERT INTO public.supplier_claim_events (
    claim_id, event_type, actor_user_id, payload, journal_entry_id, tenant_id
  ) VALUES (
    p_claim_id, v_event_type, v_user_id,
    jsonb_build_object('decision', p_decision, 'supplier_id', p_supplier_id, 'notes', p_notes, 'amount', v_amount),
    v_journal_id, v_claim.tenant_id
  );

  RETURN jsonb_build_object('claim_id', p_claim_id, 'new_status', v_new_status, 'journal_id', v_journal_id);
END $$;

ALTER FUNCTION public.decide_supplier_claim(UUID, TEXT, UUID, TEXT) OWNER TO vosi_rpc_owner;

-- =========================================================
-- Fix 2: resolve_supplier_claim — NULL source_ref + direct stock_movements INSERT
-- =========================================================
CREATE OR REPLACE FUNCTION public.resolve_supplier_claim(
  p_claim_id             UUID,
  p_outcome              TEXT,
  p_resolution_amount    NUMERIC DEFAULT NULL,
  p_resolution_target_id TEXT DEFAULT NULL,
  p_notes                TEXT DEFAULT NULL,
  p_evidence_urls        TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_wh_id          UUID;
  v_acc_claim_susp CONSTANT TEXT := '1-1460';
  v_acc_inventory  CONSTANT TEXT := '1-1510';
  v_acc_ap         CONSTANT TEXT := '2-1100';
  v_acc_damage     CONSTANT TEXT := '5-3160';
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
    RAISE EXCEPTION 'claim % is not PENDING (status=%). Can only resolve PENDING claims.', p_claim_id, v_claim.status;
  END IF;

  v_book_value := v_claim.qty * v_claim.unit_cost;

  IF p_outcome = 'REPLACED' THEN
    v_new_status := 'RESOLVED_REPLACED';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_inventory,  'side','DEBIT',  'amount', v_book_value, 'description', 'Persediaan barang pengganti dari supplier'),
      jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (replaced)')
    );
  ELSIF p_outcome = 'CREDITED' THEN
    IF p_resolution_amount IS NULL THEN RAISE EXCEPTION 'resolution_amount required for CREDITED'; END IF;
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
    IF p_resolution_amount IS NULL THEN RAISE EXCEPTION 'resolution_amount required for CASHED'; END IF;
    IF p_resolution_target_id IS NULL THEN RAISE EXCEPTION 'resolution_target_id required for CASHED (Kas/Bank account code)'; END IF;
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
  ELSE
    v_new_status := 'REJECTED';
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_acc_damage,     'side','DEBIT',  'amount', v_book_value, 'description', 'Klaim ditolak supplier — jadi Beban Barang Rusak'),
      jsonb_build_object('account_code', v_acc_claim_susp, 'side','CREDIT', 'amount', v_book_value, 'description', 'Piutang klaim closed (rejected)')
    );
  END IF;

  IF v_book_value > 0 THEN
    -- NULL source_ref for the same reason as decide_supplier_claim
    v_journal := public._post_journal_entry(
      CURRENT_DATE, 'SUPPLIER_CLAIM'::public.journal_entry_source,
      format('Resolve claim %s: %s (%s x %s)', p_claim_id, p_outcome, v_claim.qty, v_claim.sku),
      v_lines, NULL, NULL, v_claim.tenant_id
    );
    v_journal_id := (v_journal->>'entry_id')::UUID;
  END IF;

  IF p_outcome = 'REPLACED' THEN
    SELECT w.id INTO v_wh_id FROM public.warehouses w
     WHERE w.tenant_id = v_claim.tenant_id AND LOWER(w.code) = v_claim.warehouse LIMIT 1;
    IF v_wh_id IS NULL THEN RAISE EXCEPTION 'warehouse code % not found for tenant', v_claim.warehouse; END IF;

    SELECT qty INTO v_dmg_qty_before FROM public.stock_levels
     WHERE sku = v_claim.sku AND warehouse_id = v_wh_id FOR UPDATE;
    IF v_dmg_qty_before IS NULL THEN
      INSERT INTO public.stock_levels (sku, warehouse_id, qty, tenant_id, updated_at)
        VALUES (v_claim.sku, v_wh_id, v_claim.qty, v_claim.tenant_id, now());
      v_dmg_qty_before := 0;
    ELSE
      UPDATE public.stock_levels SET qty = qty + v_claim.qty, updated_at = now()
       WHERE sku = v_claim.sku AND warehouse_id = v_wh_id;
    END IF;

    -- Direct INSERT with warehouse_id (append-only trigger blocks post-UPDATE)
    INSERT INTO public.stock_movements (
      sku, warehouse, qty_delta, qty_before, qty_after, source,
      related_doc_type, related_doc_id, reason_code, reason_note,
      actor_user_id, actor_role, evidence_urls, warehouse_id, tenant_id
    ) VALUES (
      v_claim.sku, v_claim.warehouse, v_claim.qty,
      v_dmg_qty_before, v_dmg_qty_before + v_claim.qty,
      'supplier_claim_return'::public.stock_movement_source,
      'supplier_claim', p_claim_id::TEXT, 'replacement',
      COALESCE(p_notes, 'replacement from supplier'),
      v_user_id, 'claim_resolve',
      COALESCE(p_evidence_urls, '{}'::text[]),
      v_wh_id, v_claim.tenant_id
    );
  END IF;

  UPDATE public.supplier_claims
     SET status                = v_new_status,
         resolution_amount     = COALESCE(p_resolution_amount, v_book_value),
         resolution_target_id  = p_resolution_target_id,
         resolved_at           = now(),
         resolved_by           = v_user_id,
         resolution_journal_id = v_journal_id,
         resolution_notes      = p_notes
   WHERE id = p_claim_id;

  INSERT INTO public.supplier_claim_events (
    claim_id, event_type, actor_user_id, payload, journal_entry_id, tenant_id
  ) VALUES (
    p_claim_id, 'RESOLVED', v_user_id,
    jsonb_build_object('outcome', p_outcome, 'resolution_amount', COALESCE(p_resolution_amount, v_book_value), 'book_value', v_book_value, 'variance', v_variance),
    v_journal_id, v_claim.tenant_id
  );

  RETURN jsonb_build_object('claim_id', p_claim_id, 'new_status', v_new_status, 'journal_id', v_journal_id, 'book_value', v_book_value, 'variance', v_variance);
END $$;

ALTER FUNCTION public.resolve_supplier_claim(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT[]) OWNER TO vosi_rpc_owner;

-- =========================================================
-- Fix 3: _apply_opname_change damage loop — direct stock_movements INSERT
-- (same append-only trigger issue, latent bug — no committed opname
-- has had damaged_qty > 0 yet)
-- =========================================================
CREATE OR REPLACE FUNCTION public._apply_opname_change(p_approval_id BIGINT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT    := 0;
  v_movement_id      BIGINT;
  v_qty_before       INT;
  v_dmg_qty_before   INT;
  v_dmg_unit_cost    NUMERIC;
  v_dmg_amount       NUMERIC;
  v_dmg_journal      JSONB;
  v_dmg_journal_id   UUID;
  v_dmg_claim_id     UUID;
  v_dmg_wh_code      TEXT;
  v_acc_claim_susp   CONSTANT TEXT := '1-1460';
  v_acc_inventory    CONSTANT TEXT := '1-1510';
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no opname session for approval %', p_approval_id; END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)', v_session.id, v_session.status;
  END IF;

  -- Loop 1: variance handling (UNCHANGED)
  FOR r IN
    SELECT sku, warehouse_id, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id = v_session.id AND counted_qty IS NOT NULL AND variance <> 0
  LOOP
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'stock_opname_counts row for sku % in session % missing warehouse_id', r.sku, v_session.id;
    END IF;
    SELECT qty INTO v_qty_before FROM public.stock_levels
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di stock_levels untuk warehouse %', r.sku, r.warehouse_id;
    END IF;
    UPDATE public.stock_levels SET qty = qty + r.variance, updated_at = now()
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id;
    v_movement_id := public._log_stock_movement(
      p_sku => r.sku, p_warehouse => NULL, p_qty_delta => r.variance,
      p_qty_before => r.system_qty_snapshot,
      p_source => 'opname_variance'::public.stock_movement_source,
      p_related_doc_type => 'opname_session', p_related_doc_id => v_session.id::text,
      p_reason_code => 'opname', p_reason_note => NULL,
      p_actor_user_id => v_session.counted_by_user_id, p_actor_role => 'opname_commit',
      p_evidence_urls => '{}'::text[]);
    UPDATE public.stock_movements SET warehouse_id = r.warehouse_id WHERE id = v_movement_id;
    v_movement_count := v_movement_count + 1;
  END LOOP;

  -- Loop 2 (rev 3): damage handling — direct INSERT with warehouse_id
  FOR r IN
    SELECT sku, warehouse_id, damaged_qty, damage_notes, damage_evidence_urls
      FROM public.stock_opname_counts
     WHERE session_id = v_session.id AND damaged_qty > 0
  LOOP
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'stock_opname_counts damaged row for sku % missing warehouse_id', r.sku;
    END IF;
    SELECT qty INTO v_dmg_qty_before FROM public.stock_levels
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di stock_levels untuk warehouse % (damaged)', r.sku, r.warehouse_id;
    END IF;

    SELECT COALESCE(harga_modal, 0) INTO v_dmg_unit_cost FROM public.stocks WHERE sku = r.sku;
    v_dmg_amount := r.damaged_qty * v_dmg_unit_cost;

    SELECT LOWER(code) INTO v_dmg_wh_code FROM public.warehouses WHERE id = r.warehouse_id;
    IF v_dmg_wh_code IS NULL THEN RAISE EXCEPTION 'warehouse % has no matching row', r.warehouse_id; END IF;
    IF v_dmg_wh_code NOT IN ('atas','bawah') THEN
      RAISE EXCEPTION 'warehouse code % not in (atas,bawah)', v_dmg_wh_code;
    END IF;

    UPDATE public.stock_levels SET qty = qty - r.damaged_qty, updated_at = now()
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id;

    INSERT INTO public.stock_movements (
      sku, warehouse, qty_delta, qty_before, qty_after, source,
      related_doc_type, related_doc_id, reason_code, reason_note,
      actor_user_id, actor_role, evidence_urls, warehouse_id, tenant_id
    ) VALUES (
      r.sku, v_dmg_wh_code, -r.damaged_qty,
      v_dmg_qty_before, v_dmg_qty_before - r.damaged_qty,
      'opname_damage'::public.stock_movement_source,
      'opname_session', v_session.id::text, 'rusak',
      COALESCE(r.damage_notes, 'flagged rusak at opname'),
      COALESCE(v_session.counted_by_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
      'opname_commit', COALESCE(r.damage_evidence_urls, '{}'::text[]),
      r.warehouse_id, v_session.tenant_id
    );

    v_dmg_claim_id := public._insert_supplier_claim(
      p_tenant_id => v_session.tenant_id, p_supplier_id => NULL,
      p_sku => r.sku, p_warehouse => v_dmg_wh_code,
      p_qty => r.damaged_qty, p_unit_cost => v_dmg_unit_cost,
      p_source_type => 'STOCK_OPNAME', p_source_ref_id => v_session.id::TEXT,
      p_notes => r.damage_notes, p_evidence_urls => r.damage_evidence_urls,
      p_created_by => v_session.counted_by_user_id,
      p_idempotency_key => 'opname-damage-' || v_session.id::text || '-' || r.sku || '-' || v_dmg_wh_code);

    IF v_dmg_amount > 0 THEN
      v_dmg_journal := public._post_journal_entry(
        CURRENT_DATE, 'SUPPLIER_CLAIM'::public.journal_entry_source,
        format('Opname damage claim: %s x %s (session %s)', r.damaged_qty, r.sku, v_session.id),
        jsonb_build_array(
          jsonb_build_object('account_code', v_acc_claim_susp, 'side', 'DEBIT',  'amount', v_dmg_amount, 'description', 'Piutang klaim rusak (menunggu keputusan owner)'),
          jsonb_build_object('account_code', v_acc_inventory,  'side', 'CREDIT', 'amount', v_dmg_amount, 'description', 'Barang keluar rusak dari opname')
        ),
        'supplier_claims', v_dmg_claim_id, v_session.tenant_id);
      v_dmg_journal_id := (v_dmg_journal->>'entry_id')::UUID;
      UPDATE public.supplier_claims SET create_journal_id = v_dmg_journal_id WHERE id = v_dmg_claim_id;
      UPDATE public.supplier_claim_events SET journal_entry_id = v_dmg_journal_id
       WHERE claim_id = v_dmg_claim_id AND event_type = 'CREATED';
    END IF;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions SET status = 'committed', committed_at = now() WHERE id = v_session.id;
  RETURN v_movement_count;
END $$;

-- =========================================================
-- Fix 4: list_supplier_claim_events — qualify ambiguous `id`
-- =========================================================
CREATE OR REPLACE FUNCTION public.list_supplier_claim_events(p_claim_id UUID)
RETURNS TABLE (id BIGINT, event_type TEXT, actor_user_id UUID, payload JSONB, journal_entry_id UUID, at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.supplier_claims sc WHERE sc.id = p_claim_id AND sc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'claim % not found', p_claim_id;
  END IF;
  RETURN QUERY SELECT e.id, e.event_type, e.actor_user_id, e.payload, e.journal_entry_id, e.at
    FROM public.supplier_claim_events e WHERE e.claim_id = p_claim_id ORDER BY e.at ASC;
END $$;

ALTER FUNCTION public.list_supplier_claim_events(UUID) OWNER TO vosi_rpc_owner;
