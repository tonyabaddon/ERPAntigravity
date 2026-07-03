-- 20260910000015 — Historical backfill functions for sales-side GL.
--
-- Defines (does NOT execute) 4 idempotent backfill functions targeting
-- pre-Slice-A/B/C/D historical rows. Each function accepts p_dry_run
-- boolean — when true, writes to _backfill_preview_je instead of
-- journal_entries.
--
-- Execution order (see design spec §4.3):
--   1. _backfill_tempo_invoice_gl
--   2. _backfill_pi_passthrough_gl  (finds accruals from step 1)
--   3. _backfill_pi_lunas_payment_gl
--   4. _backfill_tempo_write_off_gl
--
-- Schema notes (verified 2026-07-03 from prior tasks 1-4):
--   - orders.items JSONB shape: [{sku, name, qty, unit_price, ...}]
--   - purchase_invoices has NO initial_status_at_create column — only status
--   - PEMBAYARAN JEs use source_ref_table='pembayaran', source_ref_id=pembayaran.id
--   - TEMPO_WRITEOFF live JEs use source_ref_table='orders', source_ref_id=orders.id
--     (approval_requests.id is BIGINT, cannot fit in journal_entries.source_ref_id UUID)
--   - cash_accounts.coa_account_id references chart_of_accounts.id (UUID FK, not text code)
--   - orders.written_off_at is the correct backfill entry date for write-offs
--
-- Anomaly codes (via gl_dual_write_anomalies.error_code):
--   BACKFILL_PERIOD_CLOSED      — target period closed; row skipped
--   BACKFILL_ALREADY_JOURNALED  — INFO benign skip (belt behind NOT EXISTS)
--   BACKFILL_UNBALANCED         — computed JE fails balance (should not happen)
--
-- Design spec: §4.

BEGIN;

-- ── Preview table for dry-run ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._backfill_preview_je (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  source_fn      text NOT NULL,
  source_row_id  uuid NOT NULL,
  planned_date   date NOT NULL,
  planned_lines  jsonb NOT NULL,
  reason         text
);
CREATE INDEX IF NOT EXISTS idx_backfill_preview_row ON public._backfill_preview_je (source_row_id);

