-- Funnel stage tracking columns + order type + optimistic lock
DO $$ BEGIN
  CREATE TYPE order_type_enum AS ENUM ('KOMPONEN', 'CUSTOM_PANEL', 'RAKIT_PANEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_method_enum AS ENUM ('PICKUP', 'DELIVERY', 'MARKETPLACE_COURIER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE kasir_transactions
  ADD COLUMN IF NOT EXISTS order_type order_type_enum NOT NULL DEFAULT 'KOMPONEN',
  ADD COLUMN IF NOT EXISTS funnel_stage smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS funnel_sub_stage text NOT NULL DEFAULT '1a',
  ADD COLUMN IF NOT EXISTS estimated_completion_days int NULL,
  ADD COLUMN IF NOT EXISTS estimated_completion_date date NULL,
  ADD COLUMN IF NOT EXISTS wip_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS delivery_method delivery_method_enum NOT NULL DEFAULT 'PICKUP',
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_kasir_funnel_sub_stage ON kasir_transactions(funnel_sub_stage);
CREATE INDEX IF NOT EXISTS idx_kasir_order_type ON kasir_transactions(order_type);
CREATE INDEX IF NOT EXISTS idx_kasir_funnel_stage_active ON kasir_transactions(funnel_stage) WHERE funnel_stage BETWEEN 1 AND 4;

COMMENT ON COLUMN kasir_transactions.funnel_sub_stage IS 'e.g. 2a, 2b, 3f, 4d — see src/lib/sales/stageMapping.ts';
COMMENT ON COLUMN kasir_transactions.version IS 'Optimistic locking: incremented on every update; clients pass expected version';
