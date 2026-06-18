-- Phase 1B PR A — Pengaturan (Settings) tables.
-- Three small tables that power the Pengaturan UI + PDF generator + WA
-- signature blocks. All three follow the same RLS pattern:
--   * authenticated SELECT to anyone (read-only public store info)
--   * Owner-only writes (UPDATE for the two singleton tables, ALL for
--     store_bank_accounts which needs INSERT/DELETE for adding new accounts)

-- store_settings: single-row identitas toko
CREATE TABLE IF NOT EXISTS store_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nama_toko text NOT NULL DEFAULT 'Sinar Elektrik',
  nama_legal text NULL,
  tagline text NULL,
  alamat_lengkap text NOT NULL DEFAULT '',
  kota text NOT NULL DEFAULT '',
  telp_wa text NOT NULL DEFAULT '',
  logo_url text NULL,
  google_maps_url text NULL,
  npwp text NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by uuid NULL REFERENCES auth.users(id)
);

INSERT INTO store_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS operating_hours (
  day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
  is_open boolean NOT NULL DEFAULT true,
  open_time time NULL,
  close_time time NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

INSERT INTO operating_hours(day_of_week, is_open, open_time, close_time) VALUES
  (0, true, '08:00', '17:00'), (1, true, '08:00', '17:00'),
  (2, true, '08:00', '17:00'), (3, true, '08:00', '17:00'),
  (4, true, '08:00', '17:00'), (5, true, '08:00', '15:00'),
  (6, false, NULL, NULL)
ON CONFLICT (day_of_week) DO NOTHING;

CREATE TABLE IF NOT EXISTS store_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name text NOT NULL,
  account_number text NOT NULL,
  account_holder text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_bank_accounts_active_order ON store_bank_accounts(is_active, sort_order);

ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read store_settings" ON store_settings;
CREATE POLICY "Authenticated read store_settings" ON store_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner write store_settings" ON store_settings;
CREATE POLICY "Owner write store_settings" ON store_settings FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

DROP POLICY IF EXISTS "Authenticated read operating_hours" ON operating_hours;
CREATE POLICY "Authenticated read operating_hours" ON operating_hours FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner write operating_hours" ON operating_hours;
CREATE POLICY "Owner write operating_hours" ON operating_hours FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

DROP POLICY IF EXISTS "Authenticated read store_bank_accounts" ON store_bank_accounts;
CREATE POLICY "Authenticated read store_bank_accounts" ON store_bank_accounts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Owner all store_bank_accounts" ON store_bank_accounts;
CREATE POLICY "Owner all store_bank_accounts" ON store_bank_accounts FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid() AND role = 'Owner')
);

COMMENT ON TABLE store_settings IS 'Single-row store identity used by all PDFs + WA signature';
COMMENT ON TABLE operating_hours IS '7-day open/close grid; 0=Senin per Indonesian convention';
COMMENT ON TABLE store_bank_accounts IS 'Bank accounts rendered in invoices for customer transfers';
