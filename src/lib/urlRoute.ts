/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  'pipeline',
  'order-history',
  'pelanggan',
  'laporan',
  'pembelian',
  'kasir',
  'penjualanBaru',
  'persetujuan',
  'rekonsiliasi',
  'wip-list',
  'penjualan',
]);

export interface RouteState {
  screen: ActivePage;
  params: Record<string, string>;
}

/**
 * Pure: parse a query-string ("?key=val&...") into a RouteState.
 * Unknown screens silently fall back to 'dashboard' (web-standard behavior).
 */
export function parseSearch(search: string): RouteState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawScreen = params.get('screen') ?? '';
  const screen: ActivePage = ACTIVE_PAGES.has(rawScreen as ActivePage)
    ? (rawScreen as ActivePage)
    : 'dashboard';
  params.delete('screen');
  const out: Record<string, string> = {};
  params.forEach((value, key) => { out[key] = value; });
  return { screen, params: out };
}
