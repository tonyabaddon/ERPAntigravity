-- Owner self-service PIN management RPC.
--
-- Currently the only way to set/change approval_pin_hash is via raw SQL.
-- This RPC lets an Owner change their own PIN through the Pengaturan UI:
--
--   - Uses auth.uid() (not a parameter) so caller cannot impersonate.
--   - First-time set (existing hash is NULL): p_old_pin can be empty/NULL.
--   - Subsequent change: verify p_old_pin against stored bcrypt hash.
--   - New PIN must be ≥ 4 digits, numeric only.
--   - Role must be 'Owner' AND status 'Aktif' (deactivated owners cannot
--     change PIN — closes the loophole found during owner-approve smoke
--     where deactivated test accounts still satisfied verify_owner_pin).
--   - Resets pin_failed_count + pin_locked_until on successful change
--     (own a fresh PIN, lockout cleared).
--
-- Forgot-PIN reset for another Owner (e.g. founder resets cashier-Owner
-- PIN after they forget): NOT covered here — that's a separate spec (needs
-- audit log + 2-Owner approval). For now, lost PIN = SQL editor intervention
-- or backup Owner with PIN does the recovery.

CREATE OR REPLACE FUNCTION public.change_owner_pin(
  p_old_pin TEXT,
  p_new_pin TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_id UUID;
  v_user      RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Tidak ada user login';
  END IF;

  IF p_new_pin IS NULL OR length(p_new_pin) < 4 OR p_new_pin !~ '^\d+$' THEN
    RAISE EXCEPTION 'PIN baru harus minimal 4 digit angka';
  END IF;

  SELECT id, role, status, approval_pin_hash INTO v_user
    FROM admin_users WHERE id = v_caller_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User tidak ditemukan di admin_users';
  END IF;
  IF v_user.role <> 'Owner' THEN
    RAISE EXCEPTION 'Hanya Owner yang bisa set PIN';
  END IF;
  IF v_user.status <> 'Aktif' THEN
    RAISE EXCEPTION 'User tidak aktif';
  END IF;

  -- If PIN already set, verify old PIN before allowing change.
  IF v_user.approval_pin_hash IS NOT NULL THEN
    IF p_old_pin IS NULL OR p_old_pin = ''
       OR crypt(p_old_pin, v_user.approval_pin_hash) <> v_user.approval_pin_hash THEN
      RAISE EXCEPTION 'PIN lama salah';
    END IF;
  END IF;

  UPDATE admin_users
     SET approval_pin_hash = crypt(p_new_pin, gen_salt('bf')),
         pin_failed_count  = 0,
         pin_locked_until  = NULL
   WHERE id = v_caller_id;
END $$;

GRANT EXECUTE ON FUNCTION public.change_owner_pin(TEXT, TEXT) TO authenticated;


-- Helper RPC for the Pengaturan UI to know whether the current user has a
-- PIN set (so it can show "Set PIN" vs "Ubah PIN" + hide/show old-PIN field).
-- Returns false also when caller is not an active Owner — UI gates the
-- section behind currentUser.role === 'Owner' anyway, so this is defensive.

CREATE OR REPLACE FUNCTION public.current_owner_has_pin()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_has_pin   BOOLEAN;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT approval_pin_hash IS NOT NULL INTO v_has_pin
    FROM admin_users
   WHERE id = v_caller_id AND role = 'Owner' AND status = 'Aktif';
  RETURN COALESCE(v_has_pin, FALSE);
END $$;

GRANT EXECUTE ON FUNCTION public.current_owner_has_pin() TO authenticated;
