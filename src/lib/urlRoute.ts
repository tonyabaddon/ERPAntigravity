/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import type React from 'react';
import type { ActivePage } from '../types';

/**
 * Pure: build URL query string for a screen + params.
 * Used as `href` attribute on anchor tags so Ctrl+click / middle-click / right-click
 * open-in-new-tab work natively via the browser.
 */
export function buildHref(screen: ActivePage, params?: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  search.set('screen', screen);
  if (params) {
    // Sort keys for deterministic output (makes tests stable and URLs predictable).
    const keys = Object.keys(params).sort();
    for (const key of keys) {
      const value = params[key];
      if (value === undefined || value === null || value === '') continue;
      search.set(key, value);
    }
  }
  return '?' + search.toString();
}

/**
 * Authoritative whitelist of valid screens. Mirrors the `ActivePage` union
 * in src/types.ts. Used to silently fall back to 'dashboard' when a URL
 * carries an unknown screen value (e.g. typo, deprecated screen, malicious).
 *
 * NOTE: when adding a new entry to ActivePage, add it here too.
 */
export const ACTIVE_PAGES: ReadonlySet<ActivePage> = new Set<ActivePage>([
  'dashboard',
  'sales-inbox',
  'ai-stock',
  'manajemen-gudang',
  'stok-opname',
  'user-management',
  'notifications',
  'auth',
  'whatsapp-ai',
  'settings',
  'order-history',
  'pelanggan',
  'piutang',
  'laporan',
  'pembelian',
  'kasir',
  'penjualanBaru',
  'persetujuan',
  'keputusan-owner',
  'rekonsiliasi',
  'penjualan',
  'salesLanding',
  'daftarPesanan',
  'invoicePreview',
  'daftarPenawaran',
  'akuntansi',
  'kasBank',
  'kasBankDetail',
  'warehouse-transfer',
  'warehouse-transfer-create',
  'warehouse-transfer-detail',
  'piutang-wa-reminder',
]);

export interface RouteState {
  screen: ActivePage;
  params: Record<string, string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pathname-based routing for multi-tenant URLs (/t/<slug>/*)
// ──────────────────────────────────────────────────────────────────────────────

const TENANT_SLUG_RE = /^\/t\/([a-z0-9][a-z0-9-]{2,29})(?:\/(.*))?$/;

/** Screen type widened for platform-level pages not in the tenant ActivePage union. */
export type RouteScreen = ActivePage | 'select-tenant' | 'login' | 'admin';

export interface Route {
  tenantSlug: string | null;
  screen: RouteScreen;
  params: Record<string, string>;
  isPlatformAdminArea: boolean;
}

/**
 * Pure: extract screen name from a pathname segment (e.g. "/dashboard" → "dashboard").
 * Falls back to "dashboard" for unknown values.
 */
function parseScreenFromPath(pathname: string, _search: URLSearchParams): { screen: RouteScreen; params: Record<string, string> } {
  // Strip leading slash and take the first path segment as the screen name
  const segment = pathname.replace(/^\//, '').split('/')[0] ?? '';
  // Empty segment (root URL "/" or "/t/<slug>/") → dashboard (landing).
  // Non-empty but unknown segment → 'not-found' sentinel (App.tsx renders 404).
  const screen: RouteScreen = segment === ''
    ? 'dashboard'
    : (ACTIVE_PAGES.has(segment as ActivePage) ? (segment as ActivePage) : 'not-found');
  return { screen, params: {} };
}

/**
 * Pure: parse a pathname + search into a Route object that includes tenant
 * slug and platform-admin-area flag. Used for multi-tenant path-based routing.
 *
 * Route patterns:
 *   /t/<slug>/<screen>  → tenantSlug='<slug>', screen='<screen>'
 *   /admin/*            → isPlatformAdminArea=true
 *   /select-tenant      → screen='select-tenant'
 *   /login              → screen='login'
 *   /<screen>           → legacy path, tenantSlug=null
 */
export function parseRoute(pathname: string, search: URLSearchParams): Route {
  // Platform admin area
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return { tenantSlug: null, screen: 'admin', params: {}, isPlatformAdminArea: true };
  }
  if (pathname === '/select-tenant') {
    return { tenantSlug: null, screen: 'select-tenant', params: {}, isPlatformAdminArea: false };
  }
  if (pathname === '/login') {
    return { tenantSlug: null, screen: 'login', params: {}, isPlatformAdminArea: false };
  }
  // Tenant-scoped: /t/<slug>/<screen>
  const m = pathname.match(TENANT_SLUG_RE);
  if (m) {
    const slug = m[1];
    const rest = '/' + (m[2] ?? '');
    return { tenantSlug: slug, ...parseScreenFromPath(rest, search), isPlatformAdminArea: false };
  }
  // Legacy path (no /t/ prefix) — return null slug, existing screen resolution
  return { tenantSlug: null, ...parseScreenFromPath(pathname, search), isPlatformAdminArea: false };
}

/**
 * Pure: parse a query-string ("?key=val&...") into a RouteState.
 * Unknown screens silently fall back to 'dashboard' (web-standard behavior).
 */
export function parseSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawScreen = params.get('screen') ?? '';
  // Deprecated: Pipeline menu dihapus 2026-06-21; redirect bookmark lama ke sales-inbox
  if (rawScreen === 'pipeline') {
    params.delete('screen');
    const out: Record<string, string> = {};
    params.forEach((value, key) => { out[key] = value; });
    return { screen: 'sales-inbox', params: out };
  }
  // Empty ?screen= (root URL with no screen param) → dashboard (landing).
  // Non-empty but unknown → 'not-found' sentinel (App.tsx renders 404).
  const screen: ActivePage = rawScreen === ''
    ? 'dashboard'
    : (ACTIVE_PAGES.has(rawScreen as ActivePage) ? (rawScreen as ActivePage) : 'not-found');
  params.delete('screen');
  const out: Record<string, string> = {};
  params.forEach((value, key) => { out[key] = value; });
  return { screen, params: out };
}

/**
 * Pure: decide whether this click should be intercepted for SPA navigation
 * (preventDefault + pushState) or left to the browser's native handling
 * (which is what opens new tabs / new windows).
 *
 * Intercept only plain left-click. Any modifier (Ctrl/Cmd/Shift/Alt) or
 * non-left button falls through to the browser.
 */
export function shouldInterceptClick(e: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.button !== 0) return false;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  return true;
}

