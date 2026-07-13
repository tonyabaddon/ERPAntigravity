-- 20261115000147_saldo_awal_detail_mode_sum_fix.sql
-- Item #5 hotfix: preview_saldo_awal_totals + post_saldo_awal_snapshot
-- were reading only step_data->piutang->aggregate_amount (which is 0 when
-- mode='detail'), silently dropping the sum of lines[]. Effect on Detail-
-- mode post: JE Piutang=0, JE Hutang=0, but opening_ar_lines/opening_ap_lines
-- gets full amounts → Neraca ↔ Aging mismatch, laba_ditahan absorbs the gap.
--
-- Fix pattern (symmetric AR + AP):
--   effective = CASE WHEN mode='detail'
--     THEN SUM(lines[].amount)
--     ELSE aggregate_amount
--   END
--
-- Verified 2026-07-13 via prod DB: zero posted snapshots use detail mode, so
-- no historical data corruption to remediate. Safe to hotfix.
--
-- Idempotent: CREATE OR REPLACE both functions.

CREATE OR REPLACE FUNCTION public.preview_saldo_awal_totals(p_step_data jsonb)
 RETURNS TABLE(total_assets numeric, total_liab numeric, total_equity numeric, laba_ditahan_balancing numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cash NUMERIC := 0;
  v_piutang NUMERIC := 0;
  v_persediaan NUMERIC := 0;
  v_aktiva_tetap NUMERIC := 0;
  v_aktiva_lain NUMERIC := 0;
  v_hutang NUMERIC := 0;
  v_kewajiban_lain NUMERIC := 0;
  v_modal NUMERIC := 0;
  v_prive NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM((elem->>'opening_balance')::NUMERIC), 0)
    INTO v_cash
    FROM jsonb_array_elements(COALESCE(p_step_data->'step1_cash'->'accounts', '[]'::jsonb)) AS elem;

  IF (p_step_data->'step2_aktiva'->'piutang'->>'mode') = 'detail' THEN
    SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
      INTO v_piutang
      FROM jsonb_array_elements(COALESCE(p_step_data->'step2_aktiva'->'piutang'->'lines', '[]'::jsonb)) AS elem;
  ELSE
    v_piutang := COALESCE((p_step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0);
  END IF;

  v_persediaan := COALESCE((p_step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0);
  v_aktiva_tetap := COALESCE((p_step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0);

  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
    INTO v_aktiva_lain
    FROM jsonb_array_elements(COALESCE(p_step_data->'step2_aktiva'->'lain_lain', '[]'::jsonb)) AS elem;

  IF (p_step_data->'step3_kewajiban'->'hutang_usaha'->>'mode') = 'detail' THEN
    SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
      INTO v_hutang
      FROM jsonb_array_elements(COALESCE(p_step_data->'step3_kewajiban'->'hutang_usaha'->'lines', '[]'::jsonb)) AS elem;
  ELSE
    v_hutang := COALESCE((p_step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0);
  END IF;

  SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
    INTO v_kewajiban_lain
    FROM jsonb_array_elements(COALESCE(p_step_data->'step3_kewajiban'->'lain_lain', '[]'::jsonb)) AS elem;

  v_modal := COALESCE((p_step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0);
  v_prive := COALESCE((p_step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0);

  total_assets := v_cash + v_piutang + v_persediaan + v_aktiva_tetap + v_aktiva_lain;
  total_liab := v_hutang + v_kewajiban_lain;
  laba_ditahan_balancing := total_assets - total_liab - (v_modal - v_prive);
  total_equity := v_modal - v_prive + laba_ditahan_balancing;
  RETURN NEXT;
END $function$;

REVOKE ALL ON FUNCTION public.preview_saldo_awal_totals(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_saldo_awal_totals(jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.post_saldo_awal_snapshot(p_snapshot_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID; v_user UUID; v_snap RECORD; v_je_id UUID; v_je_result JSONB;
  v_lines JSONB := '[]'::jsonb; v_totals RECORD;
  v_cash_line JSONB; v_ll JSONB; v_ar_row JSONB; v_ap_row JSONB;
  v_cash_coa TEXT; v_je_date DATE;
  v_coa_piutang TEXT; v_coa_persediaan TEXT; v_coa_aktiva_tetap TEXT;
  v_coa_hutang TEXT; v_coa_modal TEXT; v_coa_prive TEXT; v_coa_laba_ditahan TEXT;
  v_ar_amount NUMERIC := 0;
  v_ap_amount NUMERIC := 0;
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

  v_coa_piutang       := public._resolve_coa_by_subtype('PIUTANG_USAHA');
  v_coa_persediaan    := public._resolve_coa_by_subtype('PERSEDIAAN');
  v_coa_aktiva_tetap  := public._resolve_coa_by_subtype('ASET_TETAP');
  v_coa_hutang        := public._resolve_coa_by_subtype('HUTANG_USAHA');
  v_coa_modal         := public._resolve_coa_by_subtype('MODAL_DISETOR');
  v_coa_prive         := public._resolve_coa_by_subtype('PRIVE');
  v_coa_laba_ditahan  := public._resolve_coa_by_subtype('LABA_DITAHAN');

  -- Cash
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

  -- Piutang: sum lines[] in detail mode, else aggregate_amount
  IF (v_snap.step_data->'step2_aktiva'->'piutang'->>'mode') = 'detail' THEN
    SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
      INTO v_ar_amount
      FROM jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'piutang'->'lines', '[]'::jsonb)) AS elem;
  ELSE
    v_ar_amount := COALESCE((v_snap.step_data->'step2_aktiva'->'piutang'->>'aggregate_amount')::NUMERIC, 0);
  END IF;
  IF v_ar_amount > 0 THEN
    IF v_coa_piutang IS NULL THEN RAISE EXCEPTION 'Akun Piutang Usaha tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_piutang, 'side', 'DEBIT',
      'amount', v_ar_amount, 'description', 'Saldo awal Piutang Usaha'));
  END IF;

  -- Persediaan
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_persediaan IS NULL THEN RAISE EXCEPTION 'Akun Persediaan tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_persediaan, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'persediaan'->>'final_amount')::NUMERIC,
      'description', 'Saldo awal Persediaan'));
  END IF;

  -- Aktiva Tetap
  IF COALESCE((v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_aktiva_tetap IS NULL THEN RAISE EXCEPTION 'Akun Aset Tetap tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_aktiva_tetap, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step2_aktiva'->'aktiva_tetap'->>'amount')::NUMERIC,
      'description', 'Saldo awal Aktiva Tetap'));
  END IF;

  -- Aktiva lain-lain
  FOR v_ll IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'lain_lain', '[]'::jsonb)) LOOP
    IF (v_ll->>'amount')::NUMERIC > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_ll->>'coa_code', 'side', 'DEBIT',
        'amount', (v_ll->>'amount')::NUMERIC,
        'description', 'Saldo awal ' || COALESCE(v_ll->>'coa_name', v_ll->>'coa_code')));
    END IF;
  END LOOP;

  -- Hutang: sum lines[] in detail mode, else aggregate_amount
  IF (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'mode') = 'detail' THEN
    SELECT COALESCE(SUM((elem->>'amount')::NUMERIC), 0)
      INTO v_ap_amount
      FROM jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->'lines', '[]'::jsonb)) AS elem;
  ELSE
    v_ap_amount := COALESCE((v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'aggregate_amount')::NUMERIC, 0);
  END IF;
  IF v_ap_amount > 0 THEN
    IF v_coa_hutang IS NULL THEN RAISE EXCEPTION 'Akun Hutang Usaha tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_hutang, 'side', 'CREDIT',
      'amount', v_ap_amount, 'description', 'Saldo awal Hutang Usaha'));
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

  -- Modal
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_modal IS NULL THEN RAISE EXCEPTION 'Akun Modal Owner tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_modal, 'side', 'CREDIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'modal_owner'->>'amount')::NUMERIC,
      'description', 'Saldo awal Modal Owner'));
  END IF;

  -- Prive
  IF COALESCE((v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC, 0) > 0 THEN
    IF v_coa_prive IS NULL THEN RAISE EXCEPTION 'Akun Prive tidak ditemukan.'; END IF;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', v_coa_prive, 'side', 'DEBIT',
      'amount', (v_snap.step_data->'step4_ekuitas'->'prive'->>'amount')::NUMERIC,
      'description', 'Saldo awal Prive'));
  END IF;

  -- Laba Ditahan (balancing) — uses v_totals which now correctly sums detail lines
  IF v_totals.laba_ditahan_balancing != 0 THEN
    IF v_coa_laba_ditahan IS NULL THEN RAISE EXCEPTION 'Akun Laba Ditahan tidak ditemukan.'; END IF;
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

  v_je_result := public._post_journal_entry(
    v_je_date::DATE, 'OPENING_BALANCE'::journal_entry_source,
    'Saldo Awal per ' || to_char(v_snap.cutover_date, 'YYYY-MM-DD'),
    v_lines, 'saldo_awal_snapshots', p_snapshot_id, v_tenant, NULL);
  v_je_id := (v_je_result->>'entry_id')::UUID;
  IF v_je_id IS NULL THEN
    RAISE EXCEPTION 'gagal post Jurnal Umum: %', v_je_result;
  END IF;

  -- Insert opening_ar_lines (detail mode)
  IF (v_snap.step_data->'step2_aktiva'->'piutang'->>'mode') = 'detail' THEN
    FOR v_ar_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step2_aktiva'->'piutang'->'lines', '[]'::jsonb)) LOOP
      INSERT INTO public.opening_ar_lines (tenant_id, snapshot_id, customer_id, customer_name, amount, original_due_date, invoice_ref, notes)
        VALUES (v_tenant, p_snapshot_id,
          NULLIF(v_ar_row->>'customer_id', '')::UUID,
          COALESCE(v_ar_row->>'customer_name', 'Customer'),
          (v_ar_row->>'amount')::NUMERIC,
          NULLIF(v_ar_row->>'original_due_date','')::DATE,
          NULLIF(v_ar_row->>'invoice_ref',''),
          NULLIF(v_ar_row->>'notes',''));
    END LOOP;
  END IF;

  -- Insert opening_ap_lines (detail mode)
  IF (v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->>'mode') = 'detail' THEN
    FOR v_ap_row IN SELECT jsonb_array_elements(COALESCE(v_snap.step_data->'step3_kewajiban'->'hutang_usaha'->'lines', '[]'::jsonb)) LOOP
      INSERT INTO public.opening_ap_lines (tenant_id, snapshot_id, supplier_id, supplier_name, amount, original_due_date, invoice_ref, notes)
        VALUES (v_tenant, p_snapshot_id,
          NULLIF(v_ap_row->>'supplier_id','')::UUID,
          COALESCE(v_ap_row->>'supplier_name', 'Supplier'),
          (v_ap_row->>'amount')::NUMERIC,
          NULLIF(v_ap_row->>'original_due_date','')::DATE,
          NULLIF(v_ap_row->>'invoice_ref',''),
          NULLIF(v_ap_row->>'notes',''));
    END LOOP;
  END IF;

  UPDATE public.saldo_awal_snapshots
    SET status = 'posted', posted_je_id = v_je_id,
        posted_at = now(), posted_by = v_user,
        updated_at = now(), updated_by = v_user
    WHERE id = p_snapshot_id;

  RETURN v_je_id;
END $function$;

REVOKE ALL ON FUNCTION public.post_saldo_awal_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_saldo_awal_snapshot(uuid) TO authenticated;
