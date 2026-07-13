-- 20261115000142_saldo_awal_rpcs.sql
-- Item #5: 8 SECDEF RPCs for Saldo Awal wizard + Year-End Close.
-- See docs/superpowers/specs/2026-07-13-saldo-awal-year-end-close-design.md §5.

-- ── 1. save_saldo_awal_draft ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_saldo_awal_draft(
  p_step_data JSONB,
  p_cutover_date DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID; v_user UUID; v_snap_id UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_cutover_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'cutover_date harus hari ini atau sebelumnya';
  END IF;

  -- Delete existing draft (unique index enforces max 1 draft)
  DELETE FROM public.saldo_awal_snapshots
   WHERE tenant_id = v_tenant AND status = 'draft';

  INSERT INTO public.saldo_awal_snapshots
    (tenant_id, cutover_date, step_data, status, created_by, updated_by, updated_at)
  VALUES (v_tenant, p_cutover_date, p_step_data, 'draft', v_user, v_user, now())
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END $$;

ALTER FUNCTION public.save_saldo_awal_draft(JSONB, DATE) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_saldo_awal_draft(JSONB, DATE) TO authenticated;


-- ── 2. preview_saldo_awal_totals ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_saldo_awal_totals(p_step_data JSONB)
RETURNS TABLE(total_assets NUMERIC, total_liab NUMERIC, total_equity NUMERIC, laba_ditahan_balancing NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cash NUMERIC := 0; v_piutang NUMERIC := 0; v_persediaan NUMERIC := 0;
  v_aktiva_tetap NUMERIC := 0; v_aktiva_lain NUMERIC := 0;
  v_hutang NUMERIC := 0; v_kewajiban_lain NUMERIC := 0;
  v_modal NUMERIC := 0; v_prive NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM((elem->>'opening_balance')::NUMERIC), 0) INTO v_cash
    FROM jsonb_array_elements(COALESCE(p_step_data->'step1_cash'->'accounts', '[]'::jsonb)) AS elem;

  v_piutang := COALESCE((p_step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0);
  v_persediaan := COALESCE((p_step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0);
  v_aktiva_tetap := COALESCE((p_step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0);
  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0) INTO v_aktiva_lain
    FROM jsonb_array_elements(COALESCE(p_step_data->'step2_aktiva'->'lain_lain', '[]'::jsonb)) AS elem;

  v_hutang := COALESCE((p_step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0);
  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0) INTO v_kewajiban_lain
    FROM jsonb_array_elements(COALESCE(p_step_data->'step3_kewajiban'->'lain_lain', '[]'::jsonb)) AS elem;

  v_modal := COALESCE((p_step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0);
  v_prive := COALESCE((p_step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0);

  total_assets := v_cash + v_piutang + v_persediaan + v_aktiva_tetap + v_aktiva_lain;
  total_liab := v_hutang + v_kewajiban_lain;
  laba_ditahan_balancing := total_assets - total_liab - (v_modal - v_prive);
  total_equity := v_modal - v_prive + laba_ditahan_balancing;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.preview_saldo_awal_totals(JSONB) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.preview_saldo_awal_totals(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_saldo_awal_totals(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_saldo_awal_totals(JSONB) TO authenticated;


-- ── 3. get_persediaan_auto_value ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_persediaan_auto_value()
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID; v_val NUMERIC;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN RETURN 0; END IF;
  SELECT COALESCE(SUM(stock * COALESCE(harga_modal, 0)), 0) INTO v_val
    FROM public.stocks WHERE tenant_id = v_tenant;
  RETURN v_val;
END $$;

ALTER FUNCTION public.get_persediaan_auto_value() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_persediaan_auto_value() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_persediaan_auto_value() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_persediaan_auto_value() TO authenticated;


-- ── 4. get_saldo_awal_state ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_saldo_awal_state()
RETURNS TABLE(id UUID, cutover_date DATE, status TEXT, posted_je_id UUID,
              step_data JSONB, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN RETURN; END IF;

  -- Return latest non-reversed snapshot (draft or posted), prefer posted over draft
  RETURN QUERY
  SELECT sas.id, sas.cutover_date, sas.status, sas.posted_je_id,
         sas.step_data, sas.created_at, sas.updated_at
  FROM public.saldo_awal_snapshots sas
  WHERE sas.tenant_id = v_tenant AND sas.status IN ('draft','posted')
  ORDER BY CASE sas.status WHEN 'posted' THEN 1 ELSE 2 END, sas.updated_at DESC
  LIMIT 1;
END $$;

ALTER FUNCTION public.get_saldo_awal_state() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_saldo_awal_state() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_saldo_awal_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_saldo_awal_state() TO authenticated;


-- ── 5. post_saldo_awal_snapshot ───────────────────────────────────────
-- Loads snapshot, builds balanced JE lines, calls _post_journal_entry.
-- Standard MSME COA codes assumed:
--   1-1010 Kas · 1-1020 Bank · 1-1210 Piutang Usaha · 1-1510 Persediaan
--   1-2100 Aktiva Tetap · 2-1110 Hutang Usaha · 3-1100 Modal Owner
--   3-1150 Prive · 3-1200 Laba Ditahan
-- Cash accounts resolved from cash_accounts.coa_account_id per account.
-- "lain_lain" rows carry their own coa_code from CoAPicker.
CREATE OR REPLACE FUNCTION public.post_saldo_awal_snapshot(p_snapshot_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_user UUID; v_snap RECORD; v_je_id UUID;
  v_lines JSONB := '[]'::jsonb;
  v_totals RECORD;
  v_cash_line JSONB; v_ll JSONB; v_ar_row JSONB; v_ap_row JSONB;
  v_cash_coa TEXT;
  v_je_date DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_snap FROM public.saldo_awal_snapshots
   WHERE id = p_snapshot_id AND tenant_id = v_tenant AND status = 'draft'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft snapshot % tidak ditemukan atau bukan status draft', p_snapshot_id;
  END IF;

  SELECT * INTO v_totals FROM public.preview_saldo_awal_totals(v_snap.step_data);

  v_je_date := v_snap.cutover_date - INTERVAL '1 day';

  -- ── DEBIT lines: cash per account ──
  FOR v_cash_line IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step1_cash'->'accounts', '[]'::jsonb))
  LOOP
    IF (v_cash_line->>'opening_balance')::NUMERIC > 0 THEN
      SELECT coa.account_code INTO v_cash_coa
        FROM public.cash_accounts ca
        JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
       WHERE ca.id = (v_cash_line->>'cash_account_id')::UUID
         AND ca.tenant_id = v_tenant;
      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % tidak punya COA link', v_cash_line->>'cash_account_id';
      END IF;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_cash_coa, 'side', 'DEBIT',
        'amount', (v_cash_line->>'opening_balance')::NUMERIC,
        'description', 'Saldo awal ' || v_cash_coa
      ));
    END IF;
  END LOOP;

  -- Piutang Usaha (aggregate)
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '1-1210', 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC,
      'description', 'Saldo awal Piutang Usaha'
    ));
  END IF;

  -- Persediaan
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '1-1510', 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC,
      'description', 'Saldo awal Persediaan'
    ));
  END IF;

  -- Aktiva Tetap
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '1-2100', 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC,
      'description', 'Saldo awal Aktiva Tetap'
    ));
  END IF;

  -- Aktiva lain-lain
  FOR v_ll IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'lain_lain', '[]'::jsonb))
  LOOP
    IF (v_ll->>'amount')::NUMERIC > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_ll->>'coa_code', 'side', 'DEBIT',
        'amount', (v_ll->>'amount')::NUMERIC,
        'description', 'Saldo awal ' || COALESCE(v_ll->>'coa_name', v_ll->>'coa_code')
      ));
    END IF;
  END LOOP;

  -- Hutang Usaha (aggregate)
  IF COALESCE((v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '2-1110', 'side', 'CREDIT',
      'amount', (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC,
      'description', 'Saldo awal Hutang Usaha'
    ));
  END IF;

  -- Kewajiban lain-lain
  FOR v_ll IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'lain_lain', '[]'::jsonb))
  LOOP
    IF (v_ll->>'amount')::NUMERIC > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_ll->>'coa_code', 'side', 'CREDIT',
        'amount', (v_ll->>'amount')::NUMERIC,
        'description', 'Saldo awal ' || COALESCE(v_ll->>'coa_name', v_ll->>'coa_code')
      ));
    END IF;
  END LOOP;

  -- Modal Owner
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '3-1100', 'side', 'CREDIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC,
      'description', 'Saldo awal Modal Owner'
    ));
  END IF;

  -- Prive (contra-equity: DEBIT)
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '3-1150', 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC,
      'description', 'Saldo awal Prive'
    ));
  END IF;

  -- Laba Ditahan (balancing; positive → CREDIT, negative → DEBIT)
  IF v_totals.laba_ditahan_balancing >= 0 THEN
    IF v_totals.laba_ditahan_balancing > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '3-1200', 'side', 'CREDIT',
        'amount', v_totals.laba_ditahan_balancing,
        'description', 'Saldo awal Laba Ditahan (balancing)'
      ));
    END IF;
  ELSE
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '3-1200', 'side', 'DEBIT',
      'amount', ABS(v_totals.laba_ditahan_balancing),
      'description', 'Saldo awal Laba Ditahan (defisit / balancing)'
    ));
  END IF;

  -- Post JE
  v_je_id := public._post_journal_entry(
    v_je_date::DATE,
    'OPENING_BALANCE'::journal_entry_source,
    'Saldo Awal per ' || to_char(v_snap.cutover_date, 'YYYY-MM-DD'),
    v_lines,
    'saldo_awal_snapshots',
    p_snapshot_id,
    v_tenant,
    NULL
  );

  -- Insert opening_ar_lines detail (from client-provided array in step_data)
  IF (v_snap.step_data->'step2_aktiva'->'piutang'->>'mode') = 'detail' THEN
    FOR v_ar_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'piutang'->'lines', '[]'::jsonb))
    LOOP
      INSERT INTO public.opening_ar_lines
        (tenant_id, snapshot_id, customer_id, customer_name, amount, original_due_date, invoice_ref, notes)
      VALUES (v_tenant, p_snapshot_id,
              NULLIF(v_ar_row->>'customer_id', ''),
              COALESCE(v_ar_row->>'customer_name', 'Customer'),
              (v_ar_row->>'amount')::NUMERIC,
              NULLIF(v_ar_row->>'original_due_date','')::DATE,
              NULLIF(v_ar_row->>'invoice_ref',''),
              NULLIF(v_ar_row->>'notes',''));
    END LOOP;
  END IF;

  -- Insert opening_ap_lines detail
  IF (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'mode') = 'detail' THEN
    FOR v_ap_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->'lines', '[]'::jsonb))
    LOOP
      INSERT INTO public.opening_ap_lines
        (tenant_id, snapshot_id, supplier_id, supplier_name, amount, original_due_date, invoice_ref, notes)
      VALUES (v_tenant, p_snapshot_id,
              NULLIF(v_ap_row->>'supplier_id','')::UUID,
              COALESCE(v_ap_row->>'supplier_name', 'Supplier'),
              (v_ap_row->>'amount')::NUMERIC,
              NULLIF(v_ap_row->>'original_due_date','')::DATE,
              NULLIF(v_ap_row->>'invoice_ref',''),
              NULLIF(v_ap_row->>'notes',''));
    END LOOP;
  END IF;

  -- Update snapshot state
  UPDATE public.saldo_awal_snapshots
     SET status = 'posted', posted_je_id = v_je_id,
         posted_at = now(), posted_by = v_user,
         updated_at = now(), updated_by = v_user
   WHERE id = p_snapshot_id;

  RETURN v_je_id;
