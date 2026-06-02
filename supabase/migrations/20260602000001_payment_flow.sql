-- supabase/migrations/20260602000001_payment_flow.sql

-- 1. Add PAYMENT_REJECTED order status.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';

-- 2. wa_recipients table — stores admin and owner WA numbers for notifications.
CREATE TABLE IF NOT EXISTS wa_recipients (
  id         serial      PRIMARY KEY,
  role       text        NOT NULL,   -- 'admin' or 'owner'
  name       text        NOT NULL DEFAULT '',
  wa_number  text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wa_recipients ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'wa_recipients' AND policyname = 'anon_select_wa_recipients'
  ) THEN
    CREATE POLICY "anon_select_wa_recipients" ON wa_recipients FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- 3. NOTIFY trigger for payment_verified.
--    Fires when an admin sets order status to PAYMENT_VERIFIED in the dashboard.
CREATE OR REPLACE FUNCTION notify_payment_verified() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_VERIFIED' AND OLD.status IS DISTINCT FROM 'PAYMENT_VERIFIED' THEN
    PERFORM pg_notify('payment_verified', json_build_object(
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
    WHERE trigger_name = 'trg_payment_verified' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_verified
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_verified();
  END IF;
END $$;

-- 4. NOTIFY trigger for payment_rejected.
--    Fires when an admin sets order status to PAYMENT_REJECTED in the dashboard.
CREATE OR REPLACE FUNCTION notify_payment_rejected() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PAYMENT_REJECTED' AND OLD.status IS DISTINCT FROM 'PAYMENT_REJECTED' THEN
    PERFORM pg_notify('payment_rejected', json_build_object(
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
    WHERE trigger_name = 'trg_payment_rejected' AND event_object_table = 'orders'
  ) THEN
    CREATE TRIGGER trg_payment_rejected
      AFTER UPDATE ON orders
      FOR EACH ROW EXECUTE FUNCTION notify_payment_rejected();
  END IF;
END $$;
