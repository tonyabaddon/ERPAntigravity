-- 20261115000210_drop_warehouse_transfers_stub.sql
-- Drop stub warehouse_transfers table (from 20260607000053_transfer_aging_view.sql)
-- plus the aging view that depends on it. Both are recreated with new schema
-- in tasks 2 + 3.
--
-- Safety: assumes stub table has zero live rows. Verified pre-apply.

BEGIN;

DROP VIEW IF EXISTS public.v_pengawasan_transfer_aging CASCADE;
DROP TABLE IF EXISTS public.warehouse_transfers CASCADE;

COMMIT;
