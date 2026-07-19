-- Sprint 2 (2026-07-19): Task 2.2 — per-customer opt-out flag for Piutang WA reminder
-- Allows owner to toggle WA reminders per customer via Pelanggan detail form
-- Default TRUE means opt-in (reminders enabled)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS wa_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.customers.wa_reminder_enabled IS
  'Sprint 2 (2026-07-19): per-customer opt-out for Piutang WA reminder. Default TRUE (opt-in). Owner toggles via Pelanggan detail form.';
