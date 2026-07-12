-- 20261115000229_warehouse_transfer_je_posting.sql
--
-- Warehouse-transfer accounting integration — Part 2 of 2.
--
-- Motivation (from founder review 2026-07-13): current warehouse-transfer
-- RPCs (initiate/receive/cancel) mutate `stock_levels` + `stock_movements`
-- but never post to the general ledger. That leaves `1-1510 Persediaan`
-- overstated whenever a receive completes with `loss_qty > 0`, and creates
-- a mid-flight divergence between `SUM(stock_levels × harga_modal)` and
-- GL `1-1510` during IN_TRANSIT (period-close during transit yields
-- mismatched reports).
--
-- Fix — proper double-entry across the transfer lifecycle using a new
-- "in-transit" contra-inventory account (SAK EMKM / PABU standard):
--
--   Initiate   → Dr 1-1512 Persediaan Dalam Perjalanan  / Cr 1-1510 Persediaan
--                (moves value out of on-hand into in-transit)
--   Receive-full   → Dr 1-1510 / Cr 1-1512
--   Receive-partial → 3-line JE:
--                       Dr 1-1510 (× received_value)
--                     + Dr 5-3160 Kerugian Selisih Transfer Gudang (× loss_value)
--                     / Cr 1-1512 (× total_sent_value)
--   Cancel     → Dr 1-1510 / Cr 1-1512  (reverses initiate)
--
-- The value basis for every line is `stocks.harga_modal` snapshotted per
-- item at initiate time (matches opname-damage pattern in slot 102). If
-- `harga_modal` is NULL/0 the transfer still succeeds; the JE is simply
-- skipped for that line (mirrors opname behavior — otherwise a tenant
-- with any zero-cost SKU could not transfer at all).
--
-- Traceability columns on `warehouse_transfers`:
--   • initiate_journal_id  UUID  → journal_entries.id posted at initiate
--   • receive_journal_id   UUID  → posted at receive
--   • cancel_journal_id    UUID  → posted at cancel
--   • total_loss_value_rp  NUMERIC → aggregate loss value for UI + reports
-- On `warehouse_transfer_items`:
--   • harga_modal          NUMERIC → snapshot at initiate
--   • loss_value_rp        NUMERIC → per-line loss × harga_modal, filled at receive
--
-- COA seed: adds `1-1512 Persediaan Dalam Perjalanan` (parent `1-1500`)
-- and `5-3160 Kerugian Selisih Transfer Gudang` (parent `5-3000`) to
-- every existing tenant. Idempotent via NOT EXISTS.
-- Future tenants: since `_seed_tenant_accounting` (slot 053) copies from
-- Garindo, once Garindo has these accounts, new tenants get them too.
--
-- Backfill scope: only PARTIAL transfers (net-nonzero GL impact
-- historically). RECEIVED/CANCELLED = wash historically (no in-transit
-- account existed); backfilling synthetic pairs would muddy the audit
-- trail. Backfill posts a single Dr 5-3160 / Cr 1-1510 JE per historical
-- PARTIAL row, guarded by `receive_journal_id IS NULL`.
--
-- Idempotency:
--   • All schema alters use IF NOT EXISTS.
--   • COA seed uses NOT EXISTS guard.
--   • RPC rewrites use CREATE OR REPLACE.
--   • Backfill guarded by receive_journal_id IS NULL.
-- Safe to re-apply.
--
-- Depends on slot 228 (WAREHOUSE_TRANSFER enum value).

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Schema alter — traceability columns
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS initiate_journal_id UUID,
  ADD COLUMN IF NOT EXISTS receive_journal_id  UUID,
  ADD COLUMN IF NOT EXISTS cancel_journal_id   UUID,
  ADD COLUMN IF NOT EXISTS total_loss_value_rp NUMERIC;

ALTER TABLE public.warehouse_transfer_items
  ADD COLUMN IF NOT EXISTS harga_modal   NUMERIC,
  ADD COLUMN IF NOT EXISTS loss_value_rp NUMERIC;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. COA seed — new accounts for every tenant
