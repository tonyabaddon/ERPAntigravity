-- ============================================================================
-- Cetak Sales Order (Penawaran) GJP — schema + seed for improved SO PDF template.
-- Design spec: docs/superpowers/specs/2026-08-04-cetak-sales-order-gjp-design.md
-- Reversibility: tactical / reversible — all columns nullable or defaulted.
-- ============================================================================

-- ---- store_settings: SO defaults + footer contact fields ----
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS telp_kantor                TEXT,
  ADD COLUMN IF NOT EXISTS website_url                TEXT,
  ADD COLUMN IF NOT EXISTS default_so_validity_days   INT     DEFAULT 14 NOT NULL,
  ADD COLUMN IF NOT EXISTS default_payment_terms      TEXT,
  ADD COLUMN IF NOT EXISTS default_lead_time_text     TEXT,
  ADD COLUMN IF NOT EXISTS default_so_notes           TEXT,
  ADD COLUMN IF NOT EXISTS default_opening_greeting   TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_name     TEXT,
  ADD COLUMN IF NOT EXISTS default_signatory_title    TEXT,
  ADD COLUMN IF NOT EXISTS footer_show_telp_kantor    BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_wa             BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_email          BOOLEAN DEFAULT TRUE  NOT NULL,
  ADD COLUMN IF NOT EXISTS footer_show_website        BOOLEAN DEFAULT FALSE NOT NULL;

-- Seed sensible Indonesian defaults for existing tenants where NULL.
UPDATE public.store_settings SET default_payment_terms = '50% DP saat penetapan order, 50% pelunasan sebelum barang diambil'
  WHERE default_payment_terms IS NULL;
UPDATE public.store_settings SET default_lead_time_text = '7–10 hari kerja setelah uang muka diterima'
  WHERE default_lead_time_text IS NULL;
UPDATE public.store_settings SET default_opening_greeting = 'Dengan Hormat, bersama ini kami mengajukan penawaran harga untuk kebutuhan Bapak/Ibu, dengan perincian sebagai berikut:'
  WHERE default_opening_greeting IS NULL;
UPDATE public.store_settings SET default_so_notes = E'Harga belum termasuk PPN 11%\nHarga sudah termasuk perakitan dan pengujian\nPengiriman & instalasi tidak termasuk'
  WHERE default_so_notes IS NULL;

-- ---- customers: salutation + contact person ----
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='customers' AND column_name='salutation'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN salutation TEXT
      CHECK (salutation IN ('Bapak','Ibu') OR salutation IS NULL);
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contact_person_name TEXT;

-- ---- sales_orders: snapshot cols + per-SO overrides ----
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS customer_salutation          TEXT,
  ADD COLUMN IF NOT EXISTS customer_contact_person      TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name              TEXT,
  ADD COLUMN IF NOT EXISTS opening_greeting_override    TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_override       TEXT,
  ADD COLUMN IF NOT EXISTS lead_time_override           TEXT,
  ADD COLUMN IF NOT EXISTS so_notes_override            TEXT,
  ADD COLUMN IF NOT EXISTS valid_until_override         DATE;

COMMENT ON COLUMN public.sales_orders.created_by_name IS
  'Snapshot of admin_users.name at SO creation. Filled client-side (not RPC — avoids miss-log Entry #4 SECDEF owner trap). Preserves historical accuracy if admin_user later renamed.';
