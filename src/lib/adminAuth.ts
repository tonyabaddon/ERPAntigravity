/**
 * Lightweight super-admin check for the platform-admin FE.
 *
 * Since all current platform admins ARE super admins (only the founder is an admin),
 * we use is_platform_admin as a proxy.
 *
 * TODO(wave-4b): swap to admin_role JWT claim once Auth Hook adds it.
 * Backend still gated via _assert_super_admin_from_jwt() — this is UX polish only.
 *
 * We deliberately do NOT cache the result. The JWT lookup is cheap (single
 * getSession call, no network round-trip), and caching would leave a demoted
 * admin with stale edit privileges until reload once Wave 4b lands the
 * admin_role JWT claim. Backend gates every call regardless.
 */

import { tenantContextService } from './supabaseClient';

/** Returns true when the current session belongs to a super admin. */
export async function isSuperAdmin(): Promise<boolean> {
  return tenantContextService.isPlatformAdmin();
}
