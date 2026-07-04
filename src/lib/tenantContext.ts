/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Synchronous accessor for tenant slug — read from window.location.
// Used by URL routing + UI display. Auth identity comes from JWT (server-baked).

const SLUG_RE = /^\/t\/([a-z0-9][a-z0-9-]{2,29})(?:\/|$)/;

export function getTenantSlugFromURL(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(SLUG_RE);
  return m ? m[1] : null;
}
