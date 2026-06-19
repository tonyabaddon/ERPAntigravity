-- Fix verify_owner_pin: bind to caller (auth.uid) + active Owner only.
--
-- Pre-fix bug (20260607000019): the RPC picked the Owner row by
-- "WHERE role='Owner' ORDER BY id LIMIT 1" with no caller validation
-- and no status filter. Two concrete defects in production:
--
--   1. Multiple Owners exist (4 rows: 2 Aktif, 2 Tidak Aktif). LIMIT 1
--      resolved to T11 Owner — a Tidak Aktif / deactivated test account.
--      Anyone who learned its PIN could still approve, and the lockout
--      counter on that row was the only one ever incremented.
--   2. Audit attribution (the actor_id passed into _transition_approval)
--      went to whichever Owner LIMIT 1 picked, not the staff member who
--      actually entered the PIN. Two Owners sharing a PIN, or the modal
--      driven from a different authenticated session, would attribute the
--      approval to the wrong row.
--
-- Fix: bind to auth.uid(). The caller's auth user must map to an Aktif
-- Owner row in admin_users with a configured PIN. The mapping is by email
-- (lower-case match) because admin_users.id is NOT the auth uid in all
-- cases — historically Tony's row was provisioned to match his auth uid
-- but Jenny's was not, so id-based lookup would lock Jenny out. Email is
-- the only invariant across both Owners.
--
-- Lockout counter now lives on the caller's own admin_users row, which is
-- the right per-Owner isolation: brute-force attempts on one Owner can no
-- longer arm a lockout for the other.

CREATE OR REPLACE FUNCTION public.verify_owner_pin(
  p_approval_id BIGINT,
  p_pin         TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller       UUID;
  v_caller_email TEXT;
  v_owner        RECORD;
  v_owner_count  INT;
  v_ar           RECORD;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'OWNER_ONLY: no authenticated user';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller has no auth email';
  END IF;

  -- Map the auth user to their admin_users Owner row via email. Defensive
  -- multiplicity check: there must be exactly one Aktif Owner row for the
  -- caller's email — duplicate rows would make the picked row arbitrary.
  SELECT COUNT(*) INTO v_owner_count
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif';
  IF v_owner_count = 0 THEN
    RAISE EXCEPTION 'OWNER_ONLY: caller is not an active Owner';
  ELSIF v_owner_count > 1 THEN
    RAISE EXCEPTION 'OWNER_AMBIGUOUS: % active Owner rows match caller email', v_owner_count;
  END IF;

  SELECT id, approval_pin_hash, pin_failed_count, pin_locked_until
    INTO v_owner
    FROM public.admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role = 'Owner'
     AND status = 'Aktif'
   FOR UPDATE;

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

  IF crypt(p_pin, v_owner.approval_pin_hash) = v_owner.approval_pin_hash THEN
    UPDATE public.admin_users
       SET pin_failed_count = 0,
           pin_locked_until = NULL
     WHERE id = v_owner.id;
    PERFORM public._transition_approval(
      p_approval_id,
      'approved'::public.approval_status,
      v_owner.id,
      'owner_pin'
    );
    RETURN TRUE;
  ELSE
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
