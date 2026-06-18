-- Sales landing dashboard stats: urgent count, tunggu count, revenue pending, completed this month
CREATE OR REPLACE FUNCTION get_sales_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_urgent_count int;
  v_tunggu_count int;
  v_revenue_pending bigint;
  v_completed_this_month int;
  v_revenue_this_month bigint;
BEGIN
  SELECT COUNT(*) INTO v_urgent_count
  FROM kasir_transactions
  WHERE type = 'income'
    AND funnel_sub_stage IN ('2b', '2d', '3a', '3b', '3c', '3f', '3g', '4b', '4d');

  SELECT COUNT(*) INTO v_tunggu_count
  FROM kasir_transactions
  WHERE type = 'income'
    AND funnel_sub_stage IN ('1a', '2a', '2c', '2e', '3d', '3e', '3h', '4a');

  SELECT COALESCE(SUM(COALESCE(subtotal, 0)), 0) INTO v_revenue_pending
  FROM kasir_transactions
  WHERE type = 'income'
    AND funnel_stage BETWEEN 1 AND 4;

  SELECT COUNT(*), COALESCE(SUM(COALESCE(subtotal, 0)), 0)
    INTO v_completed_this_month, v_revenue_this_month
  FROM kasir_transactions
  WHERE type = 'income'
    AND funnel_stage = 5
    AND created_at >= date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'urgent_count', v_urgent_count,
    'tunggu_count', v_tunggu_count,
    'revenue_pending', v_revenue_pending,
    'completed_this_month', v_completed_this_month,
    'revenue_this_month', v_revenue_this_month
  );
END;
$$;

REVOKE ALL ON FUNCTION get_sales_dashboard_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_sales_dashboard_stats() TO authenticated;

COMMENT ON FUNCTION get_sales_dashboard_stats IS 'Sales landing dashboard counters for stats cards. Returns 5 keys.';
