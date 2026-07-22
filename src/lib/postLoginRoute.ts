// src/lib/postLoginRoute.ts
//
// Pure routing decision for post-login navigation. Extracted from
// `AuthScreen.afterLogin` so the decision table is unit-testable without
// mounting the AuthScreen component or mocking Supabase.
//
// Invoked AFTER `handleLoginSuccess` restores the pending deep-link URL, so
// `pathname` is expected to be the URL the user originally requested (or `/`
// / `/login` if there was no deep-link).

export interface PostLoginRouteInput {
  /** Current window.location.pathname (post deep-link restore). */
  pathname: string;
  /** Result of `tenantContextService.isPlatformAdmin()`. */
  isPlatformAdmin: boolean;
  /** Tenant slug from `bootstrap_tenant_context` — null if none. */
  tenantSlug: string | null;
  /**
   * Current window.location.hostname. Distinguishes admin surface
   * (admin.caleo.id, staging.admin.caleo.id) from tenant surface
   * (app.caleo.id, staging.app.caleo.id, localhost).
   *
   * The 4-hostname deployment model (founder clarified 2026-07-22):
   *   app.caleo.id           = PROD tenant dashboard
   *   admin.caleo.id         = PROD admin caleo
   *   staging.app.caleo.id   = STAGING tenant dashboard
   *   staging.admin.caleo.id = STAGING admin caleo
   *
   * Absent → treated as tenant surface (backward compat with older tests).
   */
  hostname?: string;
}

export type PostLoginRoute =
  | { action: 'stay' }
  | { action: 'redirect'; href: string };

export function computePostLoginRoute(input: PostLoginRouteInput): PostLoginRoute {
  const { pathname, isPlatformAdmin, tenantSlug, hostname } = input;
  const isTenantPath = pathname.startsWith('/t/');
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAdminHostname =
    hostname === 'admin.caleo.id' || hostname === 'staging.admin.caleo.id';

  if (isPlatformAdmin) {
    // Platform admin honors any tenant or admin deep-link. App.tsx renders
    // the impersonation gate for /t/<slug>/* if a matching impersonation
    // claim isn't yet in the JWT.
    if (isTenantPath || isAdminPath) return { action: 'stay' };
    // Hostname-aware default: on admin.caleo.id → /admin; on app.caleo.id
    // (or any non-admin hostname), platform admin defaults to their tenant
    // dashboard if they have one, else /select-tenant. Prevents the
    // "app.caleo.id lands on caleo admin" bug (2026-07-22 founder report).
    if (isAdminHostname) return { action: 'redirect', href: '/admin' };
    if (tenantSlug) return { action: 'redirect', href: `/t/${tenantSlug}/dashboard` };
    return { action: 'redirect', href: '/select-tenant' };
  }

  // Regular tenant user. Preserve any /t/* deep-link — the App slug-guard
  // rewrites cross-tenant URLs to the session's own slug.
  if (isTenantPath) return { action: 'stay' };

  if (tenantSlug) return { action: 'redirect', href: `/t/${tenantSlug}/dashboard` };
  return { action: 'redirect', href: '/select-tenant' };
}
