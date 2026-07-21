-- P3-04 (2026-07-21): remove WhatsApp test fixture noise per memory
-- `wa_test_data_noise`.
--
-- Scope:
-- wa_recipients: 24 rows on Garindo tenant with name prefix "T20 " and
-- is_active=false (T20 Active Owner / T20 Admin / T20 Inactive Owner
-- test roles). Real Owner "Tony" (is_active=true, phone 6285264787775)
-- preserved.
--
-- conversations: 3 rows on Toko Jaya with test phone pattern
-- +62812-1000-000X. Real Garindo conversations (17 rows, real @lid /
-- @s.whatsapp.net numbers) preserved.
--
-- Cascade dependencies (FKs to conversations): messages, orders, leads,
-- llm_calls. Delete each first before the conversations row.
--
-- Idempotent: DELETE with narrow predicates; re-run is a no-op after
-- the first successful apply.

BEGIN;

-- Cascade: delete FK-referring rows for test conversations
WITH test_conv_ids AS (
  SELECT id FROM conversations
  WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
    AND customer_phone LIKE '+62812-1000-000%'
)
DELETE FROM messages WHERE conversation_id IN (SELECT id FROM test_conv_ids);

WITH test_conv_ids AS (
  SELECT id FROM conversations
  WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
    AND customer_phone LIKE '+62812-1000-000%'
)
DELETE FROM leads WHERE conversation_id IN (SELECT id FROM test_conv_ids);

WITH test_conv_ids AS (
  SELECT id FROM conversations
  WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
    AND customer_phone LIKE '+62812-1000-000%'
)
DELETE FROM llm_calls WHERE conversation_id IN (SELECT id FROM test_conv_ids);

WITH test_conv_ids AS (
  SELECT id FROM conversations
  WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
    AND customer_phone LIKE '+62812-1000-000%'
)
DELETE FROM orders WHERE conversation_id IN (SELECT id FROM test_conv_ids);

-- Finally the test conversations themselves
DELETE FROM conversations
WHERE tenant_id = '22222222-2222-2222-2222-222222222222'
  AND customer_phone LIKE '+62812-1000-000%';

-- Test wa_recipients (T20 test roles, is_active=false)
DELETE FROM wa_recipients
WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
  AND name LIKE 'T20 %'
  AND is_active = false;

COMMIT;
