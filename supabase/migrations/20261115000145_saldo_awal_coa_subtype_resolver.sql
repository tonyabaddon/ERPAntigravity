-- 20261115000145_saldo_awal_coa_subtype_resolver.sql
-- Item #5 CRITICAL FIX: post_saldo_awal_snapshot hardcoded COA codes yang
-- mismatch dengan Garindo (dan tenant lain). Refactor untuk resolve
-- account_code by account_subtype semantic — portable across tenants.
--
-- Root cause: mig 142 used '1-1210' for Piutang Usaha; Garindo has 1-1400.
-- Similar mismatches: 2-1100 (bukan 2-1110), 3-1300 (bukan 3-1200).

CREATE OR REPLACE FUNCTION public._resolve_coa_by_subtype(p_subtype TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant UUID; v_code TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  SELECT account_code INTO v_code
    FROM public.chart_of_accounts
   WHERE tenant_id = v_tenant
     AND account_subtype = p_subtype
     AND is_active = true
   ORDER BY account_code
   LIMIT 1;
  RETURN v_code;
END $$;

ALTER FUNCTION public._resolve_coa_by_subtype(TEXT) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public._resolve_coa_by_subtype(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_coa_by_subtype(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public._resolve_coa_by_subtype(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.post_saldo_awal_snapshot(p_snapshot_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID; v_user UUID; v_snap RECORD; v_je_id UUID;
  v_lines JSONB := '[]'::jsonb; v_totals RECORD;
  v_cash_line JSONB; v_ll JSONB; v_ar_row JSONB; v_ap_row JSONB;
  v_cash_coa TEXT; v_je_date DATE;
  v_coa_piutang TEXT; v_coa_persediaan TEXT; v_coa_aktiva_tetap TEXT;
  v_coa_hutang TEXT; v_coa_modal TEXT; v_coa_prive TEXT; v_coa_laba_ditahan TEXT;
BEGIN
  v_tenant := public._resolve_tenant_id();
  v_user := public._current_user_id();
  IF v_user IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO v_snap FROM public.saldo_awal_snapshots
   WHERE id = p_snapshot_id AND tenant_id = v_tenant AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft snapshot % tidak ditemukan atau bukan status draft', p_snapshot_id;
  END IF;

  SELECT * INTO v_totals FROM public.preview_saldo_awal_totals(v_snap.step_data);
  v_je_date := v_snap.cutover_date - INTERVAL '1 day';

  -- Resolve COA codes by subtype (portable across tenants)
  v_coa_piutang       := public._resolve_coa_by_subtype('PIUTANG_USAHA');
  v_coa_persediaan    := public._resolve_coa_by_subtype('PERSEDIAAN');
  v_coa_aktiva_tetap  := public._resolve_coa_by_subtype('ASET_TETAP');
  v_coa_hutang        := public._resolve_coa_by_subtype('HUTANG_USAHA');
  v_coa_modal         := public._resolve_coa_by_subtype('MODAL_DISETOR');
  v_coa_prive         := public._resolve_coa_by_subtype('PRIVE');
  v_coa_laba_ditahan  := public._resolve_coa_by_subtype('LABA_DITAHAN');

  -- Cash lines from cash_accounts (unchanged)
  FOR v_cash_line IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step1_cash'->'accounts', '[]'::jsonb)) LOOP
    IF (v_cash_line->>'opening_balance')::NUMERIC > 0 THEN
      SELECT coa.account_code INTO v_cash_coa FROM public.cash_accounts ca
        JOIN public.chart_of_accounts coa ON coa.id = ca.coa_account_id
       WHERE ca.id = (v_cash_line->>'cash_account_id')::UUID AND ca.tenant_id = v_tenant;
      IF v_cash_coa IS NULL THEN
        RAISE EXCEPTION 'cash_account % tidak punya COA link', v_cash_line->>'cash_account_id';
      END IF;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_cash_coa, 'side', 'DEBIT',
        'amount', (v_cash_line->>'opening_balance')::NUMERIC,
        'description', 'Saldo awal ' || v_cash_coa));
    END IF;
  END LOOP;

  -- Piutang Usaha aggregate
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_piutang IS NULL THEN
      RAISE EXCEPTION 'Akun Piutang Usaha (subtype PIUTANG_USAHA) tidak ditemukan di Chart of Accounts. Setup COA dulu.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_piutang, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC,
      'description', 'Saldo awal Piutang Usaha'));
  END IF;

  -- Persediaan
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_persediaan IS NULL THEN
      RAISE EXCEPTION 'Akun Persediaan (subtype PERSEDIAAN) tidak ditemukan.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_persediaan, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC,
      'description', 'Saldo awal Persediaan'));
  END IF;

  -- Aktiva Tetap
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_aktiva_tetap IS NULL THEN
      RAISE EXCEPTION 'Akun Aset Tetap (subtype ASET_TETAP) tidak ditemukan.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_aktiva_tetap, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC,
      'description', 'Saldo awal Aktiva Tetap'));
  END IF;

  -- Aktiva lain-lain (COA code from CoAPicker)
  FOR v_ll IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'lain_lain', '[]'::jsonb)) LOOP
    IF (v_ll->>'amount')::NUMERIC > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_ll->>'coa_code', 'side', 'DEBIT',
        'amount', (v_ll->>'amount')::NUMERIC,
        'description', 'Saldo awal ' || COALESCE(v_ll->>'coa_name', v_ll->>'coa_code')));
    END IF;
  END LOOP;

  -- Hutang Usaha
  IF COALESCE((v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_hutang IS NULL THEN
      RAISE EXCEPTION 'Akun Hutang Usaha (subtype HUTANG_USAHA) tidak ditemukan.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_hutang, 'side', 'CREDIT',
      'amount', (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC,
      'description', 'Saldo awal Hutang Usaha'));
  END IF;

  -- Kewajiban lain-lain
  FOR v_ll IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'lain_lain', '[]'::jsonb)) LOOP
    IF (v_ll->>'amount')::NUMERIC > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_ll->>'coa_code', 'side', 'CREDIT',
        'amount', (v_ll->>'amount')::NUMERIC,
        'description', 'Saldo awal ' || COALESCE(v_ll->>'coa_name', v_ll->>'coa_code')));
    END IF;
  END LOOP;

  -- Modal Owner
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_modal IS NULL THEN
      RAISE EXCEPTION 'Akun Modal Owner (subtype MODAL_DISETOR) tidak ditemukan.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_modal, 'side', 'CREDIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC,
      'description', 'Saldo awal Modal Owner'));
  END IF;

  -- Prive (contra-equity DEBIT)
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_prive IS NULL THEN
      RAISE EXCEPTION 'Akun Prive (subtype PRIVE) tidak ditemukan.';
    END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_prive, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC,
      'description', 'Saldo awal Prive'));
  END IF;

  -- Laba Ditahan (balancing)
  IF v_totals.laba_ditahan_balancing != 0 THEN
    IF v_coa_laba_ditahan IS NULL THEN
      RAISE EXCEPTION 'Akun Laba Ditahan (subtype LABA_DITAHAN) tidak ditemukan.';
    END IF;
    IF v_totals.laba_ditahan_balancing > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_coa_laba_ditahan, 'side', 'CREDIT',
        'amount', v_totals.laba_ditahan_balancing,
        'description', 'Saldo awal Laba Ditahan (balancing)'));
    ELSE
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_coa_laba_ditahan, 'side', 'DEBIT',
        'amount', ABS(v_totals.laba_ditahan_balancing),
        'description', 'Saldo awal Laba Ditahan (defisit / balancing)'));
    END IF;
  END IF;

  v_je_id := public._post_journal_entry(v_je_date::DATE, 'OPENING_BALANCE'::journal_entry_source,
    'Saldo Awal per ' || to_char(v_snap.cutover_date, 'YYYY-MM-DD'), v_lines,
    'saldo_awal_snapshots', p_snapshot_id, v_tenant, NULL);

  IF (v_snap.step_data->'step2_aktiva'->'piutang'->>'mode') = 'detail' THEN
    FOR v_ar_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'piutang'->'lines', '[]'::jsonb)) LOOP
      INSERT INTO public.opening_ar_lines (tenant_id, snapshot_id, customer_id, customer_name, amount, original_due_date, invoice_ref, notes)
        VALUES (v_tenant, p_snapshot_id, NULLIF(v_ar_row->>'customer_id', ''),
          COALESCE(v_ar_row->>'customer_name', 'Customer'), (v_ar_row->>'amount')::NUMERIC,
          NULLIF(v_ar_row->>'original_due_date','')::DATE, NULLIF(v_ar_row->>'invoice_ref',''), NULLIF(v_ar_row->>'notes',''));
    END LOOP;
  END IF;

  IF (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'mode') = 'detail' THEN
    FOR v_ap_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->'lines', '[]'::jsonb)) LOOP
      INSERT INTO public.opening_ap_lines (tenant_id, snapshot_id, supplier_id, supplier_name, amount, original_due_date, invoice_ref, notes)
        VALUES (v_tenant, p_snapshot_id, NULLIF(v_ap_row->>'supplier_id','')::UUID,
          COALESCE(v_ap_row->>'supplier_name', 'Supplier'), (v_ap_row->>'amount')::NUMERIC,
          NULLIF(v_ap_row->>'original_due_date','')::DATE, NULLIF(v_ap_row->>'invoice_ref',''), NULLIF(v_ap_row->>'notes',''));
    END LOOP;
  END IF;

  UPDATE public.saldo_awal_snapshots SET status = 'posted', posted_je_id = v_je_id,
    posted_at = now(), posted_by = v_user, updated_at = now(), updated_by = v_user
   WHERE id = p_snapshot_id;

  RETURN v_je_id;
END $$;

ALTER FUNCTION public.post_saldo_awal_snapshot(UUID) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.post_saldo_awal_snapshot(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_saldo_awal_snapshot(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.post_saldo_awal_snapshot(UUID) TO authenticated;
