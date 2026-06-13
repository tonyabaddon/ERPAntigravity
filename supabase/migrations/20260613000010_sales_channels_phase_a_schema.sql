-- Phase A — Schema groundwork for configurable sales channels
-- Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
-- Adds 10 new channels to both kasir_channel and sales_channel ENUMs.
-- Postgres requires each ADD VALUE in its own transaction (cannot rollback within tx).

-- kasir_channel: add 10 new values (whatsapp already present per Task 1 verify)
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'expo';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'shopee';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'lazada';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'blibli';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'bukalapak';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'ralali';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'bhinneka';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'website';

-- sales_channel: mirror same additions
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'sales';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'expo';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'shopee';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'lazada';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'blibli';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'bukalapak';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'ralali';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'bhinneka';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'website';

COMMIT;
