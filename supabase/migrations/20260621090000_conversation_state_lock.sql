-- Pipeline Revamp Phase 3 — Manual state override + AI pause + auto-resume.
-- Spec: docs/superpowers/specs/2026-06-21-pipeline-revamp-design.md
-- Plan: docs/superpowers/plans/2026-06-21-pipeline-revamp.md
--
-- Schema notes (verified 2026-06-21 via MCP):
--   admin_users(id UUID PK, email TEXT, role TEXT, status TEXT, name TEXT, ...)
--   Roles: 'Owner', 'Staff Admin Toko' (no 'kasir' role exists)
--   Status: 'Aktif', 'Tidak Aktif'
--   Caller resolved via auth.uid() -> auth.users.email -> admin_users.email
--   (lower-case match; pattern from migration 20260626000010).

BEGIN;

-- ─── Schema delta ───────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS state_locked_until       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS state_locked_by_admin_id UUID        NULL REFERENCES admin_users(id);

CREATE INDEX IF NOT EXISTS idx_conversations_state_lock
  ON conversations(state_locked_until)
  WHERE state_locked_until IS NOT NULL;

-- ─── Override RPC ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION manually_override_conversation_state(
  p_conv_id       UUID,
  p_new_state     conversation_state,
  p_lock_minutes  INT DEFAULT 15
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller       UUID;
  v_caller_email TEXT;
  v_admin_id     UUID;
  v_admin_name   TEXT;
  v_admin_count  INT;
  v_old_state    conversation_state;
BEGIN
  -- Role gate via email lookup (admin_users.id != auth.uid in all cases).
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authorized: no authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  IF v_caller_email IS NULL OR v_caller_email = '' THEN
    RAISE EXCEPTION 'not authorized: caller has no email'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_admin_count
    FROM admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role IN ('Owner', 'Staff Admin Toko')
     AND status = 'Aktif';

  IF v_admin_count = 0 THEN
    RAISE EXCEPTION 'not authorized: hanya Owner / Staff Admin Toko aktif yang boleh override state'
      USING ERRCODE = '42501';
  ELSIF v_admin_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_ADMIN: % active admin rows match caller email', v_admin_count
      USING ERRCODE = '42501';
  END IF;

  SELECT id, name INTO v_admin_id, v_admin_name
    FROM admin_users
   WHERE lower(email) = lower(v_caller_email)
     AND role IN ('Owner', 'Staff Admin Toko')
     AND status = 'Aktif';

  -- Terminal-state guards.
  IF p_new_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'tidak bisa override ke status terminal: %', p_new_state
      USING ERRCODE = '22023';
  END IF;

  SELECT state INTO v_old_state FROM conversations WHERE id = p_conv_id FOR UPDATE;
  IF v_old_state IS NULL THEN
    RAISE EXCEPTION 'conversation % tidak ditemukan', p_conv_id
      USING ERRCODE = '22023';
  END IF;
  IF v_old_state IN ('COMPLETED','CANCELLED') THEN
    RAISE EXCEPTION 'tidak bisa override conversation yang sudah %', v_old_state
      USING ERRCODE = '22023';
  END IF;

  -- Mutate: set state, pause AI, set lock window.
  UPDATE conversations SET
    state                    = p_new_state,
    ai_active                = false,
    state_locked_until       = NOW() + (p_lock_minutes || ' minutes')::INTERVAL,
    state_locked_by_admin_id = v_admin_id,
    updated_at               = NOW()
  WHERE id = p_conv_id;

  -- Audit (system message in chat).
  INSERT INTO messages (conversation_id, sender, text, created_at)
  VALUES (
    p_conv_id,
    'system',
    format(
      '%s mengubah status ke %s, AI di-pause %s menit, pada %s WIB',
      v_admin_name,
      p_new_state,
      p_lock_minutes,
      to_char(NOW() AT TIME ZONE 'Asia/Jakarta', 'HH24:MI')
    ),
    NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION manually_override_conversation_state(UUID, conversation_state, INT) TO authenticated;

-- ─── Auto-resume RPC ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auto_resume_expired_locks()
RETURNS INT
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH resumed AS (
    UPDATE conversations
    SET
      ai_active                = true,
      state_locked_until       = NULL,
      state_locked_by_admin_id = NULL,
      updated_at               = NOW()
    WHERE state_locked_until IS NOT NULL
      AND state_locked_until < NOW()
    RETURNING id
  )
  SELECT count(*)::INT INTO v_count FROM resumed;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION auto_resume_expired_locks() FROM PUBLIC;

-- ─── pg_cron schedule ───────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: remove prior job if exists, then re-schedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto_resume_locked_conversations') THEN
    PERFORM cron.unschedule('auto_resume_locked_conversations');
  END IF;
END $$;

SELECT cron.schedule(
  'auto_resume_locked_conversations',
  '* * * * *',
  $cron$ SELECT public.auto_resume_expired_locks(); $cron$
);

COMMIT;
