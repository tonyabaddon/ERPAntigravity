-- 2K Verification: idempotency key rows in t_rpc_idempotency
-- Expected: > 0 after any real FE-triggered write (record_kasir_sale,
-- commit_opname, receive_purchase_order, record_pembayaran).
-- Currently 0 in fresh env; passes after at least one high-value RPC fires.
SELECT COUNT(*) AS idempotency_rows FROM t_rpc_idempotency;
