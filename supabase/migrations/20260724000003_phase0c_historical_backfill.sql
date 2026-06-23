-- 20260724000003_phase0c_historical_backfill.sql
--
-- Phase 0c Task 3: Historical backfill of ~118 existing transactions to journal_entries.
--
-- Strategy: One-shot function that loops each source table WHERE NOT EXISTS
-- a matching JE, then auto-executes at end of migration.
--
-- GL shapes:
--   kasir_transactions (income):
--     D <cash_coa>        total_amount   — cash received
--     K <pendapatan_coa>  total_amount   — revenue
--     D 5-1100 HPP        hpp_total      — COGS (if hpp_total > 0)
--     K 1-1510 Persediaan hpp_total      — inventory consumed (if hpp_total > 0)
--
--   purchase_invoices (not voided):
--     D 1-1510 Persediaan  subtotal      — stock in
--     K 2-1100 Hutang Usaha subtotal     — AP created
--
--   pembayaran (not voided, LUNAS):
--     D 2-1100 Hutang Usaha  total_paid  — AP reduced
--     K <cash_coa>           total_paid  — cash out
--
-- Idempotent: skips rows where journal_entries already has
--   (source_ref_table, source_ref_id) match.
--
-- Error handling: EXCEPTION WHEN OTHERS catches per-row failures,
--   inserts to gl_dual_write_anomalies, and continues (no abort).
--
-- Expected post-apply counts (as of 2026-06-23):
--   kasir_income:  69 posted, 2 anomalies (qris/edc - no default_bank)
--   purchase_invoices: 36 posted, 0 anomalies
--   pembayaran:    0 posted,  4 anomalies (all NULL account_id)
--   TOTAL posted: ~105 JEs

BEGIN;

DROP FUNCTION IF EXISTS public._phase0c_backfill_historical() CASCADE;

CREATE FUNCTION public._phase0c_backfill_historical()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_uid uuid := '227c28f4-09f6-4dc9-af7a-01b0feb2c194';

  -- counters
  v_kasir_posted     int := 0;
  v_kasir_anomalies  int := 0;
  v_pi_posted        int := 0;
  v_pi_anomalies     int := 0;
  v_pem_posted       int := 0;
  v_pem_anomalies    int := 0;

  -- accounting_config lookups (fetched once)
  v_default_kas      uuid;
  v_default_bank     uuid;
  v_default_qris     uuid;
  v_default_edc      uuid;

  -- loop variables
  v_kasir            kasir_transactions%ROWTYPE;
  v_pi               purchase_invoices%ROWTYPE;
  v_pem              pembayaran%ROWTYPE;

  -- per-row working vars
  v_resolved_acct_id uuid;
  v_cash_coa         text;
  v_pendapatan_coa   text;
  v_lines            jsonb;
  v_supplier_name    text;
  v_total_paid       numeric;
  v_entry_date       date;
