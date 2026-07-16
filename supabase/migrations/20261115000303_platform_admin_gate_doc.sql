-- Migration 303: Document platform_admins as admin.caleo.id gate + seed founder
-- Phase 1 Task 3 (Day 3): Custom domain + subdomain architecture
--
-- Context: platform_admins table already exists (created in earlier waves).
-- custom_access_token_hook already writes is_platform_admin + platform_admin_role into JWT.
-- _is_platform_admin_active_from_jwt() already used in RLS p_platform_admin_readall policies.
--
-- This migration:
-- 1. Adds formal comment to platform_admins confirming admin.caleo.id gate role
-- 2. Idempotently seeds founder as super_admin (safe re-run via ON CONFLICT DO NOTHING)
-- 3. Adds index on platform_admins.email for fast lookup in admin tooling
--
-- Reversibility: REVERSIBLE (comments and index only, no structural change)

BEGIN;

COMMENT ON TABLE public.platform_admins IS
  'Caleo platform team members. Gates admin.caleo.id access (Phase 2).
   JWT hook (custom_access_token_hook) writes is_platform_admin=true and
   platform_admin_role=<role> claims for rows with status=''active''.
   Checked by _is_platform_admin_active_from_jwt() in RLS policies.
   Migration 303: formal gate documentation for Phase 1 multi-tenant hardening.';

COMMENT ON COLUMN public.platform_admins.user_id IS
  'auth.users.id. Must match JWT sub claim for hook to activate.';

COMMENT ON COLUMN public.platform_admins.role IS
  'super_admin = full platform access. Future: support_agent = read-only impersonation.';

COMMENT ON COLUMN public.platform_admins.status IS
  'active = JWT claims injected. inactive = claims stripped. Allows revocation without row deletion.';

-- Idempotent founder seed: safe to re-run
INSERT INTO public.platform_admins (user_id, email, role, status, name)
SELECT
  u.id,
  u.email,
  'super_admin',
  'active',
  'Tony Wei'
FROM auth.users u
WHERE u.email = 'tonywei.office@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Index on email for admin tooling lookup (idempotent)
CREATE INDEX IF NOT EXISTS ix_platform_admins_email
  ON public.platform_admins (email);

COMMIT;