-- ── Function 1: _backfill_tempo_invoice_gl ──────────────────────────────────
--
-- Targets orders with payment_type='TEMPO' that have no TEMPO_INVOICE_CREATE
-- or BACKFILL_TEMPO_INVOICE journal entry. Uses created_at::date as entry date
-- (historical fidelity — live Slice A uses CURRENT_DATE).
--
-- JE shape mirrors Slice A (create_tempo_invoice):
--   D 1-1400 Piutang Usaha           order.total
--   K 4-1140 Penjualan Tempo         order.subtotal (gross pre-order-discount)
--   D 4-1900 Diskon Penjualan        order.discount_amount_rp (if > 0)
--   D 5-1100 HPP Penjualan           per-line stock HPP (if > 0)
--   K 1-1510 Persediaan Barang Jadi  per-line stock HPP (if > 0)
--   D 5-1200 HPP Barang Passthrough  per-line passthrough HPP (if > 0)
--   K 2-1150 Hutang Passthrough      per-line passthrough HPP (if > 0)
CREATE OR REPLACE FUNCTION public._backfill_tempo_invoice_gl(
  p_from_date date    DEFAULT '2026-06-01',
  p_to_date   date    DEFAULT CURRENT_DATE,
  p_batch     int     DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order             record;
  v_eligible          int := 0;
  v_skipped_closed    int := 0;
  v_skipped_journaled int := 0;
  v_posted            int := 0;
  v_je_lines          jsonb;
  v_hpp_stock         numeric;
  v_hpp_pt            numeric;
BEGIN
  FOR v_order IN
    SELECT o.id,
           o.total,
           o.subtotal,
           COALESCE(o.discount_amount_rp, 0) AS discount_rp,
           o.items,
           o.created_at::date AS order_date
    FROM public.orders o
    WHERE o.payment_type = 'TEMPO'
      AND o.created_at::date BETWEEN p_from_date AND p_to_date
      -- Idempotency: skip if any JE already exists for this order on either
      -- the live (TEMPO_INVOICE_CREATE) or backfill source type.
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table = 'orders'
          AND e.source_ref_id    = o.id
          AND e.source_type IN ('TEMPO_INVOICE_CREATE', 'BACKFILL_TEMPO_INVOICE')
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    -- Period-closed check: log anomaly + continue (soft skip)
    IF EXISTS (
      SELECT 1 FROM public.accounting_periods
      WHERE period_year  = EXTRACT(YEAR  FROM v_order.order_date)::int
        AND period_month = EXTRACT(MONTH FROM v_order.order_date)::int
        AND status = 'CLOSED'
    ) THEN
      v_skipped_closed := v_skipped_closed + 1;
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_backfill_tempo_invoice_gl', 'orders', v_order.id,
        'BACKFILL_PERIOD_CLOSED',
        'Period ' || EXTRACT(YEAR FROM v_order.order_date)::text
          || '-' || LPAD(EXTRACT(MONTH FROM v_order.order_date)::text, 2, '0')
          || ' is CLOSED; row skipped',
        '{}'::jsonb
      );
      CONTINUE;
    END IF;

    -- Compute per-line HPP split (stock vs passthrough) from items JSONB.
    -- items shape: [{sku, name, qty, unit_price, ...}]
    -- Uses stocks.is_passthrough + stocks.harga_modal at backfill time.
    -- If SKU is missing from stocks, defaults to stock bucket with 0 cost.
    SELECT
      COALESCE(
        SUM((line->>'qty')::numeric * COALESCE(s.harga_modal, 0))
          FILTER (WHERE COALESCE(s.is_passthrough, false) = false),
        0
      ),
      COALESCE(
        SUM((line->>'qty')::numeric * COALESCE(s.harga_modal, 0))
          FILTER (WHERE COALESCE(s.is_passthrough, false) = true),
        0
      )
    INTO v_hpp_stock, v_hpp_pt
    FROM jsonb_array_elements(v_order.items) AS line
    LEFT JOIN public.stocks s ON s.sku = (line->>'sku');

    -- Build JE lines (AR debit first, then revenue credit, then optional legs)
    v_je_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '1-1400',
        'side',         'DEBIT',
        'amount',       v_order.total,
        'description',  'Backfill AR Tempo'
      ),
      jsonb_build_object(
        'account_code', '4-1140',
        'side',         'CREDIT',
        -- Gross subtotal: total + discount (reverses the discount debit below)
        'amount',       v_order.subtotal,
        'description',  'Backfill Penjualan Tempo'
      )
    );

    -- Diskon leg (only if > 0)
    IF v_order.discount_rp > 0 THEN
      v_je_lines := v_je_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '4-1900',
        'side',         'DEBIT',
        'amount',       v_order.discount_rp,
        'description',  'Backfill Diskon Penjualan Tempo'
      ));
    END IF;

    -- Stock HPP pair (only if > 0)
    IF v_hpp_stock > 0 THEN
      v_je_lines := v_je_lines
        || jsonb_build_array(jsonb_build_object(
             'account_code', '5-1100',
             'side',         'DEBIT',
             'amount',       v_hpp_stock,
             'description',  'Backfill HPP Penjualan (stock)'
           ))
        || jsonb_build_array(jsonb_build_object(
             'account_code', '1-1510',
             'side',         'CREDIT',
             'amount',       v_hpp_stock,
             'description',  'Backfill Persediaan Tempo'
           ));
    END IF;

    -- Passthrough HPP pair (only if > 0)
    IF v_hpp_pt > 0 THEN
      v_je_lines := v_je_lines
        || jsonb_build_array(jsonb_build_object(
             'account_code', '5-1200',
             'side',         'DEBIT',
             'amount',       v_hpp_pt,
             'description',  'Backfill HPP Passthrough (accrual)'
           ))
        || jsonb_build_array(jsonb_build_object(
             'account_code', '2-1150',
             'side',         'CREDIT',
             'amount',       v_hpp_pt,
             'description',  'Backfill Hutang Passthrough Accrual'
           ));
    END IF;

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je
        (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES
        ('_backfill_tempo_invoice_gl', v_order.id, v_order.order_date, v_je_lines, 'eligible');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_order.order_date,
          p_source_type      := 'BACKFILL_TEMPO_INVOICE'::public.journal_entry_source,
          p_description      := 'Backfill Tempo Invoice ' || v_order.id::text,
          p_lines            := v_je_lines,
          p_source_ref_table := 'orders',
          p_source_ref_id    := v_order.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_tempo_invoice_gl', 'orders', v_order.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'Backfill JE failed for order %: [%] %',
          v_order.id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible',                v_eligible,
    'skipped_period_closed',   v_skipped_closed,
    'skipped_already_journaled', v_skipped_journaled,
    'posted',                  v_posted,
    'dry_run',                 p_dry_run
  );
