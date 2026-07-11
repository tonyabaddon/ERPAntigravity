-- 20261115000055_opname_abandoned_state_and_cancel_rpc.sql
--
-- Session 5 QA finding F-16 (P2): stock_opname_sessions accumulates
-- "Berlangsung" sessions that never complete. garindo alone has 140+
-- in_progress rows dating back to 2026-06-07 (some > 5 weeks old). The
-- UI list grows unbounded and there is no mechanism for the owner to
-- clear an idle session or for the system to auto-abandon it.
--
-- Fix
-- ===
-- 1. Extend the `opname_status` enum with `abandoned`. Placed at end of
--    the enum for backward compatibility; existing checks that reference
--    only in_progress/pending_owner/committed/rejected keep working
--    (no CHECK constraints to update — the enum type itself is the gate).
-- 2. New RPC `public.cancel_opname_session(p_session_id bigint)`:
--    * SECDEF (owned by postgres so it can access auth schema through
--      the JWT helper).
--    * Owner-only. Auth check via `admin_users.role = 'Owner'`. Matches
--      the pattern used by other opname RPCs.
--    * Only transitions `in_progress` → `abandoned`. Any other state is
--      rejected with a clear error, so an owner cannot accidentally
--      cancel a session that's already in review or committed.
-- 3. Backfill: mark every currently-in_progress session started > 30
--    days ago as `abandoned`. That's the historical staleness threshold
--    the finding was really flagging; anything more recent stays visible
--    until the owner explicitly cancels it or it progresses.
--
-- Frontend (companion commit) adds:
--   - `abandoned` to the OpnameSession status type + status label / pill.
--   - "Batalkan" button on in_progress rows (owner only) wired to this
--     RPC with a confirm dialog.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Extend enum. `ADD VALUE IF NOT EXISTS` is idempotent, and the new
--    label is added at the end so existing enum orderings stay stable.
-- ---------------------------------------------------------------------------

ALTER TYPE public.opname_status ADD VALUE IF NOT EXISTS 'abandoned';

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- 2) cancel_opname_session RPC
--    Owner-only. Only transitions in_progress → abandoned. Idempotent-ish:
--    calling on an already-abandoned session raises a clear error rather
--    than silently succeeding, so a stale UI can't double-cancel.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_opname_session(p_session_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := public._current_user_id();
  v_session   public.stock_opname_sessions%ROWTYPE;
  v_is_owner  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING errcode = 'P0403';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.admin_users
     WHERE id = v_uid AND role = 'Owner' AND status = 'Aktif'
  ) INTO v_is_owner;
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'NOT_OWNER: hanya Owner yang bisa membatalkan sesi opname'
      USING errcode = 'P0403';
  END IF;

  SELECT * INTO v_session
  FROM public.stock_opname_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OPNAME_SESSION_NOT_FOUND';
  END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'INVALID_STATE: hanya sesi yang masih Berlangsung yang bisa dibatalkan (status=%)', v_session.status
      USING errcode = '22023';
  END IF;

  UPDATE public.stock_opname_sessions
     SET status = 'abandoned'
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok',         true,
    'session_id', p_session_id,
    'status',     'abandoned'
  );
END $$;

REVOKE ALL ON FUNCTION public.cancel_opname_session(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_opname_session(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Backfill stale sessions.
--    30-day threshold matches the finding's original description; anything
--    more recent is intentionally left alone so a mid-count owner isn't
--    surprised by an auto-cancel.
-- ---------------------------------------------------------------------------

DO $backfill$
DECLARE
  n_updated integer;
BEGIN
  UPDATE public.stock_opname_sessions
     SET status = 'abandoned'
   WHERE status = 'in_progress'
     AND started_at < now() - interval '30 days';
  GET DIAGNOSTICS n_updated = ROW_COUNT;
  RAISE NOTICE 'F-16 backfill: marked % stale opname sessions as abandoned', n_updated;
END $backfill$;

COMMIT;
