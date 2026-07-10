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
}

export type PostLoginRoute =
  | { action: 'stay' }
  | { action: 'redirect'; href: string };

export function computePostLoginRoute(input: PostLoginRouteInput): PostLoginRoute {
  const { pathname, isPlatformAdmin, tenantSlug } = input;
  const isTenantPath = pathname.startsWith('/t/');
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  if (isPlatformAdmin) {
    // Platform admin honors any tenant or admin deep-link. App.tsx renders
    // the impersonation gate for /t/<slug>/* if a matching impersonation
    // claim isn't yet in the JWT.
    if (isTenantPath || isAdminPath) return { action: 'stay' };
    return { action: 'redirect', href: '/admin' };
  }

  // Regular tenant user. Preserve any /t/* deep-link — the App slug-guard
  // rewrites cross-tenant URLs to the session's own slug.
  if (isTenantPath) return { action: 'stay' };

  if (tenantSlug) return { action: 'redirect', href: `/t/${tenantSlug}/dashboard` };
  return { action: 'redirect', href: '/select-tenant' };
}