BEGIN
  -- Set auth context so _post_journal_entry can populate posted_by
  PERFORM set_config('request.jwt.claim.sub', v_owner_uid::text, true);

  -- Fetch accounting config once
  SELECT
    default_kas_account_id,
    default_bank_account_id,
    default_qris_account_id,
    default_edc_account_id
  INTO
    v_default_kas,
    v_default_bank,
    v_default_qris,
    v_default_edc
  FROM accounting_config
  WHERE tenant_id IS NULL
  LIMIT 1;

  -- ════════════════════════════════════════════════════════════════════════════
  -- 1. kasir_transactions (income only — expense rows are synthetic summaries)
  -- ════════════════════════════════════════════════════════════════════════════
  FOR v_kasir IN
    SELECT *
    FROM kasir_transactions
    WHERE type = 'income'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries
        WHERE source_ref_table = 'kasir_transactions'
          AND source_ref_id = kasir_transactions.id
      )
    ORDER BY date ASC, created_at ASC
  LOOP
    BEGIN
      -- Resolve cash account: payment_method → accounting_config default
      v_resolved_acct_id := CASE LOWER(v_kasir.payment_method::text)
        WHEN 'cash'     THEN v_default_kas
        WHEN 'transfer' THEN v_default_bank
        WHEN 'qris'     THEN COALESCE(v_default_qris, v_default_bank)
        WHEN 'edc'      THEN COALESCE(v_default_edc, v_default_bank)
        ELSE v_default_kas
      END;

      IF v_resolved_acct_id IS NULL THEN
        INSERT INTO gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_phase0c_backfill_historical',
          'kasir_transactions',
          v_kasir.id,
          'NO_CASH_ACCOUNT',
          'Backfill skipped: no cash account resolved for payment_method=' || v_kasir.payment_method::text,
          jsonb_build_object(
            'payment_method', v_kasir.payment_method,
            'channel',        v_kasir.channel,
            'total_amount',   v_kasir.total_amount,
            'date',           v_kasir.date
          )
        );
        v_kasir_anomalies := v_kasir_anomalies + 1;
        CONTINUE;
      END IF;

      -- Lookup COA code from cash_accounts → chart_of_accounts
      SELECT coa.account_code INTO v_cash_coa
      FROM cash_accounts ca
      JOIN chart_of_accounts coa ON coa.id = ca.coa_account_id
      WHERE ca.id = v_resolved_acct_id
        AND coa.is_active = true;

      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % has no active COA link', v_resolved_acct_id;
      END IF;

      v_pendapatan_coa := _resolve_kasir_pendapatan_coa(v_kasir.channel::text);

      -- Build JE lines: always D cash K pendapatan
      v_lines := jsonb_build_array(
        jsonb_build_object(
          'account_code', v_cash_coa,
          'side',         'DEBIT',
          'amount',       v_kasir.total_amount,
          'description',  'Backfill: Kas masuk ' || v_kasir.payment_method::text
        ),
        jsonb_build_object(
          'account_code', v_pendapatan_coa,
          'side',         'CREDIT',
          'amount',       v_kasir.total_amount,
          'description',  'Backfill: Pendapatan ' || v_kasir.channel::text
        )
      );

      -- Append HPP lines if hpp_total > 0 (COGS recognition)
      IF v_kasir.hpp_total IS NOT NULL AND v_kasir.hpp_total > 0 THEN
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object(
            'account_code', '5-1100',
            'side',         'DEBIT',
            'amount',       v_kasir.hpp_total,
            'description',  'Backfill: HPP ' || v_kasir.channel::text
          ),
          jsonb_build_object(
            'account_code', '1-1510',
            'side',         'CREDIT',
            'amount',       v_kasir.hpp_total,
            'description',  'Backfill: Pemakaian persediaan'
          )
        );
      END IF;

      PERFORM _post_journal_entry(
        v_kasir.date,
        'BACKFILL'::journal_entry_source,
        'Backfill: Penjualan ' || v_kasir.channel::text
          || COALESCE(' · ' || v_kasir.invoice_number, ''),
        v_lines,
        'kasir_transactions',
        v_kasir.id,
        NULL,  -- tenant_id (single-tenant)
        NULL   -- reverses_entry_id
      );

      v_kasir_posted := v_kasir_posted + 1;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_phase0c_backfill_historical',
        'kasir_transactions',
        v_kasir.id,
        SQLSTATE,
        SQLERRM,
        to_jsonb(v_kasir)
      );
      v_kasir_anomalies := v_kasir_anomalies + 1;
    END;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════════
  -- 2. purchase_invoices (not voided)
  -- ════════════════════════════════════════════════════════════════════════════
  FOR v_pi IN
    SELECT *
    FROM purchase_invoices
    WHERE voided_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries
        WHERE source_ref_table = 'purchase_invoices'
          AND source_ref_id = purchase_invoices.id
      )
    ORDER BY purchase_date ASC, created_at ASC
  LOOP
    BEGIN
      SELECT name INTO v_supplier_name
      FROM suppliers
      WHERE id = v_pi.supplier_id;

      PERFORM _post_journal_entry(
        v_pi.purchase_date,
        'BACKFILL'::journal_entry_source,
        'Backfill: Tagihan ' || v_pi.pi_number
          || ' · ' || COALESCE(v_supplier_name, ''),
        jsonb_build_array(
          jsonb_build_object(
            'account_code', '1-1510',
            'side',         'DEBIT',
            'amount',       v_pi.subtotal,
            'description',  'Backfill: Persediaan masuk'
          ),
          jsonb_build_object(
            'account_code', '2-1100',
            'side',         'CREDIT',
            'amount',       v_pi.subtotal,
            'description',  'Backfill: Hutang ke ' || COALESCE(v_supplier_name, '')
          )
        ),
        'purchase_invoices',
        v_pi.id,
        NULL,  -- tenant_id
        NULL   -- reverses_entry_id
      );

      v_pi_posted := v_pi_posted + 1;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_phase0c_backfill_historical',
        'purchase_invoices',
        v_pi.id,
        SQLSTATE,
        SQLERRM,
        to_jsonb(v_pi)
      );
      v_pi_anomalies := v_pi_anomalies + 1;
    END;
  END LOOP;

  -- ════════════════════════════════════════════════════════════════════════════
  -- 3. pembayaran (not voided, skip VOIDED status + voided_at IS NOT NULL)
  -- ════════════════════════════════════════════════════════════════════════════
  FOR v_pem IN
    SELECT *
    FROM pembayaran
    WHERE voided_at IS NULL
      AND status != 'VOIDED'
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries
        WHERE source_ref_table = 'pembayaran'
          AND source_ref_id = pembayaran.id
      )
    ORDER BY paid_at ASC
  LOOP
    BEGIN
      -- Resolve cash account: explicit account_id > default_bank > default_kas
      v_resolved_acct_id := COALESCE(
        v_pem.account_id,
        v_default_bank,
        v_default_kas
      );

      IF v_resolved_acct_id IS NULL THEN
        INSERT INTO gl_dual_write_anomalies (
          source_rpc, source_ref_table, source_ref_id,
          error_code, error_message, attempted_payload
        ) VALUES (
          '_phase0c_backfill_historical',
          'pembayaran',
          v_pem.id,
          'NO_CASH_ACCOUNT',
          'Backfill skipped: no cash account resolved (account_id NULL, default_bank NULL, default_kas NULL)',
          jsonb_build_object(
            'pembayaran_number', v_pem.pembayaran_number,
            'amount_total',      v_pem.amount_total,
            'discount_amount',   v_pem.discount_amount
          )
        );
        v_pem_anomalies := v_pem_anomalies + 1;
        CONTINUE;
      END IF;

      -- Lookup COA code from cash_accounts → chart_of_accounts
      SELECT coa.account_code INTO v_cash_coa
      FROM cash_accounts ca
      JOIN chart_of_accounts coa ON coa.id = ca.coa_account_id
      WHERE ca.id = v_resolved_acct_id
        AND coa.is_active = true;

      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % has no active COA link', v_resolved_acct_id;
      END IF;

      SELECT name INTO v_supplier_name
      FROM suppliers
      WHERE id = v_pem.supplier_id;

      v_total_paid := v_pem.amount_total - COALESCE(v_pem.discount_amount, 0);
      v_entry_date := (v_pem.paid_at AT TIME ZONE 'Asia/Jakarta')::date;

      PERFORM _post_journal_entry(
        v_entry_date,
        'BACKFILL'::journal_entry_source,
        'Backfill: Pembayaran ' || v_pem.pembayaran_number
          || ' — ' || COALESCE(v_supplier_name, ''),
        jsonb_build_array(
          jsonb_build_object(
            'account_code', '2-1100',
            'side',         'DEBIT',
            'amount',       v_total_paid,
            'description',  'Backfill: Kurangi Hutang Usaha ' || v_pem.pembayaran_number
          ),
          jsonb_build_object(
            'account_code', v_cash_coa,
            'side',         'CREDIT',
            'amount',       v_total_paid,
            'description',  'Backfill: Kas keluar ' || COALESCE(v_pem.payment_method, '')
          )
        ),
        'pembayaran',
        v_pem.id,
        NULL,  -- tenant_id
        NULL   -- reverses_entry_id
      );

      v_pem_posted := v_pem_posted + 1;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO gl_dual_write_anomalies (
        source_rpc, source_ref_table, source_ref_id,
        error_code, error_message, attempted_payload
      ) VALUES (
        '_phase0c_backfill_historical',
        'pembayaran',
        v_pem.id,
        SQLSTATE,
        SQLERRM,
        to_jsonb(v_pem)
      );
      v_pem_anomalies := v_pem_anomalies + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'kasir_posted',    v_kasir_posted,
    'kasir_anomalies', v_kasir_anomalies,
    'pi_posted',       v_pi_posted,
    'pi_anomalies',    v_pi_anomalies,
    'pem_posted',      v_pem_posted,
    'pem_anomalies',   v_pem_anomalies,
    'total_posted',    v_kasir_posted + v_pi_posted + v_pem_posted
  );
END;
$$;

-- Auto-execute during migration apply
SELECT public._phase0c_backfill_historical();

COMMIT;
