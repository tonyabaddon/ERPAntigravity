-- E2E audit 2026-06-12 data scrub: removes the test-data pollution that
-- surfaced during the Chrome-driven walkthrough.
--
-- Patterns targeted:
--   1. PO-TEST-<epoch>   purchase_orders + purchase_order_items
--   2. Test Supplier <epoch>  + ad-hoc "Test Supplier" with no real data
--   3. T20 <Active|Inactive> <Owner|Admin> wa_recipients (with 21-digit
--      phone numbers that are stress-test fixtures and not valid numbers)
--   4. Test Kasir <epoch> admin_users (stress-test admin rows)
--   5. T1-PENG-A/B/-<epoch> stocks ("Pengawasan Test SKU" rows)
--   6. Opname sessions with countedByUserId/witnessedByUserId equal to the
--      nil UUID 00000000-0000-0000-0000-000000000000 — the UI showed these
--      as "00000000" placeholders during the e2e walkthrough.
--   7. T9-PRICE duplicate "Test SKU" rows (the second + onward copies).
--   8. E2E-AUDIT customer + invoice created by the e2e itself, so the
--      probe run does not become permanent data.
--
-- Each statement is pattern-matched. None target rows that match a real
-- store name / supplier / SKU pattern — review the migration before
-- applying. Run order matters because of FK dependencies: child rows
-- (purchase_order_items, kasir_transaction_items, etc.) first, parents
-- after. Wrapped in a single transaction so a mid-script failure does
-- not leave the catalog half-deleted.

BEGIN;

-- ─── 1. Purchase orders + items ────────────────────────────────────────────
DELETE FROM public.purchase_order_items
 WHERE po_id IN (
   SELECT id FROM public.purchase_orders WHERE po_number LIKE 'PO-TEST-%'
 );

DELETE FROM public.purchase_orders
 WHERE po_number LIKE 'PO-TEST-%';

-- ─── 2. Test suppliers ─────────────────────────────────────────────────────
-- "Test Supplier <epoch>" + the bare "Test Supplier" that has no FK references.
DELETE FROM public.suppliers
 WHERE name LIKE 'Test Supplier %'
    OR name = 'Test Supplier';

-- ─── 3. T20 stress-test WA recipients ──────────────────────────────────────
-- These are easy to identify: name starts with "T20" AND the wa_number is
-- >= 16 digits (real Indonesian numbers are 11-13 digits).
DELETE FROM public.wa_recipients
 WHERE name LIKE 'T20 %'
   AND length(wa_number) >= 16;

-- ─── 4. Test Kasir / Test Kasir Old stress-test admin rows ─────────────────
-- The Phase 2 lockout test seeded a batch of "Test Kasir <epoch>" + "Test
-- Kasir Old <epoch>" admin_users. Their emails follow the pattern
-- *@test.local OR the name matches "Test Kasir%". Owners are excluded
-- defensively in case the test ever spawned one.
DELETE FROM public.admin_users
 WHERE (name LIKE 'Test Kasir %' OR name LIKE 'Test Kasir Old %')
   AND role <> 'Owner';

-- ─── 5. Pengawasan Test SKU ────────────────────────────────────────────────
-- The Phase 4 pengawasan-views test seeded SKUs of the form
-- T1-PENG-A-<epoch> / T1-PENG-B-<epoch>. These have zero stock and no
-- real-world equivalent. Delete the stocks rows AND the corresponding
-- stock_lots / stock_movements / opname_counts (FKs).
DELETE FROM public.stock_lots
 WHERE sku LIKE 'T1-PENG-A-%' OR sku LIKE 'T1-PENG-B-%';

DELETE FROM public.stock_opname_counts
 WHERE sku LIKE 'T1-PENG-A-%' OR sku LIKE 'T1-PENG-B-%';

-- stock_movements is append-only (REVOKE UPDATE/DELETE + deny trigger). We
-- cannot DELETE from it even from a migration without dropping the trigger;
-- the audit-immutability invariant is by design. The stocks-row deletion
-- below is FK-referenced by stock_movements with NO ACTION — so it will
-- fail if any movement rows reference these SKUs. The Pengawasan SKUs were
-- created with no movements (the test only mutated `stock_atas` directly),
-- so the FK passes; if it doesn't, fix by ALTER ... ON DELETE SET NULL or
-- skip these rows manually.
DELETE FROM public.stocks
 WHERE sku LIKE 'T1-PENG-A-%' OR sku LIKE 'T1-PENG-B-%';

-- ─── 6. Opname sessions with nil UUIDs ─────────────────────────────────────
-- These render as "00000000" in the UI. Cascade through counts.
DELETE FROM public.stock_opname_counts
 WHERE session_id IN (
   SELECT id FROM public.stock_opname_sessions
    WHERE counted_by_user_id = '00000000-0000-0000-0000-000000000000'::uuid
       OR witnessed_by_user_id = '00000000-0000-0000-0000-000000000000'::uuid
 );

DELETE FROM public.stock_opname_sessions
 WHERE counted_by_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    OR witnessed_by_user_id = '00000000-0000-0000-0000-000000000000'::uuid;

-- ─── 7. Duplicate "Test SKU" T9-PRICE rows ─────────────────────────────────
-- The e2e showed 3 rows with sku starting "T9-PRICE" — multiple inserts
-- from a stress test. Keep the first (lowest sku alpha), delete the rest.
WITH ranked AS (
  SELECT sku, ROW_NUMBER() OVER (PARTITION BY name ORDER BY sku) AS rn
    FROM public.stocks
   WHERE sku LIKE 'T9-PRICE%'
)
DELETE FROM public.stocks
 WHERE sku IN (SELECT sku FROM ranked WHERE rn > 1);

-- ─── 8. E2E-AUDIT probe artifacts from the audit itself ────────────────────
-- The 2026-06-12 walkthrough wrote one kasir tx + one customer to verify
-- pure-jasa save still worked. Clean both so they don't become permanent
-- data. The approval_request expires on its own via the sweeper.
DELETE FROM public.kasir_transactions
 WHERE invoice_no = 'WLK-20260612-017';

DELETE FROM public.customers
 WHERE wa_number = '0812-E2E-AUDIT-1';

COMMIT;

-- Manual follow-up (post-apply): re-export the stock CSV to confirm the
-- T9-PRICE row count dropped and Pengawasan test SKUs are gone. The
-- Riwayat Pesanan filter "Selesai" should drop by exactly 1.
