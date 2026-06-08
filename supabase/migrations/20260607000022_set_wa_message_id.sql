-- Phase 2 / Task 16 — _set_wa_message_id helper for approval_requests.
--
-- The Go approval sender (Task 17) needs to record the WhatsApp message id
-- on an approval_requests row AFTER Calista posts the approval card to the
-- Owner's JID. Two reasons we encapsulate this in a SECURITY DEFINER RPC
-- rather than a direct UPDATE under service_role:
--
--   1. Consistency with the rest of Phase 2. Every approval_requests
--      mutation flows through a postgres-owned function (T1's
--      _transition_approval, T4's commit_approved_adjustment, etc.). Keeping
--      the wa_message_id write in the same pattern means the
--      "approval_requests is mutated ONLY via SECURITY DEFINER RPCs"
--      invariant from …007 stays intact: a new auditor doesn't have to
--      remember that wa_message_id is the one column we set with a raw
--      UPDATE.
--
--   2. REVOKE UPDATE on approval_requests is in place at the column level
--      against PUBLIC/anon/authenticated (…007). service_role bypasses the
--      REVOKE, but the trg_deny_ar_update trigger remains DISABLED at the
--      table level — so a service_role UPDATE would technically succeed.
--      We still prefer the RPC path because if T1's trigger is ever
--      re-enabled in an incident, service_role UPDATEs would start raising
--      "append-only"; a SECURITY DEFINER RPC owned by postgres remains
--      immune to the trigger (per postgres SECURITY DEFINER semantics
--      combined with the trigger being explicitly disabled at table level).
--
-- The WHERE wa_message_id IS NULL guard makes the helper idempotent: the
-- first successful Calista post records the message id; any subsequent call
-- (e.g. retry after a transient WhatsApp send error that actually delivered)
-- is a no-op. Returning VOID with no NOT FOUND check is deliberate — we do
-- NOT raise on "already set" or "row gone", because both are legitimate
-- races the sender shouldn't have to reason about.
--
-- Grants: REVOKE EXECUTE from PUBLIC/anon/authenticated. service_role keeps
-- EXECUTE by ownership (postgres owns it, service_role can call any owner
-- function unless explicitly REVOKED at server level). The Go backend
-- invokes this RPC via the SUPABASE_DB_CONNECTION which authenticates as
-- service_role, matching the pattern for every other approvals helper.

CREATE OR REPLACE FUNCTION public._set_wa_message_id(
    p_id BIGINT,
    p_wa_message_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.approval_requests
       SET wa_message_id = p_wa_message_id
     WHERE id = p_id
       AND wa_message_id IS NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public._set_wa_message_id(BIGINT, TEXT)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._set_wa_message_id(BIGINT, TEXT)
    FROM anon;
REVOKE EXECUTE ON FUNCTION public._set_wa_message_id(BIGINT, TEXT)
    FROM authenticated;
