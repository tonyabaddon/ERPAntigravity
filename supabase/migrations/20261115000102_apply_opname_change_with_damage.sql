-- Migration: extend _apply_opname_change to process damaged_qty rows (Item #1 rev 3, slot 102)
--
-- Adds a second loop after existing variance handling to process rows where
-- damaged_qty > 0. For each damaged row:
--   1. Decrement stock_levels by damaged_qty (in addition to any variance decrement)
--   2. Log stock_movement (source='opname_damage')
--   3. Insert supplier_claim (status=AWAITING_OWNER_DECISION, no supplier_id)
--   4. Post speculative journal Dr 1-1460 Piutang Klaim Supplier / Cr 1-1510 Persediaan
--
-- Owner later decides Dispose or Klaim via decide_supplier_claim RPC.
--
-- Preserves existing variance loop behavior verbatim.
-- CREATE OR REPLACE replaces the function atomically — no partial-state risk.

CREATE OR REPLACE FUNCTION public._apply_opname_change(p_approval_id BIGINT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT    := 0;
  v_movement_id      BIGINT;
  v_qty_before       INT;
  -- Rev 3 additions for damage handling
  v_dmg_qty_before   INT;
  v_dmg_unit_cost    NUMERIC;
  v_dmg_amount       NUMERIC;
  v_dmg_movement_id  BIGINT;
  v_dmg_journal      JSONB;
  v_dmg_journal_id   UUID;
  v_dmg_claim_id     UUID;
  v_dmg_wh_code      TEXT;
  v_acc_claim_susp   CONSTANT TEXT := '1-1460';
  v_acc_inventory    CONSTANT TEXT := '1-1510';
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions
    WHERE approval_request_id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname session for approval %', p_approval_id;
  END IF;
  IF v_session.status <> 'pending_owner' THEN
    RAISE EXCEPTION 'opname session % is not pending_owner (status=%)',
      v_session.id, v_session.status;
  END IF;

  -- ==============================================================
  -- Loop 1 (EXISTING, UNCHANGED): variance handling
  -- ==============================================================
  FOR r IN
    SELECT sku, warehouse_id, system_qty_snapshot, counted_qty, variance
      FROM public.stock_opname_counts
     WHERE session_id    = v_session.id
       AND counted_qty   IS NOT NULL
       AND variance      <> 0
  LOOP
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION
        'stock_opname_counts row for sku % in session % missing warehouse_id (legacy un-backfilled row)',
        r.sku, v_session.id;
    END IF;

    SELECT qty INTO v_qty_before
      FROM public.stock_levels
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'SKU % belum ada di stock_levels untuk warehouse %',
        r.sku, r.warehouse_id;
    END IF;

    UPDATE public.stock_levels
       SET qty        = qty + r.variance,
           updated_at = now()
     WHERE sku          = r.sku
       AND warehouse_id = r.warehouse_id;

    v_movement_id := public._log_stock_movement(
      p_sku              => r.sku,
      p_warehouse        => NULL,
      p_qty_delta        => r.variance,
      p_qty_before       => r.system_qty_snapshot,
      p_source           => 'opname_variance'::public.stock_movement_source,
      p_related_doc_type => 'opname_session',
      p_related_doc_id   => v_session.id::text,
      p_reason_code      => 'opname',
      p_reason_note      => NULL,
      p_actor_user_id    => v_session.counted_by_user_id,
      p_actor_role       => 'opname_commit',
      p_evidence_urls    => '{}'::text[]
    );
    UPDATE public.stock_movements
       SET warehouse_id = r.warehouse_id
     WHERE id = v_movement_id;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  -- ==============================================================
  -- Loop 2 (NEW, rev 3): damage handling
  -- For each row with damaged_qty > 0:
  --   - Decrement sellable stock (in addition to any variance decrement)
  --   - Log stock_movement source='opname_damage'
  --   - Insert supplier_claim (AWAITING_OWNER_DECISION, no supplier)
  --   - Post journal Dr 1-1460 Piutang Klaim / Cr 1-1510 Persediaan
  -- ==============================================================
  FOR r IN
    SELECT sku, warehouse_id, damaged_qty, damage_notes, damage_evidence_urls
      FROM public.stock_opname_counts
     WHERE session_id  = v_session.id
       AND damaged_qty > 0
  LOOP
    IF r.warehouse_id IS NULL THEN
      RAISE EXCEPTION
        'stock_opname_counts damaged row for sku % missing warehouse_id (legacy un-backfilled row)',
        r.sku;
    END IF;

    -- Lock the stock row (may have been updated by loop 1 for variance)
    SELECT qty INTO v_dmg_qty_before
      FROM public.stock_levels
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'SKU % belum ada di stock_levels untuk warehouse % (damaged)',
        r.sku, r.warehouse_id;
    END IF;

    -- Unit cost from stocks.harga_modal (per-SKU cost basis maintained by tenant)
    SELECT COALESCE(harga_modal, 0) INTO v_dmg_unit_cost
      FROM public.stocks WHERE sku = r.sku;

    v_dmg_amount := r.damaged_qty * v_dmg_unit_cost;

    -- Warehouse code for supplier_claim.warehouse (text 'atas'/'bawah')
    SELECT LOWER(code) INTO v_dmg_wh_code
      FROM public.warehouses WHERE id = r.warehouse_id;
    IF v_dmg_wh_code IS NULL THEN
      RAISE EXCEPTION 'warehouse % has no matching row', r.warehouse_id;
    END IF;
    IF v_dmg_wh_code NOT IN ('atas','bawah') THEN
      RAISE EXCEPTION 'warehouse code % not in (atas,bawah) — post-Phase 3 needs cutover', v_dmg_wh_code;
    END IF;

    -- Decrement sellable
    UPDATE public.stock_levels
       SET qty = qty - r.damaged_qty,
           updated_at = now()
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id;

    -- Log stock movement
    v_dmg_movement_id := public._log_stock_movement(
      p_sku              => r.sku,
      p_warehouse        => NULL,
      p_qty_delta        => -r.damaged_qty,
      p_qty_before       => v_dmg_qty_before,
      p_source           => 'opname_damage'::public.stock_movement_source,
      p_related_doc_type => 'opname_session',
      p_related_doc_id   => v_session.id::text,
      p_reason_code      => 'rusak',
      p_reason_note      => COALESCE(r.damage_notes, 'flagged rusak at opname'),
      p_actor_user_id    => v_session.counted_by_user_id,
      p_actor_role       => 'opname_commit',
      p_evidence_urls    => COALESCE(r.damage_evidence_urls, '{}'::text[])
    );
    UPDATE public.stock_movements
       SET warehouse_id = r.warehouse_id
     WHERE id = v_dmg_movement_id;

    -- Insert supplier_claim (idempotent via key = opname-damage-<session>-<sku>-<warehouse>)
    v_dmg_claim_id := public._insert_supplier_claim(
      p_tenant_id       => v_session.tenant_id,
      p_supplier_id     => NULL,
      p_sku             => r.sku,
      p_warehouse       => v_dmg_wh_code,
      p_qty             => r.damaged_qty,
      p_unit_cost       => v_dmg_unit_cost,
      p_source_type     => 'STOCK_OPNAME',
      p_source_ref_id   => v_session.id::TEXT,
      p_notes           => r.damage_notes,
      p_evidence_urls   => r.damage_evidence_urls,
      p_created_by      => v_session.counted_by_user_id,
      p_idempotency_key => 'opname-damage-' || v_session.id::text || '-' || r.sku || '-' || v_dmg_wh_code
    );

    -- Post speculative journal Dr 1-1460 / Cr 1-1510 (Option A)
    -- Skip if unit_cost=0 (no journal effect; claim record still tracked)
    IF v_dmg_amount > 0 THEN
      v_dmg_journal := public._post_journal_entry(
        p_entry_date       => CURRENT_DATE,
        p_source_type      => 'SUPPLIER_CLAIM'::public.journal_entry_source,
        p_description      => format('Opname damage claim: %s x %s (session %s)',
                                     r.damaged_qty, r.sku, v_session.id),
        p_lines            => jsonb_build_array(
          jsonb_build_object(
            'account_code', v_acc_claim_susp,
            'side', 'DEBIT',
            'amount', v_dmg_amount,
            'description', 'Piutang klaim rusak (menunggu keputusan owner)'
          ),
          jsonb_build_object(
            'account_code', v_acc_inventory,
            'side', 'CREDIT',
            'amount', v_dmg_amount,
            'description', 'Barang keluar rusak dari opname'
          )
        ),
        p_source_ref_table => 'supplier_claims',
        p_source_ref_id    => v_dmg_claim_id,
        p_tenant_id        => v_session.tenant_id
      );

      v_dmg_journal_id := (v_dmg_journal->>'entry_id')::UUID;

      UPDATE public.supplier_claims
         SET create_journal_id = v_dmg_journal_id
       WHERE id = v_dmg_claim_id;

      -- Also stamp the CREATED event's journal_entry_id
      UPDATE public.supplier_claim_events
         SET journal_entry_id = v_dmg_journal_id
       WHERE claim_id = v_dmg_claim_id AND event_type = 'CREATED';
    END IF;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions
     SET status       = 'committed',
         committed_at = now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $$;
