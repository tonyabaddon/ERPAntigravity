-- 20261115000233_fix_opname_variance_je.sql
--
-- BLOCKER B2 fix (per docs/audits/2026-07-13-noa-e2e-audit.md).
--
-- Problem: `_apply_opname_change` Loop 1 (variance handling) mutates
-- `stock_levels` and logs `stock_movements(source='opname_variance')`
-- but posts NO JE. Every opname session with `variance <> 0` drifts
-- GL vs physical stock:
--   - overage (variance > 0): stock_levels UP but 1-1510 unchanged →
--     inventory understated in Neraca
--   - shrinkage (variance < 0): stock_levels DOWN but 1-1510
--     unchanged → inventory overstated in Neraca, no beban in P&L
--
-- Same class as warehouse-transfer PARTIAL was, fixed slot 229. Same
-- class as opname DAMAGE (Loop 2), which already posts JE.
--
-- Fix: extend Loop 1 to post a variance JE per SKU:
--   variance > 0 (overage):   Dr 1-1510 / Cr 4-1230 Keuntungan Selisih Stock Opname
--   variance < 0 (shrinkage): Dr 5-3150 Kerugian Selisih Stock Opname / Cr 1-1510
-- Amount basis: `ABS(variance) * stocks.harga_modal`.
-- Skip JE when `harga_modal = 0` (zero-cost SKU won't fail commit).
--
-- Backfill: FORWARD-ONLY. Historical variance rows in prod are QA
-- smoke test data (16 committed sessions, ~Rp 34k total, obviously
-- repetitive test pattern). Backfilling would inject 16 near-identical
-- micro-JEs into the ledger for zero informational value. Any real-
-- customer opname session posted before this migration is documented
-- as GL-untracked opname variance — noted in memory
-- `coa-null-subtype-anomalies` follow-up.
--
-- Idempotent: CREATE OR REPLACE.
-- source_type: STOCK_OPNAME_ADJ (existing enum value; no ALTER TYPE
-- needed).
-- source_ref: opname_session.id is bigint → can't fit source_ref_id
-- (uuid); pass NULL. Description embeds session id + sku for
-- traceability. Same trade-off warehouse_transfer accepts.

BEGIN;

CREATE OR REPLACE FUNCTION public._apply_opname_change(p_approval_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session          RECORD;
  r                  RECORD;
  v_movement_count   INT    := 0;
  v_movement_id      BIGINT;
  v_qty_before       INT;
  -- Loop 1 (variance) JE additions
  v_var_unit_cost    NUMERIC;
  v_var_amount       NUMERIC;
  v_var_journal      JSONB;
  -- Loop 2 (damage) — unchanged
  v_dmg_qty_before   INT;
  v_dmg_unit_cost    NUMERIC;
  v_dmg_amount       NUMERIC;
  v_dmg_journal      JSONB;
  v_dmg_journal_id   UUID;
  v_dmg_claim_id     UUID;
  v_dmg_wh_code      TEXT;
  v_acc_claim_susp   CONSTANT TEXT := '1-1460';
  v_acc_inventory    CONSTANT TEXT := '1-1510';
  v_acc_var_gain     CONSTANT TEXT := '4-1230';  -- Keuntungan Selisih Stock Opname
  v_acc_var_loss     CONSTANT TEXT := '5-3150';  -- Kerugian Selisih Stock Opname
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

  -- Loop 1: variance handling — now posts variance JE per SKU
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
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di stock_levels untuk warehouse %', r.sku, r.warehouse_id;
    END IF;

    UPDATE public.stock_levels
       SET qty = qty + r.variance, updated_at = now()
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id;

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
    UPDATE public.stock_movements SET warehouse_id = r.warehouse_id WHERE id = v_movement_id;

    -- B2 fix: post variance JE. Skip when amount = 0 (zero-cost SKU).
    SELECT COALESCE(harga_modal, 0) INTO v_var_unit_cost
      FROM public.stocks WHERE sku = r.sku;
    v_var_amount := ABS(r.variance) * COALESCE(v_var_unit_cost, 0);

    IF v_var_amount > 0 THEN
      IF r.variance > 0 THEN
        -- overage: Dr 1-1510 / Cr 4-1230
        v_var_journal := public._post_journal_entry(
          CURRENT_DATE,
          'STOCK_OPNAME_ADJ'::public.journal_entry_source,
          format('Opname variance (kelebihan): sku=%s +%s pcs (session %s)',
                 r.sku, r.variance, v_session.id),
          jsonb_build_array(
            jsonb_build_object('account_code', v_acc_inventory,
              'side', 'DEBIT',  'amount', v_var_amount,
              'description', format('Persediaan bertambah — kelebihan opname %s', r.sku)),
            jsonb_build_object('account_code', v_acc_var_gain,
              'side', 'CREDIT', 'amount', v_var_amount,
              'description', format('Keuntungan selisih opname %s', r.sku))
          ),
          'stock_opname_sessions',
          NULL,
          v_session.tenant_id
        );
      ELSE
        -- shrinkage: Dr 5-3150 / Cr 1-1510
        v_var_journal := public._post_journal_entry(
          CURRENT_DATE,
          'STOCK_OPNAME_ADJ'::public.journal_entry_source,
          format('Opname variance (kekurangan): sku=%s %s pcs (session %s)',
                 r.sku, r.variance, v_session.id),
          jsonb_build_array(
            jsonb_build_object('account_code', v_acc_var_loss,
              'side', 'DEBIT',  'amount', v_var_amount,
              'description', format('Kerugian selisih opname %s', r.sku)),
            jsonb_build_object('account_code', v_acc_inventory,
              'side', 'CREDIT', 'amount', v_var_amount,
              'description', format('Persediaan berkurang — kekurangan opname %s', r.sku))
          ),
          'stock_opname_sessions',
          NULL,
          v_session.tenant_id
        );
      END IF;
    END IF;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  -- Loop 2 (rev 3): damage handling — UNCHANGED from prior version
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

    SELECT qty INTO v_dmg_qty_before
      FROM public.stock_levels
     WHERE sku = r.sku AND warehouse_id = r.warehouse_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % belum ada di stock_levels untuk warehouse % (damaged)', r.sku, r.warehouse_id;
    END IF;

    SELECT COALESCE(harga_modal, 0) INTO v_dmg_unit_cost FROM public.stocks WHERE sku = r.sku;
    v_dmg_amount := r.damaged_qty * v_dmg_unit_cost;

    SELECT LOWER(code) INTO v_dmg_wh_code FROM public.warehouses WHERE id = r.warehouse_id;
    IF v_dmg_wh_code IS NULL THEN
      RAISE EXCEPTION 'warehouse % has no matching row', r.warehouse_id;
    END IF;
    IF v_dmg_wh_code NOT IN ('atas','bawah') THEN
      RAISE EXCEPTION 'warehouse code % not in (atas,bawah) — post-Phase 3 needs cutover', v_dmg_wh_code;
    END IF;

    UPDATE public.stock_levels
       SET qty = qty - r.damaged_qty, updated_at = now()
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
      'opname_commit',
      COALESCE(r.damage_evidence_urls, '{}'::text[]),
      r.warehouse_id, v_session.tenant_id
    );

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

    IF v_dmg_amount > 0 THEN
      v_dmg_journal := public._post_journal_entry(
        CURRENT_DATE, 'SUPPLIER_CLAIM'::public.journal_entry_source,
        format('Opname damage claim: %s x %s (session %s)', r.damaged_qty, r.sku, v_session.id),
        jsonb_build_array(
          jsonb_build_object('account_code', v_acc_claim_susp, 'side', 'DEBIT',  'amount', v_dmg_amount, 'description', 'Piutang klaim rusak (menunggu keputusan owner)'),
          jsonb_build_object('account_code', v_acc_inventory,  'side', 'CREDIT', 'amount', v_dmg_amount, 'description', 'Barang keluar rusak dari opname')
        ),
        'supplier_claims', v_dmg_claim_id, v_session.tenant_id
      );
      v_dmg_journal_id := (v_dmg_journal->>'entry_id')::UUID;

      UPDATE public.supplier_claims SET create_journal_id = v_dmg_journal_id WHERE id = v_dmg_claim_id;
      UPDATE public.supplier_claim_events SET journal_entry_id = v_dmg_journal_id
       WHERE claim_id = v_dmg_claim_id AND event_type = 'CREATED';
    END IF;

    v_movement_count := v_movement_count + 1;
  END LOOP;

  UPDATE public.stock_opname_sessions
     SET status = 'committed', committed_at = now()
   WHERE id = v_session.id;

  RETURN v_movement_count;
END $function$;

COMMIT;
