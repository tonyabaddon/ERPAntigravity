-- 20261115000152_transition_order_stage_hook.sql
-- Item #2: Hook transition_order_stage at delivery transitions (4a/4b) to
-- trigger FIFO stock decrement + JE post for service_catalog-linked lines.
-- Also adds journal_entry_source enum value SERVICE_DELIVERY (applied via
-- separate slot to avoid same-transaction enum-use limitation).

-- Enum value applied via preceding migration (service_delivery_enum).
-- Full RPC bodies applied via MCP; see prod migrations table for canonical
-- source (this file marks slot ownership).

-- _process_service_line_delivery(p_order_id, p_tenant, p_user) helper:
--   Iterates rakit_job_lines with service_catalog_id NOT NULL and
--   hpp_final IS NULL (idempotence guard). For each: FIFO-walk each
--   snapshot component, populate fifo_cost_snapshot, sum HPP, add JE
--   lines per service revenue_coa_code + labor_cost_coa_code + shared
--   5-1100 HPP Penjualan + 1-1500 Persediaan + 2-2100 Utang Gaji.
--   Posts single JE via _post_journal_entry with source_type =
--   'SERVICE_DELIVERY' and source_ref = kasir_transactions/p_order_id.

-- transition_order_stage extended: after audit_log INSERT, when
--   p_to_sub_stage IN ('4a', '4b') and there exist eligible service
--   lines, invoke _process_service_line_delivery. Result appended to
--   return JSON as service_delivery key.
