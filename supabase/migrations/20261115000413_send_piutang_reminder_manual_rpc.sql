-- supabase/migrations/20261115000413_send_piutang_reminder_manual_rpc.sql
-- Sprint 2 (2026-07-19): Task 2.5 — Manual send override for Piutang WA reminder.
-- Enforces 1x/invoice/day + Premium plan gate + enqueues t_jobs row.
--
-- SCHEMA NOTES (verified against live DB 2026-07-19):
--   tenant_subscriptions: no 'tier' column; use plan_code='PREMIUM' + grace_expires_at check
--   tenant_subscriptions: no 'status' column; active = grace_expires_at >= CURRENT_DATE
--   t_jobs.status CHECK only allows QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED (not 'PENDING')
--   piutang_reminder_sent dedup key: (invoice_id, rule_type, sent_date) — use sent_date
--   orders.tenant_id: present; scope query by tenant to prevent cross-tenant access

CREATE OR REPLACE FUNCTION public.send_piutang_reminder_manual(p_invoice_id UUID)
RETURNS TABLE (status TEXT, message TEXT)
SECURITY DEFINER
SET search_path = public, pg_catalog
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id     UUID;
  v_customer_id   TEXT;
  v_plan_code     TEXT;
  v_plan_active   BOOLEAN;
  v_already_sent  BOOLEAN;
BEGIN
  -- Resolve caller's tenant — null means unauthenticated or no membership.
  v_tenant_id := public._resolve_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Sesi tidak valid. Silakan login ulang.'::TEXT;
    RETURN;
  END IF;

  -- Verify invoice exists and belongs to caller's tenant (tenant-scoped lookup).
  -- In SECDEF context RLS is bypassed, so explicit tenant_id filter is mandatory.
  SELECT o.customer_id INTO v_customer_id
  FROM public.orders o
  WHERE o.id = p_invoice_id
    AND o.tenant_id = v_tenant_id;

  IF v_customer_id IS NULL THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Invoice tidak ditemukan atau tidak boleh diakses'::TEXT;
    RETURN;
  END IF;

  -- Tier gate: Premium plan with active (non-expired) subscription only.
  -- plan_code='PREMIUM' matches the seeded plan in migration 20261001000002.
  -- grace_expires_at is a generated column = expires_at + 7 days.
  SELECT ts.plan_code,
         (ts.grace_expires_at >= CURRENT_DATE) AS is_active
  INTO v_plan_code, v_plan_active
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = v_tenant_id;

  IF v_plan_code IS NULL OR v_plan_code != 'PREMIUM' OR NOT COALESCE(v_plan_active, FALSE) THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'WA reminder tersedia di paket Premium — upgrade untuk aktifkan'::TEXT;
    RETURN;
  END IF;

  -- 1x/invoice/day dedup using the denormalized sent_date column
  -- (matches UNIQUE constraint: invoice_id, rule_type, sent_date).
  SELECT EXISTS (
    SELECT 1 FROM public.piutang_reminder_sent
    WHERE invoice_id = p_invoice_id
      AND rule_type = 'MANUAL'
      AND sent_date = CURRENT_DATE
  ) INTO v_already_sent;

  IF v_already_sent THEN
    RETURN QUERY SELECT 'ERROR'::TEXT, 'Reminder manual sudah dikirim untuk invoice ini hari ini'::TEXT;
    RETURN;
  END IF;

  -- Enqueue for backend job worker to execute the actual send.
  -- status defaults to 'QUEUED' (CHECK: QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED).
  INSERT INTO public.t_jobs (tenant_id, job_type, payload)
  VALUES (
    v_tenant_id,
    'piutang_manual_send',
    jsonb_build_object('invoice_id', p_invoice_id)
  );

  RETURN QUERY SELECT 'OK'::TEXT, 'Reminder akan dikirim dalam beberapa detik'::TEXT;
END;
$$;

ALTER FUNCTION public.send_piutang_reminder_manual(UUID) OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.send_piutang_reminder_manual(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_piutang_reminder_manual(UUID) TO authenticated;
