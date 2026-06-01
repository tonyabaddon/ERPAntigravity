-- supabase/migrations/20260601000001_schema_id_system.sql

-- 1. Expand order_status enum with spec-compliant business statuses.
--    Existing values (PENDING, APPROVED) remain but are unused going forward.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_ADMIN_CONFIRMATION';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_PRICE_NEGO';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_STOCK_CHECK';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_CUSTOM_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PENDING_WIRING_QUOTE';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'WAITING_PAYMENT';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_UPLOADED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_VERIFIED';

-- 2. Add ai_active to conversations (false = admin has taken over, AI is silent).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_active boolean NOT NULL DEFAULT true;
-- Extend the existing anon UPDATE grant to cover ai_active.
GRANT UPDATE (state, ai_active) ON conversations TO anon;

-- 3. Sequences for GJP ID generation (global counters; gaps are acceptable).
CREATE SEQUENCE IF NOT EXISTS gjp_cust_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_lead_seq START 1;
CREATE SEQUENCE IF NOT EXISTS gjp_ord_seq  START 1;

-- 4. customers table — one row per WA number, permanent identity.
CREATE TABLE IF NOT EXISTS customers (
  id         text        PRIMARY KEY,   -- GJP-CUST-XXXX
  wa_number  text        NOT NULL,
  name       text        NOT NULL DEFAULT '',
  company    text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_customers_wa'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);
  END IF;
END $$;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'anon_select_customers'
  ) THEN
    CREATE POLICY "anon_select_customers" ON customers FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 5. leads table — one row per conversation, lifecycle NEW→IN_PROGRESS→ESCALATED|ORDERED|DROPPED.
CREATE TABLE IF NOT EXISTS leads (
  id                 text        PRIMARY KEY,   -- GJP-LEAD-YYYYMMDD-XXXX
  customer_id        text        NOT NULL REFERENCES customers(id),
  conversation_id    uuid        NOT NULL REFERENCES conversations(id),
  wa_number          text        NOT NULL,
  status             text        NOT NULL DEFAULT 'NEW',
  confirmed_order_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_customer      ON leads(customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_conversation  ON leads(conversation_id);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'anon_select_leads'
  ) THEN
    CREATE POLICY "anon_select_leads" ON leads FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_leads_updated_at' AND event_object_table = 'leads'
  ) THEN
    CREATE TRIGGER trg_leads_updated_at
      BEFORE UPDATE ON leads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 6. bank_config table — admin edits payment details here; only one row is_active=true at a time.
CREATE TABLE IF NOT EXISTS bank_config (
  id             serial      PRIMARY KEY,
  bank_name      text        NOT NULL,
  account_number text        NOT NULL,
  account_name   text        NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_select_bank_config'
  ) THEN
    CREATE POLICY "anon_select_bank_config" ON bank_config FOR SELECT TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_bank_config_updated_at' AND event_object_table = 'bank_config'
  ) THEN
    CREATE TRIGGER trg_bank_config_updated_at
      BEFORE UPDATE ON bank_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- 7. Add new columns to orders table.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gjp_order_id        text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type          text        NOT NULL DEFAULT 'STANDARD';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS leads_id            text        REFERENCES leads(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id         text        REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_type       text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_proof_url   text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_by         text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_gjp_order_id_key'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_gjp_order_id_key UNIQUE (gjp_order_id);
  END IF;
END $$;

-- 8. Enable Supabase Realtime for new tables.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'leads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE leads;
  END IF;
END $$;
