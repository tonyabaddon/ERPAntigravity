-- Stok Opname Phase E Task 12:
-- Make witness optional at schema level so tenant SOP can vary.
-- Default behavior unchanged via opname_require_witness=true.
--
-- Spec originally assumed a generic tenant_settings (key/value) table; that
-- doesn't exist in this project. We add the flag as a column on the existing
-- single-row company_settings table — same access pattern (Owner-only via
-- UI), no new infra. Future per-tenant generalization can migrate to a
-- key-value table without changing the RPC contract.

-- 1) Schema relax: witness column nullable + conditional CHECK
ALTER TABLE public.stock_opname_sessions
  ALTER COLUMN witnessed_by_user_id DROP NOT NULL;

ALTER TABLE public.stock_opname_sessions
  DROP CONSTRAINT IF EXISTS chk_two_person;

ALTER TABLE public.stock_opname_sessions
  ADD CONSTRAINT chk_two_person_when_witness_present
  CHECK (witnessed_by_user_id IS NULL
         OR counted_by_user_id <> witnessed_by_user_id);

-- 2) Settings flag on company_settings (single-row config table).
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS opname_require_witness BOOLEAN NOT NULL DEFAULT TRUE;

-- 3) Read helper for RPC use (Task 13 uses this).
CREATE OR REPLACE FUNCTION public._opname_require_witness()
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_val BOOLEAN;
BEGIN
  SELECT opname_require_witness INTO v_val FROM company_settings ORDER BY id LIMIT 1;
  RETURN COALESCE(v_val, TRUE);  -- MSME-safe default
END $$;

GRANT EXECUTE ON FUNCTION public._opname_require_witness() TO authenticated;