END $$;

ALTER FUNCTION public.post_saldo_awal_snapshot(UUID) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.post_saldo_awal_snapshot(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_saldo_awal_snapshot(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.post_saldo_awal_snapshot(UUID) TO authenticated;


-- ── 6. reverse_saldo_awal ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reverse_saldo_awal(p_snapshot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_user UUID; v_snap RECORD; v_reverse_je_id UUID;
  v_lines JSONB; v_line JSONB; v_reversed_lines JSONB := '[]'::jsonb;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_snap FROM public.saldo_awal_snapshots
   WHERE id = p_snapshot_id AND tenant_id = v_tenant AND status = 'posted'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'posted snapshot % tidak ditemukan', p_snapshot_id;
  END IF;

  -- Build reversal lines from original JE
  SELECT jsonb_agg(jsonb_build_object(
    'account_code', (SELECT account_code FROM public.chart_of_accounts WHERE id = jel.account_id),
    'side', CASE jel.side WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
    'amount', jel.amount,
    'description', 'REVERSAL: ' || COALESCE(jel.description, '')
  )) INTO v_reversed_lines
  FROM public.journal_entry_lines jel
  WHERE jel.entry_id = v_snap.posted_je_id;

  v_reverse_je_id := public._post_journal_entry(
    CURRENT_DATE::DATE,
    'OPENING_BALANCE'::journal_entry_source,
    'REVERSAL Saldo Awal: ' || p_reason,
    v_reversed_lines,
    'saldo_awal_snapshots',
    p_snapshot_id,
    v_tenant,
    v_snap.posted_je_id  -- reverses_entry_id
  );

  UPDATE public.saldo_awal_snapshots
     SET status = 'reversed', reversed_je_id = v_reverse_je_id,
         reversed_at = now(), reversed_by = v_user,
         updated_at = now(), updated_by = v_user
   WHERE id = p_snapshot_id;

  RETURN v_reverse_je_id;
END $$;

ALTER FUNCTION public.reverse_saldo_awal(UUID, TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.reverse_saldo_awal(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_saldo_awal(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_saldo_awal(UUID, TEXT) TO authenticated;


-- ── 7. preview_year_end_close ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_year_end_close(p_fiscal_year INT)
RETURNS TABLE(total_revenue NUMERIC, total_expense NUMERIC, net_income NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_start DATE; v_end DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    total_revenue := 0; total_expense := 0; net_income := 0;
    RETURN NEXT; RETURN;
  END IF;

  v_start := make_date(p_fiscal_year, 1, 1);
  v_end := make_date(p_fiscal_year, 12, 31);

  SELECT
    COALESCE(SUM(CASE WHEN coa.account_code LIKE '4-%' AND jel.side = 'CREDIT' THEN jel.amount
                      WHEN coa.account_code LIKE '4-%' AND jel.side = 'DEBIT' THEN -jel.amount
                      ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN coa.account_code LIKE '5-%' AND jel.side = 'DEBIT' THEN jel.amount
                      WHEN coa.account_code LIKE '5-%' AND jel.side = 'CREDIT' THEN -jel.amount
                      ELSE 0 END), 0)
  INTO total_revenue, total_expense
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.entry_id
  JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
  WHERE je.tenant_id = v_tenant
    AND je.entry_date BETWEEN v_start AND v_end
    AND je.is_posted = true;

  net_income := total_revenue - total_expense;
  RETURN NEXT;
END $$;

ALTER FUNCTION public.preview_year_end_close(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.preview_year_end_close(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.preview_year_end_close(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_year_end_close(INT) TO authenticated;


-- ── 8. post_year_end_close ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_year_end_close(p_fiscal_year INT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_user UUID; v_preview RECORD;
  v_je_id UUID; v_lines JSONB := '[]'::jsonb;
  v_acc RECORD; v_je_date DATE;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_fiscal_year > EXTRACT(YEAR FROM CURRENT_DATE)::INT THEN
    RAISE EXCEPTION 'tidak bisa tutup buku tahun mendatang';
  END IF;

  IF EXISTS (SELECT 1 FROM public.year_end_close_events
              WHERE tenant_id = v_tenant AND fiscal_year = p_fiscal_year AND status = 'posted') THEN
    RAISE EXCEPTION 'tahun % sudah tutup buku', p_fiscal_year;
  END IF;

  SELECT * INTO v_preview FROM public.preview_year_end_close(p_fiscal_year);

  v_je_date := make_date(p_fiscal_year, 12, 31);

  -- Zero each Revenue and Expense COA by posting reversal line per account
  FOR v_acc IN
    SELECT coa.account_code,
           SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE -jel.amount END) AS balance_credit_side,
           SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE -jel.amount END) AS balance_debit_side
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.entry_id
    JOIN public.chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.tenant_id = v_tenant
      AND je.entry_date BETWEEN make_date(p_fiscal_year,1,1) AND v_je_date
      AND je.is_posted = true
      AND (coa.account_code LIKE '4-%' OR coa.account_code LIKE '5-%')
    GROUP BY coa.account_code
    HAVING SUM(CASE WHEN jel.side = 'CREDIT' THEN jel.amount ELSE -jel.amount END) <> 0
        OR SUM(CASE WHEN jel.side = 'DEBIT' THEN jel.amount ELSE -jel.amount END) <> 0
  LOOP
    IF v_acc.account_code LIKE '4-%' THEN
      -- Revenue accounts: normal balance CREDIT; zero by DEBIT
      IF v_acc.balance_credit_side > 0 THEN
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_code', v_acc.account_code, 'side', 'DEBIT',
          'amount', v_acc.balance_credit_side,
          'description', 'Tutup Buku ' || p_fiscal_year || ': zero ' || v_acc.account_code
        ));
      END IF;
    ELSIF v_acc.account_code LIKE '5-%' THEN
      -- Expense accounts: normal balance DEBIT; zero by CREDIT
      IF v_acc.balance_debit_side > 0 THEN
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_code', v_acc.account_code, 'side', 'CREDIT',
          'amount', v_acc.balance_debit_side,
          'description', 'Tutup Buku ' || p_fiscal_year || ': zero ' || v_acc.account_code
        ));
      END IF;
    END IF;
  END LOOP;

  -- Net income → Laba Ditahan
  IF v_preview.net_income > 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '3-1200', 'side', 'CREDIT',
      'amount', v_preview.net_income,
      'description', 'Tutup Buku ' || p_fiscal_year || ': transfer laba bersih ke Laba Ditahan'
    ));
  ELSIF v_preview.net_income < 0 THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '3-1200', 'side', 'DEBIT',
      'amount', ABS(v_preview.net_income),
      'description', 'Tutup Buku ' || p_fiscal_year || ': transfer rugi ke Laba Ditahan'
    ));
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Tidak ada transaksi Pendapatan/Beban untuk tahun %; tidak perlu tutup buku', p_fiscal_year;
  END IF;

  v_je_id := public._post_journal_entry(
    v_je_date,
    'YEAR_END_CLOSE'::journal_entry_source,
    'Tutup Buku Tahun ' || p_fiscal_year,
    v_lines,
    'year_end_close_events',
    NULL,
    v_tenant,
    NULL
  );

  INSERT INTO public.year_end_close_events
    (tenant_id, fiscal_year, net_income, posted_je_id, posted_by)
  VALUES (v_tenant, p_fiscal_year, v_preview.net_income, v_je_id, v_user);

  RETURN v_je_id;
END $$;

ALTER FUNCTION public.post_year_end_close(INT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.post_year_end_close(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_year_end_close(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.post_year_end_close(INT) TO authenticated;
