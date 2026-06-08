-- Phase 2 / Task 13 — verify_owner_pin RPC (bcrypt + per-Owner lockout).
--
-- The Owner approves a pending approval_requests row by entering their PIN
-- from the in-app Approval Modal. This SECURITY DEFINER RPC is the SQL hop
-- behind that flow:
--
--   1. SELECT … FOR UPDATE the ONE Owner row (admin_users WHERE role='Owner'
--      ORDER BY id LIMIT 1). Per Foundational Decision #6 the lockout counter
--      and lock window live on this single row — even multi-staff PIN fumbles
--      against the same Owner cumulatively increment the counter.
--   2. If pin_locked_until > now() the call RAISES 'Owner PIN is locked …'.
--      Even a CORRECT PIN cannot bypass the lockout — only time can unlock.
--   3. If approval_pin_hash IS NULL the call RAISES 'Owner PIN not configured'.
--   4. Lock the target approval_requests row FOR UPDATE; refuse if not pending.
--   5. bcrypt-compare crypt(p_pin, hash) = hash.
--        Match: reset counter+lock, call _transition_approval(.., 'approved',
--               owner_id, 'owner_pin'), RETURN TRUE.
--        No match: increment pin_failed_count by 1; if the new count >= 5,
--                  set pin_locked_until = now() + 1 hour; RETURN FALSE
--                  (no raise — the UI distinguishes "wrong PIN" from "locked"
--                  by the FALSE return vs. the locked exception above).
--
-- Owned by postgres; SECURITY DEFINER so RLS/REVOKE on admin_users +
-- approval_requests cannot block the canonical decision path. search_path
-- pinned to public to defeat shadowing attacks. GRANT EXECUTE to authenticated
-- so SDK callers from the in-app modal can invoke it.

CREATE OR REPLACE FUNCTION public.verify_owner_pin(
  p_approval_id BIGINT,
  p_pin         TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
-- pgcrypto lives in the `extensions` schema on Supabase; include it on the
-- search_path so unqualified crypt() / gen_salt() calls resolve inside this
-- SECURITY DEFINER body. public is first so app objects shadow any extension
-- name collisions.
SET search_path = public, extensions
AS $$
DECLARE
  v_owner RECORD;
  v_ar    RECORD;
BEGIN
  -- Per-Owner lockout: the counter and lock live on the Owner's admin_users row.
  -- ORDER BY id LIMIT 1 picks a single deterministic Owner for MSME deployments
  -- with one Owner; multi-Owner orgs still funnel all attempts through this row
  -- (the lockout becomes org-wide rather than per-Owner — accepted trade-off
  -- per the spec).
  SELECT id, approval_pin_hash, pin_failed_count, pin_locked_until
    INTO v_owner
    FROM public.admin_users
   WHERE role = 'Owner'
   ORDER BY id
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no Owner user configured';
  END IF;

  IF v_owner.pin_locked_until IS NOT NULL AND v_owner.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Owner PIN is locked until %', v_owner.pin_locked_until;
  END IF;

  IF v_owner.approval_pin_hash IS NULL THEN
    RAISE EXCEPTION 'Owner PIN not configured';
  END IF;

  SELECT id, status INTO v_ar
    FROM public.approval_requests
   WHERE id = p_approval_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_request % not found', p_approval_id;
  END IF;
  IF v_ar.status <> 'pending' THEN
    RAISE EXCEPTION 'approval_request % is not pending', p_approval_id;
  END IF;

  -- bcrypt compare: re-crypt the supplied PIN with the stored hash's salt and
  -- compare. Constant-time semantics are provided by pgcrypto's crypt().
  IF crypt(p_pin, v_owner.approval_pin_hash) = v_owner.approval_pin_hash THEN
    -- Reset the failure counter + clear any lock that may have been set
    -- previously (e.g. on a stale window that has since elapsed but was not
    -- yet cleared).
    UPDATE public.admin_users
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = v_owner.id;
    -- Flip the approval gate via the sole sanctioned helper.
    PERFORM public._transition_approval(
      p_approval_id,
      'approved'::public.approval_status,
      v_owner.id,
      'owner_pin'
    );
    RETURN TRUE;
  ELSE
    -- Bump the failure counter; arm the lockout once the *post-increment*
    -- count reaches 5. Leaves an existing pin_locked_until intact (the early
    -- guard above already rejected calls while locked, so this branch only
    -- runs when the lock has elapsed or never existed).
    UPDATE public.admin_users
       SET pin_failed_count = pin_failed_count + 1,
           pin_locked_until = CASE
             WHEN pin_failed_count + 1 >= 5 THEN now() + INTERVAL '1 hour'
             ELSE pin_locked_until
           END
     WHERE id = v_owner.id;
    RETURN FALSE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.verify_owner_pin(BIGINT, TEXT) TO authenticated;