END;
$$;

-- ── Function 2: _backfill_pi_passthrough_gl ─────────────────────────────────
--
-- Targets PASSTHROUGH purchase_invoices that have no PI_TAGIHAN or
-- BACKFILL_PI_PASSTHROUGH journal entry. Mirrors Slice B JE shape:
--   If outstanding 2-1150 accrual on linked order >= pi.subtotal:
--     D 2-1150 Hutang Passthrough (reclass)  K 2-1100 Hutang Usaha
--   Otherwise (no prior accrual):
--     D 5-1200 HPP Passthrough               K 2-1100 Hutang Usaha
--
-- Run AFTER _backfill_tempo_invoice_gl so 2-1150 balances are present.
CREATE OR REPLACE FUNCTION public._backfill_pi_passthrough_gl(
  p_from_date date    DEFAULT '2026-06-01',
  p_to_date   date    DEFAULT CURRENT_DATE,
  p_batch     int     DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pi              record;
  v_eligible        int := 0;
  v_skipped_closed  int := 0;
  v_posted          int := 0;
  v_je_lines        jsonb;
  v_accrual_balance numeric;
  v_reason          text;
BEGIN
  FOR v_pi IN
    SELECT pi.id, pi.pi_number, pi.subtotal, pi.order_id, pi.purchase_date
    FROM public.purchase_invoices pi
    WHERE pi.type = 'PASSTHROUGH'
      AND pi.purchase_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table = 'purchase_invoices'
          AND e.source_ref_id    = pi.id
          AND e.source_type IN ('PI_TAGIHAN', 'BACKFILL_PI_PASSTHROUGH')
      )
    LIMIT p_batch
  LOOP
    v_eligible := v_eligible + 1;

    -- Period-closed check
    IF EXISTS (
      SELECT 1 FROM public.accounting_periods
      WHERE period_year  = EXTRACT(YEAR  FROM v_pi.purchase_date)::int
        AND period_month = EXTRACT(MONTH FROM v_pi.purchase_date)::int
        AND status = 'CLOSED'
    ) THEN
      v_skipped_closed := v_skipped_closed + 1;
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_backfill_pi_passthrough_gl', 'purchase_invoices', v_pi.id,
        'BACKFILL_PERIOD_CLOSED',
        'Period closed; row skipped',
        '{}'::jsonb
      );
      CONTINUE;
    END IF;

    -- Check outstanding 2-1150 accrual on linked customer order.
    -- Mirrors logic from Slice B (migration 20260910000013).
    SELECT
      COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'CREDIT'), 0) -
      COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'DEBIT'),  0)
    INTO v_accrual_balance
    FROM public.journal_entries e
    JOIN public.journal_entry_lines l ON l.entry_id = e.id
    JOIN public.chart_of_accounts a   ON a.id       = l.account_id
    WHERE e.source_ref_table = 'orders'
      AND e.source_ref_id    = v_pi.order_id
      AND a.account_code     = '2-1150';

    IF COALESCE(v_accrual_balance, 0) >= v_pi.subtotal THEN
      -- Reclass: accrued payable → real AP
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '2-1150',
          'side',         'DEBIT',
          'amount',       v_pi.subtotal,
          'description',  'Backfill reclass Hutang Passthrough → AP'
        ),
        jsonb_build_object(
          'account_code', '2-1100',
          'side',         'CREDIT',
          'amount',       v_pi.subtotal,
          'description',  'Backfill Hutang Usaha ' || v_pi.pi_number
        )
      );
      v_reason := 'reclass';
    ELSE
      -- No prior accrual: direct HPP debit
      v_je_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', '5-1200',
          'side',         'DEBIT',
          'amount',       v_pi.subtotal,
          'description',  'Backfill HPP PASSTHROUGH ' || v_pi.pi_number
        ),
        jsonb_build_object(
          'account_code', '2-1100',
          'side',         'CREDIT',
          'amount',       v_pi.subtotal,
          'description',  'Backfill Hutang Usaha ' || v_pi.pi_number
        )
      );
      v_reason := 'non-accrual';
    END IF;

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je
        (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES
        ('_backfill_pi_passthrough_gl', v_pi.id, v_pi.purchase_date, v_je_lines, v_reason);
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_pi.purchase_date,
          p_source_type      := 'BACKFILL_PI_PASSTHROUGH'::public.journal_entry_source,
          p_description      := 'Backfill PASSTHROUGH PI ' || v_pi.pi_number,
          p_lines            := v_je_lines,
          p_source_ref_table := 'purchase_invoices',
          p_source_ref_id    := v_pi.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_pi_passthrough_gl', 'purchase_invoices', v_pi.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'Backfill JE failed for PASSTHROUGH PI %: [%] %',
          v_pi.id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible',              v_eligible,
    'skipped_period_closed', v_skipped_closed,
    'posted',                v_posted,
    'dry_run',               p_dry_run
  );
