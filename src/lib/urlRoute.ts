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
