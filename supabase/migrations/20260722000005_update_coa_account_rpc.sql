-- Phase 0d Task 1: update_coa_account RPC
-- Allows Owner to edit COA account name, description, and active status.
-- System accounts cannot be deactivated.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_coa_account(
  p_id           uuid,
  p_account_name text,
  p_description  text,
  p_is_active    boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing public.chart_of_accounts%ROWTYPE;
BEGIN
  -- Gate: only active Owner may call this RPC
  PERFORM public._assert_owner_active();

  -- Lookup row
  SELECT * INTO v_existing
    FROM public.chart_of_accounts
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COA_NOT_FOUND: Akun COA dengan id % tidak ditemukan', p_id;
  END IF;

  -- Validate account name length
  IF length(trim(p_account_name)) < 3 THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_NAME: Nama akun minimal 3 karakter';
  END IF;

  -- Protect system accounts from deactivation
  IF v_existing.is_system = true AND p_is_active = false AND v_existing.is_active = true THEN
    RAISE EXCEPTION 'SYSTEM_ACCOUNT_PROTECTED: Akun sistem tidak bisa dinonaktifkan';
  END IF;

  -- Update: system accounts keep their current is_active regardless of p_is_active
  UPDATE public.chart_of_accounts
     SET account_name = trim(p_account_name),
         description  = p_description,
         is_active    = CASE
                          WHEN v_existing.is_system THEN v_existing.is_active
                          ELSE p_is_active
                        END
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'updated_at', now());
END $$;

GRANT EXECUTE ON FUNCTION public.update_coa_account(uuid, text, text, boolean) TO authenticated;

COMMIT;