-- ═════════════════════════════════════════════════════════════════════════

-- 1-1512 Persediaan Dalam Perjalanan (in-transit contra-inventory asset)
INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  is_control_account, normal_balance, is_active, is_system
)
SELECT
  t.id, '1-1512', 'Persediaan Dalam Perjalanan', 'ASET', 'PERSEDIAAN',
  false, 'DEBIT', true, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts
  WHERE tenant_id = t.id AND account_code = '1-1512'
);

UPDATE public.chart_of_accounts child
   SET parent_id = parent.id
  FROM public.chart_of_accounts parent
 WHERE child.account_code   = '1-1512'
   AND parent.account_code  = '1-1500'
   AND parent.tenant_id     = child.tenant_id
   AND child.parent_id IS NULL;

-- 5-3160 Kerugian Selisih Transfer Gudang (transit-loss expense)
INSERT INTO public.chart_of_accounts (
  tenant_id, account_code, account_name, account_type, account_subtype,
  is_control_account, normal_balance, is_active, is_system
)
SELECT
  t.id, '5-3160', 'Kerugian Selisih Transfer Gudang', 'BEBAN', 'BEBAN_NON_OPERASIONAL',
  false, 'DEBIT', true, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.chart_of_accounts
  WHERE tenant_id = t.id AND account_code = '5-3160'
);

