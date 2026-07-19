-- Sprint 2/3 (2026-07-19): Errata 3 — Fix status='PENDING' → 'QUEUED' in test-send RPCs
-- t_jobs CHECK constraint only allows: QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED
-- Migration 414 incorrectly used 'PENDING' which violates the CHECK constraint.

CREATE OR REPLACE FUNCTION public.send_piutang_reminder_test(p_rule_type TEXT)
RETURNS TABLE (status TEXT, message TEXT)
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id UUID := public._resolve_tenant_id();
  v_user_id UUID := auth.uid();
  v_phone TEXT;
BEGIN
  IF p_rule_type NOT IN ('H-3','H+3') THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'rule_type invalid'::TEXT; RETURN;
  END IF;
  SELECT phone INTO v_phone FROM public.wa_recipients WHERE tenant_id = v_tenant_id AND user_id = v_user_id AND active = TRUE LIMIT 1;
  IF v_phone IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Nomor WA kamu belum terdaftar di Pengaturan → WA Recipients'::TEXT; RETURN;
  END IF;
  INSERT INTO public.t_jobs (tenant_id, job_type, payload, status)
  VALUES (v_tenant_id, 'piutang_test_send', jsonb_build_object('phone', v_phone, 'rule_type', p_rule_type), 'QUEUED');
  RETURN QUERY SELECT 'OK'::TEXT, 'Tes akan dikirim dalam beberapa detik'::TEXT;
END; $$;

GRANT EXECUTE ON FUNCTION public.send_piutang_reminder_test(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_notification_test(p_template_id TEXT)
RETURNS TABLE (status TEXT, message TEXT)
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id UUID := public._resolve_tenant_id();
  v_user_id UUID := auth.uid();
  v_phone TEXT;
BEGIN
  SELECT phone INTO v_phone FROM public.wa_recipients WHERE tenant_id = v_tenant_id AND user_id = v_user_id AND active = TRUE LIMIT 1;
  IF v_phone IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Nomor WA kamu belum terdaftar'::TEXT; RETURN;
  END IF;
  INSERT INTO public.t_jobs (tenant_id, job_type, payload, status)
  VALUES (v_tenant_id, 'notification_test_send', jsonb_build_object('phone', v_phone, 'template_id', p_template_id), 'QUEUED');
  RETURN QUERY SELECT 'OK'::TEXT, 'Tes akan dikirim dalam beberapa detik'::TEXT;
END; $$;

GRANT EXECUTE ON FUNCTION public.send_notification_test(TEXT) TO authenticated;
