/**
 * Lightweight role-check helpers for the platform-admin frontend.
 *
 * Both functions read the `platform_admin_role` JWT claim minted by the
 * custom_access_token_hook (Wave 6 Task 1). No network round-trip — the
 * session is already cached by the Supabase client.
 *
 * Safe defaults:
 *  - Missing claim → false (handles pre-hook JWTs and tenant users)
 *  - No session → false
 *
 * Backend is still gated via _is_super_admin_from_jwt() — these helpers
 * are UX polish only (hide restricted nav items / edit buttons).
 */

import { supabase } from './supabaseClient';
import { decodeJwt } from './jwt';

/** Returns true only when the JWT carries platform_admin_role = 'super_admin'. */
export async function isSuperAdmin(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;
  const claims = decodeJwt(session.access_token);
  return claims['platform_admin_role'] === 'super_admin';
}

/**
 * Returns true only when the JWT carries platform_admin_role = 'sales_rep'.
 *
 * Deliberately NOT implemented as `!(await isSuperAdmin())` — tenant users
 * lack the claim entirely and must NOT be treated as sales_rep.
 */
export async function isSalesRep(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return false;
  const claims = decodeJwt(session.access_token);
  return claims['platform_admin_role'] === 'sales_rep';
}
