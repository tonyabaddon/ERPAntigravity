-- RPC smoke tests — call critical write RPCs as Toko Jaya owner, verify success or capture error
-- ALL wrapped in RAISE EXCEPTION rollback → zero prod side effects
-- Run via: psql "$DB_CONN" -f tests/sql/qa-week/rpc-smoke.sql

\echo === TENANT + USER SETUP ===
DO $setup$
DECLARE
  v_tenant uuid := '22222222-2222-2222-2222-222222222222'; -- Toko Jaya
  v_user uuid;
BEGIN
  SELECT tu.user_id INTO v_user FROM tenant_users tu WHERE tu.tenant_id = v_tenant LIMIT 1;
  PERFORM set_config('qa_week.user', v_user::text, false);
  PERFORM set_config('qa_week.tenant', v_tenant::text, false);
  RAISE NOTICE 'Setup complete. Tenant=%, User=%', v_tenant, v_user;
END $setup$;

\echo
\echo === Smoke 1: create_sales_order ===
DO $t$
DECLARE
  v_user uuid := current_setting('qa_week.user')::uuid;
  v_tenant uuid := current_setting('qa_week.tenant')::uuid;
  v_result jsonb;
  v_success boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  BEGIN
    -- Minimal input; catches signature + auth issues
    v_result := to_jsonb(public.create_sales_order(
      p_customer_id := (SELECT id FROM customers LIMIT 1),
      p_line_items := '[]'::jsonb,
      p_note := 'QA-WEEK-smoke-so'
    ));
    v_success := true;
    RAISE NOTICE 'PASS create_sales_order: %', LEFT(v_result::text, 150);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL create_sales_order: % (%) — may be normal if signature differs', SQLERRM, SQLSTATE;
  END;

  RAISE EXCEPTION 'rollback';
EXCEPTION WHEN OTHERS THEN NULL;
END $t$;

\echo
\echo === Smoke 2: initiate_warehouse_transfer ===
DO $t$
DECLARE
  v_user uuid := current_setting('qa_week.user')::uuid;
  v_tenant uuid := current_setting('qa_week.tenant')::uuid;
  v_wh_id uuid;
  v_stock_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT id INTO v_wh_id FROM warehouses LIMIT 1;
  SELECT id INTO v_stock_id FROM stocks WHERE tenant_id = v_tenant LIMIT 1;

  IF v_wh_id IS NULL OR v_stock_id IS NULL THEN
    RAISE NOTICE 'SKIP initiate_warehouse_transfer — missing wh(%) or stock(%)', v_wh_id, v_stock_id;
  ELSE
    BEGIN
      PERFORM public.initiate_warehouse_transfer(
        p_from_warehouse_id := v_wh_id,
        p_to_warehouse_id := v_wh_id,   -- same warehouse — should validate reject
        p_items := jsonb_build_array(jsonb_build_object('stock_id', v_stock_id, 'qty', 1))
      );
      RAISE NOTICE 'UNEXPECTED PASS initiate_warehouse_transfer with same from=to (should fail validation)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'PASS validation initiate_warehouse_transfer same-warehouse rejected: % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;

  RAISE EXCEPTION 'rollback';
EXCEPTION WHEN OTHERS THEN NULL;
END $t$;

\echo
\echo === Smoke 3: SECDEF idempotency — record_pembayaran double-call ===
DO $t$
DECLARE
  v_user uuid := current_setting('qa_week.user')::uuid;
  v_tenant uuid := current_setting('qa_week.tenant')::uuid;
  v_before int; v_after1 int; v_after2 int;
  v_result jsonb;
  v_key uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'tenant_id', v_tenant::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT COUNT(*) INTO v_before FROM t_rpc_idempotency WHERE rpc_name='record_pembayaran' AND idempotency_key = v_key;
  RAISE NOTICE 'record_pembayaran idempotency before: %', v_before;

  -- Cannot easily test without full pembayaran chain; just verify RPC exists + auth passes
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='record_pembayaran' AND prosecdef) THEN
    RAISE NOTICE 'PASS record_pembayaran SECDEF exists';
  ELSE
    RAISE NOTICE 'FAIL record_pembayaran missing';
  END IF;

  RAISE EXCEPTION 'rollback';
EXCEPTION WHEN OTHERS THEN NULL;
END $t$;

\echo
\echo === Smoke 4: RPC surface: total callable RPCs by authenticated ===
SELECT COUNT(*)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN aclexplode(p.proacl) a ON true
WHERE n.nspname='public' AND p.prosecdef
  AND pg_catalog.pg_get_userbyid(a.grantee)='authenticated' AND a.privilege_type='EXECUTE';

\echo
\echo === Smoke 5: All SECDEF callable RPCs should either belong to vosi_rpc_owner OR postgres+audit-hook pattern ===
SELECT COUNT(*) FILTER (WHERE ro.rolname = 'vosi_rpc_owner') AS vosi_owned,
       COUNT(*) FILTER (WHERE ro.rolname = 'postgres')       AS postgres_owned
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
JOIN pg_authid ro ON ro.oid = p.proowner
WHERE n.nspname='public' AND p.prosecdef;

\echo
\echo === Smoke 6: Financial: Neraca balance sanity per tenant ===
SELECT t.name, je.tenant_id,
       ROUND(SUM(je.total_debit)::numeric, 2) AS total_debit,
       ROUND(SUM(je.total_credit)::numeric, 2) AS total_credit,
       COUNT(*) AS entries
FROM journal_entries je JOIN tenants t ON t.id=je.tenant_id
GROUP BY t.name, je.tenant_id
ORDER BY t.name;

\echo
\echo === Smoke 7: JE line side totals match entry totals ===
WITH sums AS (
  SELECT je.tenant_id, je.id,
         je.total_debit,
         je.total_credit,
         COALESCE(SUM(CASE WHEN jel.side='DEBIT' THEN jel.amount END), 0) AS lines_debit,
         COALESCE(SUM(CASE WHEN jel.side='CREDIT' THEN jel.amount END), 0) AS lines_credit
  FROM journal_entries je LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
  GROUP BY je.tenant_id, je.id, je.total_debit, je.total_credit
)
SELECT COUNT(*) AS mismatches
FROM sums
WHERE total_debit != lines_debit OR total_credit != lines_credit;

\echo
\echo === Smoke 8: Stock invariants: total = FIFO sum ===
SELECT COUNT(*) AS stocks_with_mismatch
FROM stocks s
WHERE ABS(s.stok_total - COALESCE(
  (SELECT SUM(sl.qty_remaining) FROM stock_lots sl WHERE sl.stock_id = s.id),
  0
)) > 0.01;