END;
$$;

-- ── Function 3: _backfill_pi_lunas_payment_gl ───────────────────────────────
--
-- Targets purchase_invoices with status='LUNAS' that do NOT yet have a
-- PEMBAYARAN or BACKFILL_PEMBAYARAN JE linked via pembayaran.id.
--
-- Schema note: purchase_invoices has no initial_status_at_create column.
-- We identify LUNAS-at-create rows as those where status='LUNAS' AND a
-- linked pembayaran row exists (via pembayaran_items.tagihan_id = pi.id)
-- but no PEMBAYARAN JE on that pembayaran row. This is the correct proxy
-- because Slice C calls record_pembayaran → Phase 0b dual-write auto-posts
-- the JE. Historical (pre-Slice-C) rows have pembayaran but no JE.
--
-- JE shape mirrors Phase 0b (record_pembayaran):
--   D 2-1100 Hutang Usaha        payment amount
--   K <cash COA>                 payment amount  (from cash_accounts.coa_account_id → chart_of_accounts.account_code)
--
-- source_ref_table = 'pembayaran', source_ref_id = pembayaran.id
-- (matches live record_pembayaran shape — idempotency check uses this).
CREATE OR REPLACE FUNCTION public._backfill_pi_lunas_payment_gl(
  p_from_date date    DEFAULT '2026-06-01',
  p_to_date   date    DEFAULT CURRENT_DATE,
  p_batch     int     DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_pi             record;
  v_pembayaran_id  uuid;
  v_pmt_amount     numeric;
  v_cash_coa       text;
  v_eligible       int := 0;
  v_skipped_closed int := 0;
  v_posted         int := 0;
  v_je_lines       jsonb;
BEGIN
  FOR v_pi IN
    SELECT DISTINCT ON (pi.id)
           pi.id,
           pi.pi_number,
           pi.purchase_date,
           pmt.id          AS pmt_id,
           pmt.amount_total AS pmt_amount,
           ca_coa.account_code AS cash_coa_code
    FROM public.purchase_invoices pi
    -- Join to find the linked pembayaran (via junction table)
    JOIN public.pembayaran_items pmi ON pmi.tagihan_id = pi.id
    JOIN public.pembayaran       pmt ON pmt.id         = pmi.pembayaran_id
                                    AND pmt.status      <> 'VOIDED'
    -- Resolve cash account COA via FK chain: pembayaran.account_id → cash_accounts → COA
    LEFT JOIN public.cash_accounts    ca     ON ca.id = pmt.account_id
    LEFT JOIN public.chart_of_accounts ca_coa ON ca_coa.id = ca.coa_account_id
    WHERE pi.status = 'LUNAS'
      AND pi.purchase_date BETWEEN p_from_date AND p_to_date
      -- Idempotency: skip if PEMBAYARAN or BACKFILL_PEMBAYARAN JE already
      -- exists on this pembayaran row.
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table = 'pembayaran'
          AND e.source_ref_id    = pmt.id
          AND e.source_type IN ('PEMBAYARAN', 'BACKFILL_PEMBAYARAN')
      )
    ORDER BY pi.id, pmt.paid_at DESC
    LIMIT p_batch
  LOOP
    v_eligible      := v_eligible + 1;
    v_pembayaran_id := v_pi.pmt_id;
    v_pmt_amount    := v_pi.pmt_amount;
    -- Fallback cash COA: 1-1110 (Kas Toko) if cash_accounts.coa_account_id is NULL
    v_cash_coa      := COALESCE(v_pi.cash_coa_code, '1-1110');

    -- Period-closed check
    IF EXISTS (
      SELECT 1 FROM public.accounting_periods
      WHERE period_year  = EXTRACT(YEAR  FROM v_pi.purchase_date)::int
        AND period_month = EXTRACT(MONTH FROM v_pi.purchase_date)::int
        AND status = 'CLOSED'
    ) THEN
      v_skipped_closed := v_skipped_closed + 1;
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_backfill_pi_lunas_payment_gl', 'pembayaran', v_pembayaran_id,
        'BACKFILL_PERIOD_CLOSED',
        'Period closed; row skipped',
        '{}'::jsonb
      );
      CONTINUE;
    END IF;

    v_je_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '2-1100',
        'side',         'DEBIT',
        'amount',       v_pmt_amount,
        'description',  'Backfill LUNAS AP retire ' || v_pi.pi_number
      ),
      jsonb_build_object(
        'account_code', v_cash_coa,
        'side',         'CREDIT',
        'amount',       v_pmt_amount,
        'description',  'Backfill LUNAS cash payment ' || v_pi.pi_number
      )
    );

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je
        (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES
        ('_backfill_pi_lunas_payment_gl', v_pembayaran_id, v_pi.purchase_date, v_je_lines, 'lunas');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_pi.purchase_date,
          p_source_type      := 'BACKFILL_PEMBAYARAN'::public.journal_entry_source,
          p_description      := 'Backfill LUNAS payment ' || v_pi.pi_number,
          p_lines            := v_je_lines,
          p_source_ref_table := 'pembayaran',
          p_source_ref_id    := v_pembayaran_id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_pi_lunas_payment_gl', 'pembayaran', v_pembayaran_id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'Backfill payment JE failed for pembayaran %: [%] %',
          v_pembayaran_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible',              v_eligible,
    'skipped_period_closed', v_skipped_closed,
    'posted',                v_posted,
    'dry_run',               p_dry_run
  );
