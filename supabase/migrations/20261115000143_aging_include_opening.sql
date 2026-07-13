-- 20261115000143_aging_include_opening.sql
-- Item #5: Extend get_dashboard_maintenance_counts to include opening_ar_lines
-- and opening_ap_lines from saldo_awal_snapshots (status='posted', reversed_at IS NULL).
--
-- Semantic note: kasir TEMPO overdue uses age-of-creation proxy (created_at < now()-30d);
-- opening AR/AP overdue uses original_due_date < CURRENT_DATE (explicit due date).
-- These are intentionally different predicates — do not "fix" to unify them.
--
-- Opening lines have no partial-payment concept — amount IS the outstanding balance.

-- ── get_dashboard_maintenance_counts (replaces slot 130 version) ─────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_maintenance_counts()
RETURNS TABLE(
  approval_pending        INT,
  piutang_overdue_count   INT,
  piutang_overdue_sum     NUMERIC,
  hutang_overdue_count    INT,
  hutang_overdue_sum      NUMERIC,
  fulfillment_queue_count INT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_kasir_piutang_count  INT     := 0;
  v_kasir_piutang_sum    NUMERIC := 0;
  v_opening_ar_count     INT     := 0;
  v_opening_ar_sum       NUMERIC := 0;
  v_kasir_hutang_count   INT     := 0;
  v_kasir_hutang_sum     NUMERIC := 0;
  v_opening_ap_count     INT     := 0;
  v_opening_ap_sum       NUMERIC := 0;
BEGIN
  v_tenant := public._resolve_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::UUID THEN
    approval_pending := 0; piutang_overdue_count := 0; piutang_overdue_sum := 0;
    hutang_overdue_count := 0; hutang_overdue_sum := 0; fulfillment_queue_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── Approval pending ──────────────────────────────────────────────────────
  SELECT COALESCE((SELECT COUNT(*)::INT FROM public.approval_requests
                    WHERE tenant_id = v_tenant AND status = 'pending'), 0)
    INTO approval_pending;

  -- ── Piutang overdue: kasir TEMPO (age-of-creation proxy, 30d threshold) ──
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total_amount - COALESCE(dp_amount, 0)), 0)
  INTO v_kasir_piutang_count, v_kasir_piutang_sum
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND payment_type = 'TEMPO'
    AND status = 'AWAITING_LUNAS'
    AND lunas_at IS NULL
    AND cancelled_at IS NULL
    AND created_at < now() - INTERVAL '30 days';

  -- ── Piutang overdue: opening_ar_lines (original_due_date < today) ─────────
  -- Gated by saldo_awal_snapshots: status='posted' AND reversed_at IS NULL.
  -- amount IS the full outstanding balance (no paid_amount column on opening lines).
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(ar.amount), 0)
  INTO v_opening_ar_count, v_opening_ar_sum
  FROM public.opening_ar_lines ar
  JOIN public.saldo_awal_snapshots sn ON sn.id = ar.snapshot_id
  WHERE ar.tenant_id = v_tenant
    AND sn.tenant_id = v_tenant
    AND sn.status = 'posted'
    AND sn.reversed_at IS NULL
    AND ar.original_due_date IS NOT NULL
    AND ar.original_due_date < CURRENT_DATE;

  piutang_overdue_count := v_kasir_piutang_count + v_opening_ar_count;
  piutang_overdue_sum   := v_kasir_piutang_sum   + v_opening_ar_sum;

  -- ── Hutang overdue: purchase_invoices (payment_due_at < now) ─────────────
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(total - COALESCE(paid_amount, 0)), 0)
  INTO v_kasir_hutang_count, v_kasir_hutang_sum
  FROM public.purchase_invoices
  WHERE tenant_id = v_tenant
    AND payment_due_at IS NOT NULL
    AND payment_due_at < now()
    AND paid_at IS NULL
    AND voided_at IS NULL;

  -- ── Hutang overdue: opening_ap_lines (original_due_date < today) ─────────
  SELECT
    COALESCE(COUNT(*)::INT, 0),
    COALESCE(SUM(ap.amount), 0)
  INTO v_opening_ap_count, v_opening_ap_sum
  FROM public.opening_ap_lines ap
  JOIN public.saldo_awal_snapshots sn ON sn.id = ap.snapshot_id
  WHERE ap.tenant_id = v_tenant
    AND sn.tenant_id = v_tenant
    AND sn.status = 'posted'
    AND sn.reversed_at IS NULL
    AND ap.original_due_date IS NOT NULL
    AND ap.original_due_date < CURRENT_DATE;

  hutang_overdue_count := v_kasir_hutang_count + v_opening_ap_count;
  hutang_overdue_sum   := v_kasir_hutang_sum   + v_opening_ap_sum;

  -- ── Fulfillment queue ─────────────────────────────────────────────────────
  SELECT COALESCE(COUNT(*)::INT, 0)
    INTO fulfillment_queue_count
  FROM public.kasir_transactions
  WHERE tenant_id = v_tenant
    AND status IN ('AWAITING_LUNAS','WIP','PENDING_LOCK_APPROVAL')
    AND cancelled_at IS NULL;

  RETURN NEXT;
END $$;

ALTER FUNCTION public.get_dashboard_maintenance_counts() OWNER TO vosi_rpc_owner;
REVOKE ALL ON FUNCTION public.get_dashboard_maintenance_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_maintenance_counts() TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_maintenance_counts IS
  'Item #3+#5: Dashboard maintenance counts; includes opening_ar_lines + opening_ap_lines from posted saldo_awal_snapshots.';
