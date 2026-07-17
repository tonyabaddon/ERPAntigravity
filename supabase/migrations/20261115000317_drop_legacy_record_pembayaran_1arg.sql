-- Migration 317: DROP legacy record_pembayaran(jsonb) 1-arg overload
--
-- Background:
--   Slot 315 added record_pembayaran(jsonb, uuid DEFAULT NULL) with idempotency
--   and SET search_path=public. The original 1-arg overload (slot 20260620000006)
--   has mutable search_path — a pre-existing advisor WARN.
--   All FE callers were migrated to the 2-arg signature in Sub 8/9.
--
-- Caller analysis (pre-flight, 2026-07-17):
--   - src/lib/pembayaranService.ts: calls 2-arg (payload, p_idempotency_key) ✓
--   - record_pi(jsonb) SQL function: calls PERFORM public.record_pembayaran(<jsonb>)
--     with 1 argument. This is NOT a blocker — once the 1-arg overload is removed,
--     PostgreSQL overload resolution routes the 1-arg call to the 2-arg function
--     because p_idempotency_key has DEFAULT NULL (pronargdefaults=1 confirmed).
--     The call is semantically equivalent: p_idempotency_key=NULL bypasses the
--     idempotency short-circuit in the 2-arg function body (idempotency is only
--     active when a non-NULL key is passed).
--
-- Effect of dropping 1-arg:
--   - Eliminates the mutable-search-path advisor WARN.
--   - record_pi continues to work unchanged (1-arg call → 2-arg with NULL default).
--   - FE callers (all 2-arg) unaffected.
--
-- Rollback:
--   Re-create the 1-arg function body from slot 20260620000006. The 2-arg overload
--   is unaffected by this drop and remains authoritative.
--
-- Idempotent: DROP FUNCTION IF EXISTS.

BEGIN;

DROP FUNCTION IF EXISTS public.record_pembayaran(jsonb);

COMMIT;
