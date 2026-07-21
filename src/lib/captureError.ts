/**
 * Thin wrappers around Sentry.captureException / captureMessage that also
 * preserve the original console.error output.
 *
 * Usage:
 *   import { captureError, captureMessage } from '@/lib/captureError';
 *
 *   captureError(err, { feature: 'pembelian', action: 'save_po' });
 *   captureMessage('Something went wrong', 'error');
 *
 * Safe no-op when VITE_SENTRY_DSN is absent (Sentry SDK dormant mode).
 */

import * as Sentry from '@sentry/react';

/**
 * Log an error to console AND send it to Sentry.
 * @param err   - The caught error (any shape — Sentry handles non-Error values).
 * @param context - Optional key-value bag attached as Sentry `extra` data.
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.error(err, context);
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/**
 * Log a string message to console AND send it to Sentry as a message event.
 * @param msg   - Human-readable message string.
 * @param level - Sentry severity level (default: 'error').
 */
export function captureMessage(msg: string, level: 'info' | 'warning' | 'error' = 'error'): void {
  // eslint-disable-next-line no-console
  console.error(msg);
  Sentry.captureMessage(msg, level);
}
