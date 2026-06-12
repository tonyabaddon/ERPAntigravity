-- Backfill `can_manage_warehouses` into existing admin_users.permissions JSONB.
--
-- Context: AuthScreen reads `admin_users.permissions` as the user's runtime
-- permission set (NOT ALL_PERMISSIONS from the bundle). The Owner's existing
-- row predates the 2026-06-13 warehouse spec, so it lacks the new
-- `can_manage_warehouses` key. The Sidebar entry "Manajemen Gudang" is gated
-- via `can_manage_warehouses === true` (opt-in for `can_` keys), so without
-- this backfill the new entry never appears to existing users.
--
-- This migration ONLY adds the key when missing. It does NOT overwrite an
-- explicit `false` (which a Custom-role user might have). Owners get true;
-- Custom/Staff users get false (they shouldn't manage warehouses by default).

BEGIN;

-- Owners: default true
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_manage_warehouses}',
     'true'::jsonb,
     true
   )
 WHERE role = 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_manage_warehouses'));

-- All other roles: default false (must be explicitly granted later if needed)
UPDATE public.admin_users
   SET permissions = jsonb_set(
     COALESCE(permissions, '{}'::jsonb),
     '{can_manage_warehouses}',
     'false'::jsonb,
     true
   )
 WHERE role <> 'Owner'
   AND (permissions IS NULL OR NOT (permissions ? 'can_manage_warehouses'));

COMMIT;
