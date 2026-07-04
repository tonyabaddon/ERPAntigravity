-- supabase/tests/pgtap/phase_a_sync_trigger.sql
BEGIN;
SELECT plan(3);

-- Setup: fresh test tenant + subscription
INSERT INTO tenants (id, slug, name) VALUES ('cccc0000-0000-0000-0000-000000000001', 'test-sync', 'Sync Test');
INSERT INTO tenant_subscriptions (tenant_id, plan_code, activated_at, expires_at)
VALUES ('cccc0000-0000-0000-0000-000000000001', 'STARTER', '2026-01-01', '2099-12-31');

-- Verify tenant_settings synced from STARTER bundle
SELECT is(
  (SELECT modul_kasir FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  true, 'STARTER: modul_kasir = true');
SELECT is(
  (SELECT modul_tempo FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  false, 'STARTER: modul_tempo = false');

-- Change to PREMIUM → re-sync
UPDATE tenant_subscriptions SET plan_code='PREMIUM' WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid;
SELECT is(
  (SELECT modul_multi_warehouse FROM tenant_settings WHERE tenant_id='cccc0000-0000-0000-0000-000000000001'::uuid),
  true, 'PREMIUM upgrade: modul_multi_warehouse = true');

SELECT finish();
ROLLBACK;
