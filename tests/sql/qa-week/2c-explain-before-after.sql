-- QA-week Wave 1 Task 3 (2C) — EXPLAIN ANALYZE before/after for 4 perf indexes.
-- Decision memo: docs/superpowers/specs/2026-07-20-perf-indexes-decision.md
-- Migration:     supabase/migrations/20261115000504_perf_indexes.sql
--
-- Column corrections vs brief (verified against schema 2026-07-20):
--   approval_requests: no created_at → use requested_at
--   stock_lots:        no created_at → use received_at
--   approval_status enum values are lowercase: 'pending'
--   po status values in use:  ORDERED / RECEIVED / PAID (no OPEN/PARTIALLY_RECEIVED)
--
-- Rowcounts (2026-07-20):
--   approval_requests    1,289
--   purchase_order_items   290
--   stock_lots             245
--   purchase_orders        290
--
-- Run each query as-is (server side) and record the plan. Compare BEFORE
-- (this file's baseline) vs AFTER (post-migration).

-- =============================================================================
-- Q1: approval_requests hot-path (dashboard: find open by tenant + status)
-- =============================================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT * FROM approval_requests
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND status = 'pending'
    AND requested_at > NOW() - INTERVAL '7 days'
  ORDER BY requested_at DESC LIMIT 20;

-- =============================================================================
-- Q2: purchase_order_items lookup by po_id (join hot-path in PO detail screen)
-- =============================================================================
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM purchase_order_items
  WHERE po_id = (SELECT id FROM purchase_orders LIMIT 1);

-- =============================================================================
-- Q3: stock_lots FIFO scan (oldest lot with stock remaining for a SKU)
-- =============================================================================
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM stock_lots
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND sku = (SELECT sku FROM stock_lots WHERE qty_remaining > 0 LIMIT 1)
    AND qty_remaining > 0
  ORDER BY received_at ASC LIMIT 1;

-- =============================================================================
-- Q4: purchase_orders by supplier + status (supplier detail screen)
-- =============================================================================
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM purchase_orders
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND supplier_id = (SELECT id FROM suppliers WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)
    AND status IN ('ORDERED','RECEIVED');
