-- Migration: DP payment support
-- Renames payment_proof_url → full_proof_url, adds DP columns, adds 2 NOTIFY triggers.

-- 0. Add new DP status values to the order_status enum
-- NOTE: ALTER TYPE ADD VALUE cannot run inside a transaction block
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'WAITING_DP';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DP_UPLOADED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DP_VERIFIED';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DP_PROOF_REJECTED';

-- 1. Rename existing proof URL column (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'payment_proof_url'
    AND table_schema = 'public'
  ) THEN
    ALTER TABLE orders RENAME COLUMN payment_proof_url TO full_proof_url;
  END IF;
END $$;

-- 2. Add new columns
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_type    text    NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS dp_input_type   text,
  ADD COLUMN IF NOT EXISTS dp_value        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_amount       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_proof_url    text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 3. Constraints
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_payment_type,
  DROP CONSTRAINT IF EXISTS chk_dp_input_type;
ALTER TABLE orders
  ADD CONSTRAINT chk_payment_type CHECK (payment_type IN ('FULL', 'DP')),
  ADD CONSTRAINT chk_dp_input_type CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT', 'PERCENTAGE'));

-- 4. NOTIFY trigger: dp_verified
--    Fires when admin sets status → DP_VERIFIED. Handler sends WA asking for full payment.
CREATE OR REPLACE FUNCTION notify_dp_verified() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'DP_VERIFIED' AND OLD.status IS DISTINCT FROM 'DP_VERIFIED' THEN
    PERFORM pg_notify('dp_verified', json_build_object(
      'order_id',        NEW.id,
      'conversation_id', NEW.conversation_id
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_dp_verified' AND event_object_table = 'orders' AND event_object_schema = 'public'
  ) THEN
    CREATE TRIGGER trg_dp_verified
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_dp_verified();
  END IF;
END $$;

-- 5. NOTIFY trigger: dp_proof_rejected
--    Fires when admin sets status → DP_PROOF_REJECTED. Handler sends WA and resets to WAITING_DP.
CREATE OR REPLACE FUNCTION notify_dp_proof_rejected() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'DP_PROOF_REJECTED' AND OLD.status IS DISTINCT FROM 'DP_PROOF_REJECTED' THEN
    PERFORM pg_notify('dp_proof_rejected', json_build_object(
      'order_id',        NEW.id,
      'conversation_id', NEW.conversation_id,
      'reason',          COALESCE(NEW.rejection_reason, '')
    )::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_dp_proof_rejected' AND event_object_table = 'orders' AND event_object_schema = 'public'
  ) THEN
    CREATE TRIGGER trg_dp_proof_rejected
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_dp_proof_rejected();
  END IF;
END $$;
