/**
 * Sentry error tracking initializer.
 *
 * Exports `initSentry()` — call ONCE before createRoot in src/main.tsx.
 * When VITE_SENTRY_DSN is absent (local dev, CI without DSN set), this is a
 * complete no-op: the Sentry SDK is imported but never initialised, so every
 * subsequent Sentry call (captureException, setTag, setUser) is safe to call
 * anywhere — the SDK returns silently without throwing.
 */

import * as Sentry from '@sentry/react';

/** PII patterns scrubbed from every event before it leaves the browser. */
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}/g;
// Indonesian WA phone numbers: starts 628 or 08, followed by 8-12 digits.
const WA_PHONE_RE = /\b(628|08)\d{8,12}\b/g;
// PII JSON key names whose values we strip from nested objects.
const PII_KEYS = new Set([
  'password', 'pin', 'new_pin', 'old_pin',
  'customer_phone', 'nomor_hp', 'customer_name', 'nama_pelanggan',
]);

/**
 * Walk a value tree and scrub PII in-place.
 * Operates on plain objects and arrays only; primitives are returned as-is
 * (or redacted if they look like a JWT or WA phone).
 */
function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(JWT_RE, '[JWT_REDACTED]')
      .replace(WA_PHONE_RE, '[PHONE_REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = PII_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : scrubValue(v);
    }
    return result;
  }
  return value;
}

/**
 * Scrub PII from a Sentry event before transmission.
 * - Removes Authorization headers from captured request data.
 * - Strips JWT tokens and WA phone numbers from all string values.
 * - Redacts known PII JSON keys in breadcrumb data.
 */
function scrubbedEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Scrub request headers.
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    if (headers['Authorization']) headers['Authorization'] = '[REDACTED]';
    if (headers['authorization']) headers['authorization'] = '[REDACTED]';
    if (headers['Cookie']) headers['Cookie'] = '[REDACTED]';
    if (headers['cookie']) headers['cookie'] = '[REDACTED]';
  }

  // Scrub breadcrumb messages and data.
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data) {
        crumb.data = scrubValue(crumb.data) as Record<string, string>;
      }
      if (typeof crumb.message === 'string') {
        crumb.message = crumb.message
          .replace(JWT_RE, '[JWT_REDACTED]')
          .replace(WA_PHONE_RE, '[PHONE_REDACTED]');
        // Reset lastIndex because the regexes use the /g flag.
        JWT_RE.lastIndex = 0;
        WA_PHONE_RE.lastIndex = 0;
      }
    }
  }

  return event;
}

/**
 * Initialise Sentry. No-op when VITE_SENTRY_DSN is absent.
 *
 * Must be called before createRoot so the SDK can wrap React's error
 * boundaries and capture hydration errors.
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    // Dormant mode: SDK not initialised. All subsequent Sentry calls are no-ops.
    return;
  }

  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : '';

  Sentry.init({
    dsn,

    environment:
      (import.meta.env.VITE_SENTRY_ENV as string | undefined) ??
      (hostname === 'app.caleo.id' ? 'production' : 'staging'),

    release: import.meta.env.VITE_COMMIT_SHA as string | undefined,

    // 10 % of frontend transactions — stays well under 10k/month free limit.
    tracesSampleRate: 0.1,

    // Suppress browser-noise errors that carry no actionable signal.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'NetworkError when attempting to fetch resource',
      'Load failed',
      'ChunkLoadError',
    ],

    beforeSend(event) {
      return scrubbedEvent(event);
    },
  });
}
