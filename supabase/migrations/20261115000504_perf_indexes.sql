-- QA-week Wave 1 Task 3 (2C) — 4 perf indexes on hot query paths.
-- All CONCURRENTLY — no table lock. Idempotent via IF NOT EXISTS.
-- Decision memo: docs/superpowers/specs/2026-07-20-perf-indexes-decision.md
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- This file is intentionally NOT wrapped in BEGIN/COMMIT. Each CREATE is
-- individually atomic + idempotent.
--
-- Column-name corrections vs original brief (verified against live schema
-- 2026-07-20): approval_requests.requested_at (not created_at) and
-- stock_lots.received_at (not created_at).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_requests_tenant_status_requested
  ON approval_requests (tenant_id, status, requested_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_order_items_po
  ON purchase_order_items (po_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_lots_fifo
  ON stock_lots (tenant_id, sku, received_at) WHERE qty_remaining > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_tenant_supplier_status
  ON purchase_orders (tenant_id, supplier_id, status);