const ROUTE_CHANGE_EVENT = 'urlroute:change';

/**
 * Push a new URL into history and notify subscribers. Used for in-place
 * SPA navigation (the path triggered by plain left-click — modifier-key
 * clicks bypass this and let the browser handle).
 */
export function navigate(screen: ActivePage, params?: Record<string, string | undefined | null>): void {
  const href = buildHref(screen, params);
  window.history.pushState({}, '', href);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/**
 * Replace the current URL without adding to history. Use for fallback
 * cases (unknown screen, permission denied) where we want the URL to
 * reflect reality but not pollute back-button history.
 */
export function replaceRoute(screen: ActivePage, params?: Record<string, string | undefined | null>): void {
  const href = buildHref(screen, params);
  window.history.replaceState({}, '', href);
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/**
 * Click handler for anchor tags that should behave as SPA navigation
 * on plain left-click and as native browser navigation (new tab, new
 * window) under any modifier key.
 *
 * Usage:
 *   <a href={buildHref('pelanggan')}
 *      onClick={(e) => handleSPAClick(e, 'pelanggan')}>
 *     Pelanggan
 *   </a>
 */
export function handleSPAClick(
  e: React.MouseEvent,
  screen: ActivePage,
  params?: Record<string, string | undefined | null>,
): void {
  if (!shouldInterceptClick(e)) return;
  e.preventDefault();
  navigate(screen, params);
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  window.addEventListener(ROUTE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(ROUTE_CHANGE_EVENT, callback);
  };
}

// Cache the last-parsed route so useSyncExternalStore can return a stable
// reference between renders when the URL hasn't actually changed. Without
// this, every render would parse and create a fresh object → infinite loop
// or unnecessary work.
let lastSearch: string | null = null;
let lastRoute: RouteState = { screen: 'dashboard', params: {} };
function getSnapshot(): RouteState {
  const current = window.location.search;
  if (current !== lastSearch) {
    lastSearch = current;
    lastRoute = parseSearch(current);
  }
  return lastRoute;
}
function getServerSnapshot(): RouteState {
  return { screen: 'dashboard', params: {} };
}

/**
 * React hook returning the current route. Re-renders the component
 * whenever the route changes via navigate(), replaceRoute(), or the
 * browser's back/forward buttons.
 *
 * Implemented via useSyncExternalStore for safety with React 19
 * concurrent rendering.
 */
export function useURLRoute(): RouteState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