END;
$$;

-- ── Function 4: _backfill_tempo_write_off_gl ────────────────────────────────
--
-- Targets orders with status='INVOICE_WRITTEN_OFF' that have no TEMPO_WRITEOFF
-- or BACKFILL_TEMPO_WRITEOFF journal entry.
--
-- Schema note: approval_requests.id is BIGINT which cannot be stored in
-- journal_entries.source_ref_id (UUID). Live Slice D1 uses source_ref_table='orders'
-- + orders.id. This backfill uses the same shape (verified 2026-07-03 from Task 4).
-- Joins to piutang_write_off_requests to confirm the write-off was via approval.
-- Entry date = orders.written_off_at::date (not approval_requests.updated_at).
-- Amount = orders.total.
--
-- JE shape mirrors Slice D1 (approve_tempo_write_off):
--   D 5-3100 Kerugian Piutang tak tertagih  order.total
--   K 1-1400 Piutang Usaha                  order.total
CREATE OR REPLACE FUNCTION public._backfill_tempo_write_off_gl(
  p_from_date date    DEFAULT '2026-06-01',
  p_to_date   date    DEFAULT CURRENT_DATE,
  p_batch     int     DEFAULT 500,
  p_dry_run   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_order          record;
  v_eligible       int := 0;
  v_skipped_closed int := 0;
  v_posted         int := 0;
  v_je_lines       jsonb;
  v_writeoff_date  date;
BEGIN
  FOR v_order IN
    SELECT o.id, o.total, o.written_off_at::date AS wo_date
    FROM public.orders o
    -- Confirm the write-off came through an approved request (not a manual status set)
    WHERE o.status = 'INVOICE_WRITTEN_OFF'
      AND o.written_off_at IS NOT NULL
      AND o.written_off_at::date BETWEEN p_from_date AND p_to_date
      -- Belt: only rows whose write-off was via piutang_write_off_requests approval
      AND EXISTS (
        SELECT 1 FROM public.piutang_write_off_requests pwr
        WHERE pwr.order_id = o.id
      )
      -- Idempotency: skip if TEMPO_WRITEOFF or BACKFILL_TEMPO_WRITEOFF JE exists
      -- on this order already.
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries e
        WHERE e.source_ref_table = 'orders'
          AND e.source_ref_id    = o.id
          AND e.source_type IN ('TEMPO_WRITEOFF', 'BACKFILL_TEMPO_WRITEOFF')
      )
      AND o.total > 0   -- Zero-value guard (mirrors live Slice D1)
    LIMIT p_batch
  LOOP
    v_eligible    := v_eligible + 1;
    v_writeoff_date := v_order.wo_date;

    -- Period-closed check
    IF EXISTS (
      SELECT 1 FROM public.accounting_periods
      WHERE period_year  = EXTRACT(YEAR  FROM v_writeoff_date)::int
        AND period_month = EXTRACT(MONTH FROM v_writeoff_date)::int
        AND status = 'CLOSED'
    ) THEN
      v_skipped_closed := v_skipped_closed + 1;
      INSERT INTO public.gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_backfill_tempo_write_off_gl', 'orders', v_order.id,
        'BACKFILL_PERIOD_CLOSED',
        'Period closed; row skipped',
        '{}'::jsonb
      );
      CONTINUE;
    END IF;

    v_je_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '5-3100',
        'side',         'DEBIT',
        'amount',       v_order.total,
        'description',  'Backfill Kerugian Piutang tak tertagih'
      ),
      jsonb_build_object(
        'account_code', '1-1400',
        'side',         'CREDIT',
        'amount',       v_order.total,
        'description',  'Backfill hapus Piutang Usaha order ' || v_order.id::text
      )
    );

    IF p_dry_run THEN
      INSERT INTO public._backfill_preview_je
        (source_fn, source_row_id, planned_date, planned_lines, reason)
      VALUES
        ('_backfill_tempo_write_off_gl', v_order.id, v_writeoff_date, v_je_lines, 'approved');
    ELSE
      BEGIN
        PERFORM public._post_journal_entry(
          p_entry_date       := v_writeoff_date,
          p_source_type      := 'BACKFILL_TEMPO_WRITEOFF'::public.journal_entry_source,
          p_description      := 'Backfill tempo write-off order ' || v_order.id::text,
          p_lines            := v_je_lines,
          p_source_ref_table := 'orders',
          p_source_ref_id    := v_order.id
        );
        v_posted := v_posted + 1;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_backfill_tempo_write_off_gl', 'orders', v_order.id,
          SQLSTATE, SQLERRM, v_je_lines
        );
        RAISE WARNING 'Backfill write-off JE failed for order %: [%] %',
          v_order.id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible',              v_eligible,
    'skipped_period_closed', v_skipped_closed,
    'posted',                v_posted,
    'dry_run',               p_dry_run
  );
END;
$$;

-- ── Grants: REVOKE from PUBLIC — controller triggers via MCP only ────────────
REVOKE ALL ON FUNCTION public._backfill_tempo_invoice_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_pi_passthrough_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_pi_lunas_payment_gl(date, date, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_tempo_write_off_gl(date, date, int, boolean) FROM PUBLIC;

COMMIT;
