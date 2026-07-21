-- P3-03 (2026-07-21): document why whatsmeow_* tables have RLS enabled but
-- zero policies. Daemon connects as `postgres` (table owner) which bypasses
-- RLS. Multi-tenant scoping happens in whatsapp/session_manager (Go layer),
-- not via SQL policies.
--
-- Adding COMMENT ON TABLE for the "main" tables so future auditors see the
-- rationale in the Supabase Dashboard schema browser without needing to open
-- the code repo.
--
-- Idempotent: COMMENT ON is safe to re-run; overwrites any prior value.

COMMENT ON TABLE whatsmeow_device IS
  'WhatsApp daemon (whatsmeow) session store. RLS enabled + zero policies is intentional: daemon connects as `postgres` (owner) which bypasses RLS. Multi-tenant isolation happens at the Go layer (whatsapp/session_manager). Do NOT add authenticated/anon policies — they would break WA bot for all tenants.';

COMMENT ON TABLE whatsmeow_sessions IS
  'WhatsApp session keys. See whatsmeow_device for the RLS rationale.';

COMMENT ON TABLE whatsmeow_identity_keys IS
  'WhatsApp identity keys. See whatsmeow_device for the RLS rationale.';

COMMENT ON TABLE whatsmeow_pre_keys IS
  'WhatsApp pre-keys. See whatsmeow_device for the RLS rationale.';

COMMENT ON TABLE whatsmeow_contacts IS
  'WhatsApp contact cache. See whatsmeow_device for the RLS rationale.';

COMMENT ON TABLE whatsmeow_message_secrets IS
  'WhatsApp message secrets (E2E). See whatsmeow_device for the RLS rationale.';
