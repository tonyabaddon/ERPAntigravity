-- supabase/migrations/20260602000004_notification_config.sql
-- Single-row notification config table readable by Go heartbeat poller.

CREATE TABLE IF NOT EXISTS notification_config (
  id              serial      PRIMARY KEY,
  enabled         boolean     NOT NULL DEFAULT false,
  interval_label  text        NOT NULL DEFAULT 'Setiap 4 Jam',
  report_revenue  boolean     NOT NULL DEFAULT true,
  report_queue    boolean     NOT NULL DEFAULT true,
  report_activity boolean     NOT NULL DEFAULT true,
  report_status   boolean     NOT NULL DEFAULT true,
  low_stock_alert int         NOT NULL DEFAULT 5,
  delay_alert     int         NOT NULL DEFAULT 30,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_select_notification_config'
  ) THEN
    CREATE POLICY "anon_select_notification_config" ON notification_config FOR SELECT TO anon USING (true);
  END IF;
END $$;

GRANT INSERT, UPDATE ON notification_config TO anon;
GRANT USAGE ON SEQUENCE notification_config_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_insert_notification_config'
  ) THEN
    CREATE POLICY "anon_insert_notification_config" ON notification_config FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_update_notification_config'
  ) THEN
    CREATE POLICY "anon_update_notification_config" ON notification_config FOR UPDATE TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_notification_config_updated_at' AND event_object_table = 'notification_config'
  ) THEN
    CREATE TRIGGER trg_notification_config_updated_at
      BEFORE UPDATE ON notification_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