UPDATE public.chart_of_accounts child
   SET parent_id = parent.id
  FROM public.chart_of_accounts parent
 WHERE child.account_code   = '5-3160'
   AND parent.account_code  = '5-3000'
   AND parent.tenant_id     = child.tenant_id
   AND child.parent_id IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. initiate_warehouse_transfer — CREATE OR REPLACE with JE posting
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.initiate_warehouse_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id   uuid,
  p_receiver_user_id  uuid,
  p_notes             text,
  p_client_request_id text,
  p_items             jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant          uuid;
  v_sender          uuid;
  v_transfer_id     bigint;
  v_doc_no          text;
  v_total_qty       int := 0;
  v_line            record;
  v_line_no         int := 0;
  v_existing        record;
  v_avail_qty       int;
  v_from_wh_active  bool;
  v_to_wh_active    bool;
  v_sku_hpp         numeric;
  v_total_value     numeric := 0;
  v_je              jsonb;
  v_je_id           uuid;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_sender := auth.uid();

  IF v_tenant IS NULL OR v_sender IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Idempotency: return existing row if same client_request_id
  IF p_client_request_id IS NOT NULL THEN
    SELECT id, doc_no INTO v_existing
      FROM public.warehouse_transfers
     WHERE tenant_id = v_tenant AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RAISE LOG 'warehouse_transfer initiate_idempotent tenant=% client_request_id=% existing_id=%',
        v_tenant, p_client_request_id, v_existing.id;
      RETURN jsonb_build_object('transfer_id', v_existing.id, 'doc_no', v_existing.doc_no, 'idempotent', true);
    END IF;
  END IF;

  -- Validate from/to warehouses (same tenant, active, distinct)
  IF p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from and to must differ';
  END IF;

  SELECT is_active INTO v_from_wh_active FROM public.warehouses
    WHERE id = p_from_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_from_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: from % not in tenant or inactive', p_from_warehouse_id;
  END IF;

  SELECT is_active INTO v_to_wh_active FROM public.warehouses
    WHERE id = p_to_warehouse_id AND (tenant_id = v_tenant OR tenant_id IS NULL);
  IF NOT FOUND OR NOT v_to_wh_active THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_WAREHOUSE: to % not in tenant or inactive', p_to_warehouse_id;
  END IF;

  -- Validate receiver (must be tenant member)
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = p_receiver_user_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'TRANSFER_INVALID_RECEIVER: user % not in tenant', p_receiver_user_id;
  END IF;

  -- Validate items array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS';
  END IF;

  -- Pre-compute total_qty for header row
  SELECT SUM((it->>'qty')::int) INTO v_total_qty
    FROM jsonb_array_elements(p_items) it;
  IF v_total_qty IS NULL OR v_total_qty <= 0 THEN
    RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: total qty must be > 0';
  END IF;

  -- Lock all source stock_levels rows in one pass, validate qty
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    IF v_line.qty <= 0 THEN
      RAISE EXCEPTION 'TRANSFER_EMPTY_ITEMS: sku % qty must be > 0', v_line.sku;
    END IF;
    SELECT qty INTO v_avail_qty FROM public.stock_levels
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id
     FOR UPDATE;
    IF NOT FOUND OR v_avail_qty < v_line.qty THEN
      RAISE EXCEPTION 'TRANSFER_INSUFFICIENT_STOCK: sku=% tersedia=% diminta=%',
        v_line.sku, COALESCE(v_avail_qty, 0), v_line.qty;
    END IF;
  END LOOP;

  -- Generate doc_no + INSERT parent row
  v_doc_no := public._next_warehouse_transfer_doc_no(v_tenant);

  INSERT INTO public.warehouse_transfers
    (tenant_id, doc_no, from_warehouse_id, to_warehouse_id,
     sender_user_id, receiver_user_id, status, notes,
     client_request_id, initiated_at, total_qty_sent)
  VALUES
    (v_tenant, v_doc_no, p_from_warehouse_id, p_to_warehouse_id,
     v_sender, p_receiver_user_id, 'IN_TRANSIT', p_notes,
     p_client_request_id, now(), v_total_qty)
  RETURNING id INTO v_transfer_id;

  -- INSERT items (with harga_modal snapshot), deduct source stock_levels,
  -- log stock_movements, accumulate v_total_value for JE.
  FOR v_line IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty')::int AS qty
      FROM jsonb_array_elements(p_items) it
  LOOP
    v_line_no := v_line_no + 1;

    SELECT COALESCE(harga_modal, 0) INTO v_sku_hpp
      FROM public.stocks WHERE sku = v_line.sku;

    v_total_value := v_total_value + (v_line.qty * COALESCE(v_sku_hpp, 0));

    INSERT INTO public.warehouse_transfer_items
      (tenant_id, transfer_id, line_no, sku, qty_sent, harga_modal)
    VALUES
      (v_tenant, v_transfer_id, v_line_no, v_line.sku, v_line.qty, v_sku_hpp);

    UPDATE public.stock_levels
       SET qty = qty - v_line.qty, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = p_from_warehouse_id;

    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,
      p_qty_delta        => -v_line.qty,
      p_qty_before       => NULL,
      p_source           => 'transfer_out'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => v_transfer_id::text
    );
  END LOOP;

  -- Post GL journal: Dr 1-1512 In-Transit / Cr 1-1510 Persediaan (@ total value).
  -- Skip if v_total_value = 0 (no cost basis → no financial impact to record).
  IF v_total_value > 0 THEN
    v_je := public._post_journal_entry(
      p_entry_date       => CURRENT_DATE,
      p_source_type      => 'WAREHOUSE_TRANSFER'::public.journal_entry_source,
      p_description      => format('Transfer gudang %s [id=%s]: kirim (in-transit)', v_doc_no, v_transfer_id),
      p_lines            => jsonb_build_array(
        jsonb_build_object(
          'account_code', '1-1512',
          'side',         'DEBIT',
          'amount',       v_total_value,
          'description',  format('Persediaan dalam perjalanan — %s', v_doc_no)
        ),
        jsonb_build_object(
          'account_code', '1-1510',
          'side',         'CREDIT',
          'amount',       v_total_value,
          'description',  format('Keluar dari gudang asal — %s', v_doc_no)
        )
      ),
      p_source_ref_table => 'warehouse_transfers',
      p_source_ref_id    => NULL,
      p_tenant_id        => v_tenant
    );
    v_je_id := (v_je->>'entry_id')::uuid;

    UPDATE public.warehouse_transfers
       SET initiate_journal_id = v_je_id
     WHERE tenant_id = v_tenant AND id = v_transfer_id;
  END IF;

  -- App-inbox notify receiver (best-effort; skip on missing table for compat)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, p_receiver_user_id, 'TRANSFER_INCOMING',
            'warehouse_transfer', v_transfer_id::text,
            format('Transfer masuk %s dari gudang', v_doc_no), now());
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RAISE LOG 'warehouse_transfer initiated tenant=% id=% doc_no=% from=% to=% items=% sender=% je_value=%',
    v_tenant, v_transfer_id, v_doc_no, p_from_warehouse_id, p_to_warehouse_id, v_line_no, v_sender, v_total_value;

  RETURN jsonb_build_object('transfer_id', v_transfer_id, 'doc_no', v_doc_no, 'idempotent', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_warehouse_transfer(uuid, uuid, uuid, text, text, jsonb) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. receive_warehouse_transfer — CREATE OR REPLACE with JE posting
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.receive_warehouse_transfer(
  p_transfer_id bigint,
  p_items       jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant             uuid;
  v_actor              uuid;
  v_xfer               record;
  v_p_item             record;
  v_line               record;
  v_qty_received       int;
  v_loss_qty           int;
  v_total_recv         int := 0;
  v_total_loss         int := 0;
  v_line_count         int;
  v_p_count            int;
  v_final_status       text;
  v_move_id            bigint;
  v_line_value_recv    numeric;
  v_line_value_loss    numeric;
  v_total_value_sent   numeric := 0;
  v_total_value_recv   numeric := 0;
  v_total_value_loss   numeric := 0;
  v_je_lines           jsonb;
  v_je                 jsonb;
  v_je_id              uuid;
  v_doc_no             text;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  -- Load + lock transfer
  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id;
  END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.receiver_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_RECEIVER: receiver=% actor=%', v_xfer.receiver_user_id, v_actor;
  END IF;

  v_doc_no := v_xfer.doc_no;

  -- Validate p_items covers every SKU (order-agnostic, count must match)
  SELECT COUNT(*) INTO v_line_count FROM public.warehouse_transfer_items
   WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id;
  SELECT jsonb_array_length(p_items) INTO v_p_count;
  IF v_line_count <> v_p_count THEN
    RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: expected % lines, got %', v_line_count, v_p_count;
  END IF;

  -- Iterate p_items → validate + apply + accumulate values
  FOR v_p_item IN
    SELECT (it->>'sku')::text AS sku, (it->>'qty_received')::int AS qty_received
      FROM jsonb_array_elements(p_items) it
  LOOP
    SELECT * INTO v_line FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND sku = v_p_item.sku
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % not in transfer', v_p_item.sku;
    END IF;
    IF v_p_item.qty_received < 0 OR v_p_item.qty_received > v_line.qty_sent THEN
      RAISE EXCEPTION 'TRANSFER_ITEMS_MISMATCH: sku % qty_received=% out of [0, %]',
        v_p_item.sku, v_p_item.qty_received, v_line.qty_sent;
    END IF;

    v_qty_received := v_p_item.qty_received;
    v_loss_qty     := v_line.qty_sent - v_qty_received;
    v_total_recv   := v_total_recv + v_qty_received;
    v_total_loss   := v_total_loss + v_loss_qty;

    -- Value accumulation using per-line snapshotted harga_modal.
    -- Fallback: if a legacy row has NULL harga_modal (pre-slot-229 initiate),
    -- fetch current stocks.harga_modal — best-effort, only affects legacy transfers.
    IF v_line.harga_modal IS NULL THEN
      SELECT COALESCE(harga_modal, 0) INTO v_line.harga_modal
        FROM public.stocks WHERE sku = v_line.sku;
    END IF;

    v_line_value_recv := v_qty_received * COALESCE(v_line.harga_modal, 0);
    v_line_value_loss := v_loss_qty     * COALESCE(v_line.harga_modal, 0);
    v_total_value_sent := v_total_value_sent + v_line.qty_sent * COALESCE(v_line.harga_modal, 0);
    v_total_value_recv := v_total_value_recv + v_line_value_recv;
    v_total_value_loss := v_total_value_loss + v_line_value_loss;

    -- Lock + credit destination stock_levels
    UPDATE public.stock_levels
       SET qty = qty + v_qty_received, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.to_warehouse_id;
    IF NOT FOUND THEN
      INSERT INTO public.stock_levels (sku, warehouse_id, qty)
      VALUES (v_line.sku, v_xfer.to_warehouse_id, v_qty_received);
    END IF;

    -- Ledger: transfer_in (positive delta at destination)
    PERFORM public._log_stock_movement(
      p_sku              => v_line.sku,
      p_warehouse        => NULL,
      p_qty_delta        => v_qty_received,
      p_qty_before       => NULL,
      p_source           => 'transfer_in'::public.stock_movement_source,
      p_related_doc_type => 'warehouse_transfer',
      p_related_doc_id   => p_transfer_id::text
    );

    -- Loss audit row (stock_movements, not credit-back; deduct already at IN_TRANSIT)
    IF v_loss_qty > 0 THEN
      INSERT INTO public.stock_movements
        (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
         source, related_doc_type, related_doc_id, actor_user_id, created_at)
      VALUES
        (v_line.sku, v_xfer.from_warehouse_id, NULL,
         -v_loss_qty, 0, -v_loss_qty,
         'transfer_loss'::public.stock_movement_source,
         'warehouse_transfer_loss', p_transfer_id::text, v_actor, now())
      RETURNING id INTO v_move_id;

      UPDATE public.warehouse_transfer_items
         SET qty_received     = v_qty_received,
             loss_qty         = v_loss_qty,
             loss_movement_id = v_move_id,
             loss_value_rp    = v_line_value_loss
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    ELSE
      UPDATE public.warehouse_transfer_items
         SET qty_received  = v_qty_received,
             loss_qty      = NULL,
             loss_value_rp = NULL
       WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id AND line_no = v_line.line_no;
    END IF;
  END LOOP;

  v_final_status := CASE WHEN v_total_loss = 0 THEN 'RECEIVED' ELSE 'PARTIAL' END;

  -- Post GL journal reversing the in-transit portion:
  --  Receive full:    Dr 1-1510 / Cr 1-1512 (v_total_value_sent)
  --  Receive partial: Dr 1-1510 (recv) + Dr 5-3160 (loss) / Cr 1-1512 (sent)
  -- Skip entirely if v_total_value_sent = 0 (all SKUs had NULL/0 harga_modal).
  IF v_total_value_sent > 0 THEN
    IF v_total_value_loss = 0 THEN
      -- Full receive: 2-line reversal
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '1-1510',
          'side',         'DEBIT',
          'amount',       v_total_value_sent,
          'description',  format('Diterima di gudang tujuan — %s', v_doc_no)
        ),
        jsonb_build_object(
          'account_code', '1-1512',
          'side',         'CREDIT',
          'amount',       v_total_value_sent,
          'description',  format('Tutup in-transit — %s', v_doc_no)
        )
      );
    ELSIF v_total_value_recv = 0 THEN
      -- All loss (0 received): 2-line write-off
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '5-3160',
          'side',         'DEBIT',
          'amount',       v_total_value_sent,
          'description',  format('Kerugian selisih transfer — %s', v_doc_no)
        ),
        jsonb_build_object(
          'account_code', '1-1512',
          'side',         'CREDIT',
          'amount',       v_total_value_sent,
          'description',  format('Tutup in-transit (kerugian) — %s', v_doc_no)
        )
      );
    ELSE
      -- Partial: 3-line (recv Dr + loss Dr / sent Cr)
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '1-1510',
          'side',         'DEBIT',
          'amount',       v_total_value_recv,
          'description',  format('Diterima di gudang tujuan — %s', v_doc_no)
        ),
        jsonb_build_object(
          'account_code', '5-3160',
          'side',         'DEBIT',
          'amount',       v_total_value_loss,
          'description',  format('Kerugian selisih transfer — %s', v_doc_no)
        ),
        jsonb_build_object(
          'account_code', '1-1512',
          'side',         'CREDIT',
          'amount',       v_total_value_sent,
          'description',  format('Tutup in-transit — %s', v_doc_no)
        )
      );
    END IF;

    v_je := public._post_journal_entry(
      p_entry_date       => CURRENT_DATE,
      p_source_type      => 'WAREHOUSE_TRANSFER'::public.journal_entry_source,
      p_description      => format('Transfer gudang %s [id=%s]: %s',
                                   v_doc_no, p_transfer_id,
                                   CASE WHEN v_total_loss = 0 THEN 'terima lengkap'
                                        ELSE format('terima dengan selisih %s pcs', v_total_loss)
                                   END),
      p_lines            => v_je_lines,
      p_source_ref_table => 'warehouse_transfers',
      p_source_ref_id    => NULL,
      p_tenant_id        => v_tenant
    );
    v_je_id := (v_je->>'entry_id')::uuid;
  END IF;

  UPDATE public.warehouse_transfers
     SET status              = v_final_status,
         received_at         = now(),
         received_by_user_id = v_actor,
         total_qty_received  = v_total_recv,
         total_loss_qty      = CASE WHEN v_total_loss = 0 THEN NULL ELSE v_total_loss END,
         total_loss_value_rp = CASE WHEN v_total_loss = 0 THEN NULL ELSE v_total_value_loss END,
         receive_journal_id  = v_je_id,
         updated_at          = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Owner-inbox alert on PARTIAL (best-effort)
  IF v_final_status = 'PARTIAL' THEN
    BEGIN
      INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
      SELECT v_tenant, au.id, 'TRANSFER_PARTIAL_LOSS',
             'warehouse_transfer', p_transfer_id::text,
             format('Selisih transfer %s -%s pcs (Rp %s), cek ke gudang',
                    v_xfer.doc_no, v_total_loss, to_char(v_total_value_loss, 'FM999,999,999')), now()
        FROM public.admin_users au
       WHERE au.tenant_id = v_tenant AND au.can_approve_adjustment = true;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END IF;

  RAISE LOG 'warehouse_transfer received tenant=% id=% status=% total_recv=% loss=% loss_value=% actor=% je=%',
    v_tenant, p_transfer_id, v_final_status, v_total_recv, v_total_loss, v_total_value_loss, v_actor, v_je_id;

  RETURN jsonb_build_object(
    'status',            v_final_status,
    'total_loss_qty',    v_total_loss,
    'total_loss_value',  v_total_value_loss
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receive_warehouse_transfer(bigint, jsonb) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. cancel_warehouse_transfer — CREATE OR REPLACE with JE posting
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cancel_warehouse_transfer(
  p_transfer_id bigint,
  p_reason      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant       uuid;
  v_actor        uuid;
  v_xfer         record;
  v_line         record;
  v_total_value  numeric := 0;
  v_je           jsonb;
  v_je_id        uuid;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_actor  := auth.uid();
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'TRANSFER_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_xfer FROM public.warehouse_transfers
   WHERE tenant_id = v_tenant AND id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSFER_NOT_FOUND: id=%', p_transfer_id; END IF;
  IF v_xfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'TRANSFER_WRONG_STATUS: current=%', v_xfer.status;
  END IF;
  IF v_xfer.sender_user_id <> v_actor THEN
    RAISE EXCEPTION 'TRANSFER_NOT_SENDER: sender=% actor=%', v_xfer.sender_user_id, v_actor;
  END IF;

  -- Credit each line's qty back to source stock_levels + audit row + accumulate value
  FOR v_line IN
    SELECT sku, qty_sent, harga_modal FROM public.warehouse_transfer_items
     WHERE tenant_id = v_tenant AND transfer_id = p_transfer_id
     ORDER BY line_no
     FOR UPDATE
  LOOP
    IF v_line.harga_modal IS NULL THEN
      SELECT COALESCE(harga_modal, 0) INTO v_line.harga_modal
        FROM public.stocks WHERE sku = v_line.sku;
    END IF;
    v_total_value := v_total_value + v_line.qty_sent * COALESCE(v_line.harga_modal, 0);

    UPDATE public.stock_levels
       SET qty = qty + v_line.qty_sent, updated_at = now()
     WHERE sku = v_line.sku AND warehouse_id = v_xfer.from_warehouse_id;

    INSERT INTO public.stock_movements
      (sku, warehouse_id, warehouse, qty_delta, qty_before, qty_after,
       source, related_doc_type, related_doc_id, actor_user_id, created_at)
    VALUES
      (v_line.sku, v_xfer.from_warehouse_id, NULL,
       v_line.qty_sent, 0, v_line.qty_sent,
       'transfer_cancel_return'::public.stock_movement_source,
       'warehouse_transfer', p_transfer_id::text, v_actor, now());
  END LOOP;

  -- Post GL journal reversing initiate: Dr 1-1510 / Cr 1-1512 (@ total value).
  -- Only if the transfer's initiate posted a JE (i.e. total_value > 0).
  IF v_total_value > 0 THEN
    v_je := public._post_journal_entry(
      p_entry_date       => CURRENT_DATE,
      p_source_type      => 'WAREHOUSE_TRANSFER'::public.journal_entry_source,
      p_description      => format('Transfer gudang %s [id=%s]: batal (kembali ke asal)',
                                   v_xfer.doc_no, p_transfer_id),
      p_lines            => jsonb_build_array(
        jsonb_build_object(
          'account_code', '1-1510',
          'side',         'DEBIT',
          'amount',       v_total_value,
          'description',  format('Kembali ke gudang asal — %s', v_xfer.doc_no)
        ),
        jsonb_build_object(
          'account_code', '1-1512',
          'side',         'CREDIT',
          'amount',       v_total_value,
          'description',  format('Batal in-transit — %s', v_xfer.doc_no)
        )
      ),
      p_source_ref_table => 'warehouse_transfers',
      p_source_ref_id    => NULL,
      p_tenant_id        => v_tenant
    );
    v_je_id := (v_je->>'entry_id')::uuid;
  END IF;

  UPDATE public.warehouse_transfers
     SET status               = 'CANCELLED',
         cancelled_at         = now(),
         cancelled_by_user_id = v_actor,
         cancel_reason        = p_reason,
         cancel_journal_id    = v_je_id,
         updated_at           = now()
   WHERE tenant_id = v_tenant AND id = p_transfer_id;

  -- Notify receiver (best-effort)
  BEGIN
    INSERT INTO public.app_inbox (tenant_id, user_id, kind, ref_type, ref_id, message, created_at)
    VALUES (v_tenant, v_xfer.receiver_user_id, 'TRANSFER_CANCELLED',
            'warehouse_transfer', p_transfer_id::text,
            format('Transfer %s dibatalkan sender', v_xfer.doc_no), now());
  EXCEPTION WHEN undefined_table THEN NULL; END;

  RAISE LOG 'warehouse_transfer cancelled tenant=% id=% actor=% reason=% je=%',
    v_tenant, p_transfer_id, v_actor, p_reason, v_je_id;

  RETURN jsonb_build_object('status', 'CANCELLED');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_warehouse_transfer(bigint, text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. get_warehouse_transfer_detail — refresh signature to expose new columns
-- ═════════════════════════════════════════════════════════════════════════
-- The detail RPC already returns header + items via row_to_json; the new
-- columns (harga_modal, loss_value_rp, *_journal_id, total_loss_value_rp)
-- surface automatically. No RPC change needed; documented here for clarity.

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Backfill historical PARTIAL transfers (loss > 0, no receive_journal_id)
-- ═════════════════════════════════════════════════════════════════════════
-- Posts Dr 5-3160 / Cr 1-1510 for the loss value only.
-- Rationale (per advisor 2026-07-13): historical transfers never had an
-- in-transit account movement, so posting a synthetic pair would muddy
-- the audit trail. The only economically-real event is the write-off of
-- the missing inventory. Direct Dr 5-3160 / Cr 1-1510 captures that.
--
-- Guarded by receive_journal_id IS NULL — safe to re-run.
-- Loss value computed as SUM(loss_qty × current stocks.harga_modal) per
-- transfer. If any SKU has NULL harga_modal → value line is 0 (silently
-- skipped). If aggregate value is 0 → skip the JE entirely.

DO $backfill$
DECLARE
  r              record;
  v_je           jsonb;
  v_je_id        uuid;
  v_line_value   numeric;
  v_total_value  numeric;
  v_backfilled   int := 0;
  v_skipped_zero int := 0;
  v_skipped_err  int := 0;
BEGIN
  FOR r IN
    SELECT wt.tenant_id, wt.id, wt.doc_no, wt.total_loss_qty
      FROM public.warehouse_transfers wt
     WHERE wt.status = 'PARTIAL'
       AND wt.receive_journal_id IS NULL
       AND wt.total_loss_qty IS NOT NULL
       AND wt.total_loss_qty > 0
  LOOP
    BEGIN
      -- Aggregate loss value across all lines for this transfer
      SELECT COALESCE(SUM(wti.loss_qty * COALESCE(wti.harga_modal, s.harga_modal, 0)), 0)
        INTO v_total_value
        FROM public.warehouse_transfer_items wti
        LEFT JOIN public.stocks s ON s.sku = wti.sku
       WHERE wti.tenant_id = r.tenant_id
         AND wti.transfer_id = r.id
         AND wti.loss_qty IS NOT NULL
         AND wti.loss_qty > 0;

      IF v_total_value IS NULL OR v_total_value = 0 THEN
        v_skipped_zero := v_skipped_zero + 1;
        CONTINUE;
      END IF;

      -- Also backfill per-line loss_value_rp + total_loss_value_rp for UI
      UPDATE public.warehouse_transfer_items
         SET loss_value_rp = loss_qty * COALESCE(harga_modal,
             (SELECT harga_modal FROM public.stocks WHERE sku = warehouse_transfer_items.sku), 0)
       WHERE tenant_id = r.tenant_id
         AND transfer_id = r.id
         AND loss_qty IS NOT NULL AND loss_qty > 0
         AND loss_value_rp IS NULL;

      v_je := public._post_journal_entry(
        p_entry_date       => CURRENT_DATE,
        p_source_type      => 'WAREHOUSE_TRANSFER'::public.journal_entry_source,
        p_description      => format('Backfill kerugian selisih transfer %s [id=%s]', r.doc_no, r.id),
        p_lines            => jsonb_build_array(
          jsonb_build_object(
            'account_code', '5-3160',
            'side',         'DEBIT',
            'amount',       v_total_value,
            'description',  format('Kerugian selisih transfer (backfill) — %s', r.doc_no)
          ),
          jsonb_build_object(
            'account_code', '1-1510',
            'side',         'CREDIT',
            'amount',       v_total_value,
            'description',  format('Barang selisih (backfill) — %s', r.doc_no)
          )
        ),
        p_source_ref_table => 'warehouse_transfers',
        p_source_ref_id    => NULL,
        p_tenant_id        => r.tenant_id
      );
      v_je_id := (v_je->>'entry_id')::uuid;

      UPDATE public.warehouse_transfers
         SET receive_journal_id  = v_je_id,
             total_loss_value_rp = v_total_value
       WHERE tenant_id = r.tenant_id AND id = r.id;

      v_backfilled := v_backfilled + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped_err := v_skipped_err + 1;
      RAISE WARNING 'warehouse_transfer JE backfill skipped tenant=% id=% doc=% err=%',
        r.tenant_id, r.id, r.doc_no, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'warehouse_transfer JE backfill: % posted, % skipped (zero value), % skipped (error)',
    v_backfilled, v_skipped_zero, v_skipped_err;
END $backfill$;

COMMIT;
