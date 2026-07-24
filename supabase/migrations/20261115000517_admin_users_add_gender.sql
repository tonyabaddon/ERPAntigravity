-- Migration 20261115000517: add gender column to admin_users
--
-- Feature: gender-aware default profile avatar (spec 2026-07-24).
-- Founder complaint: broken image icon in Sidebar for OTP-login admins
-- (no OAuth avatar_url). Fix: gender field + <AvatarBadge> component
-- with 3 flat SVG variants (M/F/N) in Caleo palette.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'N'
  CHECK (gender IN ('M', 'F', 'N'));

-- Explicit backfill (redundant given DEFAULT but authoritative for verify)
UPDATE public.admin_users SET gender = 'N' WHERE gender IS NULL OR gender NOT IN ('M','F','N');

-- Verify every row has valid gender
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.admin_users WHERE gender NOT IN ('M','F','N');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'admin_users backfill: % rows with invalid gender', v_bad;
  END IF;
  RAISE NOTICE 'admin_users.gender backfilled: all rows valid';
END $$;
