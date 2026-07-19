-- QA WEEK cleanup — remove test rows created by Session 5 interactive testing
-- Safe to run repeatedly (idempotent DELETE). Zero effect if no matching rows.
-- Run via: psql "$DB_CONN" -f docs/qa-week/pending-fixes/cleanup-qa-week-testdata.sql

BEGIN;

\echo === Before cleanup ===
SELECT 'customers' AS t, COUNT(*) FROM customers WHERE name LIKE 'QA-WEEK-%' OR wa_number = '081234567890'
UNION ALL SELECT 'kasir_transactions', COUNT(*) FROM kasir_transactions WHERE note LIKE 'QA-WEEK-%'
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders WHERE note LIKE 'QA-WEEK-%'
UNION ALL SELECT 'orders', COUNT(*) FROM orders WHERE customer_phone = '081234567890' OR customer_name LIKE 'QA-WEEK-%';

-- Customers (may cascade to kasir_transactions, orders via FK)
DELETE FROM customers WHERE name LIKE 'QA-WEEK-%';

-- Kasir transactions tagged for QA week
DELETE FROM kasir_transactions WHERE note LIKE 'QA-WEEK-%';

-- Purchase orders tagged
DELETE FROM purchase_orders WHERE note LIKE 'QA-WEEK-%';

-- Sales orders / orders with QA prefix
DELETE FROM sales_orders WHERE note LIKE 'QA-WEEK-%';

\echo === After cleanup ===
SELECT 'customers' AS t, COUNT(*) FROM customers WHERE name LIKE 'QA-WEEK-%'
UNION ALL SELECT 'kasir_transactions', COUNT(*) FROM kasir_transactions WHERE note LIKE 'QA-WEEK-%'
UNION ALL SELECT 'purchase_orders', COUNT(*) FROM purchase_orders WHERE note LIKE 'QA-WEEK-%';

COMMIT;

\echo === Cleanup complete ===
