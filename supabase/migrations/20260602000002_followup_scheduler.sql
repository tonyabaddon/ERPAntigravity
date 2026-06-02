-- supabase/migrations/20260602000002_followup_scheduler.sql

-- 1. Add follow-up tracking columns to conversations.
--    last_ai_message_at  — maintained by trigger below; never written directly by Go.
--    followup_count_today — how many follow-ups sent on last_followup_date (WIB).
--    last_followup_date  — WIB date of last follow-up; NULL means never sent.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_ai_message_at   timestamptz,
  ADD COLUMN IF NOT EXISTS followup_count_today  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_followup_date    date;

-- 2. Trigger function: update last_ai_message_at on every AI message insert.
--    Covers all existing and future InsertMessage(SenderAI) calls automatically.
CREATE OR REPLACE FUNCTION update_last_ai_message_at() RETURNS trigger AS $$
BEGIN
  IF NEW.sender = 'ai' THEN
    UPDATE conversations
    SET last_ai_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_update_last_ai_message_at'
      AND event_object_table = 'messages'
  ) THEN
    CREATE TRIGGER trg_update_last_ai_message_at
      AFTER INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION update_last_ai_message_at();
  END IF;
END $$;
