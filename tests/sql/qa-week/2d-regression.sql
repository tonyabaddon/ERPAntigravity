-- 2D regression: verify all 6 WT policies now use _check_expiry_ok()
-- instead of the broken _guard_expiry_write() IS NULL predicate.
-- Run after migration 503.

DO $t$
DECLARE v_broken_count int; v_fixed_count int;
BEGIN
  SELECT COUNT(*) INTO v_broken_count FROM pg_policies
    WHERE (qual ILIKE '%_guard_expiry_write%IS NULL%' OR with_check ILIKE '%_guard_expiry_write%IS NULL%');
  SELECT COUNT(*) INTO v_fixed_count FROM pg_policies
    WHERE tablename IN ('warehouse_transfers', 'warehouse_transfer_items')
      AND (qual ILIKE '%_check_expiry_ok%' OR with_check ILIKE '%_check_expiry_ok%');

  IF v_broken_count = 0 THEN
    RAISE NOTICE 'PASS: 0 policies still use broken _guard_expiry_write() IS NULL predicate';
  ELSE
    RAISE NOTICE 'FAIL: % policies still have broken predicate', v_broken_count;
  END IF;

  IF v_fixed_count = 6 THEN
    RAISE NOTICE 'PASS: 6 policies on WT tables now use _check_expiry_ok()';
  ELSE
    RAISE NOTICE 'FAIL: expected 6 WT policies with _check_expiry_ok(), got %', v_fixed_count;
  END IF;
END $t$;
