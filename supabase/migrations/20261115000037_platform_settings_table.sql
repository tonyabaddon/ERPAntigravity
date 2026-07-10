-- supabase/migrations/20261115000037_platform_settings_table.sql
-- Wave 6 Task 8: platform_settings singleton table
-- Singleton (id=1 CHECK) for VOSI platform-level bank + WhatsApp info.
-- RLS: super_admin can UPDATE; both authenticated + vosi_rpc_owner can SELECT.
-- Direct table read/write (no RPC needed); RLS enforces the super_admin write gate.
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                 INTEGER      PRIMARY KEY DEFAULT 1,
  bank_name          TEXT,
  bank_account_no    TEXT,
  bank_account_name  TEXT,
  admin_wa_number    TEXT,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by         UUID         REFERENCES auth.users(id),
  CONSTRAINT platform_settings_singleton CHECK (id = 1)
);

COMMENT ON TABLE public.platform_settings IS
  'Singleton row (id=1) storing VOSI platform-level bank + WhatsApp payment info '
  'displayed to customers after tenant onboarding.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — ensure the singleton row always exists
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.platform_settings (id)
VALUES (1)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users + service role (vosi_rpc_owner) can read.
-- sales_rep needs to read bank info for wizard result screen.
CREATE POLICY "platform_settings_select"
  ON public.platform_settings
  FOR SELECT
  TO authenticated, vosi_rpc_owner
  USING (true);

-- UPDATE: super_admin only.
-- _is_super_admin_from_jwt() is a SECURITY DEFINER helper (migration 000032).
CREATE POLICY "platform_settings_update"
  ON public.platform_settings
  FOR UPDATE
  TO authenticated, vosi_rpc_owner
  USING (public._is_super_admin_from_jwt())
  WITH CHECK (public._is_super_admin_from_jwt());

COMMIT;
