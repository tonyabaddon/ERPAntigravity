-- supabase/migrations/20260602000003_admin_write_grants.sql
-- Grant anon write access to bank_config, wa_recipients, whatsapp_numbers
-- so the admin dashboard can manage these tables without the service role key.

-- bank_config: anon may INSERT (first-time setup) and UPDATE (editing the active row)
GRANT INSERT, UPDATE ON bank_config TO anon;
GRANT USAGE ON SEQUENCE bank_config_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_insert_bank_config'
  ) THEN
    CREATE POLICY "anon_insert_bank_config" ON bank_config FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_update_bank_config'
  ) THEN
    CREATE POLICY "anon_update_bank_config" ON bank_config FOR UPDATE TO anon USING (true);
  END IF;
END $$;

-- wa_recipients: anon may INSERT (add recipient), UPDATE (toggle is_active), DELETE (remove)
GRANT INSERT, UPDATE, DELETE ON wa_recipients TO anon;
GRANT USAGE ON SEQUENCE wa_recipients_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_insert_wa_recipients'
  ) THEN
    CREATE POLICY "anon_insert_wa_recipients" ON wa_recipients FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_update_wa_recipients'
  ) THEN
    CREATE POLICY "anon_update_wa_recipients" ON wa_recipients FOR UPDATE TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_delete_wa_recipients'
  ) THEN
    CREATE POLICY "anon_delete_wa_recipients" ON wa_recipients FOR DELETE TO anon USING (true);
  END IF;
END $$;

-- whatsapp_numbers: anon may update is_enabled and is_ai_enabled columns only
GRANT UPDATE (is_enabled, is_ai_enabled) ON whatsapp_numbers TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_numbers' AND policyname = 'anon_update_wa_numbers_toggles'
  ) THEN
    CREATE POLICY "anon_update_wa_numbers_toggles" ON whatsapp_numbers FOR UPDATE TO anon USING (true);
  END IF;
END $$;
