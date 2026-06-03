-- supabase/migrations/20260603000003_admin_users.sql
-- Admin users table for UserManagementScreen.
-- Replaces localStorage-based admin storage.

CREATE TABLE IF NOT EXISTS admin_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  whatsapp    text,
  role        text NOT NULL DEFAULT 'Staff Admin Toko',
  permissions jsonb NOT NULL DEFAULT '{"dashboard":true,"sales":false,"stokAi":false,"konfig":false}',
  status      text NOT NULL DEFAULT 'Aktif',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'admin_users' AND policyname = 'anon full access admin_users'
  ) THEN
    CREATE POLICY "anon full access admin_users"
      ON admin_users FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO anon;
